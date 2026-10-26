import "server-only";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { canonicalize, sha256Hex } from "@/lib/hash";
import { publicSnapshotSchema, type PublicSnapshot } from "@/lib/public-snapshot/schema";
import { buildPublicSnapshot } from "@/lib/public-snapshot/service";
import { WorkflowError } from "@/lib/review/service";
import { publisherWalletSchema, type PublicationReservationInput } from "./schema";

// Mint closed as cancelled or reverted (D44, D48): history, not an open publication.
const FAILED_PUBLICATION = ["CHAIN_FAILED", "CHAIN_FAILED_SUSPENDED"] as const;
const configurationSchema = z.strictObject({ userId: z.string().trim().min(1).max(191), walletAddress: publisherWalletSchema });
const reservationSelect = {
  id: true, confirmationId: true, status: true, passportVersion: true, approvedVersion: true,
  payloadHash: true, publisherWallet: true, createdAt: true, cancelledAt: true, walletVerifiedAt: true,
  tokenId: true, chainId: true, contractAddress: true, transactionHash: true,
  mintPreparation: { select: { attempt: { select: { reopens: { where: { status: "APPLIED", priorTokenId: { not: null } }, select: { priorTokenId: true } } } } } },
} satisfies Prisma.PublicationSelect;
type ReservationRow = Prisma.PublicationGetPayload<{ select: typeof reservationSelect }>;

function publisherConfiguration() {
  const parsed = configurationSchema.safeParse({
    userId: process.env.HARTOLIT_PUBLISHER_USER_ID,
    walletAddress: process.env.HARTOLIT_PUBLISHER_WALLET,
  });
  if (!parsed.success) throw new WorkflowError(503, "Publication publisher is not configured");
  return parsed.data;
}

export function publicationPublisherAccess(adminId: string) {
  try {
    const publisher = publisherConfiguration();
    const canProve = publisher.userId === adminId;
    return { configured: true, canProve, walletAddress: canProve ? publisher.walletAddress : null, chainId: 97 as const };
  } catch (error) {
    if (!(error instanceof WorkflowError) || error.status !== 503) throw error;
    return { configured: false, canProve: false, walletAddress: null, chainId: 97 as const };
  }
}

function reservationResponse(row: Omit<ReservationRow, "mintPreparation">, previousTokenIds: string[] = []) {
  return {
    id: row.id, confirmationId: row.confirmationId, status: row.status,
    passportVersion: row.passportVersion, approvedVersion: row.approvedVersion,
    payloadHash: row.payloadHash, walletAddress: row.publisherWallet,
    createdAt: row.createdAt.toISOString(), cancelledAt: row.cancelledAt?.toISOString() ?? null,
    walletVerifiedAt: row.walletVerifiedAt?.toISOString() ?? null,
    // Public chain identifiers, only once finalized (suspended keeps them for review).
    issued: row.tokenId && row.chainId && row.contractAddress && row.transactionHash && (row.status === "PUBLISHED" || row.status === "CHAIN_SUSPENDED")
      ? { tokenId: row.tokenId, chainId: row.chainId, contractAddress: row.contractAddress, transactionHash: row.transactionHash,
        // Numbers this record had before a reopening (D75): printed copies must be replaced.
        previousTokenIds: previousTokenIds.filter(id => id !== row.tokenId) } : null,
  };
}

// Shared by reservation and wallet proof. All checks and callers' writes stay under
// the passport lock used by recall; a signature never bypasses current approval.
async function lockPublicationCandidate(tx: Prisma.TransactionClient, adminId: string, passportId: string, input: PublicationReservationInput, stage: "RESERVED" | "PINNED" = "RESERVED") {
  const publisher = publisherConfiguration();
  if (adminId !== publisher.userId || input.walletAddress !== publisher.walletAddress) {
    throw new WorkflowError(403, "Only the designated publisher and configured wallet may reserve publication");
  }

  const admin = await tx.user.findFirst({
    where: { id: adminId, role: "admin", banned: false, twoFactorEnabled: true }, select: { id: true },
  });
  if (!admin) throw new WorkflowError(403, "Publication requires an active administrator with MFA");

  // Serialize reservation and recall on the passport row; never bump the confirmed version.
  const locked = await tx.passport.updateMany({
    where: { id: passportId, status: "APPROVED", version: input.passportVersion },
    data: { updatedAt: new Date() },
  });
  if (!locked.count) {
    const exists = await tx.passport.findUnique({ where: { id: passportId }, select: { id: true } });
    throw new WorkflowError(exists ? 409 : 404, exists ? "Approved passport changed; reload its confirmation" : "Passport not found");
  }
  const passport = await tx.passport.findUniqueOrThrow({
    where: { id: passportId }, select: { approvedVersion: true, submittedVersion: true },
  });
  const confirmation = await tx.publicSnapshotConfirmation.findUnique({ where: { id: input.confirmationId } });
  if (!confirmation || confirmation.passportId !== passportId || confirmation.invalidatedAt ||
    confirmation.passportVersion !== input.passportVersion || confirmation.approvedVersion !== passport.approvedVersion ||
    passport.approvedVersion !== passport.submittedVersion || confirmation.payloadHash !== input.expectedSha256) {
    throw new WorkflowError(409, "An active confirmation matching this approval and hash is required");
  }
  let snapshot: PublicSnapshot;
  try { snapshot = publicSnapshotSchema.parse(JSON.parse(confirmation.canonicalJson)); }
  catch { throw new WorkflowError(409, "Stored public confirmation is invalid"); }
  if (canonicalize(snapshot) !== confirmation.canonicalJson || await sha256Hex(confirmation.canonicalJson) !== confirmation.payloadHash ||
    snapshot.certificateId !== confirmation.certificateId) {
    throw new WorkflowError(409, "Stored public confirmation is invalid");
  }

  // Publications whose mint failed are history: a cancelled or reverted attempt (CHAIN_FAILED)
  // may be followed by a new publication of the same snapshot; a quarantined one must be resolved first.
  const existing = await tx.publication.findFirst({ where: { confirmationId: confirmation.id, status: { notIn: [...FAILED_PUBLICATION] } } });
  const failed = existing ? [] : await tx.publication.findMany({ where: { confirmationId: confirmation.id, status: { in: [...FAILED_PUBLICATION] } },
    orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
  if (failed.some(row => row.status === "CHAIN_FAILED_SUSPENDED")) throw new WorkflowError(409, "A quarantined failed publication of this record must be resolved first");
  if (existing && (existing.status !== stage || existing.reservedById !== adminId || existing.publisherWallet !== publisher.walletAddress ||
    existing.canonicalJson !== confirmation.canonicalJson || existing.payloadHash !== confirmation.payloadHash ||
    existing.passportVersion !== confirmation.passportVersion || existing.approvedVersion !== confirmation.approvedVersion || existing.chainId !== 97)) {
    throw new WorkflowError(409, "Publication reservation cannot be replaced or restarted");
  }
  const otherActive = await tx.publication.findFirst({
    where: { passportId, status: { notIn: ["CANCELLED", "CHAIN_FAILED"] }, confirmationId: { not: confirmation.id } }, select: { id: true },
  });
  if (otherActive) throw new WorkflowError(409, "This passport already has an active publication");

  // Rebuild only to validate current facts and selected READY evidence. Persist the saved bytes.
  const preview = await buildPublicSnapshot(tx, passportId, confirmation.weatherFileId, confirmation.chemicalFileId, {
    certificateId: confirmation.certificateId, snapshotAt: snapshot.snapshotAt,
  }, stage === "PINNED" ? existing?.id : undefined, true);
  if (preview.canonicalJson !== confirmation.canonicalJson || preview.sha256 !== confirmation.payloadHash) {
    throw new WorkflowError(409, "Public facts or selected evidence changed after confirmation");
  }
  return { existing, confirmation, publisher, previousFailedId: failed[0]?.id ?? null };
}

async function lockExistingPublication(tx: Prisma.TransactionClient, adminId: string, passportId: string, publicationId: string, stage: "RESERVED" | "PINNED") {
  const configured = publisherConfiguration();
  if (configured.userId !== adminId) throw new WorkflowError(403, "Only the designated publisher may prove wallet ownership");
  const reservation = await tx.publication.findFirst({ where: { id: publicationId, passportId } });
  if (!reservation) throw new WorkflowError(404, "Publication reservation not found");
  const { existing, confirmation } = await lockPublicationCandidate(tx, adminId, passportId, {
    confirmationId: reservation.confirmationId, passportVersion: reservation.passportVersion,
    expectedSha256: reservation.payloadHash, walletAddress: configured.walletAddress,
  }, stage);
  if (!existing || existing.id !== publicationId) throw new WorkflowError(409, "Publication reservation changed");
  return { reservation: existing, confirmation };
}

export async function lockReservedPublication(tx: Prisma.TransactionClient, adminId: string, passportId: string, publicationId: string) {
  return lockExistingPublication(tx, adminId, passportId, publicationId, "RESERVED");
}

/** Same authorization and fact checks, scoped to the verified-storage stage only. */
export async function lockPinnedPublication(tx: Prisma.TransactionClient, adminId: string, passportId: string, publicationId: string) {
  return lockExistingPublication(tx, adminId, passportId, publicationId, "PINNED");
}

/** Private planning only: no IPFS request, chain transaction or wallet ownership claim. */
export async function reservePublication(adminId: string, passportId: string, input: PublicationReservationInput) {
  return getDb().$transaction(async (tx) => {
    const { existing, confirmation, publisher, previousFailedId } = await lockPublicationCandidate(tx, adminId, passportId, input);
    if (existing) return { reservation: reservationResponse(existing), created: false };

    const reservation = await tx.publication.create({ data: {
      passportId, confirmationId: confirmation.id, reservedById: adminId, publisherWallet: publisher.walletAddress,
      passportVersion: confirmation.passportVersion, approvedVersion: confirmation.approvedVersion,
      // A new publication after a failed one gets its own key; the failed one keeps the original.
      idempotencyKey: previousFailedId ? `confirmation:${confirmation.id}:after:${previousFailedId}` : `confirmation:${confirmation.id}`, canonicalJson: confirmation.canonicalJson,
      payloadHash: confirmation.payloadHash, chainId: 97,
    }, select: reservationSelect });
    await tx.auditLog.create({ data: {
      passportId, publicationId: reservation.id, actorId: adminId, action: "PUBLICATION_RESERVED",
      version: confirmation.passportVersion, fromStatus: "APPROVED", toStatus: "APPROVED",
      ...(previousFailedId ? { note: `Published again after failed publication ${previousFailedId}` } : {}),
    } });
    return { reservation: reservationResponse(reservation), created: true };
  });
}

export async function publicationReservations(passportId: string) {
  const row = await getDb().passport.findUnique({
    where: { id: passportId }, select: { publications: { orderBy: { createdAt: "desc" }, take: 50, select: reservationSelect } },
  });
  if (!row) throw new WorkflowError(404, "Passport not found");
  const previous = [...new Set(row.publications.flatMap(publication => publication.mintPreparation?.attempt?.reopens.map(reopen => reopen.priorTokenId!) ?? []))];
  return row.publications.map(publication => reservationResponse(publication, previous));
}
