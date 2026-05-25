/**
 * SHA-256 helpers that work in both the browser (Web Crypto) and Node (server routes).
 */

const isBrowser = typeof window !== "undefined";

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(input: ArrayBuffer | Uint8Array | string): Promise<string> {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }

  if (isBrowser || (typeof crypto !== "undefined" && "subtle" in crypto)) {
    // Copy into a fresh ArrayBuffer-backed Uint8Array to satisfy BufferSource typing
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = await crypto.subtle.digest("SHA-256", copy);
    return toHex(digest);
  }

  // Node fallback (server route)
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

export async function sha256File(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return sha256Hex(buf);
}

export async function sha256Json(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value));
}

/** Deterministic JSON serialization for stable hashes across clients. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

export function hexToBytes32(hex: string): `0x${string}` {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length !== 64) {
    throw new Error(`Expected 32-byte hex (64 chars), got ${clean.length} chars`);
  }
  if (!/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error("Hex contains non-hex characters");
  }
  return `0x${clean.toLowerCase()}` as `0x${string}`;
}
