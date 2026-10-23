import "server-only";

import { keccak256, type Hash } from "viem";
import { z } from "zod";
import { HARTOLIT_PASSPORT_ABI as abi } from "@/lib/contract";
import { canonicalize, sha256Hex } from "@/lib/hash";
import { PUBLIC_SNAPSHOT_NAME, PUBLIC_SNAPSHOT_VERSION, publicSnapshotSchema, type PublicSnapshot } from "@/lib/public-snapshot/schema";
import type { MintReader } from "@/lib/publication/chain-mint";
import type { RawBlockReader } from "@/lib/publication/ipfs-reader";
import { MAX_PUBLIC_BLOCK_BYTES, rawCidFromSha256 } from "@/lib/publication/raw-cid";
import { publisherWalletSchema } from "@/lib/publication/schema";

export type PublicVerifierReader = Pick<MintReader, "getChainId" | "getBlock" | "getCode" | "readContract">;
const hexHash = z.string().regex(/^0x[0-9a-f]{64}$/);
const targetSchema = z.strictObject({ chainId: z.literal(97), contractAddress: publisherWalletSchema, contractCodeHash: hexHash,
  requiredConfirmations: z.number().int().min(2).max(256) });
const tokenIdSchema = z.string().regex(/^[1-9][0-9]{0,77}$/);

export type PublicVerificationFailure = "NOT_FOUND" | "PENDING" | "UNAVAILABLE" | "MISMATCH" | "UNSUPPORTED";
export type PublicVerification =
  | { status: "INVALID_REQUEST" }
  | { [S in PublicVerificationFailure]: { status: S; reason: string; tokenId: string } }[PublicVerificationFailure]
  | { status: "VALID"; tokenId: string; chainId: 97; contractAddress: string; owner: string; payloadHash: string; cid: string;
      checkedBlockNumber: string; checkedBlockHash: string; confirmations: string; snapshot: PublicSnapshot; canonicalJson: string };

/** Independent public verification from chain state and IPFS bytes alone. The
 * database is never consulted: a matching record can only enrich the display.
 * State is read at head - (confirmations - 1), so VALID implies that depth.
 * Provider errors never leave this function; only a coarse reason does.
 */
export async function verifyPublicPassport(tokenIdInput: unknown, targetInput: unknown, reader: PublicVerifierReader,
  readBlock: RawBlockReader): Promise<PublicVerification> {
  const token = tokenIdSchema.safeParse(tokenIdInput);
  if (!token.success) return { status: "INVALID_REQUEST" };
  const tokenId = token.data, id = BigInt(tokenId);
  const fail = <S extends PublicVerificationFailure>(status: S, reason: string) => ({ status, reason, tokenId });
  const target = targetSchema.safeParse(targetInput);
  if (!target.success) return fail("UNAVAILABLE", "NOT_CONFIGURED");
  const { contractAddress, contractCodeHash, requiredConfirmations } = target.data;
  const address = contractAddress as Hash;
  let state;
  try {
    if (await reader.getChainId() !== 97) return fail("UNAVAILABLE", "CHAIN");
    const head = await reader.getBlock();
    if (head.number === null || !head.hash) throw new Error();
    const safeNumber = head.number - BigInt(requiredConfirmations - 1);
    const runtime = async (blockNumber: bigint) => {
      const code = await reader.getCode({ address, blockNumber });
      return !code || code === "0x" ? "EMPTY" : keccak256(code) === contractCodeHash ? "MATCH" : "OTHER";
    };
    const stable = async (safe?: { number: bigint; hash: string }) =>
      (await reader.getBlock({ blockNumber: head.number! })).hash === head.hash && await reader.getChainId() === 97 &&
      (!safe || (await reader.getBlock({ blockNumber: safe.number })).hash === safe.hash);
    const shallow = async () => {
      if (await runtime(head.number) !== "MATCH") return fail("UNAVAILABLE", "CONTRACT");
      const next = await reader.readContract({ abi, address, functionName: "nextTokenId", blockNumber: head.number });
      if (!await stable()) throw new Error();
      return id < next ? fail("PENDING", "CONFIRMING") : fail("NOT_FOUND", "TOKEN");
    };
    // Nothing is deep enough yet (young chain or a contract deployed after the
    // checked block): the token can at most be pending.
    if (safeNumber < 0n) return await shallow();
    const safe = await reader.getBlock({ blockNumber: safeNumber });
    if (safe.number !== safeNumber || !safe.hash) throw new Error();
    const deployed = await runtime(safeNumber);
    if (deployed === "EMPTY") return await shallow();
    if (deployed === "OTHER") return fail("UNAVAILABLE", "CONTRACT");
    const read = { abi, address, blockNumber: safeNumber } as const;
    // Tokens are minted sequentially and never burned (soulbound, no burn path).
    if (id >= await reader.readContract({ ...read, functionName: "nextTokenId" })) {
      if (await runtime(head.number) !== "MATCH") return fail("UNAVAILABLE", "CONTRACT");
      const next = await reader.readContract({ abi, address, functionName: "nextTokenId", blockNumber: head.number });
      if (!await stable({ number: safeNumber, hash: safe.hash })) throw new Error();
      return id < next ? fail("PENDING", "CONFIRMING") : fail("NOT_FOUND", "TOKEN");
    }
    const [owner, uri, payloadHash] = await Promise.all([
      reader.readContract({ ...read, functionName: "ownerOf", args: [id] }),
      reader.readContract({ ...read, functionName: "tokenURI", args: [id] }),
      reader.readContract({ ...read, functionName: "payloadHash", args: [id] }),
    ]);
    const indexed = await reader.readContract({ ...read, functionName: "hashToTokenId", args: [payloadHash] });
    if (!await stable({ number: safeNumber, hash: safe.hash })) throw new Error();
    state = { owner: owner.toLowerCase(), uri, payloadHash: payloadHash.toLowerCase(), indexed, safe: { number: safeNumber, hash: safe.hash },
      confirmations: head.number - safeNumber + 1n };
  } catch { return fail("UNAVAILABLE", "CHAIN"); }
  if (!/^0x[0-9a-f]{40}$/.test(state.owner) || /^0x0{40}$/.test(state.owner) || !/^0x[0-9a-f]{64}$/.test(state.payloadHash) ||
    state.indexed !== id) return fail("MISMATCH", "CHAIN_STATE");
  const hash = state.payloadHash.slice(2), cid = rawCidFromSha256(hash);
  // Only the V1 raw-block profile is verifiable; other URIs are not guessed at.
  if (state.uri !== `ipfs://${cid}`) return /^ipfs:\/\/bafkrei[a-z2-7]{52}$/.test(state.uri) ? fail("MISMATCH", "URI") : fail("UNSUPPORTED", "STORAGE_PROFILE");
  let bytes;
  try { bytes = await readBlock(cid); } catch { return fail("UNAVAILABLE", "IPFS"); }
  if (!bytes.length || bytes.length > MAX_PUBLIC_BLOCK_BYTES || await sha256Hex(bytes) !== hash) return fail("MISMATCH", "BYTES");
  // From here the bytes are exactly the on-chain commitment; failure means this
  // verifier cannot read that document, not that the record was altered.
  let canonicalJson, snapshot;
  try {
    canonicalJson = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(canonicalJson);
    if (canonicalize(parsed) !== canonicalJson) return fail("UNSUPPORTED", "ENCODING");
    const header = parsed as { schemaName?: unknown; schemaVersion?: unknown };
    if (header.schemaName !== PUBLIC_SNAPSHOT_NAME || header.schemaVersion !== PUBLIC_SNAPSHOT_VERSION) return fail("UNSUPPORTED", "SCHEMA");
    snapshot = publicSnapshotSchema.parse(parsed);
  } catch { return fail("UNSUPPORTED", "SCHEMA"); }
  return { status: "VALID", tokenId, chainId: 97, contractAddress, owner: state.owner, payloadHash: hash, cid,
    checkedBlockNumber: state.safe.number.toString(), checkedBlockHash: state.safe.hash, confirmations: state.confirmations.toString(),
    snapshot, canonicalJson };
}
