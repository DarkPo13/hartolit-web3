import "server-only";

import { z } from "zod";
import type { Prisma, PublicationMintFailure } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { canonicalize, sha256Hex } from "@/lib/hash";
import { WorkflowError } from "@/lib/review/service";
import { publicationPublisherAccess } from "./service";
import { lockDispatchedMint } from "./mint-observation";
import { mintWalletHistory, verifyMintWalletAnchors } from "./mint-wallet";
import { inspectMintTransaction, type MintReader } from "./chain-mint";
import { boundedMintMonitorReader } from "./mint-monitor";

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const inputSchema = z.strictObject({ requestId: z.uuid(), transactionId: z.uuid(), expectedIntentSha256: sha,
  expectedWalletStateSha256: sha, expectedObservationVersion: z.number().int().nonnegative(), acknowledgement: z.literal("CLOSE_REVERTED_MINT") });
type Input = z.infer<typeof inputSchema>;

async function authority(tx: Prisma.TransactionClient, adminId: string, wallet?: string) {
  const access = publicationPublisherAccess(adminId);
  if (!access.configured || !access.canProve || !access.walletAddress || (wallet && access.walletAddress !== wallet) ||
    !await tx.user.findFirst({ where: { id: adminId, role: "admin", banned: false, twoFactorEnabled: true }, select: { id: true } })) {
    throw new WorkflowError(403, "Failed-send closure requires the current designated MFA publisher and wallet");
  }
}
async function load(tx: Prisma.TransactionClient, adminId: string, passportId: string, attemptId: string, transactionId: string) {
  await authority(tx, adminId);
  const context = await lockDispatchedMint(tx, passportId, attemptId);
  const transaction = await tx.publicationMintTransaction.findFirst({ where: { id: transactionId, attemptId, nonce: context.attempt.nonce } });
  if (!transaction) throw new WorkflowError(409, "An exact-call/nonce matched transaction is required");
  await authority(tx, adminId, context.attempt.publisherWallet);
  return { ...context, transaction };
}
async function pending(tx: Prisma.TransactionClient, adminId: string, current: Awaited<ReturnType<typeof load>>) {
  if (current.finalized || current.failed) throw new WorkflowError(409, "Closed mint attempts cannot be closed again or resent");
  const history = await mintWalletHistory(tx, current.attempt.chainId, current.attempt.publisherWallet);
  await authority(tx, adminId, current.attempt.publisherWallet);
  const walletStateSha256 = await sha256Hex(canonicalize({ history: history.binding, commitment: current.binding,
    observationVersion: current.attempt.observationVersion, discoveryVersion: current.attempt.discoveryVersion,
    transactionId: current.transaction.id, hash: current.transaction.transactionHash, nonce: current.attempt.nonce.toString() }));
  return { ...current, history, walletStateSha256 };
}
function requireReview(current: Awaited<ReturnType<typeof pending>>, input: Input) {
  if (current.intent.sha256 !== input.expectedIntentSha256 || current.walletStateSha256 !== input.expectedWalletStateSha256 ||
    current.attempt.observationVersion !== input.expectedObservationVersion) throw new WorkflowError(409, "Failed-send review changed; review the current attempt again");
}
function matches(row: PublicationMintFailure, adminId: string, attemptId: string, input: Input) {
  return row.actorId === adminId && row.attemptId === attemptId && row.transactionId === input.transactionId &&
    row.intentSha256 === input.expectedIntentSha256 && row.walletStateSha256 === input.expectedWalletStateSha256 && row.reviewedObservationVersion === input.expectedObservationVersion;
}
const recorded = (row: PublicationMintFailure, quarantined: boolean) => ({ status: "RECORDED" as const, failureId: row.id,
  closedAt: row.closedAt.toISOString(), currentlyQuarantined: quarantined, issued: false as const, canResend: false as const });

/** Internal separate review. Future HTTP callers must authenticate session/origin.
 * Known hash/candidate alone is never authority to release an uncertain nonce.
 */
export async function getMintFailureReview(adminId: string, passportId: string, attemptId: string, transactionId: string) {
  return getDb().$transaction(async tx => {
    const current = await pending(tx, adminId, await load(tx, adminId, passportId, attemptId, transactionId));
    return { transactionId, intentSha256: current.intent.sha256, walletStateSha256: current.walletStateSha256,
      observationVersion: current.attempt.observationVersion, nonce: current.attempt.nonce.toString(),
      transactionHash: current.transaction.transactionHash, issued: false as const, canResend: false as const };
  });
}

/** Close only a fresh canonical EVM REVERTED exact mint/nonce. Release the shared
 * active slot, never the original preparation/request/nonce or permission to retry.
 * Cancellation, pending, missing and timeout remain unresolved. No broadcaster.
 */
export async function closeRevertedMint(adminId: string, passportId: string, attemptId: string, input: unknown, trustedReader: MintReader) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "Exact failed-send review and separate acknowledgement are required");
  const data = parsed.data;
  const before = await getDb().$transaction(async tx => {
    const current = await load(tx, adminId, passportId, attemptId, data.transactionId);
    const existing = await tx.publicationMintFailure.findUnique({ where: { requestId: data.requestId } });
    if (existing) {
      if (!matches(existing, adminId, attemptId, data)) throw new WorkflowError(409, "Failure request belongs to another review");
      return { recorded: recorded(existing, !!current.attempt.quarantinedAt) };
    }
    const candidate = await pending(tx, adminId, current);
    requireReview(candidate, data);
    return { candidate };
  });
  if (before.recorded) return before.recorded;
  const candidate = before.candidate!, startedAt = Date.now(), reader = boundedMintMonitorReader(trustedReader);
  let result;
  try {
    const head = await verifyMintWalletAnchors(candidate.history.anchors, reader);
    result = await inspectMintTransaction(candidate.intent, candidate.transaction.transactionHash, reader, candidate.attempt.nonce);
    if (head && ((await reader.getBlock({ blockNumber: head.number })).hash !== head.hash || await reader.getChainId() !== 97)) throw new Error();
  } catch { throw new WorkflowError(503, "Failed-send proof could not be freshly verified; wallet slot remains held"); }
  if (result.status !== "REVERTED") throw new WorkflowError(409, "Only a sufficiently confirmed exact reverted mint releases this slot");
  return getDb().$transaction(async tx => {
    const current = await load(tx, adminId, passportId, attemptId, data.transactionId);
    const existing = await tx.publicationMintFailure.findUnique({ where: { requestId: data.requestId } });
    if (existing) {
      if (!matches(existing, adminId, attemptId, data)) throw new WorkflowError(409, "Failure request belongs to another review");
      return recorded(existing, !!current.attempt.quarantinedAt);
    }
    const fresh = await pending(tx, adminId, current);
    requireReview(fresh, data);
    if (fresh.binding !== candidate.binding || Date.now() < startedAt || Date.now() - startedAt >= 15_000) {
      throw new WorkflowError(409, "Failed-send proof expired or commitment changed");
    }
    const observation = await tx.publicationMintObservation.create({ data: { attemptId, revision: fresh.attempt.observationVersion + 1,
      transactionId: fresh.transaction.id, reportedHash: fresh.transaction.transactionHash, status: "REVERTED", resultJson: canonicalize({ version: 1, ...result }) } });
    const failure = await tx.publicationMintFailure.create({ data: { attemptId, requestId: data.requestId, actorId: adminId,
      observationId: observation.id, transactionId: fresh.transaction.id, reviewedObservationVersion: data.expectedObservationVersion,
      intentSha256: data.expectedIntentSha256, walletStateSha256: data.expectedWalletStateSha256, closedAt: observation.observedAt } });
    await tx.publicationMintAttempt.update({ where: { id: attemptId }, data: { status: "FAILED_TERMINAL", failedAt: observation.observedAt,
      failedObservationId: observation.id, failureStatus: "REVERTED", observationVersion: observation.revision } });
    await tx.publication.update({ where: { id: fresh.publication.id }, data: { status: "CHAIN_FAILED" } });
    const previous = await tx.publicationMintResult.findUnique({ where: { attemptId } });
    const selected = { status: "SUSPENDED" as const, checkedObservationId: observation.id, verifiedObservationId: previous?.verifiedObservationId ?? null,
      verificationStatus: previous?.verifiedObservationId ? "VERIFIED" as const : null };
    await tx.publicationMintResult.upsert({ where: { attemptId }, create: { attemptId, ...selected }, update: selected });
    await tx.auditLog.create({ data: { passportId, publicationId: fresh.publication.id, actorId: adminId,
      version: fresh.publication.passportVersion, action: "PUBLICATION_MINT_FAILED", fromStatus: "APPROVED", toStatus: "APPROVED", note: `Reverted mint closure: ${failure.id}` } });
    return recorded(failure, false);
  });
}
