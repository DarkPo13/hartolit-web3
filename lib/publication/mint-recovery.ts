import "server-only";

import { z } from "zod";
import type { Prisma, PublicationMintReanchor, PublicationMintRecovery } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { canonicalize, sha256Hex } from "@/lib/hash";
import { WorkflowError } from "@/lib/review/service";
import { publicationPublisherAccess } from "./service";
import { lockDispatchedMint } from "./mint-observation";
import { lockMintWallet, finalizedMintReceipt, failedMintReceipt, mintWalletState, sameClosedMintOutcome, verifyMintWalletAnchors } from "./mint-wallet";
import { inspectMintTransaction, type MintReader } from "./chain-mint";
import { inspectMintCancellation } from "./mint-cancellation";
import { boundedMintMonitorReader } from "./mint-reader";

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const recoverySchema = z.strictObject({ requestId: z.uuid(), expectedIntentSha256: sha, expectedWalletStateSha256: sha,
  expectedFinalizedObservationId: z.uuid(), expectedObservationVersion: z.number().int().positive(),
  expectedQuarantinedAt: z.iso.datetime({ precision: 3 }), acknowledgement: z.literal("RESTORE_ORIGINAL_MINT") });
const failedRecoverySchema = recoverySchema.omit({ expectedFinalizedObservationId: true, acknowledgement: true }).extend({
  expectedFailedObservationId: z.uuid(), acknowledgement: z.literal("RESTORE_FAILED_MINT"),
});
const cancelledRecoverySchema = recoverySchema.omit({ expectedFinalizedObservationId: true, acknowledgement: true }).extend({
  expectedCancelledObservationId: z.uuid(), expectedCancellationId: z.uuid(), acknowledgement: z.literal("RESTORE_CANCELLED_MINT"),
});
const reanchorSchema = recoverySchema.omit({ expectedFinalizedObservationId: true, acknowledgement: true }).extend({
  expectedFirstObservationId: z.uuid(), expectedAnchorObservationId: z.uuid(), acknowledgement: z.literal("ADOPT_REINCLUDED_MINT_ANCHOR"),
});
type RecoveryKind = "SUCCESS" | "FAILURE" | "CANCELLATION";
type RecoveryInput = Omit<z.infer<typeof recoverySchema>, "expectedFinalizedObservationId" | "acknowledgement"> &
  { expectedOriginalObservationId: string; expectedCancellationId: string | null };

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
  if ((kind === "FAILURE" && original.status !== "REVERTED") || (kind === "CANCELLATION" && original.status !== "CANCELLED")) {
    throw new WorkflowError(409, "Recovery kind does not match the closed failure proof");
  }
  await lockMintWallet(tx, context.attempt.chainId, context.attempt.publisherWallet);
  await requirePublisher(tx, adminId, context.attempt.publisherWallet);
  // A cancellation has no matched mint transaction; its original is the reviewed
  // closure proof, still bound to the saved dispatch anchor.
  const cancellation = kind === "CANCELLATION" ? await tx.publicationMintCancellation.findFirst({ where: { attemptId,
    observationId: originalObservation.id, transactionHash: original.transactionHash, proofStatus: "CANCELLED" } }) : null;
  const transaction = kind === "CANCELLATION" ? null : await tx.publicationMintTransaction.findFirst({ where: { id: originalObservation.transactionId!,
    attemptId, nonce: context.attempt.nonce, transactionHash: original.transactionHash } });
  if (kind === "CANCELLATION" ? !cancellation || originalObservation.transactionId || context.attempt.dispatchBlockNumber === null ||
    !context.attempt.dispatchBlockHash : !transaction) throw new WorkflowError(409, "Original matched transaction changed");
  // Attempts covered by a checkpoint are verified through its block; their
  // quarantine stamps are still bound below.
  const wallet = await mintWalletState(tx, context.attempt.chainId, context.attempt.publisherWallet, { allowStaleCheckpoint: true });
  const anchors = wallet.anchors;
  const walletBinding = canonicalize({ checkpoint: wallet.checkpointBinding, quarantined: wallet.quarantined.map(row => ({ id: row.id,
    quarantinedAt: row.quarantinedAt!.toISOString(), observationVersion: row.observationVersion })), rows: wallet.rows.map(row => ({ id: row.id, nonce: row.nonce.toString(), status: row.status,
    observationVersion: row.observationVersion, discoveryVersion: row.discoveryVersion,
    quarantinedAt: row.quarantinedAt?.toISOString() ?? null, finalizedAt: row.finalizedAt?.toISOString() ?? null,
    finalizedObservationId: row.finalizedObservationId, failedAt: row.failedAt?.toISOString() ?? null,
    failedObservationId: row.failedObservationId, proof: row.finalizedObservation?.resultJson ?? row.failedObservation?.resultJson ?? null,
    anchorObservationId: row.anchorObservationId, anchor: row.currentReanchor?.anchorObservation.resultJson ?? null })) });
  return { ...context, original, originalObservation, cancellation, anchors, walletBinding, walletStateSha256: await sha256Hex(walletBinding) };
}

/** Internal review only. A future route must authenticate the session/origin;
 * neither review nor restore exposes a caller-controlled RPC or signing key.
 */
export async function getMintRecoveryReview(adminId: string, passportId: string, attemptId: string) {
  const { review: { originalObservationId, ...review } } = await recoveryReview(adminId, passportId, attemptId, "SUCCESS");
  return { ...review, finalizedObservationId: originalObservationId };
}

export async function getMintFailureRecoveryReview(adminId: string, passportId: string, attemptId: string) {
  const { review: { originalObservationId, ...review } } = await recoveryReview(adminId, passportId, attemptId, "FAILURE");
  return { ...review, failedObservationId: originalObservationId };
}

export async function getMintCancellationRecoveryReview(adminId: string, passportId: string, attemptId: string) {
  const { review: { originalObservationId, ...review }, cancellationId } = await recoveryReview(adminId, passportId, attemptId, "CANCELLATION");
  return { ...review, cancelledObservationId: originalObservationId, cancellationId: cancellationId! };
}

async function recoveryReview(adminId: string, passportId: string, attemptId: string, kind: RecoveryKind) {
  return getDb().$transaction(async tx => {
    const current = await load(tx, adminId, passportId, attemptId, kind);
    if (!current.attempt.quarantinedAt) throw new WorkflowError(409, "Mint is not quarantined");
    return { cancellationId: current.cancellation?.id ?? null, review: { attemptId, intentSha256: current.intent.sha256, walletStateSha256: current.walletStateSha256,
      originalObservationId: current.originalObservation.id, observationVersion: current.attempt.observationVersion,
      quarantinedAt: current.attempt.quarantinedAt.toISOString(), originalReceipt: current.original, anchorReceipt: current.anchor,
      issued: false as const, canResend: false as const } };
  });
}

function matches(row: PublicationMintRecovery, adminId: string, attemptId: string, input: RecoveryInput, kind: RecoveryKind) {
  return row.kind === kind && row.actorId === adminId && row.attemptId === attemptId && row.intentSha256 === input.expectedIntentSha256 &&
    row.walletStateSha256 === input.expectedWalletStateSha256 && (kind === "SUCCESS" ? row.finalizedObservationId : row.failedObservationId) === input.expectedOriginalObservationId &&
    row.cancellationId === input.expectedCancellationId &&
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
    current.originalObservation.id !== input.expectedOriginalObservationId || current.intent.sha256 !== input.expectedIntentSha256 ||
    (current.cancellation?.id ?? null) !== input.expectedCancellationId) {
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
  return restoreReviewed(adminId, passportId, attemptId, { ...parsed.data, expectedOriginalObservationId: parsed.data.expectedFinalizedObservationId,
    expectedCancellationId: null }, trustedReader, "SUCCESS");
}

/** Clear only quarantine on an unchanged canonical REVERTED first proof. Never
 * change terminal failure status, nonce claims, chain fields or allow resend.
 */
export async function restoreFailedMint(adminId: string, passportId: string, attemptId: string, input: unknown, trustedReader: MintReader) {
  const parsed = failedRecoverySchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "Exact failed-mint recovery review and acknowledgement are required");
  return restoreReviewed(adminId, passportId, attemptId, { ...parsed.data, expectedOriginalObservationId: parsed.data.expectedFailedObservationId,
    expectedCancellationId: null }, trustedReader, "FAILURE");
}

/** Clear only quarantine on the unchanged canonical self-send first proof of a
 * reviewed cancellation closure. Never reuses its nonce/preparation or resends.
 */
export async function restoreCancelledMint(adminId: string, passportId: string, attemptId: string, input: unknown, trustedReader: MintReader) {
  const parsed = cancelledRecoverySchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "Exact cancelled-mint recovery review and acknowledgement are required");
  return restoreReviewed(adminId, passportId, attemptId, { ...parsed.data, expectedOriginalObservationId: parsed.data.expectedCancelledObservationId },
    trustedReader, "CANCELLATION");
}

export function matchesOriginalMintReceipt(original: ReturnType<typeof finalizedMintReceipt> | ReturnType<typeof failedMintReceipt>,
  result: Awaited<ReturnType<typeof inspectMintTransaction>> | Awaited<ReturnType<typeof inspectMintCancellation>>) {
  if (result.status !== "VERIFIED" && result.status !== "REVERTED" && result.status !== "CANCELLED") return false;
  if (result.status !== original.status) return false;
  return result.transactionHash === original.transactionHash && result.blockNumber === original.blockNumber && result.blockHash === original.blockHash &&
    result.contractAddress === original.contractAddress && result.intentSha256 === original.intentSha256 && BigInt(result.confirmations) >= BigInt(original.confirmations) &&
    (original.status !== "VERIFIED" || (result.status === "VERIFIED" && result.tokenId === original.tokenId)) &&
    (original.status !== "CANCELLED" || (result.status === "CANCELLED" && result.nonce === original.nonce && result.publisherWallet === original.publisherWallet));
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
    const dispatched = async () => {
      if (kind !== "CANCELLATION") return;
      const anchor = await reader.getBlock({ blockNumber: before.attempt.dispatchBlockNumber! });
      if (anchor.number !== before.attempt.dispatchBlockNumber || anchor.hash !== before.attempt.dispatchBlockHash) throw new Error();
    };
    await dispatched();
    result = kind === "CANCELLATION"
      ? await inspectMintCancellation(before.intent, before.original.transactionHash, before.attempt.nonce, reader)
      : await inspectMintTransaction(before.intent, before.original.transactionHash, reader, before.attempt.nonce);
    await dispatched();
    if (!head || (await reader.getBlock({ blockNumber: head.number })).hash !== head.hash || await reader.getChainId() !== 97) throw new Error();
  } catch { throw new WorkflowError(503, "Original wallet receipts could not be freshly verified; quarantine remains"); }
  const original = before.original;
  // "Unchanged" means unchanged from the current canonical anchor (D50).
  if (!matchesOriginalMintReceipt(before.anchor!, result)) {
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
      status: original.status, resultJson: canonicalize({ version: 1, ...(kind === "CANCELLATION" ? { proofKind: "CANCELLATION" } : {}), ...result }) } });
    const recovery = await tx.publicationMintRecovery.create({ data: { attemptId, requestId: data.requestId, actorId: adminId,
      quarantinedAt: current.attempt.quarantinedAt!, reviewedObservationVersion: data.expectedObservationVersion,
      intentSha256: data.expectedIntentSha256, walletStateSha256: data.expectedWalletStateSha256,
      kind, finalizedObservationId: kind === "SUCCESS" ? current.originalObservation.id : null,
      failedObservationId: kind === "SUCCESS" ? null : current.originalObservation.id, cancellationId: current.cancellation?.id ?? null,
      verificationStatus: original.status, verifiedObservationId: observation.id, restoredAt: observation.observedAt } });
    await tx.publicationMintAttempt.update({ where: { id: attemptId }, data: { quarantinedAt: null, observationVersion: observation.revision } });
    await tx.publication.update({ where: { id: current.publication.id }, data: { status: kind === "SUCCESS" ? "PUBLISHED" : "CHAIN_FAILED" } });
    const previous = await tx.publicationMintResult.findUnique({ where: { attemptId } });
    const verifiedObservationId = kind === "SUCCESS" ? observation.id : previous?.verifiedObservationId ?? null;
    const selected = { status: kind === "SUCCESS" ? "VERIFIED" as const : "SUSPENDED" as const, checkedObservationId: observation.id,
      verifiedObservationId, verificationStatus: verifiedObservationId ? "VERIFIED" as const : null };
    await tx.publicationMintResult.upsert({ where: { attemptId }, create: { attemptId, ...selected }, update: selected });
    await tx.auditLog.create({ data: { passportId, publicationId: current.publication.id, actorId: adminId,
      version: current.publication.passportVersion, action: ({ SUCCESS: "PUBLICATION_MINT_RESTORED", FAILURE: "PUBLICATION_MINT_FAILURE_RESTORED",
        CANCELLATION: "PUBLICATION_MINT_CANCELLATION_RESTORED" } as const)[kind],
      fromStatus: "APPROVED", toStatus: "APPROVED", note: `Original ${kind.toLowerCase()} mint recovery: ${recovery.id}` } });
    return recorded(recovery, false);
  });
}

async function loadClosed(tx: Prisma.TransactionClient, adminId: string, passportId: string, attemptId: string) {
  const access = publicationPublisherAccess(adminId);
  if (!access.walletAddress) throw new WorkflowError(403, "Recovery requires the current designated MFA publisher");
  await requirePublisher(tx, adminId, access.walletAddress);
  const row = await tx.publicationMintAttempt.findFirst({ where: { id: attemptId, preparation: { publication: { passportId } } },
    select: { status: true, failureStatus: true } });
  const kind = row?.status === "FINALIZED" ? "SUCCESS" as const : row?.failureStatus === "REVERTED" ? "FAILURE" as const
    : row?.failureStatus === "CANCELLED" ? "CANCELLATION" as const : null;
  if (!kind) throw new WorkflowError(409, "A closed mint attempt is required");
  // load() relocks and rechecks that the closed proof matches this kind.
  return { ...await load(tx, adminId, passportId, attemptId, kind), kind };
}

/** Internal review of a quarantined closed attempt whose first transaction may
 * have been re-included in another canonical block. No send or HTTP action.
 */
export async function getMintReanchorReview(adminId: string, passportId: string, attemptId: string) {
  return getDb().$transaction(async tx => {
    const current = await loadClosed(tx, adminId, passportId, attemptId);
    if (!current.attempt.quarantinedAt) throw new WorkflowError(409, "Mint is not quarantined");
    return { attemptId, intentSha256: current.intent.sha256, walletStateSha256: current.walletStateSha256,
      firstObservationId: current.originalObservation.id, anchorObservationId: current.attempt.anchorObservationId ?? current.originalObservation.id,
      observationVersion: current.attempt.observationVersion, quarantinedAt: current.attempt.quarantinedAt.toISOString(),
      firstReceipt: current.original, anchorReceipt: current.anchor, issued: false as const, canResend: false as const };
  });
}

/** The same first transaction and outcome at a different canonical inclusion,
 * at least as deep as the anchor it replaces. Never a lost, replaced or
 * changed-outcome transaction.
 */
export function matchesReincludedMintReceipt(first: Parameters<typeof sameClosedMintOutcome>[0],
  anchor: { blockNumber: string; blockHash: string; confirmations: string },
  result: Awaited<ReturnType<typeof inspectMintTransaction>> | Awaited<ReturnType<typeof inspectMintCancellation>>) {
  if (result.status !== "VERIFIED" && result.status !== "REVERTED" && result.status !== "CANCELLED") return false;
  return sameClosedMintOutcome(first, result) && (result.blockNumber !== anchor.blockNumber || result.blockHash !== anchor.blockHash) &&
    BigInt(result.confirmations) >= BigInt(anchor.confirmations);
}

type ReanchorInput = z.infer<typeof reanchorSchema>;
function reanchorMatches(row: PublicationMintReanchor, adminId: string, attemptId: string, data: ReanchorInput) {
  return row.actorId === adminId && row.attemptId === attemptId && row.intentSha256 === data.expectedIntentSha256 &&
    row.walletStateSha256 === data.expectedWalletStateSha256 && row.reviewedObservationVersion === data.expectedObservationVersion &&
    row.quarantinedAt.toISOString() === data.expectedQuarantinedAt && (row.finalizedObservationId ?? row.failedObservationId) === data.expectedFirstObservationId &&
    (row.previousAnchorObservationId ?? data.expectedFirstObservationId) === data.expectedAnchorObservationId;
}
function requireReanchorReview(current: Awaited<ReturnType<typeof loadClosed>>, data: ReanchorInput) {
  if (current.attempt.quarantinedAt?.toISOString() !== data.expectedQuarantinedAt || current.attempt.observationVersion !== data.expectedObservationVersion ||
    current.walletStateSha256 !== data.expectedWalletStateSha256 || current.intent.sha256 !== data.expectedIntentSha256 ||
    current.originalObservation.id !== data.expectedFirstObservationId ||
    (current.attempt.anchorObservationId ?? current.originalObservation.id) !== data.expectedAnchorObservationId) {
    throw new WorkflowError(409, "Re-inclusion review changed; inspect the current quarantine again");
  }
}
const reanchored = (row: PublicationMintReanchor, quarantined: boolean) => ({ status: "RECORDED" as const, reanchorId: row.id,
  reanchoredAt: row.reanchoredAt.toISOString(), currentlyQuarantined: quarantined, issued: false as const, canResend: false as const });

/** Adopt a new canonical inclusion anchor for the unchanged first transaction
 * after separate current-publisher review. The first proof, public chain fields,
 * nonce/preparation claims, other quarantines and later active slots are kept.
 */
export async function adoptReincludedMintAnchor(adminId: string, passportId: string, attemptId: string, input: unknown, trustedReader: MintReader) {
  const parsed = reanchorSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "Exact re-inclusion review and acknowledgement are required");
  const data = parsed.data;
  const before = await getDb().$transaction(async tx => {
    const current = await loadClosed(tx, adminId, passportId, attemptId);
    const existing = await tx.publicationMintReanchor.findUnique({ where: { requestId: data.requestId } });
    if (existing) {
      if (!reanchorMatches(existing, adminId, attemptId, data)) throw new WorkflowError(409, "Re-inclusion request belongs to another review");
      return { ...current, existing };
    }
    requireReanchorReview(current, data);
    return { ...current, existing: null };
  });
  if (before.existing) return reanchored(before.existing, !!before.attempt.quarantinedAt);
  const startedAt = Date.now(), reader = boundedMintMonitorReader(trustedReader), cancellation = before.kind === "CANCELLATION";
  let result;
  try {
    // Only this transaction's own inclusion is re-proved; every wallet anchor is
    // still verified in full before any new permission or finalization.
    const dispatched = async () => {
      if (!cancellation) return;
      const anchor = await reader.getBlock({ blockNumber: before.attempt.dispatchBlockNumber! });
      if (anchor.number !== before.attempt.dispatchBlockNumber || anchor.hash !== before.attempt.dispatchBlockHash) throw new Error();
    };
    await dispatched();
    result = cancellation
      ? await inspectMintCancellation(before.intent, before.original.transactionHash, before.attempt.nonce, reader)
      : await inspectMintTransaction(before.intent, before.original.transactionHash, reader, before.attempt.nonce);
    await dispatched();
    if (await reader.getChainId() !== 97) throw new Error();
  } catch { throw new WorkflowError(503, "Re-included transaction could not be freshly verified; quarantine remains"); }
  if (!matchesReincludedMintReceipt(before.original, before.anchor!, result) ||
    (cancellation && "blockNumber" in result && BigInt(result.blockNumber) <= before.attempt.dispatchBlockNumber!)) {
    throw new WorkflowError(409, "Only the same transaction and outcome at a new sufficiently deep canonical block can replace the anchor");
  }
  return getDb().$transaction(async tx => {
    const current = await loadClosed(tx, adminId, passportId, attemptId);
    const existing = await tx.publicationMintReanchor.findUnique({ where: { requestId: data.requestId } });
    if (existing) {
      if (!reanchorMatches(existing, adminId, attemptId, data)) throw new WorkflowError(409, "Re-inclusion request belongs to another review");
      return reanchored(existing, !!current.attempt.quarantinedAt);
    }
    requireReanchorReview(current, data);
    if (current.binding !== before.binding || current.walletBinding !== before.walletBinding ||
      Date.now() < startedAt || Date.now() - startedAt >= 15_000) throw new WorkflowError(409, "Re-inclusion check expired or its commitment changed");
    const status = current.original.status, success = current.kind === "SUCCESS";
    const observation = await tx.publicationMintObservation.create({ data: { attemptId, revision: data.expectedObservationVersion + 1,
      reportedHash: current.original.transactionHash, transactionId: current.originalObservation.transactionId, status,
      resultJson: canonicalize({ version: 1, ...(cancellation ? { proofKind: "CANCELLATION" } : {}), ...result }) } });
    const row = await tx.publicationMintReanchor.create({ data: { attemptId, requestId: data.requestId, actorId: adminId,
      quarantinedAt: current.attempt.quarantinedAt!, reviewedObservationVersion: data.expectedObservationVersion,
      intentSha256: data.expectedIntentSha256, walletStateSha256: data.expectedWalletStateSha256,
      transactionHash: current.original.transactionHash, proofStatus: status,
      finalizedObservationId: success ? current.originalObservation.id : null, failedObservationId: success ? null : current.originalObservation.id,
      previousAnchorObservationId: current.attempt.anchorObservationId, anchorObservationId: observation.id, reanchoredAt: observation.observedAt } });
    await tx.publicationMintAttempt.update({ where: { id: attemptId }, data: { anchorObservationId: observation.id, quarantinedAt: null,
      observationVersion: observation.revision } });
    await tx.publication.update({ where: { id: current.publication.id }, data: { status: success ? "PUBLISHED" : "CHAIN_FAILED" } });
    const previous = await tx.publicationMintResult.findUnique({ where: { attemptId } });
    const verifiedObservationId = success ? observation.id : previous?.verifiedObservationId ?? null;
    const selected = { status: success ? "VERIFIED" as const : "SUSPENDED" as const, checkedObservationId: observation.id,
      verifiedObservationId, verificationStatus: verifiedObservationId ? "VERIFIED" as const : null };
    await tx.publicationMintResult.upsert({ where: { attemptId }, create: { attemptId, ...selected }, update: selected });
    await tx.auditLog.create({ data: { passportId, publicationId: current.publication.id, actorId: adminId,
      version: current.publication.passportVersion, action: "PUBLICATION_MINT_REANCHORED", fromStatus: "APPROVED", toStatus: "APPROVED",
      note: `Re-included ${current.kind.toLowerCase()} mint anchor: ${row.id}` } });
    return reanchored(row, false);
  });
}
