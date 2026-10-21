import { sha256Hex } from "../hash";

export const MAX_PUBLIC_BLOCK_BYTES = 64 * 1024;

/** Narrow V1 storage profile: CIDv1, raw codec, sha2-256, lowercase base32.
 * https://specs.ipfs.tech/cid/ gives the independent binary "hello" vector.
 * UnixFS DAG-PB/JSON/CAR layouts are deliberately unsupported, not guessed.
 */
export function rawCidFromSha256(hash: string) {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("Invalid SHA-256 digest");
  const bytes = [1, 0x55, 0x12, 0x20, ...hash.match(/../g)!.map((pair) => parseInt(pair, 16))];
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0, value = 0, encoded = "b";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += alphabet[(value >>> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  if (bits) encoded += alphabet[(value << (5 - bits)) & 31];
  return encoded;
}

export async function verifyPublicRawBlock(canonicalJson: string, payloadHash: string, cid: string, bytes: Uint8Array) {
  const expected = new TextEncoder().encode(canonicalJson);
  if (!expected.length || expected.length > MAX_PUBLIC_BLOCK_BYTES || bytes.length !== expected.length ||
    !expected.every((byte, index) => byte === bytes[index]) || await sha256Hex(bytes) !== payloadHash ||
    cid !== rawCidFromSha256(payloadHash)) {
    throw new Error("Public IPFS block does not match the confirmed bytes and CID");
  }
}
