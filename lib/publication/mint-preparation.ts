import "server-only";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { canonicalize } from "@/lib/hash";
import { WorkflowError } from "@/lib/review/service";
import { createMintIntent } from "./chain-mint";
import { lockPinnedPublication } from "./service";
import { requireStoredWalletProof } from "./wallet-proof";
import { rawCidFromSha256 } from "./raw-cid";
import { RAW_PIN_PROFILE } from "./target";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const preparationSchema = z.strictObject({
  publicationId: z.uuid(), requestId: z.uuid(), confirmationId: z.uuid(),
  passportVersion: z.number().int().positive(), expectedSha256: sha256,
  expectedIntentSha256: sha256, acknowledgement: z.literal("PREPARE_EXACT_MINT"),
});

/** Current authority/facts/storage check shared by preparation and future dispatch.
 * All callers retain the passport lock through their writes; no RPC occurs here.
 */
export async function lockMintCandidate(tx: Prisma.TransactionClient, adminId: string, passportId: string, publicationId: string, selectedTarget: unknown) {
  const { reservation, confirmation } = await lockPinnedPublication(tx, adminId, passportId, publicationId);
  if (reservation.cancelledAt || reservation.contractAddress || reservation.transactionHash || reservation.tokenId) {
    throw new WorkflowError(409, "Publication is not awaiting its first mint");
  }
  const proof = await requireStoredWalletProof(tx, adminId, reservation, confirmation);
  const pin = await tx.publicationPinAttempt.findFirst({ where: { publicationId: reservation.id, status: "VERIFIED" } });
  if (!pin || pin.walletChallengeId !== proof.id || !pin.dispatchedAt || !pin.verifiedAt || !pin.closedAt || !pin.providerPinId ||
    !pin.providerKey || !pin.providerConfigHash || pin.storageProfile !== RAW_PIN_PROFILE ||
    pin.expectedCid !== rawCidFromSha256(reservation.payloadHash) || pin.verifiedCid !== pin.expectedCid || reservation.ipfsCid !== pin.verifiedCid) {
    throw new WorkflowError(409, "A bound verified pin receipt and its consumed proof are required");
  }
  let intent;
  try {
    intent = await createMintIntent(selectedTarget, { canonicalJson: reservation.canonicalJson,
      payloadHash: reservation.payloadHash, ipfsCid: pin.verifiedCid });
  } catch { throw new WorkflowError(503, "A valid server-owned mint target is required"); }
  if (intent.publisherWallet !== reservation.publisherWallet) throw new WorkflowError(409, "The reviewed mint publisher changed");
  return { reservation, confirmation, pin, intent };
}

/** Internal private preparation only. selectedTarget is a trusted server dependency,
 * never a browser-supplied address/RPC URL. No configured caller or HTTP action exists.
 * A future send must reauthorize and durably consume a separate dispatch permission.
 */
export async function prepareMintIntent(adminId: string, passportId: string, input: unknown, selectedTarget: unknown) {
  const parsed = preparationSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "Exact mint acknowledgement and confirmation are required");
  const data = parsed.data;
  return getDb().$transaction(async tx => {
    const { reservation, confirmation, pin, intent } = await lockMintCandidate(tx, adminId, passportId, data.publicationId, selectedTarget);
    if (data.confirmationId !== confirmation.id || data.passportVersion !== reservation.passportVersion || data.expectedSha256 !== reservation.payloadHash) {
      throw new WorkflowError(409, "Mint acknowledgement does not match the current pinned confirmation");
    }
    if (intent.sha256 !== data.expectedIntentSha256) {
      throw new WorkflowError(409, "The reviewed mint intent changed");
    }
    const intentJson = canonicalize(intent);
    const existing = await tx.publicationMintPreparation.findFirst({ where: { OR: [{ publicationId: reservation.id }, { requestId: data.requestId }] } });
    const response = (id: string, createdAt: Date, created: boolean) => ({
      preparation: { id, publicationId: reservation.id, pinAttemptId: pin.id, requestId: data.requestId,
        intent, createdAt: createdAt.toISOString(), issued: false as const, dispatchEnabled: false as const, canResend: false as const }, created,
    });
    if (existing) {
      if (existing.publicationId !== reservation.id || existing.requestId !== data.requestId || existing.pinAttemptId !== pin.id ||
        existing.intentSha256 !== intent.sha256 || existing.intentJson !== intentJson) {
        throw new WorkflowError(409, "An existing mint preparation cannot be replaced or rebound");
      }
      return response(existing.id, existing.createdAt, false);
    }
    const row = await tx.publicationMintPreparation.create({ data: {
      publicationId: reservation.id, pinAttemptId: pin.id, requestId: data.requestId, intentJson, intentSha256: intent.sha256,
    } });
    await tx.auditLog.create({ data: {
      passportId, publicationId: reservation.id, actorId: adminId, action: "PUBLICATION_MINT_PREPARED",
      version: reservation.passportVersion, fromStatus: "APPROVED", toStatus: "APPROVED", note: `Mint preparation: ${row.id}`,
    } });
    return response(row.id, row.createdAt, true);
  });
}
