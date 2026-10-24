import "server-only";

import { z } from "zod";
import { canonicalize } from "@/lib/hash";
import { publicSnapshotSchema } from "@/lib/public-snapshot/schema";
import { MAX_PUBLIC_BLOCK_BYTES, verifyPublicRawBlock } from "./raw-cid";
import { readBoundedIpfsBody, IpfsReadError, type PinReader } from "./ipfs-reader";
import type { PublicationTarget } from "./target";
import type { PinUploadCommand } from "./upload";

/** Kubo RPC raw-block protocol for a server-owned `kubo-raw-v1` target. The
 * optional bearer credential goes only to the RPC origin, never to the gateway.
 */
function rpc(target: PublicationTarget, path: string, query: Record<string, string>) {
  const url = new URL(`/api/v0/${path}`, target.apiUrl);
  url.search = new URLSearchParams(query).toString();
  return url;
}
const auth = (token?: string): Record<string, string> => token ? { authorization: `Bearer ${token}` } : {};
const json = async (response: Response) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedIpfsBody(response, 16 * 1024)));

export function kuboRawUpload(target: PublicationTarget, request: typeof fetch, token?: string) {
  return async (command: PinUploadCommand) => {
    try {
      const bytes = new TextEncoder().encode(command.canonicalJson);
      if (canonicalize(publicSnapshotSchema.parse(JSON.parse(command.canonicalJson))) !== command.canonicalJson) throw new Error();
      await verifyPublicRawBlock(command.canonicalJson, command.payloadHash, command.expectedCid, bytes);
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "application/octet-stream" }), "public-snapshot.json");
      const response = await request(rpc(target, "block/put", { "cid-codec": "raw", mhtype: "sha2-256", mhlen: "32", pin: "true" }), {
        method: "POST", body: form, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000), headers: auth(token),
      });
      const receipt = z.object({ Key: z.string(), Size: z.number().int().nonnegative() }).parse(await json(response));
      if (receipt.Key !== command.expectedCid || receipt.Size !== bytes.length) throw new Error();
    } catch { throw new Error("Raw-block upload was not confirmed"); }
  };
}

export function kuboRawRead(target: PublicationTarget, request: typeof fetch, token?: string): PinReader {
  return async (cid) => {
    try {
      if (!/^bafkrei[a-z2-7]{52}$/.test(cid)) throw new Error();
      const response = await request(rpc(target, "pin/ls", { arg: cid, type: "recursive" }), {
        method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000), headers: auth(token),
      });
      const pins = z.object({ Keys: z.record(z.string(), z.object({ Type: z.string() })) }).parse(await json(response));
      if (pins.Keys[cid]?.Type !== "recursive") return { kind: "not-confirmed" };
      const block = await request(new URL(`/ipfs/${cid}?format=raw`, target.gatewayUrl), {
        method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { accept: "application/vnd.ipld.raw" },
      });
      if (block.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/vnd.ipld.raw") {
        await block.body?.cancel().catch(() => {}); throw new Error();
      }
      return { kind: "pinned", cid, pinId: `kubo:${cid}`, bytes: await readBoundedIpfsBody(block, MAX_PUBLIC_BLOCK_BYTES) };
    } catch { throw new IpfsReadError(); }
  };
}
