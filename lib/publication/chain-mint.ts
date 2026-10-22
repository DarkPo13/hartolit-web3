import "server-only";

import { z } from "zod";
import { encodeFunctionData, keccak256, parseEventLogs, type PublicClient, type Hash } from "viem";
import { HARTOLIT_PASSPORT_ABI as abi } from "@/lib/contract";
import { canonicalize, sha256Hex } from "@/lib/hash";
import { publicSnapshotSchema } from "@/lib/public-snapshot/schema";
import { publisherWalletSchema } from "./schema";
import { MAX_PUBLIC_BLOCK_BYTES, rawCidFromSha256, verifyPublicRawBlock } from "./raw-cid";

const hexHash = z.string().regex(/^0x[0-9a-f]{64}$/);
const targetSchema = z.strictObject({
  chainId: z.literal(97), contractAddress: publisherWalletSchema, contractCodeHash: hexHash,
  publisherWallet: publisherWalletSchema, recipientWallet: publisherWalletSchema,
  requiredConfirmations: z.number().int().min(2).max(256),
});
const intentSchema = targetSchema.extend({
  version: z.literal(1), certificateId: z.uuid(), payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  ipfsCid: z.string().max(255), data: z.string().regex(/^0x[0-9a-f]+$/), sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type MintIntent = Readonly<z.infer<typeof intentSchema>>;
export type MintReader = Pick<PublicClient, "getChainId" | "getBlock" | "getCode" | "getTransaction" | "getTransactionReceipt" | "readContract">;
export class ChainVerificationError extends Error {
  constructor() { super("Chain data is unavailable or does not match the mint commitment"); }
}
const requireMatch = (condition: unknown) => { if (!condition) throw new ChainVerificationError(); };
const lower = (value: string | null | undefined) => value?.toLowerCase();
const missing = (error: unknown) => error instanceof Error && ["TransactionNotFoundError", "TransactionReceiptNotFoundError", "BlockNotFoundError"].includes(error.name);
const unknown = (status: "UNKNOWN" | "PENDING" | "REORG") => ({ status, issued: false as const, canResend: false as const });

function dataFor(value: Pick<MintIntent, "recipientWallet" | "payloadHash" | "ipfsCid">) {
  return encodeFunctionData({ abi, functionName: "mintPassport", args: [value.recipientWallet as Hash, `0x${value.payloadHash}`, `ipfs://${value.ipfsCid}`] });
}

/** Data coherence only: the future caller must separately authorize current DB
 * approval/consent/proof and verified storage. Creating this intent grants no send.
 * Target/recipient/code hash/depth are trusted server choices, never browser URLs.
 */
export async function createMintIntent(targetInput: unknown, input: { canonicalJson: string; payloadHash: string; ipfsCid: string }): Promise<MintIntent> {
  try {
    const target = targetSchema.parse(targetInput);
    requireMatch(input.canonicalJson.length <= MAX_PUBLIC_BLOCK_BYTES);
    const snapshot = publicSnapshotSchema.parse(JSON.parse(input.canonicalJson));
    requireMatch(canonicalize(snapshot) === input.canonicalJson);
    await verifyPublicRawBlock(input.canonicalJson, input.payloadHash, input.ipfsCid, new TextEncoder().encode(input.canonicalJson));
    const body = { ...target, version: 1 as const, certificateId: snapshot.certificateId, payloadHash: input.payloadHash, ipfsCid: input.ipfsCid,
      data: dataFor({ recipientWallet: target.recipientWallet, payloadHash: input.payloadHash, ipfsCid: input.ipfsCid }) };
    return Object.freeze({ ...body, sha256: await sha256Hex(canonicalize(body)) });
  } catch { throw new ChainVerificationError(); }
}

async function intent(input: unknown) {
  const value = intentSchema.parse(input);
  const { sha256, ...body } = value;
  requireMatch(await sha256Hex(canonicalize(body)) === sha256 && value.data === dataFor(value) && value.ipfsCid === rawCidFromSha256(value.payloadHash));
  return Object.freeze(value);
}

/** Serializable wallet-call description, not a send command or authorization. */
export async function mintTransactionRequest(input: unknown) {
  try {
    const value = await intent(input);
    return Object.freeze({ chainId: value.chainId, from: value.publisherWallet, to: value.contractAddress,
      data: value.data as Hash, value: "0" as const });
  } catch { throw new ChainVerificationError(); }
}

async function codeAt(reader: MintReader, value: MintIntent, blockNumber: bigint) {
  const code = await reader.getCode({ address: value.contractAddress as Hash, blockNumber });
  requireMatch(code && code !== "0x" && keccak256(code) === value.contractCodeHash);
}

/** Read-only preflight. READY is advisory, not permission, simulation or a signed
 * transaction. The wallet still needs a separate current authorized send action.
 */
export async function inspectMintReadiness(input: unknown, reader: MintReader) {
  try {
    const value = await intent(input);
    requireMatch(await reader.getChainId() === value.chainId);
    const head = await reader.getBlock(); requireMatch(head.number !== null && head.hash);
    await codeAt(reader, value, head.number!);
    const common = { abi, address: value.contractAddress as Hash, blockNumber: head.number! };
    const role = await reader.readContract({ ...common, functionName: "MINTER_ROLE" });
    const [paused, authorized, existing] = await Promise.all([
      reader.readContract({ ...common, functionName: "paused" }),
      reader.readContract({ ...common, functionName: "hasRole", args: [role, value.publisherWallet as Hash] }),
      reader.readContract({ ...common, functionName: "hashToTokenId", args: [`0x${value.payloadHash}`] }),
    ]);
    requireMatch((await reader.getBlock({ blockNumber: head.number! })).hash === head.hash && await reader.getChainId() === value.chainId);
    return { status: existing !== 0n ? "ALREADY_MINTED" as const : paused ? "PAUSED" as const : !authorized ? "UNAUTHORIZED" as const : "READY" as const,
      issued: false as const, canResend: false as const };
  } catch { throw new ChainVerificationError(); }
}

/** Verifies an observed receipt; never writes a DB state, sends, grants a retry or
 * issues a certificate. Confirmation depth is a policy input, not absolute finality.
 * The caller owns RPC credentials/limits; this module accepts a read-only dependency.
 */
export async function inspectMintTransaction(input: unknown, transactionHash: string, reader: MintReader) {
  try {
    const value = await intent(input), hash = hexHash.parse(transactionHash) as Hash;
    requireMatch(await reader.getChainId() === value.chainId);
    let tx;
    try { tx = await reader.getTransaction({ hash }); }
    catch (error) { if (missing(error)) return unknown("UNKNOWN"); throw error; }
    requireMatch(tx.hash === hash && tx.chainId === value.chainId && lower(tx.from) === value.publisherWallet &&
      lower(tx.to) === value.contractAddress && tx.value === 0n && lower(tx.input) === value.data);
    if (tx.blockNumber === null || tx.blockHash === null) return unknown("PENDING");
    let receipt;
    try { receipt = await reader.getTransactionReceipt({ hash }); }
    catch (error) { if (missing(error)) return unknown("UNKNOWN"); throw error; }
    requireMatch(receipt.transactionHash === hash && receipt.blockNumber === tx.blockNumber && receipt.blockHash === tx.blockHash &&
      receipt.transactionIndex === tx.transactionIndex && lower(receipt.from) === value.publisherWallet && lower(receipt.to) === value.contractAddress);
    let included, head;
    try { included = await reader.getBlock({ blockNumber: receipt.blockNumber }); head = await reader.getBlock(); }
    catch (error) { if (missing(error)) return unknown("REORG"); throw error; }
    if (included.hash !== receipt.blockHash || head.number === null || head.number < receipt.blockNumber) return unknown("REORG");
    const confirmations = head.number - receipt.blockNumber + 1n;
    await codeAt(reader, value, receipt.blockNumber); await codeAt(reader, value, head.number);
    let tokenId: bigint | undefined;
    if (receipt.status === "success") {
      const logs = parseEventLogs({ abi, eventName: "PassportMinted", strict: true,
        logs: receipt.logs.filter(log => lower(log.address) === value.contractAddress) });
      requireMatch(logs.length === 1);
      const log = logs[0]!;
      requireMatch(!log.removed && log.blockNumber === receipt.blockNumber && log.blockHash === receipt.blockHash && log.transactionHash === hash &&
        log.args.tokenId > 0n && lower(log.args.mintedBy) === value.publisherWallet && lower(log.args.to) === value.recipientWallet &&
        log.args.payloadHash === `0x${value.payloadHash}` && log.args.ipfsUri === `ipfs://${value.ipfsCid}`);
      tokenId = log.args.tokenId;
      const common = { abi, address: value.contractAddress as Hash, blockNumber: receipt.blockNumber };
      const [owner, uri, payloadHash, indexedId] = await Promise.all([
        reader.readContract({ ...common, functionName: "ownerOf", args: [tokenId] }),
        reader.readContract({ ...common, functionName: "tokenURI", args: [tokenId] }),
        reader.readContract({ ...common, functionName: "payloadHash", args: [tokenId] }),
        reader.readContract({ ...common, functionName: "hashToTokenId", args: [`0x${value.payloadHash}`] }),
      ]);
      requireMatch(lower(owner) === value.recipientWallet && uri === `ipfs://${value.ipfsCid}` && payloadHash === `0x${value.payloadHash}` && indexedId === tokenId);
    } else requireMatch(receipt.status === "reverted");
    // Reject a branch change during receipt/state reads, including stale RPC receipts.
    try {
      const [again, tip, confirmed, chainId] = await Promise.all([
        reader.getBlock({ blockNumber: receipt.blockNumber }), reader.getBlock({ blockNumber: head.number }),
        reader.getTransactionReceipt({ hash }), reader.getChainId(),
      ]);
      if (again.hash !== receipt.blockHash || tip.hash !== head.hash || chainId !== value.chainId ||
        confirmed.blockHash !== receipt.blockHash || confirmed.status !== receipt.status) return unknown("REORG");
    } catch (error) { if (missing(error)) return unknown("REORG"); throw error; }
    const evidence = { issued: false as const, canResend: false as const, confirmations: confirmations.toString() };
    if (confirmations < BigInt(value.requiredConfirmations)) return { ...evidence, status: "CONFIRMING" as const };
    if (receipt.status === "reverted") return { ...evidence, status: "REVERTED" as const };
    return { ...evidence, status: "VERIFIED" as const, tokenId: tokenId!.toString(), transactionHash: hash,
      blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, contractAddress: value.contractAddress, intentSha256: value.sha256 };
  } catch { throw new ChainVerificationError(); }
}
