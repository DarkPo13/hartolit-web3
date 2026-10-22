import "server-only";

import { keccak256, type Hash } from "viem";
import { HARTOLIT_PASSPORT_ABI as abi } from "@/lib/contract";
import { ChainVerificationError, validateMintIntent, type MintReader } from "./chain-mint";
import { boundedMintMonitorReader } from "./mint-reader";

const hashPattern = /^0x[0-9a-f]{64}$/;
const requireMatch: (condition: unknown) => asserts condition = condition => { if (!condition) throw new ChainVerificationError(); };
const missing = (error: unknown) => error instanceof Error && ["TransactionNotFoundError", "TransactionReceiptNotFoundError", "BlockNotFoundError"].includes(error.name);
const unresolved = (status: "UNKNOWN" | "PENDING" | "REORG") => ({ status, issued: false as const, canResend: false as const });

/** Read-only evidence for a narrow same-nonce cancellation, never slot release or
 * resend permission. The caller supplies a saved intent/nonce and trusted reader;
 * there is no HTTP action, caller-selected RPC or transaction broadcaster.
 */
export async function inspectMintCancellation(input: unknown, transactionHash: string, expectedNonce: bigint, trustedReader: MintReader) {
  try {
    const intent = await validateMintIntent(input);
    requireMatch(typeof transactionHash === "string" && hashPattern.test(transactionHash) && typeof expectedNonce === "bigint" && expectedNonce >= 0n && expectedNonce <= BigInt(Number.MAX_SAFE_INTEGER));
    const hash = transactionHash as Hash, reader = boundedMintMonitorReader(trustedReader);
    requireMatch(await reader.getChainId() === intent.chainId);
    let tx;
    try { tx = await reader.getTransaction({ hash }); }
    catch (error) { if (missing(error)) return unresolved("UNKNOWN"); throw error; }
    requireMatch(tx.hash === hash && tx.chainId === intent.chainId && tx.from.toLowerCase() === intent.publisherWallet &&
      tx.to?.toLowerCase() === intent.publisherWallet && tx.value === 0n && tx.input === "0x" &&
      Number.isSafeInteger(tx.nonce) && BigInt(tx.nonce) === expectedNonce &&
      ["legacy", "eip2930", "eip1559"].includes(tx.type) &&
      (!("authorizationList" in tx) || tx.authorizationList === undefined || (Array.isArray(tx.authorizationList) && tx.authorizationList.length === 0)));
    if (tx.blockNumber === null || tx.blockHash === null) return unresolved("PENDING");
    let receipt;
    try { receipt = await reader.getTransactionReceipt({ hash }); }
    catch (error) { if (missing(error)) return unresolved("UNKNOWN"); throw error; }
    const exactReceipt = (value: typeof receipt) => value.transactionHash === hash && value.blockNumber === tx.blockNumber && value.blockHash === tx.blockHash &&
      value.transactionIndex === tx.transactionIndex && value.from.toLowerCase() === intent.publisherWallet && value.to?.toLowerCase() === intent.publisherWallet &&
      value.status === "success" && value.contractAddress === null && value.logs.length === 0;
    requireMatch(exactReceipt(receipt));
    requireMatch(typeof receipt.blockNumber === "bigint" && receipt.blockNumber > 0n && hashPattern.test(receipt.blockHash) &&
      Number.isSafeInteger(receipt.transactionIndex) && receipt.transactionIndex >= 0);
    let included, head;
    try {
      included = await reader.getBlock({ blockNumber: receipt.blockNumber }); head = await reader.getBlock();
    } catch (error) { if (missing(error)) return unresolved("REORG"); throw error; }
    requireMatch(head.number !== null && head.number >= 0n && head.number <= BigInt(Number.MAX_SAFE_INTEGER) && head.hash && hashPattern.test(head.hash));
    if (included.number !== receipt.blockNumber || included.hash !== receipt.blockHash || head.number < receipt.blockNumber) return unresolved("REORG");
    // Bound membership data before looking up the receipt's index. A receipt and
    // transaction supplied together are insufficient without their canonical block.
    requireMatch(Array.isArray(included.transactions) && included.transactions.length <= 2048 &&
      included.transactions[receipt.transactionIndex] === hash);
    for (const blockNumber of new Set([receipt.blockNumber - 1n, receipt.blockNumber, head.number])) {
      const publisherCode = await reader.getCode({ address: intent.publisherWallet as Hash, blockNumber });
      requireMatch(publisherCode === undefined || publisherCode === "0x");
    }
    for (const blockNumber of new Set([receipt.blockNumber, head.number])) {
      const code = await reader.getCode({ address: intent.contractAddress as Hash, blockNumber });
      requireMatch(code && code !== "0x" && keccak256(code) === intent.contractCodeHash);
      requireMatch(await reader.readContract({ abi, address: intent.contractAddress as Hash, blockNumber,
        functionName: "hashToTokenId", args: [`0x${intent.payloadHash}`] }) === 0n);
    }
    // Reread receipt identity, membership and captured head after code/state reads.
    try {
      const [again, tip, confirmed, chainId] = await Promise.all([
        reader.getBlock({ blockNumber: receipt.blockNumber }), reader.getBlock({ blockNumber: head.number }),
        reader.getTransactionReceipt({ hash }), reader.getChainId(),
      ]);
      if (again.number !== receipt.blockNumber || again.hash !== receipt.blockHash || tip.number !== head.number || tip.hash !== head.hash ||
        chainId !== intent.chainId || !exactReceipt(confirmed) || !Array.isArray(again.transactions) ||
        again.transactions.length > 2048 || again.transactions[receipt.transactionIndex] !== hash) return unresolved("REORG");
    } catch (error) { if (missing(error)) return unresolved("REORG"); throw error; }
    const confirmations = head.number - receipt.blockNumber + 1n;
    return { status: confirmations < BigInt(intent.requiredConfirmations) ? "CONFIRMING" as const : "CANCELLED" as const,
      transactionHash: hash, nonce: expectedNonce.toString(), blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
      confirmations: confirmations.toString(), headBlockNumber: head.number.toString(), headBlockHash: head.hash,
      publisherWallet: intent.publisherWallet, contractAddress: intent.contractAddress,
      intentSha256: intent.sha256, issued: false as const, canResend: false as const };
  } catch { throw new ChainVerificationError(); }
}
