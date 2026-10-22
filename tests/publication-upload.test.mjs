import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createHash } from "node:crypto";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { createLocalKuboProvider } = await jiti.import("../lib/publication/local-kubo.ts");
const { createPublicationTarget, validatePublicationTarget, RAW_PIN_PROFILE } = await jiti.import("../lib/publication/target.ts");
const { rawCidFromSha256 } = await jiti.import("../lib/publication/raw-cid.ts");
const { canonicalize } = await jiti.import("../lib/hash.ts");
const config = { key: "fictional-unit", apiUrl: "http://127.0.0.1:15001", gatewayUrl: "http://127.0.0.1:18080" };
const description = { ...config, kind: "kubo-raw-v1", accountScope: "fixture", storageProfile: RAW_PIN_PROFILE };
const snapshot = {
  schemaName: "hartolit.field-passport.public", schemaVersion: "2.0.0", issuer: "Hartolit",
  certificateId: "f837b2a1-9401-4fd8-860c-aa02d7d3fe49", snapshotAt: "2026-10-02T12:31:40.000Z",
  farm: { label: "Fictional \u0424\u0435\u0440\u043c\u0430" },
  field: { reference: "e84b1ab9-daf4-49c8-bb08-9952451a6763", areaHectares: 12.5, crop: "sunflower" },
  treatment: { category: "herbicide", date: "2026-09-01", localTime: "09:30", timeZone: "Europe/Kyiv", treatedAreaHectares: 10.25, droneModel: "Fictional Drone" },
  weather: { temperatureCelsius: 22.5, humidityPercent: 61, windSpeedMps: 2.75, rainfallMm: 0, measuredAt: "2026-09-01T08:20:00.000Z" },
  chemical: { product: "Fictional Product", activeSubstance: null, dosePerHa: 1.25, doseUnit: "L_PER_HA", workingVolumeLitersPerHa: 25, manufacturer: null, registrationNumber: null },
  evidence: { weatherSha256: "a".repeat(64), chemicalSha256: "b".repeat(64) },
};
function command(value = snapshot) {
  const canonicalJson = canonicalize(value);
  const payloadHash = createHash("sha256").update(canonicalJson).digest("hex");
  return { attemptId: "fictional", publicationId: "fictional", idempotencyKey: "fictional", canonicalJson, payloadHash, expectedCid: rawCidFromSha256(payloadHash) };
}

test("server-owned target fingerprint binds endpoints, account and profile", async () => {
  const target = await createPublicationTarget(description);
  assert.ok(Object.isFrozen(target));
  assert.deepEqual(await validatePublicationTarget(target), target);
  assert.equal((await createPublicationTarget({ ...description, apiUrl: `${config.apiUrl}/` })).configurationSha256, target.configurationSha256);
  const changed = await createPublicationTarget({ ...description, accountScope: "another-account" });
  assert.notEqual(changed.configurationSha256, target.configurationSha256);
  await assert.rejects(validatePublicationTarget({ ...target, gatewayUrl: "https://changed.invalid" }));
  for (const patch of [{ apiUrl: "https://user:password@host.invalid" }, { storageProfile: "another-profile" }, { gatewayUrl: "https://gateway.invalid/path" }]) {
    await assert.rejects(createPublicationTarget({ ...description, ...patch }));
  }
});

test("local Kubo upload preserves exact UTF-8 and rejects private or altered payload before I/O", async () => {
  let sends = 0;
  const data = command();
  const provider = await createLocalKuboProvider(config, async (address, options) => {
    sends++;
    const url = new URL(address);
    assert.equal(url.pathname, "/api/v0/block/put"); assert.equal(url.searchParams.get("cid-codec"), "raw");
    assert.equal(url.searchParams.get("pin"), "true"); assert.equal(options.method, "POST"); assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    const file = options.body.get("file");
    assert.equal(file.name, "public-snapshot.json"); assert.equal(await file.text(), data.canonicalJson);
    assert.equal(file.size, Buffer.byteLength(data.canonicalJson));
    return Response.json({ Key: data.expectedCid, Size: file.size });
  });
  await provider.upload(data); assert.equal(sends, 1);
  for (const invalid of [{ ...data, expectedCid: rawCidFromSha256("0".repeat(64)) }, command({ ...snapshot, privateFarmerId: "fictional-private" }),
    { ...data, canonicalJson: `${data.canonicalJson}\n` }]) await assert.rejects(provider.upload(invalid));
  assert.equal(sends, 1, "invalid payloads never reach an uploader");
});

test("local upload cannot be enabled in production or aimed at external hosts; bad acknowledgements fail", async () => {
  await assert.rejects(createLocalKuboProvider({ ...config, apiUrl: "https://external.invalid" }));
  const before = process.env.NODE_ENV;
  try { process.env.NODE_ENV = "production"; await assert.rejects(createLocalKuboProvider(config)); }
  finally { if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before; }
  const data = command();
  for (const response of [
    () => Response.json({ Key: rawCidFromSha256("0".repeat(64)), Size: Buffer.byteLength(data.canonicalJson) }),
    () => Response.json({ Key: data.expectedCid, Size: 1 }), () => new Response("broken"),
    () => new Response("upstream error", { status: 500 }),
    () => new Response(null, { status: 302, headers: { location: "https://other.invalid" } }),
  ]) {
    const provider = await createLocalKuboProvider(config, async () => response());
    await assert.rejects(provider.upload(data), /not confirmed/);
  }
});
