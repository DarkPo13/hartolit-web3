import "server-only";

import type { Prisma, PublicationPinAttempt } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { WorkflowError } from "@/lib/review/service";
import { lockReservedPublication } from "./service";
import { requireStoredWalletProof } from "./wallet-proof";
import { MAX_PUBLIC_BLOCK_BYTES, rawCidFromSha256 } from "./raw-cid";
import { validatePublicationTarget, type PublicationTarget } from "./target";
import { publicationPreparationSchema } from "./schema";

const dispatchDeadlineMs = 5 * 60_000;

function parsePreparation(input: unknown) {
  const parsed = publicationPreparationSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "Explicit publication acknowledgement and exact confirmation are required");
  return parsed.data;
}

function response(row: PublicationPinAttempt) {
  return { id: row.id, publicationId: row.publicationId, requestId: row.requestId, status: row.status,
    createdAt: row.createdAt.toISOString(), dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    deadlineAt: row.deadlineAt?.toISOString() ?? null, closedAt: row.closedAt?.toISOString() ?? null };
}

async function audit(tx: Prisma.TransactionClient, passportId: string, publicationId: string,
  attemptId: string, actorId: string, version: number,
  action: "PUBLICATION_PIN_PREPARED" | "PUBLICATION_PIN_DISPATCH_STARTED" | "PUBLICATION_PIN_CANCELLED" | "PUBLICATION_PIN_OUTCOME_UNKNOWN",
) {
  await tx.auditLog.create({ data: { passportId, publicationId, actorId, version, action,
    fromStatus: "APPROVED", toStatus: "APPROVED", note: `Pin attempt: ${attemptId}` } });
}

/** Server-only workflow. The authenticated consent route delegates preparation/cancellation;
 * dispatch remains internal with no HTTP entry point or configured production uploader.
 * Wallet ownership signing alone never authorizes either preparation or dispatch.
 */
export async function preparePinAttempt(adminId: string, passportId: string, input: unknown, selectedTarget: PublicationTarget) {
  const data = parsePreparation(input);
  let target: PublicationTarget;
  try { target = await validatePublicationTarget(selectedTarget); }
  catch { throw new WorkflowError(503, "A valid server-owned publication target is required"); }
  if (data.expectedTargetSha256 !== target.configurationSha256) throw new WorkflowError(409, "The reviewed publication target changed");
  return getDb().$transaction(async (tx) => {
    const { reservation, confirmation } = await lockReservedPublication(tx, adminId, passportId, data.publicationId);
    if (data.confirmationId !== confirmation.id || data.passportVersion !== reservation.passportVersion || data.expectedSha256 !== reservation.payloadHash) {
      throw new WorkflowError(409, "Publication acknowledgement does not match the saved confirmation");
    }
    const proof = await requireStoredWalletProof(tx, adminId, reservation, confirmation);
    if (new TextEncoder().encode(reservation.canonicalJson).length > MAX_PUBLIC_BLOCK_BYTES) {
      throw new WorkflowError(422, "The public snapshot exceeds the supported IPFS block size");
    }
    const existing = await tx.publicationPinAttempt.findUnique({ where: { requestId: data.requestId } });
    if (existing) {
      if (existing.publicationId !== reservation.id || existing.walletChallengeId !== proof.id || existing.status !== "PREPARED" ||
        existing.providerKey !== target.key || existing.providerConfigHash !== target.configurationSha256 || existing.storageProfile !== target.storageProfile) {
        throw new WorkflowError(409, "This publication request cannot be reused");
      }
      return { attempt: response(existing), created: false };
    }
    const active = await tx.publicationPinAttempt.findFirst({
      where: { publicationId: reservation.id, status: { not: "CANCELLED" } }, select: { id: true },
    });
    if (active) throw new WorkflowError(409, "Resolve the existing pin attempt before preparing another");
    const attempt = await tx.publicationPinAttempt.create({ data: {
      publicationId: reservation.id, walletChallengeId: proof.id, requestId: data.requestId,
      expectedCid: rawCidFromSha256(reservation.payloadHash),
      providerKey: target.key, providerConfigHash: target.configurationSha256, storageProfile: target.storageProfile,
    } });
    await audit(tx, passportId, reservation.id, attempt.id, adminId, reservation.passportVersion, "PUBLICATION_PIN_PREPARED");
    return { attempt: response(attempt), created: true };
  });
}

/** Only a PREPARED attempt can be cancelled or retried: no dispatch permission was issued. */
export async function cancelPreparedPinAttempt(adminId: string, passportId: string, publicationId: string, attemptId: string) {
  return getDb().$transaction(async (tx) => {
    const { reservation } = await lockReservedPublication(tx, adminId, passportId, publicationId);
    const attempt = await tx.publicationPinAttempt.findFirst({ where: { id: attemptId, publicationId } });
    if (!attempt) throw new WorkflowError(404, "Pin attempt not found");
    if (attempt.status === "CANCELLED") return response(attempt);
    if (attempt.status !== "PREPARED") throw new WorkflowError(409, "A dispatched attempt requires reconciliation");
    const cancelled = await tx.publicationPinAttempt.update({ where: { id: attempt.id }, data: { status: "CANCELLED", closedAt: new Date() } });
    await audit(tx, passportId, publicationId, attempt.id, adminId, reservation.passportVersion, "PUBLICATION_PIN_CANCELLED");
    return response(cancelled);
  });
}

/** Commit the point after which sending may have happened BEFORE any network request.
 * Exactly one caller receives the command. Repeated calls always conflict; a lost response
 * is an unknown outcome, never permission to resend. No external I/O runs in this transaction.
 */
export async function beginPinDispatch(adminId: string, passportId: string, publicationId: string, attemptId: string, selectedTarget: PublicationTarget) {
  let target: PublicationTarget;
  try { target = await validatePublicationTarget(selectedTarget); }
  catch { throw new WorkflowError(503, "A valid server-owned publication target is required"); }
  return getDb().$transaction(async (tx) => {
    const { reservation, confirmation } = await lockReservedPublication(tx, adminId, passportId, publicationId);
    const proof = await requireStoredWalletProof(tx, adminId, reservation, confirmation);
    const attempt = await tx.publicationPinAttempt.findFirst({ where: { id: attemptId, publicationId } });
    if (!attempt) throw new WorkflowError(404, "Pin attempt not found");
    if (attempt.status !== "PREPARED" || attempt.walletChallengeId !== proof.id ||
      attempt.providerKey !== target.key || attempt.providerConfigHash !== target.configurationSha256 || attempt.storageProfile !== target.storageProfile || reservation.ipfsCid ||
      reservation.transactionHash || reservation.tokenId || reservation.contractAddress) {
      throw new WorkflowError(409, "Pin attempt cannot be dispatched");
    }
    const now = new Date();
    if (new TextEncoder().encode(reservation.canonicalJson).length > MAX_PUBLIC_BLOCK_BYTES) {
      throw new WorkflowError(422, "The public snapshot exceeds the supported IPFS block size");
    }
    const expectedCid = rawCidFromSha256(reservation.payloadHash);
    if (attempt.expectedCid && attempt.expectedCid !== expectedCid) throw new WorkflowError(409, "Pin attempt CID changed");
    await tx.publication.update({ where: { id: publicationId }, data: { status: "PINNING" } });
    await tx.publicationPinAttempt.update({ where: { id: attemptId }, data: {
      status: "DISPATCHING", dispatchedAt: now, deadlineAt: new Date(now.getTime() + dispatchDeadlineMs), expectedCid,
    } });
    await audit(tx, passportId, publicationId, attemptId, adminId, reservation.passportVersion, "PUBLICATION_PIN_DISPATCH_STARTED");
    return { attemptId, publicationId, idempotencyKey: reservation.idempotencyKey, expectedCid,
      canonicalJson: reservation.canonicalJson, payloadHash: reservation.payloadHash };
  });
}

/** Internal recovery only. Expiry does NOT prove the provider did nothing.
 * This never resets PINNING, reopens recall, issues a command, or fabricates a CID.
 * Both transport ambiguity and a process crash converge on UNKNOWN for later provider readback.
 */
async function unknownOutcome(passportId: string, publicationId: string, attemptId: string, expiredOnly: boolean) {
  return getDb().$transaction(async (tx) => {
    const locked = await tx.passport.updateMany({ where: { id: passportId }, data: { updatedAt: new Date() } });
    if (!locked.count) throw new WorkflowError(404, "Passport not found");
    const publication = await tx.publication.findFirst({ where: { id: publicationId, passportId } });
    const attempt = await tx.publicationPinAttempt.findFirst({ where: { id: attemptId, publicationId } });
    if (!publication || !attempt) throw new WorkflowError(404, "Pin attempt not found");
    if (publication.status !== "PINNING" || !["DISPATCHING", "UNKNOWN"].includes(attempt.status)) {
      throw new WorkflowError(409, "Pin attempt is not awaiting an external outcome");
    }
    if (attempt.status === "UNKNOWN") return response(attempt);
    const now = new Date();
    if (expiredOnly && (!attempt.deadlineAt || attempt.deadlineAt > now)) throw new WorkflowError(409, "Pin attempt is still within its dispatch deadline");
    const updated = await tx.publicationPinAttempt.update({ where: { id: attempt.id }, data: { status: "UNKNOWN", closedAt: now } });
    await audit(tx, passportId, publicationId, attemptId, "system:publication-recovery", publication.passportVersion, "PUBLICATION_PIN_OUTCOME_UNKNOWN");
    return response(updated);
  });
}

export async function recordUnknownPinOutcome(passportId: string, publicationId: string, attemptId: string) {
  return unknownOutcome(passportId, publicationId, attemptId, false);
}

export async function recoverExpiredPinAttempt(passportId: string, publicationId: string, attemptId: string) {
  return unknownOutcome(passportId, publicationId, attemptId, true);
}
