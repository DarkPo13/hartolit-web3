import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { WorkflowError } from "@/lib/review/service";
import type { MintIntent, MintReader } from "./chain-mint";
import { discoverMintTransaction } from "./mint-discovery";
import { lockDispatchedMint, finalizeMintPublication, reconcileMintResult, reconcileMintCancellation } from "./mint-observation";
import { requireMintMonitorLease } from "./mint-monitor-lease";
import { boundedMintMonitorReader } from "./mint-reader";

type ReaderFactory = (intent: MintIntent) => MintReader;
const batchSchema = z.strictObject({ limit: z.number().int().min(1).max(5) });
// D76: a closed proof re-verified unchanged at ten times the depth is deep enough to settle;
// the 24 hours since closure are checked in SQL when the lease is released.
const settledDepth = (checked: { status: string; confirmations?: string }, intent: MintIntent, expected: string) =>
  checked.status === expected && typeof checked.confirmations === "string" && BigInt(checked.confirmations) >= 10n * BigInt(intent.requiredConfirmations);

// Keep the existing internal export for monitor/recovery consumers.
export { boundedMintMonitorReader } from "./mint-reader";

/** Internal scheduler building block. Claims do not grant send permission.
 * No actor, provider URL, transaction hash or signing key comes from a request.
 */
export async function monitorMintAttempt(passportId: string, attemptId: string, readerFor: ReaderFactory) {
  if (!z.uuid().safeParse(passportId).success || !z.uuid().safeParse(attemptId).success) throw new WorkflowError(422, "Invalid mint monitor target");
  const lease = { token: randomUUID() };
  const claimed = await getDb().$transaction(async tx => {
    const locked = await tx.passport.updateMany({ where: { id: passportId }, data: { updatedAt: new Date() } });
    if (!locked.count) return false;
    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "PublicationMintAttempt" AS a
      SET "monitorToken" = ${lease.token}::uuid, "monitorUntil" = clock_timestamp() + interval '90 seconds',
          "observationVersion" = "observationVersion" + 1
      FROM "PublicationMintPreparation" AS p, "Publication" AS pub
      WHERE a."id" = ${attemptId}::uuid AND a."preparationId" = p."id" AND p."publicationId" = pub."id"
        AND pub."passportId" = ${passportId}::uuid AND a."monitorNextAt" <= clock_timestamp() AND a."monitorSettledAt" IS NULL
        AND (a."monitorUntil" IS NULL OR a."monitorUntil" <= clock_timestamp())
      RETURNING a."id"`;
    return rows.length === 1;
  });
  if (!claimed) return { status: "SKIPPED" as const, issued: false as const, canResend: false as const };
  let status: string = "BLOCKED", deep = false;
  try {
    const context = await getDb().$transaction(async tx => {
      const saved = await lockDispatchedMint(tx, passportId, attemptId);
      await requireMintMonitorLease(tx, attemptId, lease);
      return saved;
    });
    const reader = boundedMintMonitorReader(readerFor(context.intent));
    if (context.failed?.status === "CANCELLED") {
      const checked = await reconcileMintCancellation(passportId, attemptId, {}, reader, lease);
      status = checked.status; deep = settledDepth(checked, context.intent, "CANCELLED");
    } else if (context.finalized || context.failed) {
      // Preserve the original proof and sticky quarantine; never substitute a
      // replacement for an already closed transaction, successful or failed.
      const transactionId = (context.attempt.finalizedObservation ?? context.attempt.failedObservation)!.transactionId!;
      const checked = await reconcileMintResult(passportId, attemptId, { transactionId }, reader, lease);
      status = checked.status; deep = settledDepth(checked, context.intent, (context.finalized ?? context.failed)!.status);
    } else {
      const search = await discoverMintTransaction(passportId, attemptId, {}, reader, lease);
      status = search.status;
      if (search.status === "FOUND" && search.matchedTransactionId) {
        status = (await finalizeMintPublication(passportId, attemptId, { transactionId: search.matchedTransactionId }, reader, lease)).status;
      }
    }
  } catch (error) {
    // No private provider error text or commitment data escapes this boundary.
    status = error instanceof WorkflowError && error.status === 409 ? "BLOCKED" : "UNAVAILABLE";
  } finally {
    await getDb().$transaction(async tx => {
      await tx.passport.updateMany({ where: { id: passportId }, data: { updatedAt: new Date() } });
      // Token CAS: an old worker cannot clear/reschedule a reclaimed lease.
      await tx.$executeRaw`
        UPDATE "PublicationMintAttempt"
        SET "monitorToken" = NULL, "monitorUntil" = NULL,
            "monitorNextAt" = clock_timestamp() + ${["BLOCKED", "UNAVAILABLE"].includes(status) ? 120 : 30} * interval '1 second',
            "monitorSettledAt" = CASE WHEN ${deep} AND "quarantinedAt" IS NULL AND "status" IN ('FINALIZED', 'FAILED_TERMINAL')
              AND COALESCE("finalizedAt", "failedAt") <= clock_timestamp() - interval '24 hours' THEN clock_timestamp() ELSE "monitorSettledAt" END
        WHERE "id" = ${attemptId}::uuid AND "monitorToken" = ${lease.token}::uuid`;
    });
  }
  return { status, issued: false as const, canResend: false as const };
}

/** Bounded tick for a future trusted scheduler, not a self-starting daemon or
 * HTTP endpoint. Stable due ordering prevents permanent oldest-row starvation.
 */
export async function runMintMonitorBatch(input: unknown, readerFor: ReaderFactory) {
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "Mint monitor batch limit must be between 1 and 5");
  const rows = await getDb().$queryRaw<{ id: string; passportId: string }[]>`
    SELECT a."id", pub."passportId" FROM "PublicationMintAttempt" AS a
    JOIN "PublicationMintPreparation" AS p ON p."id" = a."preparationId"
    JOIN "Publication" AS pub ON pub."id" = p."publicationId"
    WHERE a."monitorNextAt" <= clock_timestamp() AND (a."monitorUntil" IS NULL OR a."monitorUntil" <= clock_timestamp())
      AND a."monitorSettledAt" IS NULL
    ORDER BY a."monitorNextAt", a."id" LIMIT ${parsed.data.limit}`;
  const end = performance.now() + 60_000;
  const results = [];
  for (const row of rows) {
    if (performance.now() >= end) break;
    results.push(await monitorMintAttempt(row.passportId, row.id, readerFor));
  }
  return { checked: results.filter(row => row.status !== "SKIPPED").length, results, issued: false as const, canResend: false as const };
}
