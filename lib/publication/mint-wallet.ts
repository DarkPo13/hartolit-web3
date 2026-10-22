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
export const MAX_MINT_WALLET_RECEIPTS = 64;

export function finalizedMintReceipt(row: PublicationMintObservation | null) {
  try {
    if (!row || row.status !== "VERIFIED" || !row.transactionId) throw new Error();
    const receipt = receiptSchema.parse(JSON.parse(row.resultJson));
    if (receipt.transactionHash !== row.reportedHash) throw new Error();
    return receipt;
  } catch { throw new WorkflowError(409, "Finalized mint receipt is invalid"); }
}

export async function lockMintWallet(tx: Prisma.TransactionClient, chainId: number, wallet: string) {
  const key = `hartolit:mint:${chainId}:${wallet}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`;
}

/** Bounded revalidation before releasing/consuming another shared-wallet slot.
 * Historical nonce claims are permanent. Do not truncate an oversized history.
 */
export async function mintWalletHistory(tx: Prisma.TransactionClient, chainId: number, wallet: string) {
  await lockMintWallet(tx, chainId, wallet);
  const rows = await tx.publicationMintAttempt.findMany({ where: { chainId, publisherWallet: wallet, status: "FINALIZED" },
    orderBy: { nonce: "asc" }, take: MAX_MINT_WALLET_RECEIPTS + 1, include: { finalizedObservation: true } });
  if (rows.some(row => row.quarantinedAt)) throw new WorkflowError(409, "Publisher wallet is quarantined; no new send or finalization is allowed");
  if (rows.length > MAX_MINT_WALLET_RECEIPTS) throw new WorkflowError(503, "Wallet history exceeds the bounded verification limit; no new permission is allowed");
  const anchors = rows.map(row => ({ attemptId: row.id, nonce: row.nonce, receipt: finalizedMintReceipt(row.finalizedObservation) }));
  return { anchors, binding: canonicalize(rows.map(row => ({ id: row.id, nonce: row.nonce.toString(),
    revision: row.observationVersion, finalizedAt: row.finalizedAt?.toISOString(), proof: row.finalizedObservation?.resultJson }))) };
}

export async function verifyMintWalletAnchors(anchors: Awaited<ReturnType<typeof mintWalletHistory>>["anchors"], reader: MintReader,
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
