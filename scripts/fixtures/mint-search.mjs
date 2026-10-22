import { createHash, randomBytes } from "node:crypto";

export function mintSearchFrame(intent, nonce, { anchor, head = anchor.number + 40n, candidate = null, cancel = false,
  transactionHash = `0x${randomBytes(32).toString("hex")}` }) {
  const blockHash = number => number === anchor.number ? anchor.hash : `0x${createHash("sha256")
    .update(`fictional-mint-search-${number}-${candidate !== null && number >= candidate ? `${transactionHash}-${cancel}` : "empty"}`).digest("hex")}`;
  const tx = candidate === null ? null : { hash: transactionHash, chainId: 97, from: intent.publisherWallet, to: cancel ? intent.publisherWallet : intent.contractAddress,
    input: cancel ? "0x" : intent.data, value: 0n, nonce: Number(nonce), blockNumber: candidate, blockHash: blockHash(candidate), transactionIndex: 0 };
  return { tx, blockHash, reader: {
    getChainId: async () => 97,
    getBlock: async (args = {}) => {
      const number = args.blockNumber ?? head;
      return { number, hash: blockHash(number), parentHash: blockHash(number - 1n), transactions: tx?.blockNumber === number ? [tx] : [] };
    },
    getTransaction: async ({ hash }) => {
      if (tx?.hash === hash) return tx;
      throw Object.assign(new Error(), { name: "TransactionNotFoundError" });
    },
  } };
}
