import "server-only";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { canonicalize } from "@/lib/hash";
import { WorkflowError } from "@/lib/review/service";
import { createMintIntent, validateMintIntent, requireExactMintTransaction, inspectMintTransaction, type MintReader } from "./chain-mint";
import { inspectMintCancellation } from "./mint-cancellation";
import { rawCidFromSha256 } from "./raw-cid";
import { RAW_PIN_PROFILE } from "./target";
import { closedMintAnchor, closedMintProofInclude, finalizedMintReceipt, failedMintReceipt, lockMintWallet, mintWalletHistory, verifyMintWalletAnchors } from "./mint-wallet";
import { requireMintMonitorLease, type MintMonitorLease } from "./mint-monitor-lease";

const inputSchema = z.strictObject({ transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/).nullable() });
const resultSchema = z.strictObject({ transactionId: z.uuid() });
const resultFreshnessMs = 15_000;
const unissued = (status: "UNKNOWN" | "UNAVAILABLE" | "MISMATCH") => ({ status, issued: false as const, canResend: false as const });

export async function lockDispatchedMint(tx: Prisma.TransactionClient, passportId: string, attemptId: string) {
  const locked = await tx.passport.updateMany({ where: { id: passportId }, data: { updatedAt: new Date() } });
  if (!locked.count) throw new WorkflowError(404, "Passport not found");
  const attempt = await tx.publicationMintAttempt.findFirst({ where: { id: attemptId, preparation: { publication: { passportId } } },
    include: { ...closedMintProofInclude, preparation: { include: { pinAttempt: true, publication: { include: { confirmation: true,
      passport: { select: { status: true, version: true, approvedVersion: true, submittedVersion: true } } } } } } } });
  if (!attempt) throw new WorkflowError(404, "Mint attempt not found");
  const preparation = attempt.preparation, pin = preparation.pinAttempt, publication = preparation.publication;
  const confirmation = publication.confirmation, passport = publication.passport;
  const finalized = attempt.status === "FINALIZED" ? finalizedMintReceipt(attempt.finalizedObservation) : null;
  const failed = attempt.status === "FAILED_TERMINAL" ? failedMintReceipt(attempt.failedObservation) : null;
  const closed = finalized ?? failed;
  // Monitoring/recovery compare canonical inclusion with the current anchor;
  // public chain fields and the first proof always come from the first proof.
  // Anchor changes are fenced by observationVersion, not by this commitment.
  const anchor = closed ? closedMintAnchor(attempt) : null;
  if (failed?.status === "CANCELLED" && (failed.nonce !== attempt.nonce.toString() || failed.publisherWallet !== attempt.publisherWallet)) {
    throw new WorkflowError(409, "Cancelled proof does not match the saved wallet and nonce");
  }
  const stageMatches = finalized
    ? publication.status === (attempt.quarantinedAt ? "CHAIN_SUSPENDED" : "PUBLISHED") && publication.contractAddress === finalized.contractAddress &&
      publication.transactionHash === finalized.transactionHash && publication.tokenId === finalized.tokenId
    : publication.status === (failed ? attempt.quarantinedAt ? "CHAIN_FAILED_SUSPENDED" : "CHAIN_FAILED" : "CHAIN_PENDING") && !publication.contractAddress && !publication.transactionHash && !publication.tokenId;
  if (!stageMatches || publication.cancelledAt ||
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
      intent.publisherWallet !== attempt.publisherWallet || intent.certificateId !== confirmation.certificateId ||
      (closed && (closed.intentSha256 !== intent.sha256 || closed.contractAddress !== intent.contractAddress))) throw new Error();
  } catch { throw new WorkflowError(409, "Saved mint intent is invalid"); }
  const binding = canonicalize({ preparationId: preparation.id, pinAttemptId: pin.id, intentJson: preparation.intentJson,
    requestId: attempt.requestId, chainId: attempt.chainId, wallet: attempt.publisherWallet, nonce: attempt.nonce.toString(), walletChallengeId: pin.walletChallengeId,
    createdAt: attempt.createdAt.toISOString(), deadlineAt: attempt.deadlineAt.toISOString(),
    pinTarget: pin.providerConfigHash, providerKey: pin.providerKey, pinVerifiedAt: pin.verifiedAt!.toISOString(), providerPinId: pin.providerPinId,
    dispatchBlockNumber: attempt.dispatchBlockNumber?.toString() ?? null, dispatchBlockHash: attempt.dispatchBlockHash });
  return { attempt, publication, intent, binding, finalized, failed, anchor };
}

/** Internal historical readback, never authority to send, release a wallet slot or
 * issue a certificate. Actor/config revocation must not hide an already sent result.
 * The reader is a trusted server dependency; request data contains no target/URL.
 */
export async function observeMintAttempt(passportId: string, attemptId: string, input: unknown, reader: MintReader) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "A transaction hash or explicit missing hash is required");
  return readAttempt(passportId, attemptId, { kind: "report", hash: parsed.data.transactionHash }, reader);
}

/** Select an as-of result only through a fresh read of a previously matched
 * transaction. Historical VERIFIED rows, caller hashes and observation IDs are
 * never sufficient. This remains private/unissued and retains the wallet slot.
 */
export async function reconcileMintResult(passportId: string, attemptId: string, input: unknown, reader: MintReader, lease?: MintMonitorLease) {
  const parsed = resultSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "A saved matching transaction is required");
  return readAttempt(passportId, attemptId, { kind: "result", transactionId: parsed.data.transactionId }, reader, lease);
}

/** Internal system completion of an already authorized send. No broadcaster or
 * public certificate route. Fresh verification is mandatory, including on replay.
 */
export async function finalizeMintPublication(passportId: string, attemptId: string, input: unknown, reader: MintReader, lease?: MintMonitorLease) {
  const parsed = resultSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "A saved matching transaction is required");
  return readAttempt(passportId, attemptId, { kind: "finalize", transactionId: parsed.data.transactionId }, reader, lease);
}

/** Internal canonical monitoring of the first closed cancellation only. */
export async function reconcileMintCancellation(passportId: string, attemptId: string, input: unknown, reader: MintReader, lease?: MintMonitorLease) {
  if (!z.strictObject({}).safeParse(input).success) throw new WorkflowError(422, "Cancellation monitoring accepts no caller hash or provider");
  return readAttempt(passportId, attemptId, { kind: "cancellation" }, reader, lease);
}

type Selection = { kind: "report"; hash: string | null } | { kind: "result" | "finalize"; transactionId: string } | { kind: "cancellation" };
async function readAttempt(passportId: string, attemptId: string, selection: Selection, reader: MintReader, lease?: MintMonitorLease) {
  const before = await getDb().$transaction(async tx => {
    const candidate = await lockDispatchedMint(tx, passportId, attemptId);
    await requireMintMonitorLease(tx, attemptId, lease);
    if (selection.kind === "report") return { ...candidate, hash: selection.hash, history: null };
    if (selection.kind === "cancellation") {
      if (candidate.failed?.status !== "CANCELLED") throw new WorkflowError(409, "An original closed cancellation is required");
      return { ...candidate, hash: candidate.failed.transactionHash, history: null };
    }
    const transaction = await tx.publicationMintTransaction.findFirst({ where: {
      id: selection.transactionId, attemptId, nonce: candidate.attempt.nonce,
    } });
    if (!transaction) throw new WorkflowError(409, "Transaction does not belong to this mint attempt");
    const history = selection.kind === "finalize" ? await mintWalletHistory(tx, candidate.attempt.chainId, candidate.attempt.publisherWallet) : null;
    return { ...candidate, hash: transaction.transactionHash, history };
  });
  const hash = before.hash;
  const closed = before.finalized || before.failed;
  if (before.failed && selection.kind === "finalize") throw new WorkflowError(409, "A closed failed send cannot be finalized or resent");
  if (closed && hash !== closed.transactionHash) throw new WorkflowError(409, "A closed transaction cannot be replaced or hidden by another report");
  const startedAt = Date.now();
  const walletAnchor = before.history ? await verifyMintWalletAnchors(before.history.anchors.filter(row => row.attemptId !== attemptId), reader) : null;
  let matched = false;
  let result: Awaited<ReturnType<typeof inspectMintTransaction>> | Awaited<ReturnType<typeof inspectMintCancellation>> | ReturnType<typeof unissued> = unissued("UNKNOWN");
  // The missing hash is a durable uncertainty marker, never a discovery or retry.
  if (hash) {
    try {
      if (await reader.getChainId() !== before.intent.chainId) throw new Error();
      if (before.failed?.status === "CANCELLED") {
        result = await inspectMintCancellation(before.intent, hash, before.attempt.nonce, reader);
      } else {
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
      }
    } catch { result = unissued("UNAVAILABLE"); }
  }
  if (walletAnchor) {
    try {
      if ((await reader.getBlock({ blockNumber: walletAnchor.number })).hash !== walletAnchor.hash || await reader.getChainId() !== 97) throw new Error();
    } catch { throw new WorkflowError(503, "Wallet history changed during finalization; no slot was released"); }
  }
  // Every network read is outside the transaction. A concurrent observation wins
  // by revision; an older response cannot overwrite it or masquerade as fresh.
  return getDb().$transaction(async tx => {
    const current = await lockDispatchedMint(tx, passportId, attemptId);
    if (current.binding !== before.binding) throw new WorkflowError(409, "Mint commitment changed during observation");
    if (current.attempt.observationVersion !== before.attempt.observationVersion || current.attempt.discoveryVersion !== before.attempt.discoveryVersion) {
      return { status: "SUPERSEDED" as const, issued: false as const, canResend: false as const };
    }
    if (selection.kind === "result" || selection.kind === "finalize") {
      const transaction = await tx.publicationMintTransaction.findFirst({ where: {
        id: selection.transactionId, attemptId, nonce: current.attempt.nonce, transactionHash: hash!,
      } });
      if (!transaction) throw new WorkflowError(409, "Saved transaction changed during result verification");
    }
    const currentClosed = current.finalized ?? current.failed;
    if (currentClosed && hash !== currentClosed.transactionHash) throw new WorkflowError(409, "Closed transaction changed");
    if (current.failed && selection.kind === "finalize") throw new WorkflowError(409, "A closed failed send cannot be finalized");
    if (selection.kind === "finalize") {
      const history = await mintWalletHistory(tx, current.attempt.chainId, current.attempt.publisherWallet);
      if (history.binding !== before.history?.binding) throw new WorkflowError(409, "Wallet history changed during finalization");
    } else if (current.finalized || current.failed) {
      // Quarantine must serialize against other passports consuming the released slot.
      await lockMintWallet(tx, current.attempt.chainId, current.attempt.publisherWallet);
    }
    await requireMintMonitorLease(tx, attemptId, lease);
    if (selection.kind !== "report" && (Date.now() - startedAt >= resultFreshnessMs || Date.now() < startedAt)) {
      throw new WorkflowError(409, "Mint result read expired; no result was selected");
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
      status: result.status, resultJson: canonicalize({ version: 1, ...(before.failed?.status === "CANCELLED" ? { proofKind: "CANCELLATION" } : {}), ...result }) } });
    await tx.publicationMintAttempt.update({ where: { id: attemptId }, data: { observationVersion: revision } });
    await tx.auditLog.create({ data: { passportId, publicationId: current.publication.id, actorId: "system:publication-recovery",
      version: current.publication.passportVersion, action: "PUBLICATION_MINT_OBSERVED", fromStatus: "APPROVED", toStatus: "APPROVED", note: `Mint observation: ${row.id}` } });
    // Only explicit fresh reconciliation can promote success. Any later report
    // suspends the projection, even a successful diagnostic read: it is not a
    // selected result. Retain the last verified receipt as historical evidence.
    const previous = await tx.publicationMintResult.findUnique({ where: { attemptId } });
    let resultStatus: "VERIFIED" | "SUSPENDED" | null = null;
    if (selection.kind !== "report" || previous) {
      resultStatus = !current.failed && selection.kind !== "report" && result.status === "VERIFIED" ? "VERIFIED" : "SUSPENDED";
      const verifiedObservationId = resultStatus === "VERIFIED" ? row.id : previous?.verifiedObservationId ?? null;
      const data = { status: resultStatus, checkedObservationId: row.id, verifiedObservationId,
        verificationStatus: verifiedObservationId ? "VERIFIED" as const : null };
      await tx.publicationMintResult.upsert({ where: { attemptId }, create: { attemptId, ...data }, update: data });
      await tx.auditLog.create({ data: { passportId, publicationId: current.publication.id, actorId: "system:publication-recovery",
        version: current.publication.passportVersion, action: "PUBLICATION_MINT_RESULT_CHECKED", fromStatus: "APPROVED", toStatus: "APPROVED", note: `Mint result ${resultStatus}: ${row.id}` } });
    }
    let publicationStatus = current.publication.status;
    if (current.failed) {
      const anchor = current.anchor!;
      const sameFailure = (result.status === "REVERTED" || result.status === "CANCELLED") && result.status === anchor.status && result.transactionHash === anchor.transactionHash &&
        result.blockNumber === anchor.blockNumber && result.blockHash === anchor.blockHash &&
        result.contractAddress === anchor.contractAddress && result.intentSha256 === anchor.intentSha256 &&
        BigInt(result.confirmations) >= BigInt(anchor.confirmations) && Date.now() >= startedAt && Date.now() - startedAt < resultFreshnessMs;
      if (!sameFailure && !current.attempt.quarantinedAt) {
        publicationStatus = "CHAIN_FAILED_SUSPENDED";
        await tx.publicationMintAttempt.update({ where: { id: attemptId }, data: { quarantinedAt: new Date() } });
        await tx.publication.update({ where: { id: current.publication.id }, data: { status: publicationStatus } });
        await tx.auditLog.create({ data: { passportId, publicationId: current.publication.id, actorId: "system:publication-recovery",
          version: current.publication.passportVersion, action: "PUBLICATION_MINT_QUARANTINED", fromStatus: "APPROVED", toStatus: "APPROVED", note: `Closed failed mint check: ${row.id}` } });
      }
    } else if (current.finalized) {
      const anchor = current.anchor!;
      const sameReceipt = result.status === "VERIFIED" && anchor.status === "VERIFIED" && result.transactionHash === anchor.transactionHash &&
        result.blockNumber === anchor.blockNumber && result.blockHash === anchor.blockHash && result.tokenId === current.finalized.tokenId &&
        Date.now() >= startedAt && Date.now() - startedAt < resultFreshnessMs;
      if (!sameReceipt && !current.attempt.quarantinedAt) {
        publicationStatus = "CHAIN_SUSPENDED";
        await tx.publicationMintAttempt.update({ where: { id: attemptId }, data: { quarantinedAt: new Date() } });
        await tx.publication.update({ where: { id: current.publication.id }, data: { status: publicationStatus } });
        await tx.auditLog.create({ data: { passportId, publicationId: current.publication.id, actorId: "system:publication-recovery",
          version: current.publication.passportVersion, action: "PUBLICATION_MINT_QUARANTINED", fromStatus: "APPROVED", toStatus: "APPROVED", note: `Finalized mint check: ${row.id}` } });
      }
    } else if (selection.kind === "finalize" && result.status === "VERIFIED") {
      publicationStatus = "PUBLISHED";
      await tx.publicationMintAttempt.update({ where: { id: attemptId }, data: { status: "FINALIZED", finalizedAt: row.observedAt,
        finalizedObservationId: row.id, finalizationStatus: "VERIFIED" } });
      await tx.publication.update({ where: { id: current.publication.id }, data: { status: publicationStatus,
        contractAddress: result.contractAddress, transactionHash: result.transactionHash, tokenId: result.tokenId } });
      await tx.auditLog.create({ data: { passportId, publicationId: current.publication.id, actorId: "system:publication-recovery",
        version: current.publication.passportVersion, action: "PUBLICATION_MINT_FINALIZED", fromStatus: "APPROVED", toStatus: "APPROVED", note: `Finalized mint receipt: ${row.id}` } });
    }
    await requireMintMonitorLease(tx, attemptId, lease);
    return { ...result, observationId: row.id, revision, observedAt: row.observedAt.toISOString(), matchedTransactionId: transactionId,
      historical: true as const, resultStatus, publicationStatus };
  });
}
