import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { canonicalize, sha256Hex } from "@/lib/hash";
import { publicSnapshotSchema } from "@/lib/public-snapshot/schema";
import { WorkflowError } from "@/lib/review/service";
import { rawCidFromSha256, verifyPublicRawBlock } from "./raw-cid";
import { readPinnedRawBlock, type PinReader } from "./ipfs-reader";
import { recordUnknownPinOutcome } from "./pinning";

async function loadCandidate(tx: Prisma.TransactionClient, passportId: string, publicationId: string, attemptId: string) {
  const locked = await tx.passport.updateMany({ where: { id: passportId }, data: { updatedAt: new Date() } });
  if (!locked.count) throw new WorkflowError(404, "Passport not found");
  const publication = await tx.publication.findFirst({ where: { id: publicationId, passportId }, include: { confirmation: true, passport: {
    select: { status: true, version: true, submittedVersion: true, approvedVersion: true },
  } } });
  const attempt = await tx.publicationPinAttempt.findFirst({ where: { id: attemptId, publicationId } });
  if (!publication || !attempt) throw new WorkflowError(404, "Pin attempt not found");
  const confirmation = publication.confirmation, passport = publication.passport;
  let snapshot;
  try { snapshot = publicSnapshotSchema.parse(JSON.parse(confirmation.canonicalJson)); }
  catch { throw new WorkflowError(409, "Stored public confirmation is invalid"); }
  if (canonicalize(snapshot) !== confirmation.canonicalJson ||
    await sha256Hex(confirmation.canonicalJson) !== confirmation.payloadHash || snapshot.certificateId !== confirmation.certificateId ||
    publication.canonicalJson !== confirmation.canonicalJson || publication.payloadHash !== confirmation.payloadHash ||
    confirmation.invalidatedAt || passport.status !== "APPROVED" || passport.version !== publication.passportVersion ||
    confirmation.passportVersion !== publication.passportVersion || confirmation.approvedVersion !== publication.approvedVersion ||
    passport.approvedVersion !== publication.approvedVersion || passport.submittedVersion !== publication.approvedVersion ||
    publication.chainId !== 97 || publication.cancelledAt || publication.contractAddress || publication.transactionHash || publication.tokenId || !attempt.dispatchedAt ||
    attempt.expectedCid !== rawCidFromSha256(publication.payloadHash)) {
    throw new WorkflowError(409, "Dispatched publication no longer matches its confirmed bytes");
  }
  const verified = attempt.status === "VERIFIED" && publication.status === "PINNED";
  if (verified) {
    if (attempt.verifiedCid !== attempt.expectedCid || publication.ipfsCid !== attempt.verifiedCid || !attempt.verifiedAt || !attempt.providerPinId) {
      throw new WorkflowError(409, "Stored pin verification is inconsistent");
    }
  } else if (publication.status !== "PINNING" || !["DISPATCHING", "UNKNOWN"].includes(attempt.status) || publication.ipfsCid) {
    throw new WorkflowError(409, "Pin attempt is not awaiting verification");
  }
  return { publication, attempt, verified };
}

function result(cid: string, verifiedAt: Date) {
  return { status: "PINNED" as const, cid, verifiedAt: verifiedAt.toISOString(), issued: false as const };
}

/** Internal read-only reconciliation. The reader is a trusted server dependency, never request data.
 * Recording an already public result must still work after the initiating user/config is revoked.
 * No new dispatch, upload, mint, retry permission or public certificate is produced here.
 */
export async function reconcilePinAttempt(passportId: string, publicationId: string, attemptId: string, reader: PinReader = readPinnedRawBlock) {
  const before = await getDb().$transaction((tx) => loadCandidate(tx, passportId, publicationId, attemptId));
  if (before.verified) return result(before.attempt.verifiedCid!, before.attempt.verifiedAt!);
  // Once readback starts, an uncertain outcome remains durable even if this process crashes.
  try { await recordUnknownPinOutcome(passportId, publicationId, attemptId); }
  catch (error) {
    if (!(error instanceof WorkflowError) || error.status !== 409) throw error;
    const concurrent = await getDb().$transaction((tx) => loadCandidate(tx, passportId, publicationId, attemptId));
    if (concurrent.verified) return result(concurrent.attempt.verifiedCid!, concurrent.attempt.verifiedAt!);
    throw error;
  }
  let receipt;
  try {
    receipt = await reader(before.attempt.expectedCid!);
    if (receipt.kind === "pinned") {
      if (!receipt.pinId || receipt.pinId.length > 128) throw new Error();
      await verifyPublicRawBlock(before.publication.canonicalJson, before.publication.payloadHash, receipt.cid, receipt.bytes);
    }
  } catch {
    const current = await getDb().$transaction((tx) => loadCandidate(tx, passportId, publicationId, attemptId));
    if (current.verified) return result(current.attempt.verifiedCid!, current.attempt.verifiedAt!);
    throw new WorkflowError(503, "IPFS result is unverified; publication remains blocked pending readback");
  }
  if (receipt.kind === "not-confirmed") {
    const current = await getDb().$transaction((tx) => loadCandidate(tx, passportId, publicationId, attemptId));
    return current.verified ? result(current.attempt.verifiedCid!, current.attempt.verifiedAt!) : { status: "UNKNOWN" as const, issued: false as const };
  }
  // Network I/O is outside the transaction. Recheck the complete immutable commitment after it.
  return getDb().$transaction(async (tx) => {
    const current = await loadCandidate(tx, passportId, publicationId, attemptId);
    if (current.publication.canonicalJson !== before.publication.canonicalJson || current.publication.payloadHash !== before.publication.payloadHash ||
      current.attempt.expectedCid !== before.attempt.expectedCid || current.attempt.walletChallengeId !== before.attempt.walletChallengeId ||
      current.attempt.dispatchedAt?.getTime() !== before.attempt.dispatchedAt?.getTime()) {
      throw new WorkflowError(409, "Dispatched publication changed during readback");
    }
    if (current.verified) return result(current.attempt.verifiedCid!, current.attempt.verifiedAt!);
    const now = new Date();
    await tx.publicationPinAttempt.update({ where: { id: attemptId }, data: {
      status: "VERIFIED", verifiedCid: receipt.cid, providerPinId: receipt.pinId, verifiedAt: now, closedAt: now,
    } });
    await tx.publication.update({ where: { id: publicationId }, data: { status: "PINNED", ipfsCid: receipt.cid } });
    await tx.auditLog.create({ data: { passportId, publicationId, actorId: "system:publication-recovery",
      version: before.publication.passportVersion, action: "PUBLICATION_PIN_VERIFIED", fromStatus: "APPROVED", toStatus: "APPROVED",
      note: `Pin attempt: ${attemptId}` } });
    return result(receipt.cid, now);
  });
}
