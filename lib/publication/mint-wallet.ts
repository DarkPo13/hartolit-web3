import "server-only";

import { z } from "zod";
import type { Prisma, PublicationMintObservation } from "@/generated/prisma/client";
import { canonicalize } from "@/lib/hash";
import { WorkflowError } from "@/lib/review/service";
import type { MintReader } from "./chain-mint";

const hex = z.string().regex(/^0x[0-9a-f]{64}$/);
const integer = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const receiptSchema = z.strictObject({ version: z.literal(1), status: z.literal("VERIFIED"),
  issued: z.literal(false), canResend: z.literal(false), transactionHash: hex, blockHash: hex, blockNumber: integer,
  contractAddress: z.string().regex(/^0x[0-9a-f]{40}$/), intentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  tokenId: z.string().regex(/^[1-9][0-9]{0,77}$/), confirmations: integer.refine(value => BigInt(value) >= 2n),
});
const failedReceiptSchema = receiptSchema.omit({ tokenId: true, status: true }).extend({ status: z.literal("REVERTED") });
const cancelledReceiptSchema = failedReceiptSchema.omit({ status: true }).extend({ status: z.literal("CANCELLED"), proofKind: z.literal("CANCELLATION"), nonce: integer,
  publisherWallet: z.string().regex(/^0x[0-9a-f]{40}$/), headBlockNumber: integer, headBlockHash: hex,
}).refine(value => BigInt(value.headBlockNumber) >= BigInt(value.blockNumber) &&
  BigInt(value.headBlockNumber) - BigInt(value.blockNumber) + 1n === BigInt(value.confirmations));
export const MAX_MINT_WALLET_RECEIPTS = 64;
export const CLOSED_MINT_STATUSES = ["FINALIZED", "FAILED_TERMINAL"] as const;

export function failedMintReceipt(row: PublicationMintObservation | null) {
  try {
    if (!row) throw new Error();
    const receipt = row.status === "CANCELLED" && !row.transactionId
      ? cancelledReceiptSchema.parse(JSON.parse(row.resultJson))
      : row.status === "REVERTED" && row.transactionId ? failedReceiptSchema.parse(JSON.parse(row.resultJson)) : null;
    if (!receipt) throw new Error();
    if (receipt.transactionHash !== row.reportedHash) throw new Error();
    return receipt;
  } catch { throw new WorkflowError(409, "Closed failed mint receipt is invalid"); }
}

export function finalizedMintReceipt(row: PublicationMintObservation | null) {
  try {
    if (!row || row.status !== "VERIFIED" || !row.transactionId) throw new Error();
    const receipt = receiptSchema.parse(JSON.parse(row.resultJson));
    if (receipt.transactionHash !== row.reportedHash) throw new Error();
    return receipt;
  } catch { throw new WorkflowError(409, "Finalized mint receipt is invalid"); }
}

type ClosedMintRow = { status: string; nonce: bigint; publisherWallet: string; failedObservation: PublicationMintObservation | null;
  finalizedObservation: PublicationMintObservation | null; currentReanchor?: { anchorObservation: PublicationMintObservation } | null };
export const closedMintProofInclude = { finalizedObservation: true, failedObservation: true,
  currentReanchor: { include: { anchorObservation: true } } } as const;

/** The immutable first closed proof. */
export function closedMintReceipt(row: ClosedMintRow) {
  const receipt = row.status === "FAILED_TERMINAL" ? failedMintReceipt(row.failedObservation) : finalizedMintReceipt(row.finalizedObservation);
  if (receipt.status === "CANCELLED" && (receipt.nonce !== row.nonce.toString() || receipt.publisherWallet !== row.publisherWallet)) {
    throw new WorkflowError(409, "Cancellation proof wallet or nonce changed");
  }
  return receipt;
}

type ClosedMintOutcome = { status: string; transactionHash: string; contractAddress: string; intentSha256: string;
  tokenId?: string; nonce?: string; publisherWallet?: string };

/** Same transaction and outcome; only the inclusion block/depth may differ. */
export function sameClosedMintOutcome(first: ClosedMintOutcome, other: ClosedMintOutcome) {
  return other.status === first.status && other.transactionHash === first.transactionHash &&
    other.contractAddress === first.contractAddress && other.intentSha256 === first.intentSha256 &&
    (first.status !== "VERIFIED" || (other.status === "VERIFIED" && other.tokenId === first.tokenId)) &&
    (first.status !== "CANCELLED" || (other.status === "CANCELLED" && other.nonce === first.nonce && other.publisherWallet === first.publisherWallet));
}

/** Current canonical inclusion anchor: a reviewed re-inclusion of the unchanged
 * first transaction, or the first proof itself. Never a different transaction.
 */
export function closedMintAnchor(row: ClosedMintRow) {
  const first = closedMintReceipt(row), saved = row.currentReanchor?.anchorObservation;
  if (!saved) return first;
  const anchor = closedMintReceipt({ ...row, finalizedObservation: saved, failedObservation: saved });
  if (!sameClosedMintOutcome(first, anchor)) throw new WorkflowError(409, "Re-included mint anchor does not match its first proof");
  return anchor;
}

export async function lockMintWallet(tx: Prisma.TransactionClient, chainId: number, wallet: string) {
  const key = `hartolit:mint:${chainId}:${wallet}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`;
}

export type MintWalletAnchor = { attemptId: string | null; nonce: bigint; receipt: { blockNumber: string; blockHash: string; confirmations: string } };
type Checkpoint = Awaited<ReturnType<Prisma.TransactionClient["publicationMintWalletCheckpoint"]["findFirst"]>>;

/** DB-side validity of a checkpoint: the covered closed set and covered anchors
 * are unchanged since it was attested. Chain validity is its block (an ancestor
 * of every covered inclusion block) staying canonical, checked with the anchors.
 */
export async function mintCheckpointCurrent(tx: Prisma.TransactionClient, checkpoint: NonNullable<Checkpoint>) {
  const covered = { chainId: checkpoint.chainId, publisherWallet: checkpoint.publisherWallet, nonce: { lte: checkpoint.coveredThroughNonce } };
  const [closed, open, reanchors, reopened] = await Promise.all([
    tx.publicationMintAttempt.count({ where: { ...covered, status: { in: [...CLOSED_MINT_STATUSES] } } }),
    tx.publicationMintAttempt.count({ where: { ...covered, status: { notIn: [...CLOSED_MINT_STATUSES] } } }),
    tx.publicationMintReanchor.count({ where: { attempt: covered } }),
    // A covered attempt reopened after the attestation (D75) may close again with another proof.
    tx.publicationMintReopen.count({ where: { attempt: covered, status: "APPLIED", approvedAt: { gt: checkpoint.createdAt } } }),
  ]);
  return closed === checkpoint.coveredCount && open === 0 && reanchors === checkpoint.coveredReanchorCount && reopened === 0;
}

export function checkpointAnchor(checkpoint: NonNullable<Checkpoint>): MintWalletAnchor {
  return { attemptId: null, nonce: checkpoint.coveredThroughNonce, receipt: { blockNumber: checkpoint.blockNumber.toString(),
    blockHash: checkpoint.blockHash, confirmations: checkpoint.confirmations.toString() } };
}

/** Bounded wallet state after the latest verified checkpoint. Quarantine is read
 * across the whole wallet, including attempts the checkpoint covers.
 */
export async function mintWalletState(tx: Prisma.TransactionClient, chainId: number, wallet: string, { allowStaleCheckpoint = false } = {}) {
  await lockMintWallet(tx, chainId, wallet);
  const checkpoint = await tx.publicationMintWalletCheckpoint.findFirst({ where: { chainId, publisherWallet: wallet }, orderBy: { sequence: "desc" } });
  const stale = !!checkpoint && !await mintCheckpointCurrent(tx, checkpoint);
  // Recovery may read a stale checkpoint (a covered proof was re-anchored); its
  // anchor then fails chain verification, so nothing is unblocked through it.
  if (stale && !allowStaleCheckpoint) {
    throw new WorkflowError(503, "Wallet checkpoint is stale; a new verified checkpoint is required before another permission");
  }
  const rows = await tx.publicationMintAttempt.findMany({ where: { chainId, publisherWallet: wallet,
    ...(checkpoint ? { nonce: { gt: checkpoint.coveredThroughNonce } } : {}) },
  orderBy: { nonce: "asc" }, take: MAX_MINT_WALLET_RECEIPTS + 2, include: closedMintProofInclude });
  const closed = rows.filter(row => CLOSED_MINT_STATUSES.some(status => status === row.status));
  const quarantined = await tx.publicationMintAttempt.findMany({ where: { chainId, publisherWallet: wallet, quarantinedAt: { not: null } },
    orderBy: { id: "asc" }, take: MAX_MINT_WALLET_RECEIPTS + 1, select: { id: true, quarantinedAt: true, observationVersion: true } });
  if (rows.length > MAX_MINT_WALLET_RECEIPTS + 1 || closed.length > MAX_MINT_WALLET_RECEIPTS || quarantined.length > MAX_MINT_WALLET_RECEIPTS) {
    throw new WorkflowError(503, "Wallet history exceeds the bounded verification limit; a verified checkpoint is required");
  }
  const anchors: MintWalletAnchor[] = [...(checkpoint ? [checkpointAnchor(checkpoint)] : []),
    ...closed.map(row => ({ attemptId: row.id, nonce: row.nonce, receipt: closedMintAnchor(row) }))];
  const checkpointBinding = checkpoint ? { id: checkpoint.id, sequence: checkpoint.sequence, coveredThroughNonce: checkpoint.coveredThroughNonce.toString(),
    coveredCount: checkpoint.coveredCount, coveredReanchorCount: checkpoint.coveredReanchorCount, blockHash: checkpoint.blockHash, stale } : null;
  return { checkpoint, checkpointBinding, rows, closed, quarantined, anchors };
}

/** Bounded revalidation before releasing/consuming another shared-wallet slot.
 * Historical nonce claims are permanent. Do not truncate an oversized history.
 */
export async function mintWalletHistory(tx: Prisma.TransactionClient, chainId: number, wallet: string) {
  const state = await mintWalletState(tx, chainId, wallet);
  if (state.quarantined.length) throw new WorkflowError(409, "Publisher wallet is quarantined; no new send or finalization is allowed");
  return { anchors: state.anchors, uncheckpointed: state.closed.length, binding: canonicalize({ checkpoint: state.checkpointBinding,
    rows: state.closed.map(row => ({ id: row.id, nonce: row.nonce.toString(),
      status: row.status, revision: row.observationVersion, finalizedAt: row.finalizedAt?.toISOString() ?? null,
      failedAt: row.failedAt?.toISOString() ?? null, proof: row.finalizedObservation?.resultJson ?? row.failedObservation?.resultJson,
      anchor: row.currentReanchor?.anchorObservation.resultJson ?? null })) }) };
}

export async function verifyMintWalletAnchors(anchors: MintWalletAnchor[], reader: MintReader,
  head?: Awaited<ReturnType<MintReader["getBlock"]>>) {
  if (!anchors.length) return null;
  try {
    const tip = head ?? await reader.getBlock();
    if (tip.number === null || !tip.hash || await reader.getChainId() !== 97) throw new Error();
    const blocks = await Promise.all(anchors.map(({ receipt }) => reader.getBlock({ blockNumber: BigInt(receipt.blockNumber) })));
    if (blocks.some((block, index) => block.number !== BigInt(anchors[index]!.receipt.blockNumber) ||
      block.hash !== anchors[index]!.receipt.blockHash || block.number! + BigInt(anchors[index]!.receipt.confirmations) - 1n > tip.number!) ||
      (await reader.getBlock({ blockNumber: tip.number })).hash !== tip.hash || await reader.getChainId() !== 97) throw new Error();
    return { number: tip.number, hash: tip.hash };
  } catch { throw new WorkflowError(503, "Previously released wallet receipts could not be verified; no new permission is allowed"); }
}
