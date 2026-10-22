import "server-only";

import { z } from "zod";
import type { Prisma, PublicationMintRecovery } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { canonicalize, sha256Hex } from "@/lib/hash";
import { WorkflowError } from "@/lib/review/service";
import { publicationPublisherAccess } from "./service";
import { lockDispatchedMint } from "./mint-observation";
import { CLOSED_MINT_STATUSES, lockMintWallet, finalizedMintReceipt, failedMintReceipt, MAX_MINT_WALLET_RECEIPTS, verifyMintWalletAnchors } from "./mint-wallet";
import { inspectMintTransaction, type MintReader } from "./chain-mint";
import { boundedMintMonitorReader } from "./mint-monitor";

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const recoverySchema = z.strictObject({ requestId: z.uuid(), expectedIntentSha256: sha, expectedWalletStateSha256: sha,
  expectedFinalizedObservationId: z.uuid(), expectedObservationVersion: z.number().int().positive(),
  expectedQuarantinedAt: z.iso.datetime({ precision: 3 }), acknowledgement: z.literal("RESTORE_ORIGINAL_MINT") });
const failedRecoverySchema = recoverySchema.omit({ expectedFinalizedObservationId: true, acknowledgement: true }).extend({
  expectedFailedObservationId: z.uuid(), acknowledgement: z.literal("RESTORE_FAILED_MINT"),
});
type RecoveryKind = "SUCCESS" | "FAILURE";
type RecoveryInput = Omit<z.infer<typeof recoverySchema>, "expectedFinalizedObservationId" | "acknowledgement"> & { expectedOriginalObservationId: string };

async function requirePublisher(tx: Prisma.TransactionClient, adminId: string, wallet: string) {
  const access = publicationPublisherAccess(adminId);
  if (!access.configured || !access.canProve || access.walletAddress !== wallet ||
    !await tx.user.findFirst({ where: { id: adminId, role: "admin", banned: false, twoFactorEnabled: true }, select: { id: true } })) {
    throw new WorkflowError(403, "Recovery requires the current designated MFA publisher and wallet");
  }
}

async function load(tx: Prisma.TransactionClient, adminId: string, passportId: string, attemptId: string, kind: RecoveryKind) {
  // Reject unauthorized actors before loading private recovery state.
  const access = publicationPublisherAccess(adminId);
  if (!access.walletAddress) throw new WorkflowError(403, "Recovery requires the current designated MFA publisher");
  await requirePublisher(tx, adminId, access.walletAddress);
  const context = await lockDispatchedMint(tx, passportId, attemptId);
  const original = kind === "SUCCESS" ? context.finalized : context.failed;
  const originalObservation = kind === "SUCCESS" ? context.attempt.finalizedObservation : context.attempt.failedObservation;
  if (!original || !originalObservation) throw new WorkflowError(409, "Recovery kind does not match the closed original mint");
  await lockMintWallet(tx, context.attempt.chainId, context.attempt.publisherWallet);
  await requirePublisher(tx, adminId, context.attempt.publisherWallet);
  const transaction = await tx.publicationMintTransaction.findFirst({ where: { id: originalObservation.transactionId!,
    attemptId, nonce: context.attempt.nonce, transactionHash: original.transactionHash } });
  if (!transaction) throw new WorkflowError(409, "Original matched transaction changed");
  const rows = await tx.publicationMintAttempt.findMany({ where: { chainId: context.attempt.chainId, publisherWallet: context.attempt.publisherWallet },
    orderBy: { nonce: "asc" }, take: MAX_MINT_WALLET_RECEIPTS + 2, include: { finalizedObservation: true, failedObservation: true } });
  const closed = rows.filter(row => CLOSED_MINT_STATUSES.some(status => status === row.status));
  if (rows.length > MAX_MINT_WALLET_RECEIPTS + 1 || closed.length > MAX_MINT_WALLET_RECEIPTS) {
    throw new WorkflowError(503, "Wallet recovery exceeds the bounded verification history");
  }
  const anchors = closed.map(row => ({ attemptId: row.id, nonce: row.nonce, receipt: row.status === "FAILED_TERMINAL" ? failedMintReceipt(row.failedObservation) : finalizedMintReceipt(row.finalizedObservation) }));
  const walletBinding = canonicalize(rows.map(row => ({ id: row.id, nonce: row.nonce.toString(), status: row.status,
    observationVersion: row.observationVersion, discoveryVersion: row.discoveryVersion,
    quarantinedAt: row.quarantinedAt?.toISOString() ?? null, finalizedAt: row.finalizedAt?.toISOString() ?? null,
    finalizedObservationId: row.finalizedObservationId, failedAt: row.failedAt?.toISOString() ?? null,
    failedObservationId: row.failedObservationId, proof: row.finalizedObservation?.resultJson ?? row.failedObservation?.resultJson ?? null })));
  return { ...context, original, originalObservation, anchors, walletBinding, walletStateSha256: await sha256Hex(walletBinding) };
}

/** Internal review only. A future route must authenticate the session/origin;
 * neither review nor restore exposes a caller-controlled RPC or signing key.
 */
export async function getMintRecoveryReview(adminId: string, passportId: string, attemptId: string) {
  const { originalObservationId, ...review } = await recoveryReview(adminId, passportId, attemptId, "SUCCESS");
  return { ...review, finalizedObservationId: originalObservationId };
}

export async function getMintFailureRecoveryReview(adminId: string, passportId: string, attemptId: string) {
  const { originalObservationId, ...review } = await recoveryReview(adminId, passportId, attemptId, "FAILURE");
  return { ...review, failedObservationId: originalObservationId };
}

async function recoveryReview(adminId: string, passportId: string, attemptId: string, kind: RecoveryKind) {
  return getDb().$transaction(async tx => {
    const current = await load(tx, adminId, passportId, attemptId, kind);
    if (!current.attempt.quarantinedAt) throw new WorkflowError(409, "Mint is not quarantined");
    return { attemptId, intentSha256: current.intent.sha256, walletStateSha256: current.walletStateSha256,
      originalObservationId: current.originalObservation.id, observationVersion: current.attempt.observationVersion,
      quarantinedAt: current.attempt.quarantinedAt.toISOString(), originalReceipt: current.original, issued: false as const, canResend: false as const };
  });
}

function matches(row: PublicationMintRecovery, adminId: string, attemptId: string, input: RecoveryInput, kind: RecoveryKind) {
  return row.kind === kind && row.actorId === adminId && row.attemptId === attemptId && row.intentSha256 === input.expectedIntentSha256 &&
    row.walletStateSha256 === input.expectedWalletStateSha256 && (kind === "SUCCESS" ? row.finalizedObservationId : row.failedObservationId) === input.expectedOriginalObservationId &&
    row.reviewedObservationVersion === input.expectedObservationVersion && row.quarantinedAt.toISOString() === input.expectedQuarantinedAt;
}
function recorded(row: PublicationMintRecovery, quarantined: boolean) {
  // Idempotent replay is historical evidence, never a current health guarantee.
  return { status: "RECORDED" as const, recoveryId: row.id, restoredAt: row.restoredAt.toISOString(),
    currentlyQuarantined: quarantined, issued: false as const, canResend: false as const };
}
function requireReview(current: Awaited<ReturnType<typeof load>>, input: RecoveryInput) {
  if (current.attempt.quarantinedAt?.toISOString() !== input.expectedQuarantinedAt ||
    current.attempt.observationVersion !== input.expectedObservationVersion || current.walletStateSha256 !== input.expectedWalletStateSha256 ||
    current.originalObservation.id !== input.expectedOriginalObservationId || current.intent.sha256 !== input.expectedIntentSha256) {
    throw new WorkflowError(409, "Recovery review changed; inspect the current quarantine again");
  }
}

/** Restore only the unchanged first receipt, after fresh canonical/depth checks
 * and separate current-publisher review. Never resolves a genuinely lost/remined
 * receipt, another quarantine or an active attempt/nonce claim.
 */
export async function restoreOriginalMint(adminId: string, passportId: string, attemptId: string, input: unknown, trustedReader: MintReader) {
  const parsed = recoverySchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "Exact original-mint recovery review and acknowledgement are required");
  return restoreReviewed(adminId, passportId, attemptId, { ...parsed.data, expectedOriginalObservationId: parsed.data.expectedFinalizedObservationId }, trustedReader, "SUCCESS");
}

/** Clear only quarantine on an unchanged canonical REVERTED first proof. Never
 * change terminal failure status, nonce claims, chain fields or allow resend.
 */
export async function restoreFailedMint(adminId: string, passportId: string, attemptId: string, input: unknown, trustedReader: MintReader) {
  const parsed = failedRecoverySchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "Exact failed-mint recovery review and acknowledgement are required");
  return restoreReviewed(adminId, passportId, attemptId, { ...parsed.data, expectedOriginalObservationId: parsed.data.expectedFailedObservationId }, trustedReader, "FAILURE");
}

export function matchesOriginalMintReceipt(original: ReturnType<typeof finalizedMintReceipt> | ReturnType<typeof failedMintReceipt>,
  result: Awaited<ReturnType<typeof inspectMintTransaction>>) {
  if (result.status !== "VERIFIED" && result.status !== "REVERTED") return false;
  if (result.status !== original.status) return false;
  return result.transactionHash === original.transactionHash && result.blockNumber === original.blockNumber && result.blockHash === original.blockHash &&
    result.contractAddress === original.contractAddress && result.intentSha256 === original.intentSha256 && BigInt(result.confirmations) >= BigInt(original.confirmations) &&
    (original.status !== "VERIFIED" || (result.status === "VERIFIED" && result.tokenId === original.tokenId));
}

async function restoreReviewed(adminId: string, passportId: string, attemptId: string, data: RecoveryInput, trustedReader: MintReader, kind: RecoveryKind) {
  const before = await getDb().$transaction(async tx => {
    const current = await load(tx, adminId, passportId, attemptId, kind);
    const existing = await tx.publicationMintRecovery.findUnique({ where: { requestId: data.requestId } });
    if (existing) {
      if (!matches(existing, adminId, attemptId, data, kind)) throw new WorkflowError(409, "Recovery request belongs to another review");
      return { ...current, existing };
    }
    requireReview(current, data);
    return { ...current, existing: null };
  });
  if (before.existing) return recorded(before.existing, !!before.attempt.quarantinedAt);
  const startedAt = Date.now(), reader = boundedMintMonitorReader(trustedReader);
  let result;
  try {
    const head = await verifyMintWalletAnchors(before.anchors, reader);
    result = await inspectMintTransaction(before.intent, before.original.transactionHash, reader, before.attempt.nonce);
    if (!head || (await reader.getBlock({ blockNumber: head.number })).hash !== head.hash || await reader.getChainId() !== 97) throw new Error();
  } catch { throw new WorkflowError(503, "Original wallet receipts could not be freshly verified; quarantine remains"); }
  const original = before.original;
  if (!matchesOriginalMintReceipt(original, result)) {
    throw new WorkflowError(409, "Original receipt is not unchanged and verified; quarantine remains");
  }
  return getDb().$transaction(async tx => {
    const current = await load(tx, adminId, passportId, attemptId, kind);
    const existing = await tx.publicationMintRecovery.findUnique({ where: { requestId: data.requestId } });
    if (existing) {
      if (!matches(existing, adminId, attemptId, data, kind)) throw new WorkflowError(409, "Recovery request belongs to another review");
      return recorded(existing, !!current.attempt.quarantinedAt);
    }
    requireReview(current, data);
    if (current.binding !== before.binding || current.walletBinding !== before.walletBinding ||
      Date.now() < startedAt || Date.now() - startedAt >= 15_000) throw new WorkflowError(409, "Recovery check expired or its commitment changed");
    const observation = await tx.publicationMintObservation.create({ data: { attemptId, revision: data.expectedObservationVersion + 1,
      reportedHash: original.transactionHash, transactionId: current.originalObservation.transactionId,
      status: original.status, resultJson: canonicalize({ version: 1, ...result }) } });
    const recovery = await tx.publicationMintRecovery.create({ data: { attemptId, requestId: data.requestId, actorId: adminId,
      quarantinedAt: current.attempt.quarantinedAt!, reviewedObservationVersion: data.expectedObservationVersion,
      intentSha256: data.expectedIntentSha256, walletStateSha256: data.expectedWalletStateSha256,
      kind, finalizedObservationId: kind === "SUCCESS" ? current.originalObservation.id : null,
      failedObservationId: kind === "FAILURE" ? current.originalObservation.id : null, verificationStatus: original.status,
      verifiedObservationId: observation.id, restoredAt: observation.observedAt } });
    await tx.publicationMintAttempt.update({ where: { id: attemptId }, data: { quarantinedAt: null, observationVersion: observation.revision } });
    await tx.publication.update({ where: { id: current.publication.id }, data: { status: kind === "SUCCESS" ? "PUBLISHED" : "CHAIN_FAILED" } });
    const previous = await tx.publicationMintResult.findUnique({ where: { attemptId } });
    const verifiedObservationId = kind === "SUCCESS" ? observation.id : previous?.verifiedObservationId ?? null;
    const selected = { status: kind === "SUCCESS" ? "VERIFIED" as const : "SUSPENDED" as const, checkedObservationId: observation.id,
      verifiedObservationId, verificationStatus: verifiedObservationId ? "VERIFIED" as const : null };
    await tx.publicationMintResult.upsert({ where: { attemptId }, create: { attemptId, ...selected }, update: selected });
    await tx.auditLog.create({ data: { passportId, publicationId: current.publication.id, actorId: adminId,
      version: current.publication.passportVersion, action: kind === "SUCCESS" ? "PUBLICATION_MINT_RESTORED" : "PUBLICATION_MINT_FAILURE_RESTORED",
      fromStatus: "APPROVED", toStatus: "APPROVED", note: `Original ${kind.toLowerCase()} mint recovery: ${recovery.id}` } });
    return recorded(recovery, false);
  });
}
