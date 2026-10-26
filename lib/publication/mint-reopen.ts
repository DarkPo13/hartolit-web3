import "server-only";

import { z } from "zod";
import type { Prisma, PublicationMintReopenKind } from "@/generated/prisma/client";
import type { PublicClient } from "viem";
import { getDb } from "@/lib/db";
import { canonicalize } from "@/lib/hash";
import { WorkflowError } from "@/lib/review/service";
import { inspectMintTransaction, type MintReader } from "./chain-mint";
import { inspectMintCancellation } from "./mint-cancellation";
import { lockDispatchedMint } from "./mint-observation";
import { lockMintWallet, mintWalletState, verifyMintWalletAnchors } from "./mint-wallet";
import { boundedMintMonitorReader } from "./mint-reader";
import { publicationPublisherAccess } from "./service";

/** D75: two-person reopening of a closed mint whose recorded result no longer holds on
 * chain, and moving a pending attempt's dispatch anchor to an earlier verified block.
 * Classification always comes from fresh chain reads, never from the caller. Reopening
 * returns the attempt to UNKNOWN; the existing check, D44/D48 closures and D74
 * re-publication then apply. Nothing here sends, resends or uses a new nonce.
 */
type ReopenReader = MintReader & Pick<PublicClient, "getTransactionCount">;
const NEGATIVE: PublicationMintReopenKind[] = ["LOST", "SUCCESS_REVERTED"];
export const REOPEN_WAIT_MS = 24 * 60 * 60 * 1000;
const kindSchema = z.enum(["LOST", "SUCCESS_REVERTED", "FAILURE_SUCCEEDED", "TOKEN_CHANGED", "CANCELLATION_CHANGED", "DISPATCH_ANCHOR_CHANGED"]);
const proposeSchema = z.strictObject({ requestId: z.uuid(), reason: z.string().trim().min(10).max(1000), acknowledgement: z.literal("PROPOSE_MINT_REOPEN") });
const approveSchema = z.strictObject({ requestId: z.uuid(), proposalId: z.uuid(), expectedKind: kindSchema,
  expectedObservationVersion: z.number().int().nonnegative(), acknowledgement: z.literal("APPROVE_MINT_REOPEN") });
const withdrawSchema = z.strictObject({ proposalId: z.uuid(), acknowledgement: z.literal("WITHDRAW_MINT_REOPEN") });
const freshnessMs = 15_000;

async function activeAdmin(tx: Prisma.TransactionClient, adminId: string) {
  if (!await tx.user.findFirst({ where: { id: adminId, role: "admin", banned: false, twoFactorEnabled: true }, select: { id: true } })) {
    throw new WorkflowError(403, "An active administrator with MFA is required");
  }
}
function requirePublisher(adminId: string, wallet: string) {
  const access = publicationPublisherAccess(adminId);
  if (!access.configured || !access.canProve || access.walletAddress !== wallet) {
    throw new WorkflowError(403, "Only the current designated MFA publisher with this wallet proposes");
  }
}

type Context = Awaited<ReturnType<typeof lockDispatchedMint>>;
type Evidence = { kind: PublicationMintReopenKind; head: bigint; detail: Record<string, string>; newAnchor?: { number: bigint; hash: string } };

type Anchor = Awaited<ReturnType<typeof mintWalletState>>["anchors"][number];

/** Fresh classification, outside any database transaction; null when the recorded result
 * still holds, is unsettled, or no class applies. `anchors` are the wallet's saved anchors.
 */
async function classify(context: Context, anchors: Anchor[], rawReader: ReopenReader): Promise<Evidence | null> {
  const reader = boundedMintMonitorReader(rawReader) as ReopenReader, attempt = context.attempt;
  const tip = await reader.getBlock();
  if (tip.number === null || await reader.getChainId() !== 97) throw new WorkflowError(503, "Chain could not be read");
  const head = tip.number;
  if (!context.finalized && !context.failed) {
    if (attempt.dispatchBlockNumber === null || !attempt.dispatchBlockHash) return null;
    const block = attempt.dispatchBlockNumber <= head ? await reader.getBlock({ blockNumber: attempt.dispatchBlockNumber }) : null;
    if (block?.hash === attempt.dispatchBlockHash) return null;
    // An earlier verified anchor: the newest closed proof (or checkpoint) below this nonce that is canonical now.
    const earlier = anchors.filter(anchor => anchor.nonce < attempt.nonce).sort((a, b) => (a.nonce < b.nonce ? 1 : -1))[0];
    if (!earlier || BigInt(earlier.receipt.blockNumber) >= attempt.dispatchBlockNumber) {
      throw new WorkflowError(409, "No earlier verified wallet anchor exists; this needs the manual incident procedure");
    }
    await verifyMintWalletAnchors([earlier], reader);
    return { kind: "DISPATCH_ANCHOR_CHANGED", head, detail: { anchor: "not canonical", newAnchorBlock: earlier.receipt.blockNumber },
      newAnchor: { number: BigInt(earlier.receipt.blockNumber), hash: earlier.receipt.blockHash } };
  }
  if (!attempt.quarantinedAt) return null;
  const used = BigInt(await reader.getTransactionCount({ address: attempt.publisherWallet as `0x${string}`, blockNumber: head })) > attempt.nonce;
  const closed = (context.finalized ?? context.failed)!;
  if (closed.status === "CANCELLED") {
    const result = await inspectMintCancellation(context.intent, closed.transactionHash, attempt.nonce, reader).catch(() => null);
    if (result?.status === "CANCELLED") return null;
    if (!used) return { kind: "LOST", head, detail: { proof: "self-send not found", nonce: "unused" } };
    return result ? { kind: "CANCELLATION_CHANGED", head, detail: { proof: result.status } } : null;
  }
  const result = await inspectMintTransaction(context.intent, closed.transactionHash, reader, attempt.nonce).catch(() => null);
  if (!result) return null;
  if (context.finalized) {
    if (result.status === "VERIFIED") return result.tokenId === context.finalized.tokenId ? null
      : { kind: "TOKEN_CHANGED", head, detail: { tokenId: result.tokenId, block: result.blockNumber } };
    if (result.status === "REVERTED") return { kind: "SUCCESS_REVERTED", head, detail: { block: result.blockNumber } };
  } else {
    if (result.status === "VERIFIED") return { kind: "FAILURE_SUCCEEDED", head, detail: { tokenId: result.tokenId, block: result.blockNumber } };
    if (result.status === "REVERTED") return null;
  }
  return result.status === "UNKNOWN" && !used ? { kind: "LOST", head, detail: { transaction: "not found", nonce: "unused" } } : null;
}

async function load(tx: Prisma.TransactionClient, passportId: string, attemptId: string) {
  const context = await lockDispatchedMint(tx, passportId, attemptId);
  await lockMintWallet(tx, context.attempt.chainId, context.attempt.publisherWallet);
  return context;
}
async function walletAnchors(tx: Prisma.TransactionClient, context: Context) {
  if (context.finalized || context.failed) return [];
  return (await mintWalletState(tx, context.attempt.chainId, context.attempt.publisherWallet, { allowStaleCheckpoint: true })).anchors;
}
const proofId = (context: Context) => context.attempt.finalizedObservationId ?? context.attempt.failedObservationId;

/** Read-only state for the incident panel: the open proposal and when it may be approved. */
export async function mintReopenState(passportId: string, attemptId: string) {
  const proposal = await getDb().publicationMintReopen.findFirst({ where: { attemptId, status: "PROPOSED", attempt: { preparation: { publication: { passportId } } } },
    select: { id: true, kind: true, reason: true, proposedById: true, proposedAt: true, proposedHeadBlock: true, attempt: { select: { observationVersion: true,
      preparation: { select: { intentJson: true } } } } } });
  const applied = await getDb().publicationMintReopen.count({ where: { attemptId, status: "APPLIED" } });
  if (!proposal) return { proposal: null, appliedCount: applied };
  const confirmations = Number(JSON.parse(proposal.attempt.preparation.intentJson).requiredConfirmations ?? 0);
  const negative = NEGATIVE.includes(proposal.kind);
  return { appliedCount: applied, proposal: { id: proposal.id, kind: proposal.kind, reason: proposal.reason, proposedById: proposal.proposedById,
    proposedAt: proposal.proposedAt.toISOString(), observationVersion: proposal.attempt.observationVersion,
    approvableAt: new Date(proposal.proposedAt.getTime() + (negative ? REOPEN_WAIT_MS : 0)).toISOString(),
    approvableAtBlock: (proposal.proposedHeadBlock + BigInt(negative ? 10 * confirmations : 0)).toString() } };
}

export async function proposeMintReopen(adminId: string, passportId: string, attemptId: string, input: unknown, reader: ReopenReader) {
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "A reason of 10-1000 characters and the proposal acknowledgement are required");
  const data = parsed.data;
  const existing = await getDb().publicationMintReopen.findUnique({ where: { requestId: data.requestId } });
  if (existing) {
    if (existing.attemptId !== attemptId || existing.proposedById !== adminId) throw new WorkflowError(409, "Proposal request belongs to another proposal");
    return { status: "RECORDED" as const, proposalId: existing.id, kind: existing.kind };
  }
  const before = await getDb().$transaction(async tx => {
    await activeAdmin(tx, adminId);
    const context = await load(tx, passportId, attemptId);
    requirePublisher(adminId, context.attempt.publisherWallet);
    if (await tx.publicationMintReopen.count({ where: { attemptId, status: "PROPOSED" } })) throw new WorkflowError(409, "A proposal for this attempt is already open");
    return { context, anchors: await walletAnchors(tx, context), startedAt: Date.now() };
  });
  const evidence = await classify(before.context, before.anchors, reader);
  if (!evidence) throw new WorkflowError(409, "The recorded result still holds or is not settled; restore, re-anchor or wait");
  return getDb().$transaction(async tx => {
    const context = await load(tx, passportId, attemptId);
    requirePublisher(adminId, context.attempt.publisherWallet);
    if (context.binding !== before.context.binding || proofId(context) !== proofId(before.context) || Date.now() - before.startedAt >= freshnessMs) {
      throw new WorkflowError(409, "The attempt changed during the check; review it again");
    }
    const row = await tx.publicationMintReopen.create({ data: { attemptId, requestId: data.requestId, kind: evidence.kind, reason: data.reason,
      proposedById: adminId, proposedHeadBlock: evidence.head, proposalEvidenceJson: canonicalize(evidence.detail),
      reviewedObservationVersion: context.attempt.observationVersion, priorStatus: context.attempt.status, priorProofObservationId: proofId(context),
      priorTokenId: context.finalized?.tokenId ?? null,
      ...(evidence.kind === "DISPATCH_ANCHOR_CHANGED" ? { priorAnchorBlockNumber: context.attempt.dispatchBlockNumber, priorAnchorBlockHash: context.attempt.dispatchBlockHash,
        newAnchorBlockNumber: evidence.newAnchor!.number, newAnchorBlockHash: evidence.newAnchor!.hash } : {}) } });
    await tx.auditLog.create({ data: { passportId, publicationId: context.publication.id, actorId: adminId, version: context.publication.passportVersion,
      action: "PUBLICATION_MINT_REOPEN_PROPOSED", fromStatus: "APPROVED", toStatus: "APPROVED", note: `Mint reopen proposal ${evidence.kind}: ${row.id}` } });
    return { status: "PROPOSED" as const, proposalId: row.id, kind: row.kind };
  });
}

export async function withdrawMintReopen(adminId: string, passportId: string, attemptId: string, input: unknown) {
  const parsed = withdrawSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "The withdrawal acknowledgement is required");
  return getDb().$transaction(async tx => {
    await activeAdmin(tx, adminId);
    const context = await lockDispatchedMint(tx, passportId, attemptId);
    const changed = await tx.publicationMintReopen.updateMany({ where: { id: parsed.data.proposalId, attemptId, status: "PROPOSED" },
      data: { status: "WITHDRAWN", withdrawnAt: new Date() } });
    if (!changed.count) throw new WorkflowError(409, "No open proposal to withdraw");
    await tx.auditLog.create({ data: { passportId, publicationId: context.publication.id, actorId: adminId, version: context.publication.passportVersion,
      action: "PUBLICATION_MINT_REOPEN_WITHDRAWN", fromStatus: "APPROVED", toStatus: "APPROVED", note: `Mint reopen proposal withdrawn: ${parsed.data.proposalId}` } });
    return { status: "WITHDRAWN" as const };
  });
}

/** Second person. Fresh checks must still show the proposed class; LOST and
 * SUCCESS_REVERTED also wait 24 hours and ten times the configured depth.
 */
export async function approveMintReopen(adminId: string, passportId: string, attemptId: string, input: unknown, reader: ReopenReader) {
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "The exact proposal, expected class and approval acknowledgement are required");
  const data = parsed.data;
  const replay = await getDb().publicationMintReopen.findUnique({ where: { approvalRequestId: data.requestId } });
  if (replay) {
    if (replay.id !== data.proposalId || replay.approvedById !== adminId) throw new WorkflowError(409, "Approval request belongs to another proposal");
    return { status: "RECORDED" as const, proposalId: replay.id, kind: replay.kind };
  }
  const before = await getDb().$transaction(async tx => {
    await activeAdmin(tx, adminId);
    const context = await load(tx, passportId, attemptId);
    const proposal = await tx.publicationMintReopen.findFirst({ where: { id: data.proposalId, attemptId, status: "PROPOSED" } });
    if (!proposal || proposal.kind !== data.expectedKind) throw new WorkflowError(409, "The proposal changed or was closed; review it again");
    if (proposal.proposedById === adminId) throw new WorkflowError(403, "A second administrator must approve");
    if (context.attempt.observationVersion !== data.expectedObservationVersion || proofId(context) !== proposal.priorProofObservationId ||
      context.attempt.status !== proposal.priorStatus) throw new WorkflowError(409, "The attempt changed since the review; review it again");
    if (NEGATIVE.includes(proposal.kind) && Date.now() - proposal.proposedAt.getTime() < REOPEN_WAIT_MS) {
      throw new WorkflowError(409, "The 24-hour waiting period has not passed");
    }
    return { context, proposal, anchors: await walletAnchors(tx, context), startedAt: Date.now() };
  });
  const { proposal } = before;
  const evidence = await classify(before.context, before.anchors, reader);
  const depth = BigInt(before.context.intent.requiredConfirmations);
  if (!evidence || evidence.kind !== proposal.kind ||
    (proposal.kind === "DISPATCH_ANCHOR_CHANGED" && (evidence.newAnchor?.number !== proposal.newAnchorBlockNumber || evidence.newAnchor?.hash !== proposal.newAnchorBlockHash))) {
    throw new WorkflowError(409, "A fresh check no longer shows the proposed class; the proposal stays open");
  }
  if (NEGATIVE.includes(proposal.kind) && evidence.head < proposal.proposedHeadBlock + 10n * depth) {
    throw new WorkflowError(409, "The chain has not advanced ten times the configured depth since the proposal");
  }
  return getDb().$transaction(async tx => {
    await activeAdmin(tx, adminId);
    const context = await load(tx, passportId, attemptId);
    if (context.binding !== before.context.binding || proofId(context) !== proofId(before.context) ||
      context.attempt.observationVersion !== before.context.attempt.observationVersion || Date.now() - before.startedAt >= freshnessMs) {
      throw new WorkflowError(409, "The attempt changed during the check; review it again");
    }
    const now = new Date();
    const applied = await tx.publicationMintReopen.updateMany({ where: { id: proposal.id, status: "PROPOSED" }, data: { status: "APPLIED", approvedById: adminId,
      approvalRequestId: data.requestId, approvedAt: now, approvedHeadBlock: evidence.head, approvalEvidenceJson: canonicalize(evidence.detail) } });
    if (!applied.count) throw new WorkflowError(409, "The proposal changed or was closed; review it again");
    const attempt = context.attempt;
    if (proposal.kind === "DISPATCH_ANCHOR_CHANGED") {
      // Discovery restarts from the earlier verified block; a closure needs a new search first.
      await tx.publicationMintAttempt.update({ where: { id: attempt.id }, data: { dispatchBlockNumber: proposal.newAnchorBlockNumber,
        dispatchBlockHash: proposal.newAnchorBlockHash, discoveryBlockNumber: null, discoveryBlockHash: null,
        discoveryVersion: attempt.discoveryVersion + 1, monitorNextAt: now } });
      await tx.auditLog.create({ data: { passportId, publicationId: context.publication.id, actorId: adminId, version: context.publication.passportVersion,
        action: "PUBLICATION_MINT_DISPATCH_REANCHORED", fromStatus: "APPROVED", toStatus: "APPROVED", note: `Dispatch anchor moved: ${proposal.id}` } });
      return { status: "APPLIED" as const, proposalId: proposal.id, kind: proposal.kind };
    }
    // Re-anchored history and the active-slot index both refer to closed states; keep those for the manual procedure.
    if (await tx.publicationMintReanchor.count({ where: { attemptId: attempt.id } })) {
      throw new WorkflowError(409, "A re-anchored attempt cannot be reopened in the app; use the manual incident procedure");
    }
    // A record already published again (D74) keeps that publication; reopening would create two open ones.
    if (await tx.publication.count({ where: { confirmationId: context.publication.confirmationId, id: { not: context.publication.id },
      status: { notIn: ["CANCELLED", "CHAIN_FAILED", "CHAIN_FAILED_SUSPENDED"] } } })) {
      throw new WorkflowError(409, "This record was published again; the earlier attempt stays closed (manual procedure)");
    }
    if (await tx.publicationMintAttempt.count({ where: { chainId: attempt.chainId, publisherWallet: attempt.publisherWallet,
      status: { in: ["DISPATCHING", "UNKNOWN"] }, id: { not: attempt.id } } })) {
      throw new WorkflowError(409, "Another mint of this wallet is open; resolve it first");
    }
    await tx.publicationMintAttempt.update({ where: { id: attempt.id }, data: { status: "UNKNOWN", unknownAt: now,
      finalizedAt: null, finalizedObservationId: null, finalizationStatus: null, failedAt: null, failedObservationId: null, failureStatus: null,
      anchorObservationId: null, quarantinedAt: null, monitorToken: null, monitorUntil: null, monitorNextAt: now,
      discoveryBlockNumber: null, discoveryBlockHash: null, discoveryVersion: attempt.discoveryVersion + 1, observationVersion: attempt.observationVersion + 1 } });
    await tx.publication.update({ where: { id: context.publication.id }, data: { status: "CHAIN_PENDING", contractAddress: null, transactionHash: null, tokenId: null } });
    await tx.publicationMintResult.updateMany({ where: { attemptId: attempt.id }, data: { status: "SUSPENDED" } });
    await tx.auditLog.create({ data: { passportId, publicationId: context.publication.id, actorId: adminId, version: context.publication.passportVersion,
      action: "PUBLICATION_MINT_REOPENED", fromStatus: "APPROVED", toStatus: "APPROVED", note: `Mint reopened (${proposal.kind}): ${proposal.id}` } });
    return { status: "APPLIED" as const, proposalId: proposal.id, kind: proposal.kind };
  });
}

/** Foreign use of the attempt's nonce (incident class "different transaction at the same nonce"):
 * the latest search found a conflicting transaction that is not a zero-value self-send. No in-app resolution.
 */
export async function foreignNonceTransaction(passportId: string, attemptId: string, reader: MintReader) {
  const row = await getDb().publicationMintAttempt.findFirst({ where: { id: attemptId, status: { in: ["DISPATCHING", "UNKNOWN"] }, preparation: { publication: { passportId } } },
    select: { publisherWallet: true, discoveryVersion: true, discoveries: { orderBy: { revision: "desc" }, take: 1, select: { revision: true, status: true, transactionHash: true } } } });
  const latest = row?.discoveries[0];
  if (!row || !latest || latest.revision !== row.discoveryVersion || latest.status !== "CONFLICT" || !latest.transactionHash) return null;
  try {
    const found = await boundedMintMonitorReader(reader).getTransaction({ hash: latest.transactionHash as `0x${string}` });
    const selfSend = found.to?.toLowerCase() === row.publisherWallet && found.value === 0n && (found.input === "0x" || found.input === "0x0");
    return selfSend ? null : latest.transactionHash;
  } catch { return null; }
}
