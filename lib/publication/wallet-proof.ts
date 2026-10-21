import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma, Publication, PublicSnapshotConfirmation, PublicationWalletChallenge } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { WorkflowError } from "@/lib/review/service";
import { lockReservedPublication } from "./service";
import type { WalletProofInput } from "./schema";
import { verifyPublisherSignature } from "./wallet-signature";

const lifetimeMs = 5 * 60_000;

function applicationOrigin() {
  try {
    const url = new URL(process.env.BETTER_AUTH_URL ?? "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.origin.length > 255) throw new Error();
    return url.origin;
  } catch { throw new WorkflowError(503, "Publisher application origin is not configured"); }
}

function ownershipMessage(challenge: {
  id: string; publicationId: string; walletAddress: string; origin: string; nonce: string; createdAt: Date; expiresAt: Date;
}, certificateId: string, payloadHash: string) {
  return [
    "Hartolit publisher wallet ownership", "",
    "This signature proves wallet control only.",
    "It does not publish a certificate or authorize a blockchain transaction.", "",
    `Application: ${challenge.origin}`,
    `Wallet: ${challenge.walletAddress}`,
    "Chain ID: 97 (BSC Testnet)",
    `Certificate: ${certificateId}`,
    `Publication reservation: ${challenge.publicationId}`,
    `Payload SHA-256: ${payloadHash}`,
    `Challenge: ${challenge.id}`,
    `Nonce: ${challenge.nonce}`,
    `Issued at: ${challenge.createdAt.toISOString()}`,
    `Expires at: ${challenge.expiresAt.toISOString()}`,
  ].join("\n");
}

function challengeResponse(row: PublicationWalletChallenge) {
  return { id: row.id, publicationId: row.publicationId, walletAddress: row.walletAddress,
    chainId: 97, message: row.message, expiresAt: row.expiresAt.toISOString() };
}

function matchesContext(row: PublicationWalletChallenge, actorId: string, wallet: string, certificateId: string, hash: string) {
  return row.actorId === actorId && row.walletAddress === wallet && row.origin === applicationOrigin() &&
    row.expiresAt.getTime() - row.createdAt.getTime() === lifetimeMs &&
    row.message === ownershipMessage(row, certificateId, hash);
}

/** A stored timestamp alone is not proof. Revalidate the consumed, unrevoked signature. */
export async function requireStoredWalletProof(
  tx: Prisma.TransactionClient, adminId: string, reservation: Publication, confirmation: PublicSnapshotConfirmation,
) {
  const verifiedAt = reservation.walletVerifiedAt;
  if (!verifiedAt) throw new WorkflowError(409, "Wallet ownership proof is required");
  const rows = await tx.publicationWalletChallenge.findMany({
    where: { publicationId: reservation.id, consumedAt: verifiedAt, invalidatedAt: null }, take: 2,
  });
  const row = rows[0];
  if (rows.length !== 1 || !row || !row.signature || !row.consumedAt || row.createdAt > row.consumedAt ||
    row.consumedAt >= row.expiresAt || row.consumedAt > new Date() ||
    !matchesContext(row, adminId, reservation.publisherWallet, confirmation.certificateId, reservation.payloadHash) ||
    !await verifyPublisherSignature(row.walletAddress, row.message, row.signature)) {
    throw new WorkflowError(409, "Stored wallet proof is invalid or revoked");
  }
  // An already consumed proof stays valid after the challenge's signing deadline.
  return row;
}

export async function createWalletChallenge(adminId: string, passportId: string, publicationId: string) {
  return getDb().$transaction(async (tx) => {
    const { reservation, confirmation } = await lockReservedPublication(tx, adminId, passportId, publicationId);
    if (reservation.walletVerifiedAt) throw new WorkflowError(409, "Wallet ownership is already verified for this reservation");
    const now = new Date();
    const pending = await tx.publicationWalletChallenge.findFirst({
      where: { publicationId, consumedAt: null, invalidatedAt: null },
    });
    // Concurrent requests and retries reuse a live challenge instead of accumulating rows.
    if (pending && pending.expiresAt > now && pending.createdAt <= now &&
      matchesContext(pending, adminId, reservation.publisherWallet, confirmation.certificateId, reservation.payloadHash)) {
      return { challenge: challengeResponse(pending), created: false };
    }
    await tx.publicationWalletChallenge.updateMany({
      where: { publicationId, consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: now },
    });
    const data = {
      id: randomUUID(), publicationId, actorId: adminId, walletAddress: reservation.publisherWallet,
      origin: applicationOrigin(), nonce: randomBytes(32).toString("hex"), createdAt: now,
      expiresAt: new Date(now.getTime() + lifetimeMs),
    };
    const row = await tx.publicationWalletChallenge.create({ data: {
      ...data, message: ownershipMessage(data, confirmation.certificateId, reservation.payloadHash),
    } });
    await tx.auditLog.create({ data: {
      passportId, publicationId, actorId: adminId, action: "PUBLICATION_WALLET_CHALLENGED",
      version: reservation.passportVersion, fromStatus: "APPROVED", toStatus: "APPROVED",
    } });
    return { challenge: challengeResponse(row), created: true };
  });
}

export async function verifyWalletProof(adminId: string, passportId: string, input: WalletProofInput) {
  return getDb().$transaction(async (tx) => {
    const { reservation, confirmation } = await lockReservedPublication(tx, adminId, passportId, input.publicationId);
    const row = await tx.publicationWalletChallenge.findUnique({ where: { id: input.challengeId } });
    const now = new Date();
    if (!row || row.publicationId !== reservation.id || row.consumedAt || row.invalidatedAt ||
      row.expiresAt <= now || row.createdAt > now || reservation.walletVerifiedAt ||
      !matchesContext(row, adminId, reservation.publisherWallet, confirmation.certificateId, reservation.payloadHash)) {
      throw new WorkflowError(409, "Wallet challenge expired, changed or was already used; request a new challenge");
    }
    // EIP-191 recovery is local and supports EOA wallets only. No RPC, contract-wallet
    // simulation, signing key or external publication is involved in this proof.
    const valid = await verifyPublisherSignature(row.walletAddress, row.message, input.signature);
    if (!valid) throw new WorkflowError(403, "Wallet signature does not match this challenge");
    // Recheck expiry after verification; the same passport lock serializes recall and replay.
    const verifiedAt = new Date();
    const consumed = await tx.publicationWalletChallenge.updateMany({
      where: { id: row.id, consumedAt: null, invalidatedAt: null, expiresAt: { gt: verifiedAt } },
      data: { consumedAt: verifiedAt, signature: input.signature },
    });
    if (!consumed.count) throw new WorkflowError(409, "Wallet challenge expired or was already used");
    await tx.publication.update({ where: { id: reservation.id }, data: { walletVerifiedAt: verifiedAt } });
    await tx.auditLog.create({ data: {
      passportId, publicationId: reservation.id, actorId: adminId, action: "PUBLICATION_WALLET_VERIFIED",
      version: reservation.passportVersion, fromStatus: "APPROVED", toStatus: "APPROVED",
    } });
    return { publicationId: reservation.id, walletAddress: row.walletAddress, walletVerifiedAt: verifiedAt.toISOString() };
  });
}
