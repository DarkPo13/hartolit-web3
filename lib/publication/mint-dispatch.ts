import "server-only";

import { z } from "zod";
import type { Prisma, PublicationMintAttempt } from "@/generated/prisma/client";
import type { PublicClient } from "viem";
import { getDb } from "@/lib/db";
import { canonicalize } from "@/lib/hash";
import { WorkflowError } from "@/lib/review/service";
import { lockMintCandidate } from "./mint-preparation";
import { inspectMintReadiness, mintTransactionRequest, type MintReader, type MintIntent } from "./chain-mint";

type DispatchReader = MintReader & Pick<PublicClient, "getTransactionCount">;
const dispatchSchema = z.strictObject({
  preparationId: z.uuid(), requestId: z.uuid(), expectedIntentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  acknowledgement: z.literal("SEND_EXACT_MINT"),
});
const freshnessMs = 15_000;
const deadlineMs = 5 * 60_000;

async function load(tx: Prisma.TransactionClient, adminId: string, passportId: string, data: z.infer<typeof dispatchSchema>, target: unknown) {
  const preparation = await tx.publicationMintPreparation.findUnique({ where: { id: data.preparationId } });
  if (!preparation) throw new WorkflowError(404, "Mint preparation not found");
  const candidate = await lockMintCandidate(tx, adminId, passportId, preparation.publicationId, target);
  if (preparation.intentJson !== canonicalize(candidate.intent) || preparation.intentSha256 !== candidate.intent.sha256 ||
    preparation.intentSha256 !== data.expectedIntentSha256 || preparation.pinAttemptId !== candidate.pin.id) {
    throw new WorkflowError(409, "The saved or reviewed mint preparation changed");
  }
  // Passport locks are independent. Serialize the shared wallet's eligibility
  // check and write too; the SQL unique index remains an independent backstop.
  const key = `hartolit:mint:${candidate.intent.chainId}:${candidate.intent.publisherWallet}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`;
  const attempt = await tx.publicationMintAttempt.findFirst({ where: { OR: [
    { preparationId: preparation.id }, { requestId: data.requestId },
    { chainId: candidate.intent.chainId, publisherWallet: candidate.intent.publisherWallet },
  ] }, select: { id: true } });
  if (attempt) throw new WorkflowError(409, "Resolve the existing wallet attempt; no new send is allowed");
  return { ...candidate, preparation };
}

/** Read-only preflight; an exclusive application wallet is still required. Other
 * software can use its nonce after these reads; no database lock can stop that.
 */
async function observedNonce(intent: MintIntent, reader: DispatchReader) {
  try {
    const startedAt = Date.now();
    if ((await inspectMintReadiness(intent, reader)).status !== "READY") throw new Error();
    const head = await reader.getBlock();
    if (head.number === null || !head.hash) throw new Error();
    const address = intent.publisherWallet as `0x${string}`;
    const latest = await reader.getTransactionCount({ address, blockNumber: head.number });
    const pending = await reader.getTransactionCount({ address, blockTag: "pending" });
    if (!Number.isSafeInteger(latest) || latest < 0 || latest !== pending ||
      await reader.getTransactionCount({ address, blockTag: "pending" }) !== latest ||
      (await reader.getBlock({ blockNumber: head.number })).hash !== head.hash || await reader.getChainId() !== intent.chainId) throw new Error();
    return { nonce: latest, startedAt };
  } catch { throw new WorkflowError(503, "Mint readiness or an idle wallet nonce could not be verified; no send was authorized"); }
}

/** Internal single-use permission, not a broadcaster. Commit DISPATCHING and the
 * wallet nonce before returning the command. Never return it on replay, even if
 * the response was lost. No HTTP caller, configured RPC or wallet send is enabled.
 */
export async function beginMintDispatch(adminId: string, passportId: string, input: unknown, selectedTarget: unknown, reader: DispatchReader) {
  const parsed = dispatchSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "Separate exact mint send acknowledgement is required");
  const data = parsed.data;
  const before = await getDb().$transaction(tx => load(tx, adminId, passportId, data, selectedTarget));
  // RPC must never hold the passport lock. Reauthorize and compare after the read.
  const observation = await observedNonce(before.intent, reader);
  const request = await mintTransactionRequest(before.intent);
  try {
    return await getDb().$transaction(async tx => {
      const current = await load(tx, adminId, passportId, data, selectedTarget);
      if (current.preparation.intentJson !== before.preparation.intentJson || current.preparation.pinAttemptId !== before.preparation.pinAttemptId ||
        Date.now() - observation.startedAt >= freshnessMs || Date.now() < observation.startedAt) {
        throw new WorkflowError(409, "Mint preflight expired or its commitment changed; no send was authorized");
      }
      const now = new Date();
      const row = await tx.publicationMintAttempt.create({ data: {
        preparationId: current.preparation.id, requestId: data.requestId, chainId: current.intent.chainId,
        publisherWallet: current.intent.publisherWallet, nonce: BigInt(observation.nonce), createdAt: now, deadlineAt: new Date(now.getTime() + deadlineMs),
      } });
      await tx.publication.update({ where: { id: current.reservation.id }, data: { status: "CHAIN_PENDING" } });
      await tx.auditLog.create({ data: { passportId, publicationId: current.reservation.id, actorId: adminId,
        version: current.reservation.passportVersion, action: "PUBLICATION_MINT_DISPATCH_STARTED", fromStatus: "APPROVED", toStatus: "APPROVED", note: `Mint attempt: ${row.id}` } });
      return { attemptId: row.id, preparationId: row.preparationId, intentSha256: current.intent.sha256,
        deadlineAt: row.deadlineAt.toISOString(), request: { ...request, nonce: observation.nonce }, issued: false as const, canResend: false as const };
    });
  } catch (error) {
    // The SQL wallet-slot index also serializes different passports, whose row
    // locks are independent. A losing transaction rolls back all its writes.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      throw new WorkflowError(409, "The wallet nonce or attempt is already reserved; no new send is allowed");
    }
    throw error;
  }
}

function metadata(row: PublicationMintAttempt) {
  return { attemptId: row.id, status: row.status, nonce: row.nonce.toString(), deadlineAt: row.deadlineAt.toISOString(),
    unknownAt: row.unknownAt?.toISOString() ?? null, issued: false as const, canResend: false as const };
}

async function unknownOutcome(passportId: string, attemptId: string, expiredOnly: boolean) {
  return getDb().$transaction(async tx => {
    const locked = await tx.passport.updateMany({ where: { id: passportId }, data: { updatedAt: new Date() } });
    if (!locked.count) throw new WorkflowError(404, "Passport not found");
    const row = await tx.publicationMintAttempt.findFirst({ where: { id: attemptId, preparation: { publication: { passportId, status: "CHAIN_PENDING" } } },
      include: { preparation: { include: { publication: true } } } });
    if (!row) throw new WorkflowError(409, "Mint attempt is not awaiting an external outcome");
    if (row.status === "UNKNOWN") return metadata(row);
    const now = new Date();
    if (expiredOnly && row.deadlineAt > now) throw new WorkflowError(409, "Mint dispatch is still within its deadline");
    const updated = await tx.publicationMintAttempt.update({ where: { id: row.id }, data: { status: "UNKNOWN", unknownAt: now } });
    await tx.auditLog.create({ data: { passportId, publicationId: row.preparation.publicationId, actorId: "system:publication-recovery",
      version: row.preparation.publication.passportVersion, action: "PUBLICATION_MINT_OUTCOME_UNKNOWN", fromStatus: "APPROVED", toStatus: "APPROVED", note: `Mint attempt: ${row.id}` } });
    return metadata(updated);
  });
}

// Recovery may run after actor/config revocation. Neither deadline nor refusal
// proves nothing was broadcast; UNKNOWN retains the wallet slot and nonce.
export async function recordUnknownMintOutcome(passportId: string, attemptId: string) { return unknownOutcome(passportId, attemptId, false); }
export async function recoverExpiredMintDispatch(passportId: string, attemptId: string) { return unknownOutcome(passportId, attemptId, true); }
