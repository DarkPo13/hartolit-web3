import "server-only";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { canonicalize, sha256Hex } from "@/lib/hash";
import { publicSnapshotSchema, type PublicSnapshot } from "@/lib/public-snapshot/schema";
import { buildPublicSnapshot } from "@/lib/public-snapshot/service";
import { WorkflowError } from "@/lib/review/service";
import { publisherWalletSchema, type PublicationReservationInput } from "./schema";

const configurationSchema = z.strictObject({ userId: z.string().trim().min(1).max(191), walletAddress: publisherWalletSchema });
const reservationSelect = {
  id: true, confirmationId: true, status: true, passportVersion: true, approvedVersion: true,
  payloadHash: true, publisherWallet: true, createdAt: true, cancelledAt: true, walletVerifiedAt: true,
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

function reservationResponse(row: ReservationRow) {
  return {
    id: row.id, confirmationId: row.confirmationId, status: row.status,
    passportVersion: row.passportVersion, approvedVersion: row.approvedVersion,
    payloadHash: row.payloadHash, walletAddress: row.publisherWallet,
    createdAt: row.createdAt.toISOString(), cancelledAt: row.cancelledAt?.toISOString() ?? null,
    walletVerifiedAt: row.walletVerifiedAt?.toISOString() ?? null,
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

  const existing = await tx.publication.findUnique({ where: { confirmationId: confirmation.id } });
  if (existing && (existing.status !== stage || existing.reservedById !== adminId || existing.publisherWallet !== publisher.walletAddress ||
    existing.canonicalJson !== confirmation.canonicalJson || existing.payloadHash !== confirmation.payloadHash ||
    existing.passportVersion !== confirmation.passportVersion || existing.approvedVersion !== confirmation.approvedVersion || existing.chainId !== 97)) {
    throw new WorkflowError(409, "Publication reservation cannot be replaced or restarted");
  }
  const otherActive = await tx.publication.findFirst({
    where: { passportId, status: { not: "CANCELLED" }, confirmationId: { not: confirmation.id } }, select: { id: true },
  });
  if (otherActive) throw new WorkflowError(409, "This passport already has an active publication");

  // Rebuild only to validate current facts and selected READY evidence. Persist the saved bytes.
  const preview = await buildPublicSnapshot(tx, passportId, confirmation.weatherFileId, confirmation.chemicalFileId, {
    certificateId: confirmation.certificateId, snapshotAt: snapshot.snapshotAt,
  }, stage === "PINNED" ? existing?.id : undefined);
  if (preview.canonicalJson !== confirmation.canonicalJson || preview.sha256 !== confirmation.payloadHash) {
    throw new WorkflowError(409, "Public facts or selected evidence changed after confirmation");
  }
  return { existing, confirmation, publisher };
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
    const { existing, confirmation, publisher } = await lockPublicationCandidate(tx, adminId, passportId, input);
    if (existing) return { reservation: reservationResponse(existing), created: false };

    const reservation = await tx.publication.create({ data: {
      passportId, confirmationId: confirmation.id, reservedById: adminId, publisherWallet: publisher.walletAddress,
      passportVersion: confirmation.passportVersion, approvedVersion: confirmation.approvedVersion,
      idempotencyKey: `confirmation:${confirmation.id}`, canonicalJson: confirmation.canonicalJson,
      payloadHash: confirmation.payloadHash, chainId: 97,
    }, select: reservationSelect });
    await tx.auditLog.create({ data: {
      passportId, publicationId: reservation.id, actorId: adminId, action: "PUBLICATION_RESERVED",
      version: confirmation.passportVersion, fromStatus: "APPROVED", toStatus: "APPROVED",
    } });
    return { reservation: reservationResponse(reservation), created: true };
  });
}

export async function publicationReservations(passportId: string) {
  const row = await getDb().passport.findUnique({
    where: { id: passportId }, select: { publications: { orderBy: { createdAt: "desc" }, take: 50, select: reservationSelect } },
  });
  if (!row) throw new WorkflowError(404, "Passport not found");
  return row.publications.map(reservationResponse);
}
