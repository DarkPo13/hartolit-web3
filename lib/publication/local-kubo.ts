import "server-only";

import { z } from "zod";
import { canonicalize } from "@/lib/hash";
import { publicSnapshotSchema } from "@/lib/public-snapshot/schema";
import { createPublicationTarget, RAW_PIN_PROFILE } from "./target";
import { MAX_PUBLIC_BLOCK_BYTES, verifyPublicRawBlock } from "./raw-cid";
import { readBoundedIpfsBody, IpfsReadError } from "./ipfs-reader";
import type { PublicationPinProvider } from "./upload";

/** Local protocol fixture, not the selected hosted provider. Use an isolated OFFLINE node.
 * No environment config or production route enables this factory. Non-loopback hosts
 * and production execution are rejected, even if supplied with an injected transport.
 */
export async function createLocalKuboProvider(config: { key: string; apiUrl: string; gatewayUrl: string }, request: typeof fetch = fetch): Promise<PublicationPinProvider> {
  if (process.env.NODE_ENV === "production") throw new Error("Local Kubo is unavailable in production");
  for (const value of [config.apiUrl, config.gatewayUrl]) {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname)) throw new Error("Local Kubo requires loopback endpoints");
  }
  const target = await createPublicationTarget({ ...config, kind: "kubo-raw-v1", accountScope: "isolated-offline-fixture", storageProfile: RAW_PIN_PROFILE });
  function rpc(path: string, query: Record<string, string>) {
    const url = new URL(`/api/v0/${path}`, target.apiUrl);
    url.search = new URLSearchParams(query).toString();
    return url;
  }
  const json = async (response: Response) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedIpfsBody(response, 16 * 1024)));
  return Object.freeze<PublicationPinProvider>({
    target,
    upload: async (command) => {
      try {
        const bytes = new TextEncoder().encode(command.canonicalJson);
        if (canonicalize(publicSnapshotSchema.parse(JSON.parse(command.canonicalJson))) !== command.canonicalJson) throw new Error();
        await verifyPublicRawBlock(command.canonicalJson, command.payloadHash, command.expectedCid, bytes);
        const form = new FormData();
        form.append("file", new Blob([bytes], { type: "application/octet-stream" }), "public-snapshot.json");
        const response = await request(rpc("block/put", { "cid-codec": "raw", mhtype: "sha2-256", mhlen: "32", pin: "true" }), {
          method: "POST", body: form, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
        });
        const receipt = z.object({ Key: z.string(), Size: z.number().int().nonnegative() }).parse(await json(response));
        if (receipt.Key !== command.expectedCid || receipt.Size !== bytes.length) throw new Error();
      } catch { throw new Error("Local raw-block upload was not confirmed"); }
    },
    read: async (cid) => {
      try {
        if (!/^bafkrei[a-z2-7]{52}$/.test(cid)) throw new Error();
        const response = await request(rpc("pin/ls", { arg: cid, type: "recursive" }), {
          method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
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
    },
  });
}
