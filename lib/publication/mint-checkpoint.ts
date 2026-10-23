import "server-only";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { canonicalize, sha256Hex } from "@/lib/hash";
import { WorkflowError } from "@/lib/review/service";
import type { MintReader } from "./chain-mint";
import { boundedMintMonitorReader } from "./mint-reader";
import { publisherWalletSchema } from "./schema";
import { CLOSED_MINT_STATUSES, MAX_MINT_WALLET_RECEIPTS, checkpointAnchor, closedMintAnchor, closedMintProofInclude, lockMintWallet,
  mintCheckpointCurrent, verifyMintWalletAnchors, type MintWalletAnchor } from "./mint-wallet";

const targetSchema = z.strictObject({ chainId: z.literal(97), publisherWallet: publisherWalletSchema });
const BASE_CANDIDATES = 4;
const unissued = { issued: false as const, canResend: false as const };

type Candidate = { base: Awaited<ReturnType<Prisma.TransactionClient["publicationMintWalletCheckpoint"]["findFirst"]>>;
  covered: { id: string; nonce: bigint; receipt: MintWalletAnchor["receipt"]; proof: string }[] };

/** Candidate bases newest first: DB-current checkpoints, then the wallet start.
 * Each candidate covers at most the next 64 closed proofs after its base.
 */
async function plan(tx: Prisma.TransactionClient, chainId: number, wallet: string) {
  await lockMintWallet(tx, chainId, wallet);
  const recent = await tx.publicationMintWalletCheckpoint.findMany({ where: { chainId, publisherWallet: wallet }, orderBy: { sequence: "desc" }, take: BASE_CANDIDATES });
  const bases = [];
  for (const checkpoint of recent) if (await mintCheckpointCurrent(tx, checkpoint)) bases.push(checkpoint);
  const candidates: Candidate[] = [];
  for (const base of [...bases, null]) {
    const rows = await tx.publicationMintAttempt.findMany({ where: { chainId, publisherWallet: wallet, status: { in: [...CLOSED_MINT_STATUSES] },
      ...(base ? { nonce: { gt: base.coveredThroughNonce } } : {}) }, orderBy: { nonce: "asc" }, take: MAX_MINT_WALLET_RECEIPTS, include: closedMintProofInclude });
    // A covered range is a complete prefix: no open attempt may sit inside it.
    const through = rows.at(-1)?.nonce;
    if (through !== undefined && await tx.publicationMintAttempt.count({ where: { chainId, publisherWallet: wallet,
      status: { notIn: [...CLOSED_MINT_STATUSES] }, nonce: { lte: through } } })) throw new WorkflowError(409, "An open attempt precedes closed proofs; no checkpoint");
    candidates.push({ base, covered: rows.map(row => ({ id: row.id, nonce: row.nonce, receipt: closedMintAnchor(row),
      proof: row.currentReanchor?.anchorObservation.resultJson ?? row.finalizedObservation?.resultJson ?? row.failedObservation?.resultJson ?? "" })) });
  }
  return { latest: recent[0] ?? null, candidates, binding: canonicalize({ latest: recent[0]?.id ?? null,
    candidates: candidates.map(row => ({ base: row.base?.id ?? null, covered: row.covered.map(item => ({ id: item.id, proof: item.proof })) })) }) };
}

/** Internal building block for a trusted scheduler, never an HTTP action. It
 * attests that every closed proof up to a nonce had its current anchor at or
 * below one canonical block; it unblocks no quarantine and grants no send.
 */
export async function checkpointMintWallet(input: unknown, trustedReader: MintReader) {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "A Testnet publisher wallet is required");
  const { chainId, publisherWallet: wallet } = parsed.data;
  const before = await getDb().$transaction(tx => plan(tx, chainId, wallet));
  const startedAt = Date.now(), reader = boundedMintMonitorReader(trustedReader);
  let chosen: Candidate | undefined, head;
  try {
    const tip = await reader.getBlock();
    if (tip.number === null || !tip.hash || await reader.getChainId() !== 97) throw new Error();
    // Newest canonical base wins; a broken proof anchor is never skipped by
    // falling back further, it fails the whole checkpoint.
    for (const candidate of before.candidates) {
      if (candidate.base && (await reader.getBlock({ blockNumber: candidate.base.blockNumber })).hash !== candidate.base.blockHash) continue;
      chosen = candidate; break;
    }
    if (!chosen) throw new Error();
    if (chosen.covered.length) {
      head = await verifyMintWalletAnchors([...(chosen.base ? [checkpointAnchor(chosen.base)] : []),
        ...chosen.covered.map(row => ({ attemptId: row.id, nonce: row.nonce, receipt: row.receipt }))], reader, tip);
    }
  } catch { throw new WorkflowError(503, "Wallet proofs could not be freshly verified; no checkpoint was recorded"); }
  if (!chosen) throw new WorkflowError(503, "No canonical checkpoint base could be verified");
  if (!chosen.covered.length) {
    if (chosen.base && chosen.base.id === before.latest?.id) return { status: "CURRENT" as const, checkpointId: chosen.base.id, ...unissued };
    throw new WorkflowError(409, "No closed proofs follow the newest canonical checkpoint");
  }
  const last = chosen.covered.at(-1)!;
  const top = chosen.covered.reduce((best, row) => BigInt(row.receipt.blockNumber) > BigInt(best.receipt.blockNumber) ||
    (row.receipt.blockNumber === best.receipt.blockNumber && BigInt(row.receipt.confirmations) > BigInt(best.receipt.confirmations)) ? row : best);
  // Nonce order implies inclusion order; a lower block than the base is impossible on one chain.
  if ((chosen.base && BigInt(top.receipt.blockNumber) < chosen.base.blockNumber) ||
    chosen.covered.some(row => row.receipt.blockNumber === top.receipt.blockNumber && row.receipt.blockHash !== top.receipt.blockHash)) {
    throw new WorkflowError(409, "Covered proofs are not on one canonical chain");
  }
  const coveredSha256 = await sha256Hex(canonicalize({ base: chosen.base?.id ?? null,
    covered: chosen.covered.map(row => ({ id: row.id, nonce: row.nonce.toString(), anchor: row.receipt })) }));
  return getDb().$transaction(async tx => {
    const current = await plan(tx, chainId, wallet);
    if (current.binding !== before.binding || Date.now() < startedAt || Date.now() - startedAt >= 15_000) {
      throw new WorkflowError(409, "Wallet history changed or the check expired; no checkpoint was recorded");
    }
    const covered = { chainId, publisherWallet: wallet, nonce: { lte: last.nonce } };
    const [coveredCount, coveredReanchorCount] = await Promise.all([
      tx.publicationMintAttempt.count({ where: { ...covered, status: { in: [...CLOSED_MINT_STATUSES] } } }),
      tx.publicationMintReanchor.count({ where: { attempt: covered } }),
    ]);
    const row = await tx.publicationMintWalletCheckpoint.create({ data: { chainId, publisherWallet: wallet, sequence: (current.latest?.sequence ?? 0) + 1,
      baseCheckpointId: chosen.base?.id ?? null, coveredThroughNonce: last.nonce, coveredCount, coveredReanchorCount,
      blockNumber: BigInt(top.receipt.blockNumber), blockHash: top.receipt.blockHash, confirmations: Number(top.receipt.confirmations),
      headBlockNumber: head!.number, headBlockHash: head!.hash, coveredSha256 } });
    return { status: "CHECKPOINTED" as const, checkpointId: row.id, sequence: row.sequence, coveredThroughNonce: row.coveredThroughNonce.toString(),
      coveredCount: row.coveredCount, ...unissued };
  });
}
