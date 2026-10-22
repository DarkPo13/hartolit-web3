import "server-only";

import { z } from "zod";
import { getDb } from "@/lib/db";
import { canonicalize } from "@/lib/hash";
import { WorkflowError } from "@/lib/review/service";
import { lockDispatchedMint } from "./mint-observation";
import { searchMintPage } from "./mint-search";
import type { MintReader } from "./chain-mint";
import { requireMintMonitorLease, type MintMonitorLease } from "./mint-monitor-lease";

const inputSchema = z.strictObject({});
const cursorBinding = (row: { discoveryBlockNumber: bigint | null; discoveryBlockHash: string | null }) => canonicalize({
  number: row.discoveryBlockNumber?.toString() ?? null, hash: row.discoveryBlockHash,
});

/** Internal bounded historical recovery. Saved server anchors only: no caller
 * range/hash/URL, actor privilege, receipt adoption, finalization or resend.
 */
export async function discoverMintTransaction(passportId: string, attemptId: string, input: unknown, reader: MintReader, lease?: MintMonitorLease) {
  if (!inputSchema.safeParse(input).success) throw new WorkflowError(422, "Discovery accepts no caller range, hash or provider");
  const before = await getDb().$transaction(async tx => {
    const context = await lockDispatchedMint(tx, passportId, attemptId);
    await requireMintMonitorLease(tx, attemptId, lease);
    return context;
  });
  const attempt = before.attempt;
  if (before.finalized || before.failed) throw new WorkflowError(409, "Closed transactions use canonical readback, not discovery");
  if (attempt.dispatchBlockNumber === null || !attempt.dispatchBlockHash) throw new WorkflowError(409, "Historical attempt has no saved dispatch anchor; do not guess one");
  const anchor = { number: attempt.dispatchBlockNumber, hash: attempt.dispatchBlockHash };
  const cursor = { number: attempt.discoveryBlockNumber ?? anchor.number, hash: attempt.discoveryBlockHash ?? anchor.hash };
  const startedAt = Date.now();
  const result = await searchMintPage(before.intent, attempt.nonce, anchor, cursor, reader);
  return getDb().$transaction(async tx => {
    const current = await lockDispatchedMint(tx, passportId, attemptId);
    await requireMintMonitorLease(tx, attemptId, lease);
    if (current.attempt.observationVersion !== attempt.observationVersion || current.attempt.discoveryVersion !== attempt.discoveryVersion) {
      return { status: "SUPERSEDED" as const, issued: false as const, canResend: false as const };
    }
    if (current.binding !== before.binding || cursorBinding(current.attempt) !== cursorBinding(attempt)) throw new WorkflowError(409, "Mint search commitment or cursor changed");
    if (Date.now() < startedAt || Date.now() - startedAt >= 15_000) throw new WorkflowError(409, "Mint search expired; no progress saved");
    let transactionId: string | null = null;
    if (result.status === "FOUND") {
      const hash = result.transactionHash!;
      const existing = await tx.publicationMintTransaction.findUnique({ where: { transactionHash: hash } });
      if (existing && (existing.attemptId !== attemptId || existing.nonce !== attempt.nonce)) throw new WorkflowError(409, "Discovered transaction belongs to another attempt");
      transactionId = existing?.id ?? (await tx.publicationMintTransaction.create({ data: { attemptId, nonce: attempt.nonce, transactionHash: hash } })).id;
    }
    const revision = attempt.discoveryVersion + 1;
    const row = await tx.publicationMintDiscovery.create({ data: { attemptId, revision, ...result, transactionId } });
    const progress = result.resetToDispatchAnchor ? { discoveryBlockNumber: anchor.number, discoveryBlockHash: anchor.hash }
      : ["SCANNED", "CAUGHT_UP"].includes(result.status) && result.throughBlock !== null
        ? { discoveryBlockNumber: result.throughBlock, discoveryBlockHash: result.throughBlockHash } : {};
    await tx.publicationMintAttempt.update({ where: { id: attemptId }, data: { discoveryVersion: revision, ...progress } });
    await tx.auditLog.create({ data: { passportId, publicationId: current.publication.id, actorId: "system:publication-recovery",
      version: current.publication.passportVersion, action: "PUBLICATION_MINT_SEARCHED", fromStatus: "APPROVED", toStatus: "APPROVED", note: `Mint search ${result.status}: ${row.id}` } });
    await requireMintMonitorLease(tx, attemptId, lease);
    return { status: row.status, discoveryId: row.id, revision, observedAt: row.observedAt.toISOString(),
      fromBlock: row.fromBlock?.toString() ?? null, throughBlock: row.throughBlock?.toString() ?? null,
      headBlock: row.headBlock?.toString() ?? null, scannedBlocks: row.scannedBlocks, scannedTransactions: row.scannedTransactions,
      transactionHash: row.transactionHash, matchedTransactionId: transactionId, resetToDispatchAnchor: row.resetToDispatchAnchor,
      issued: false as const, canResend: false as const };
  });
}
