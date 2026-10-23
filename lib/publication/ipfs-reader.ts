import "server-only";

import { z } from "zod";
import { MAX_PUBLIC_BLOCK_BYTES } from "./raw-cid";

export type PinReadResult = { kind: "not-confirmed" } | { kind: "pinned"; cid: string; pinId: string; bytes: Uint8Array };
export type PinReader = (expectedCid: string) => Promise<PinReadResult>;
export class IpfsReadError extends Error {
  constructor() { super("Public IPFS readback is unavailable or invalid"); }
}

const pinsSchema = z.object({
  count: z.number().int().nonnegative(),
  results: z.array(z.object({
    requestid: z.string().min(1).max(128), status: z.literal("pinned"), pin: z.object({ cid: z.string().max(255) }),
  })).max(2),
});

function endpoint(value: string | undefined) {
  const url = new URL(value ?? "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new IpfsReadError();
  return url;
}

export async function readBoundedIpfsBody(response: Response, maxBytes: number) {
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new IpfsReadError();
  }
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    await response.body.cancel().catch(() => {});
    throw new IpfsReadError();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new IpfsReadError();
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

/** Read-only standard Pinning Service API + trustless raw-block gateway.
 * URLs and credential come only from server configuration, never browser input.
 * Dependency injection is for trusted callers/tests; no mock or HTTP write mode exists.
 */
export function createPinReader(config: { apiUrl?: string; token?: string; gatewayUrl?: string }, request: typeof fetch = fetch): PinReader {
  try {
    const api = endpoint(config.apiUrl), gateway = endpoint(config.gatewayUrl);
    if (!config.token?.trim() || /[\r\n]/.test(config.token) || gateway.pathname !== "/") throw new IpfsReadError();
    const token = config.token;
    return async (expectedCid) => {
      try {
        if (!/^bafkrei[a-z2-7]{52}$/.test(expectedCid)) throw new IpfsReadError();
        const pinsUrl = new URL(`${api.toString().replace(/\/$/, "")}/pins`);
        pinsUrl.search = new URLSearchParams({ cid: expectedCid, status: "pinned", limit: "2" }).toString();
        const pinsResponse = await request(pinsUrl, { method: "GET", cache: "no-store", redirect: "error",
          signal: AbortSignal.timeout(10_000), headers: { accept: "application/json", authorization: `Bearer ${token}` } });
        const pins = pinsSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedIpfsBody(pinsResponse, 32 * 1024))));
        if (pins.count < pins.results.length || pins.results.some((row) => row.pin.cid !== expectedCid)) throw new IpfsReadError();
        const pin = pins.results[0];
        if (!pin) return { kind: "not-confirmed" };
        const blockUrl = new URL(`/ipfs/${expectedCid}?format=raw`, gateway);
        const blockResponse = await request(blockUrl, { method: "GET", cache: "no-store", redirect: "error",
          signal: AbortSignal.timeout(10_000), headers: { accept: "application/vnd.ipld.raw" } });
        if (blockResponse.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/vnd.ipld.raw") {
          await blockResponse.body?.cancel().catch(() => {});
          throw new IpfsReadError();
        }
        return { kind: "pinned", cid: expectedCid, pinId: pin.requestid, bytes: await readBoundedIpfsBody(blockResponse, MAX_PUBLIC_BLOCK_BYTES) };
      } catch { throw new IpfsReadError(); }
    };
  } catch { throw new IpfsReadError(); }
}

export type RawBlockReader = (cid: string) => Promise<Uint8Array>;

/** Trustless raw-block gateway read for public verification: no credential is
 * sent and the caller must hash the bytes itself. Same HTTPS/redirect/size rules.
 */
export function createRawGatewayReader(gatewayUrl: string | undefined, request: typeof fetch = fetch): RawBlockReader {
  const gateway = endpoint(gatewayUrl);
  if (gateway.pathname !== "/") throw new IpfsReadError();
  return async (cid) => {
    try {
      if (!/^bafkrei[a-z2-7]{52}$/.test(cid)) throw new IpfsReadError();
      const response = await request(new URL(`/ipfs/${cid}?format=raw`, gateway), { method: "GET", cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(10_000), headers: { accept: "application/vnd.ipld.raw" } });
      if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/vnd.ipld.raw") {
        await response.body?.cancel().catch(() => {});
        throw new IpfsReadError();
      }
      return await readBoundedIpfsBody(response, MAX_PUBLIC_BLOCK_BYTES);
    } catch { throw new IpfsReadError(); }
  };
}

export const readPinnedRawBlock: PinReader = async (cid) => createPinReader({
  apiUrl: process.env.HARTOLIT_IPFS_PINNING_API_URL,
  token: process.env.HARTOLIT_IPFS_PINNING_TOKEN,
  gatewayUrl: process.env.HARTOLIT_IPFS_GATEWAY_URL,
})(cid);
