import "server-only";

import { requireExactMintTransaction, type MintIntent, type MintReader } from "./chain-mint";

export const MINT_SEARCH_BLOCKS = 32;
const maxBlockTransactions = 2048, maxPageTransactions = 4096, deadlineMs = 10_000;
const hashPattern = /^0x[0-9a-f]{64}$/;
type Anchor = { number: bigint; hash: string };
export type MintSearchResult = {
  status: "FOUND" | "CONFLICT" | "SCANNED" | "CAUGHT_UP" | "REORG" | "UNAVAILABLE";
  fromBlock: bigint | null; throughBlock: bigint | null; throughBlockHash: string | null;
  headBlock: bigint | null; headBlockHash: string | null;
  scannedBlocks: number; scannedTransactions: number; transactionHash: string | null; resetToDispatchAnchor: boolean;
};
const empty = (status: MintSearchResult["status"]): MintSearchResult => ({ status, fromBlock: null, throughBlock: null,
  throughBlockHash: null, headBlock: null, headBlockHash: null, scannedBlocks: 0, scannedTransactions: 0,
  transactionHash: null, resetToDispatchAnchor: false });
const requireValue: (value: unknown) => asserts value = value => { if (!value) throw new Error(); };
class SearchReorg extends Error {}

/** One standard-RPC page, never mempool absence proof or permission to resend.
 * The caller owns the saved anchors/intent and transport response-size limits.
 * Time out locally; an underlying RPC may still settle, but its result is ignored.
 */
export async function searchMintPage(intent: MintIntent, nonce: bigint, anchor: Anchor, cursor: Anchor, reader: MintReader): Promise<MintSearchResult> {
  const startedAt = Date.now();
  async function read<T>(operation: () => Promise<T>) {
    const remaining = deadlineMs - (Date.now() - startedAt);
    if (remaining <= 0 || remaining > deadlineMs) throw new Error();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error()), remaining); })]); }
    finally { clearTimeout(timer); }
  }
  try {
    requireValue(anchor.number >= 0n && cursor.number >= anchor.number && hashPattern.test(anchor.hash) && hashPattern.test(cursor.hash));
    requireValue(await read(() => reader.getChainId()) === intent.chainId);
    const head = await read(() => reader.getBlock());
    requireValue(head.number !== null && head.number >= 0n && head.number <= BigInt(Number.MAX_SAFE_INTEGER) && head.hash && hashPattern.test(head.hash));
    if (head.number < anchor.number) throw new SearchReorg();
    const headNumber = head.number, headHash = head.hash;
    async function stableBase() {
      const [tip, origin, chainId] = await Promise.all([
        read(() => reader.getBlock({ blockNumber: headNumber })), read(() => reader.getBlock({ blockNumber: anchor.number })), read(() => reader.getChainId()),
      ]);
      if (tip.number !== headNumber || tip.hash !== headHash || origin.number !== anchor.number || origin.hash !== anchor.hash || chainId !== intent.chainId) throw new SearchReorg();
    }
    const origin = await read(() => reader.getBlock({ blockNumber: anchor.number }));
    if (origin.number !== anchor.number || origin.hash !== anchor.hash) throw new SearchReorg();
    let cursorChanged = cursor.number > headNumber;
    if (!cursorChanged) {
      try {
        const checkpoint = await read(() => reader.getBlock({ blockNumber: cursor.number }));
        cursorChanged = checkpoint.number !== cursor.number || checkpoint.hash !== cursor.hash;
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "BlockNotFoundError") throw error;
        cursorChanged = true;
      }
    }
    const headData = { headBlock: headNumber, headBlockHash: headHash };
    if (cursorChanged) {
      await stableBase();
      requireValue(Date.now() >= startedAt && Date.now() - startedAt < deadlineMs);
      return { ...empty("REORG"), ...headData, resetToDispatchAnchor: true };
    }
    const fromBlock = cursor.number + 1n;
    let throughBlock = cursor.number, throughBlockHash = cursor.hash, scannedTransactions = 0, scannedBlocks = 0;
    let transactionHash: string | null = null, exact = false;
    for (let number = fromBlock; number <= headNumber && scannedBlocks < MINT_SEARCH_BLOCKS; number++) {
      const block = await read(() => reader.getBlock({ blockNumber: number, includeTransactions: true }));
      requireValue(block.number === number && block.hash && hashPattern.test(block.hash) && block.parentHash === throughBlockHash && Array.isArray(block.transactions));
      requireValue(block.transactions.length <= maxBlockTransactions && scannedTransactions + block.transactions.length <= maxPageTransactions);
      const seen = new Set<string>();
      let candidate: (typeof block.transactions)[number] | undefined;
      for (const [index, tx] of block.transactions.entries()) {
        requireValue(typeof tx !== "string" && hashPattern.test(tx.hash) && !seen.has(tx.hash) && /^0x[0-9a-fA-F]{40}$/.test(tx.from) &&
          Number.isSafeInteger(tx.nonce) && tx.nonce >= 0 && tx.blockHash === block.hash && tx.blockNumber === number && tx.transactionIndex === index);
        seen.add(tx.hash);
        if (tx.from.toLowerCase() === intent.publisherWallet && BigInt(tx.nonce) === nonce) {
          requireValue(!candidate); candidate = tx;
        }
      }
      scannedTransactions += block.transactions.length; scannedBlocks++;
      throughBlock = number; throughBlockHash = block.hash;
      if (candidate) {
        const found = await read(() => reader.getTransaction({ hash: candidate.hash }));
        requireValue(found.hash === candidate.hash && found.blockNumber === number && found.blockHash === block.hash && found.transactionIndex === candidate.transactionIndex &&
          found.from.toLowerCase() === candidate.from.toLowerCase() && found.nonce === candidate.nonce && found.to?.toLowerCase() === candidate.to?.toLowerCase() &&
          found.input === candidate.input && found.value === candidate.value && found.chainId === candidate.chainId);
        transactionHash = found.hash;
        try { requireExactMintTransaction(intent, found.hash, found, nonce); exact = true; } catch { /* A cancellation/different call consumes the same nonce. */ }
        break;
      }
    }
    await stableBase();
    const [checkpoint, last] = await Promise.all([
      read(() => reader.getBlock({ blockNumber: cursor.number })), read(() => reader.getBlock({ blockNumber: throughBlock })),
    ]);
    if (checkpoint.hash !== cursor.hash || last.hash !== throughBlockHash) throw new SearchReorg();
    requireValue(Date.now() >= startedAt && Date.now() - startedAt < deadlineMs);
    return { status: transactionHash ? exact ? "FOUND" : "CONFLICT" : throughBlock === headNumber ? "CAUGHT_UP" : "SCANNED",
      fromBlock: scannedBlocks ? fromBlock : null, throughBlock: scannedBlocks ? throughBlock : null,
      throughBlockHash: scannedBlocks ? throughBlockHash : null, ...headData, scannedBlocks, scannedTransactions, transactionHash, resetToDispatchAnchor: false };
  } catch (error) { return empty(error instanceof SearchReorg ? "REORG" : "UNAVAILABLE"); }
}
