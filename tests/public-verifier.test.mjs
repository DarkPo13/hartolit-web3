import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createJiti } from "jiti";
import { keccak256 } from "viem";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { verifyPublicPassport } = await jiti.import("../lib/public-verifier/verify.ts");
const { createRawGatewayReader } = await jiti.import("../lib/publication/ipfs-reader.ts");
const { canonicalize, sha256Hex } = await jiti.import("../lib/hash.ts");
const { rawCidFromSha256 } = await jiti.import("../lib/publication/raw-cid.ts");
const { publicPassportShare } = await jiti.import("../lib/public-verifier/share.ts");
const { default: QRCode } = await import("qrcode");

const fictional = {
  schemaName: "hartolit.field-passport.public", schemaVersion: "2.0.0",
  certificateId: "f837b2a1-9401-4fd8-860c-aa02d7d3fe49", snapshotAt: "2026-10-02T12:31:40.000Z", issuer: "Hartolit",
  farm: { label: "Fictional Farm X" },
  field: { reference: "e84b1ab9-daf4-49c8-bb08-9952451a6763", areaHectares: 12.5, crop: "sunflower" },
  treatment: { category: "herbicide", date: "2026-09-01", localTime: "09:30", timeZone: "Europe/Kyiv", treatedAreaHectares: 10.25, droneModel: "Fictional Drone X" },
  weather: { temperatureCelsius: 22.5, humidityPercent: 61, windSpeedMps: 2.75, rainfallMm: 0.125, measuredAt: "2026-09-01T08:20:00.000Z" },
  chemical: { product: "Fictional Product X", activeSubstance: "Fictional Active X", dosePerHa: 1.25, doseUnit: "L_PER_HA", workingVolumeLitersPerHa: 25,
    manufacturer: "Fictional Maker X", registrationNumber: "FICTIONAL-REG-X" },
  evidence: { weatherSha256: "a".repeat(64), chemicalSha256: "b".repeat(64) },
};
const code = "0x60006000", owner = `0x${"2".repeat(40)}`;
const target = { chainId: 97, contractAddress: `0x${"1".repeat(40)}`, contractCodeHash: keccak256(code), requiredConfirmations: 3 };
const blockHash = number => `0x${number.toString(16).padStart(64, "0")}`;

/** Fictional chain at head 10 (checked block 8) with token 1 deep and token 2 pending. */
async function world(document = canonicalize(fictional), patch = {}) {
  const bytes = typeof document === "string" ? new TextEncoder().encode(document) : document;
  const hash = await sha256Hex(bytes), cid = rawCidFromSha256(hash), head = patch.head ?? 10n;
  const state = { nextAtSafe: 2n, nextAtHead: 3n, ownerOf: owner, tokenURI: `ipfs://${cid}`, payloadHash: `0x${hash}`, hashToTokenId: 1n, ...patch.state };
  const reader = { getChainId: async () => 97, getCode: async () => code,
    getBlock: async args => args?.blockNumber === undefined ? { number: head, hash: blockHash(head) } : { number: args.blockNumber, hash: blockHash(args.blockNumber) },
    readContract: async ({ functionName, blockNumber }) => functionName === "nextTokenId" ? (blockNumber === head ? state.nextAtHead : state.nextAtSafe) : state[functionName],
    ...patch.reader };
  return { reader, cid, hash, readBlock: patch.readBlock ?? (async requested => { assert.equal(requested, cid); return bytes; }) };
}
const verify = async (tokenId, w, t = target) => verifyPublicPassport(tokenId, t, w.reader, w.readBlock);

test("a deep raw-profile token whose bytes match the chain commitment is VALID with readable facts", async () => {
  const w = await world(), result = await verify("1", w);
  assert.equal(result.status, "VALID"); assert.equal(result.checkedBlockNumber, "8"); assert.equal(result.confirmations, "3");
  assert.equal(result.cid, w.cid); assert.equal(result.payloadHash, w.hash); assert.equal(result.owner, owner);
  assert.equal(result.canonicalJson, canonicalize(fictional)); assert.deepEqual(result.snapshot, fictional);
});

test("requests and configuration are strict before any RPC", async () => {
  let calls = 0;
  const w = await world(undefined, { reader: { getChainId: async () => { calls++; return 97; } } });
  for (const tokenId of ["0", "01", "-1", "1.0", "1e3", " 1", 1, null, "9".repeat(79)]) assert.deepEqual(await verify(tokenId, w), { status: "INVALID_REQUEST" });
  for (const t of [null, {}, { ...target, requiredConfirmations: 1 }, { ...target, chainId: 56 }, { ...target, rpcUrl: "https://untrusted.example.invalid" }]) {
    assert.deepEqual(await verify("1", w, t), { status: "UNAVAILABLE", reason: "NOT_CONFIGURED", tokenId: "1" });
  }
  assert.equal(calls, 0);
});

test("depth is read from head minus confirmations: shallow tokens are PENDING, absent ones NOT_FOUND", async () => {
  const w = await world();
  assert.equal((await verify("2", w)).status, "PENDING"); assert.equal((await verify("3", w)).status, "NOT_FOUND");
  const young = await world(undefined, { head: 1n, state: { nextAtHead: 2n } });
  assert.equal((await verify("1", young)).status, "PENDING", "no block is deep enough yet");
  const deployedLater = await world(undefined, { reader: { getCode: async ({ blockNumber }) => blockNumber === 10n ? code : "0x" } });
  assert.equal((await verify("1", deployedLater)).status, "PENDING", "a contract younger than the checked block cannot hold a deep token");
  const replaced = await world(undefined, { reader: { getCode: async ({ blockNumber }) => blockNumber === 10n ? "0x60016001" : "0x" } });
  assert.equal((await verify("1", replaced)).reason, "CONTRACT");
});

test("chain, contract and branch problems are UNAVAILABLE without leaking provider detail", async () => {
  const cases = [
    { getChainId: async () => 56 },
    { getCode: async () => "0x60016001" },
    { getBlock: async () => { throw new Error("fictional-private-provider-detail"); } },
    { readContract: async () => { throw new Error("fictional-private-provider-detail"); } },
  ];
  for (const reader of cases) {
    const result = await verify("1", await world(undefined, { reader }));
    assert.equal(result.status, "UNAVAILABLE"); assert.ok(!JSON.stringify(result).includes("fictional-private"));
  }
  // The head changes while state is read: a branch switch is not a verdict.
  let reads = 0;
  const moving = await world(undefined, { reader: { getBlock: async args => {
    if (args?.blockNumber === 10n && ++reads) return { number: 10n, hash: blockHash(99n) };
    return args?.blockNumber === undefined ? { number: 10n, hash: blockHash(10n) } : { number: args.blockNumber, hash: blockHash(args.blockNumber) };
  } } });
  assert.deepEqual(await verify("1", moving), { status: "UNAVAILABLE", reason: "CHAIN", tokenId: "1" });
});

test("on-chain inconsistency, a different raw CID or the wrong bytes are MISMATCH", async () => {
  for (const state of [{ hashToTokenId: 2n }, { ownerOf: `0x${"0".repeat(40)}` }]) {
    assert.deepEqual(await verify("1", await world(undefined, { state })), { status: "MISMATCH", reason: "CHAIN_STATE", tokenId: "1" });
  }
  const other = rawCidFromSha256("d".repeat(64));
  assert.equal((await verify("1", await world(undefined, { state: { tokenURI: `ipfs://${other}` } }))).reason, "URI");
  const wrongBytes = await world(undefined, { readBlock: async () => new TextEncoder().encode(canonicalize({ ...fictional, issuer: "Other" })) });
  assert.deepEqual(await verify("1", wrongBytes), { status: "MISMATCH", reason: "BYTES", tokenId: "1" });
  assert.equal((await verify("1", await world(undefined, { readBlock: async () => new Uint8Array(64 * 1024 + 1) }))).reason, "BYTES");
});

test("committed bytes this verifier cannot read are UNSUPPORTED, gateway failure UNAVAILABLE", async () => {
  for (const uri of ["ipfs://QmFictionalLegacyCid", "https://gateway.example.invalid/ipfs/x", "ipfs://bafybeigdyrztfictionaldagpb"]) {
    assert.deepEqual(await verify("1", await world(undefined, { state: { tokenURI: uri } })), { status: "UNSUPPORTED", reason: "STORAGE_PROFILE", tokenId: "1" });
  }
  assert.equal((await verify("1", await world(JSON.stringify(fictional, null, 2)))).reason, "ENCODING");
  assert.equal((await verify("1", await world(canonicalize({ ...fictional, schemaVersion: "1.0.0" })))).reason, "SCHEMA");
  assert.equal((await verify("1", await world(canonicalize({ ...fictional, privateNote: "fictional" })))).reason, "SCHEMA");
  assert.equal((await verify("1", await world(new Uint8Array([0xff, 0xfe])))).status, "UNSUPPORTED");
  const offline = await world(undefined, { readBlock: async () => { throw new Error("fictional-private-gateway-detail"); } });
  assert.deepEqual(await verify("1", offline), { status: "UNAVAILABLE", reason: "IPFS", tokenId: "1" });
});

test("the trustless gateway reader is HTTPS-only, credential-free, bounded and raw-typed", async () => {
  const cid = rawCidFromSha256("e".repeat(64)), seen = [];
  const raw = (body, type = "application/vnd.ipld.raw", status = 200) => new Response(body, { status, headers: { "content-type": type } });
  const read = createRawGatewayReader("https://gateway.example.invalid/", async (url, options) => { seen.push({ url: String(url), options }); return raw("ok"); });
  assert.equal(new TextDecoder().decode(await read(cid)), "ok");
  assert.equal(seen[0].url, `https://gateway.example.invalid/ipfs/${cid}?format=raw`);
  assert.equal(seen[0].options.redirect, "error"); assert.equal(seen[0].options.headers.authorization, undefined);
  for (const url of [undefined, "http://gateway.example.invalid/", "https://user:secret@gateway.example.invalid/", "https://gateway.example.invalid/base/"]) {
    assert.throws(() => createRawGatewayReader(url));
  }
  await assert.rejects(read("not-a-raw-cid")); assert.equal(seen.length, 1, "malformed CID is refused before a request");
  for (const response of [raw("x", "text/html"), raw("x", "application/vnd.ipld.raw", 404), raw(new Uint8Array(64 * 1024 + 1))]) {
    await assert.rejects(createRawGatewayReader("https://gateway.example.invalid/", async () => response)(cid));
  }
});

test("the share link and QR use only the configured application origin", async () => {
  const share = await publicPassportShare("7", "https://dapp.example.invalid/ignored/path?x=1");
  assert.equal(share.url, "https://dapp.example.invalid/passports/7");
  assert.equal(share.qrDataUrl, await QRCode.toDataURL(share.url, { errorCorrectionLevel: "M", margin: 2, width: 240 }), "QR encodes exactly the share URL");
  for (const [tokenId, origin] of [["0", "https://dapp.example.invalid"], ["7/../x", "https://dapp.example.invalid"], ["7", undefined], ["7", "not a url"],
    ["7", "javascript:alert(1)"], ["7", "https://user:secret@dapp.example.invalid"]]) assert.equal(await publicPassportShare(tokenId, origin), null);
});
