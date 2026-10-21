import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: {
  "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/"),
} });
const { rawCidFromSha256, verifyPublicRawBlock, MAX_PUBLIC_BLOCK_BYTES } = await jiti.import("../lib/publication/raw-cid.ts");
const { createPinReader } = await jiti.import("../lib/publication/ipfs-reader.ts");
const hash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
// Binary vector from https://specs.ipfs.tech/cid/, independently base32-encoded with Python.
const cid = "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq";
const bytes = new TextEncoder().encode("hello");
const config = { apiUrl: "https://pin.example.invalid/api/v1/", token: "fictional-test-only", gatewayUrl: "https://gateway.example.invalid" };
const pins = (patch = {}) => Response.json({ count: 1, results: [{ requestid: "fictional-pin", status: "pinned", pin: { cid }, ...patch }] });
const block = (body = bytes, headers = {}) => new Response(body, { headers: { "content-type": "application/vnd.ipld.raw", ...headers } });
const invalid = (promise) => assert.rejects(promise, (error) => error.message === "Public IPFS readback is unavailable or invalid");

test("raw CID matches the independent IPFS vector and binds exact bytes", async () => {
  assert.equal(rawCidFromSha256(hash), cid);
  await verifyPublicRawBlock("hello", hash, cid, bytes);
  for (const [value, digest, address, body] of [
    ["hello", hash, cid, new TextEncoder().encode("Hello")],
    ["hello", "0".repeat(64), cid, bytes], ["hello", hash, `${cid}/path`, bytes],
    ["hello", hash, cid.toUpperCase(), bytes], ["hello ", hash, cid, bytes],
    ["x".repeat(MAX_PUBLIC_BLOCK_BYTES + 1), hash, cid, new Uint8Array(MAX_PUBLIC_BLOCK_BYTES + 1)],
  ]) await assert.rejects(verifyPublicRawBlock(value, digest, address, body));
});

test("readback uses only bounded GETs, exact CID filtering and separate credentials", async () => {
  const calls = [];
  const reader = createPinReader(config, async (url, options) => {
    calls.push({ url: new URL(url), options });
    return calls.length === 1 ? pins() : block();
  });
  const receipt = await reader(cid);
  assert.equal(receipt.kind, "pinned"); assert.equal(receipt.cid, cid); assert.equal(receipt.pinId, "fictional-pin");
  assert.deepEqual(receipt.bytes, bytes);
  assert.equal(calls[0].url.pathname, "/api/v1/pins");
  assert.equal(calls[0].url.searchParams.get("cid"), cid);
  assert.equal(calls[0].url.searchParams.get("status"), "pinned");
  assert.equal(calls[0].options.headers.authorization, "Bearer fictional-test-only");
  assert.equal(calls[1].url.pathname, `/ipfs/${cid}`); assert.equal(calls[1].url.search, "?format=raw");
  assert.equal(calls[1].options.headers.authorization, undefined, "gateway never receives provider credential");
  for (const call of calls) {
    assert.equal(call.options.method, "GET"); assert.equal(call.options.redirect, "error");
    assert.equal(call.options.cache, "no-store"); assert.ok(call.options.signal instanceof AbortSignal);
    assert.equal(call.options.body, undefined);
  }
  let callsWithoutPin = 0;
  assert.deepEqual(await createPinReader(config, async () => {
    callsWithoutPin++; return Response.json({ count: 0, results: [] });
  })(cid), { kind: "not-confirmed" });
  assert.equal(callsWithoutPin, 1, "a missing pin cannot be replaced by gateway availability alone");
});

test("malformed, partial, redirected, oversized and unavailable reads fail closed", async () => {
  for (const first of [
    () => pins({ status: "failed" }), () => pins({ pin: { cid: cid.replace(/.$/, "a") } }),
    () => new Response("private provider error", { status: 401 }),
    () => new Response(null, { status: 302, headers: { location: "https://other.invalid" } }),
    () => new Response("not json"), () => new Response("x".repeat(32 * 1024 + 1)),
    () => Response.json({ count: 0, results: [{ requestid: "pin", status: "pinned", pin: { cid } }] }),
  ]) await invalid(createPinReader(config, async () => first())(cid));
  for (const second of [
    () => block(bytes, { "content-length": String(MAX_PUBLIC_BLOCK_BYTES + 1) }),
    () => block(new Uint8Array(MAX_PUBLIC_BLOCK_BYTES + 1)),
    () => block(bytes, { "content-type": "application/json" }),
    () => new Response(bytes, { status: 206, headers: { "content-type": "application/vnd.ipld.raw" } }),
    () => new Response(null, { status: 302, headers: { location: "https://other.invalid" } }),
  ]) {
    let count = 0;
    await invalid(createPinReader(config, async () => ++count === 1 ? pins() : second())(cid));
  }
  await invalid(createPinReader(config, async () => { throw new Error("secret fixture text"); })(cid));
  for (const patch of [{ apiUrl: "http://localhost" }, { apiUrl: "https://user:secret@host.invalid" },
    { gatewayUrl: "https://gateway.invalid/path" }, { gatewayUrl: "https://gateway.invalid?query=1" }, { token: "" }]) {
    assert.throws(() => createPinReader({ ...config, ...patch }));
  }
});
