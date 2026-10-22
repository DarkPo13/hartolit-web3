import "server-only";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { canonicalize } from "@/lib/hash";
import { WorkflowError } from "@/lib/review/service";
import { createMintIntent, validateMintIntent, requireExactMintTransaction, inspectMintTransaction, type MintReader } from "./chain-mint";
import { rawCidFromSha256 } from "./raw-cid";
import { RAW_PIN_PROFILE } from "./target";

const inputSchema = z.strictObject({ transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/).nullable() });
const unissued = (status: "UNKNOWN" | "UNAVAILABLE" | "MISMATCH") => ({ status, issued: false as const, canResend: false as const });

async function load(tx: Prisma.TransactionClient, passportId: string, attemptId: string) {
  const locked = await tx.passport.updateMany({ where: { id: passportId }, data: { updatedAt: new Date() } });
  if (!locked.count) throw new WorkflowError(404, "Passport not found");
  const attempt = await tx.publicationMintAttempt.findFirst({ where: { id: attemptId, preparation: { publication: { passportId } } },
    include: { preparation: { include: { pinAttempt: true, publication: { include: { confirmation: true,
      passport: { select: { status: true, version: true, approvedVersion: true, submittedVersion: true } } } } } } } });
  if (!attempt) throw new WorkflowError(404, "Mint attempt not found");
  const preparation = attempt.preparation, pin = preparation.pinAttempt, publication = preparation.publication;
  const confirmation = publication.confirmation, passport = publication.passport;
  if (publication.status !== "CHAIN_PENDING" || publication.cancelledAt || publication.contractAddress || publication.transactionHash || publication.tokenId ||
    confirmation.invalidatedAt || passport.status !== "APPROVED" || passport.version !== publication.passportVersion ||
    passport.approvedVersion !== publication.approvedVersion || passport.submittedVersion !== publication.approvedVersion ||
    confirmation.passportVersion !== publication.passportVersion || confirmation.approvedVersion !== publication.approvedVersion ||
    publication.canonicalJson !== confirmation.canonicalJson || publication.payloadHash !== confirmation.payloadHash ||
    attempt.chainId !== 97 || publication.chainId !== attempt.chainId || attempt.publisherWallet !== publication.publisherWallet ||
    pin.publicationId !== publication.id || pin.status !== "VERIFIED" || !pin.dispatchedAt || !pin.verifiedAt || !pin.closedAt || !pin.providerPinId ||
    !pin.providerKey || !pin.providerConfigHash || pin.storageProfile !== RAW_PIN_PROFILE ||
    pin.expectedCid !== rawCidFromSha256(publication.payloadHash) || pin.verifiedCid !== pin.expectedCid || publication.ipfsCid !== pin.verifiedCid) {
    throw new WorkflowError(409, "Dispatched mint no longer matches its saved commitment");
  }
  let intent;
  try {
    const saved = await validateMintIntent(JSON.parse(preparation.intentJson));
    intent = await createMintIntent({ chainId: saved.chainId, contractAddress: saved.contractAddress, contractCodeHash: saved.contractCodeHash,
      publisherWallet: saved.publisherWallet, recipientWallet: saved.recipientWallet, requiredConfirmations: saved.requiredConfirmations },
    { canonicalJson: publication.canonicalJson, payloadHash: publication.payloadHash, ipfsCid: pin.verifiedCid! });
    if (canonicalize(intent) !== preparation.intentJson || intent.sha256 !== preparation.intentSha256 ||
      intent.publisherWallet !== attempt.publisherWallet || intent.certificateId !== confirmation.certificateId) throw new Error();
  } catch { throw new WorkflowError(409, "Saved mint intent is invalid"); }
  const binding = canonicalize({ preparationId: preparation.id, pinAttemptId: pin.id, intentJson: preparation.intentJson,
    requestId: attempt.requestId, chainId: attempt.chainId, wallet: attempt.publisherWallet, nonce: attempt.nonce.toString(), walletChallengeId: pin.walletChallengeId,
    createdAt: attempt.createdAt.toISOString(), deadlineAt: attempt.deadlineAt.toISOString(),
    pinTarget: pin.providerConfigHash, providerKey: pin.providerKey, pinVerifiedAt: pin.verifiedAt!.toISOString(), providerPinId: pin.providerPinId });
  return { attempt, publication, intent, binding };
}

/** Internal historical readback, never authority to send, release a wallet slot or
 * issue a certificate. Actor/config revocation must not hide an already sent result.
 * The reader is a trusted server dependency; request data contains no target/URL.
 */
export async function observeMintAttempt(passportId: string, attemptId: string, input: unknown, reader: MintReader) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "A transaction hash or explicit missing hash is required");
  const hash = parsed.data.transactionHash;
  const before = await getDb().$transaction(tx => load(tx, passportId, attemptId));
  let matched = false;
  let result: Awaited<ReturnType<typeof inspectMintTransaction>> | ReturnType<typeof unissued> = unissued("UNKNOWN");
  // The missing hash is a durable uncertainty marker, never a discovery or retry.
  if (hash) {
    try {
      if (await reader.getChainId() !== before.intent.chainId) throw new Error();
      let transaction;
      try { transaction = await reader.getTransaction({ hash: hash as `0x${string}` }); }
      catch (error) {
        if (!(error instanceof Error) || error.name !== "TransactionNotFoundError") throw error;
      }
      if (transaction) {
        try { requireExactMintTransaction(before.intent, hash, transaction, before.attempt.nonce); matched = true; }
        catch { result = unissued("MISMATCH"); }
        if (matched) result = await inspectMintTransaction(before.intent, hash, reader, before.attempt.nonce);
      }
    } catch { result = unissued("UNAVAILABLE"); }
  }
  // Every network read is outside the transaction. A concurrent observation wins
  // by revision; an older response cannot overwrite it or masquerade as fresh.
  return getDb().$transaction(async tx => {
    const current = await load(tx, passportId, attemptId);
    if (current.binding !== before.binding) throw new WorkflowError(409, "Mint commitment changed during observation");
    if (current.attempt.observationVersion !== before.attempt.observationVersion) {
      return { status: "SUPERSEDED" as const, issued: false as const, canResend: false as const };
    }
    let transactionId: string | null = null;
    if (matched && hash) {
      const existing = await tx.publicationMintTransaction.findUnique({ where: { transactionHash: hash } });
      if (existing && (existing.attemptId !== attemptId || existing.nonce !== current.attempt.nonce)) {
        throw new WorkflowError(409, "Transaction is already linked to a different mint attempt");
      }
      transactionId = existing?.id ?? (await tx.publicationMintTransaction.create({ data: {
        attemptId, nonce: current.attempt.nonce, transactionHash: hash,
      } })).id;
    }
    const revision = current.attempt.observationVersion + 1;
    const row = await tx.publicationMintObservation.create({ data: { attemptId, revision, reportedHash: hash, transactionId,
      status: result.status, resultJson: canonicalize({ version: 1, ...result }) } });
    await tx.publicationMintAttempt.update({ where: { id: attemptId }, data: { observationVersion: revision } });
    await tx.auditLog.create({ data: { passportId, publicationId: current.publication.id, actorId: "system:publication-recovery",
      version: current.publication.passportVersion, action: "PUBLICATION_MINT_OBSERVED", fromStatus: "APPROVED", toStatus: "APPROVED", note: `Mint observation: ${row.id}` } });
    return { ...result, observationId: row.id, revision, observedAt: row.observedAt.toISOString(), matchedTransactionId: transactionId,
      historical: true as const };
  });
}
