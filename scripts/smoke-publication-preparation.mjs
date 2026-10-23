import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { createJiti } from "jiti";
import { browserCheckpoint } from "./publication-browser-checkpoint.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { createPublicationTarget } = await jiti.import("../lib/publication/target.ts");
const { preparePinAttempt } = await jiti.import("../lib/publication/pinning.ts");

const configured = { key: "fictional-consent", scope: "offline-test-account", apiUrl: "https://rpc.example.invalid", gatewayUrl: "https://gateway.example.invalid" };
// Independent canonical encoding: this description is flat, with alphabetic keys.
const fingerprint = target => createHash("sha256").update(JSON.stringify({ accountScope: target.scope,
  apiUrl: target.apiUrl, gatewayUrl: target.gatewayUrl, key: target.key, kind: "kubo-raw-v1",
  storageProfile: "raw-cidv1-sha256-64k-v1" })).digest("hex");

export async function smokePublicationPreparation({ api, db, fixture, confirm, ownerId, publisherId, publisher, other, unverified, operator, signingAccount, restart, base }) {
  const row = await fixture(ownerId, publisherId), id = row.passport.id;
  const confirmation = await confirm(publisher, row);
  const root = `/api/admin/passports/${id}/publication`, path = `${root}/pin-attempts`;
  const reserved = await api(root, { user: publisher, method: "POST", body: {
    confirmationId: confirmation.id, passportVersion: 4, expectedSha256: confirmation.preview.sha256, walletAddress: signingAccount.address.toLowerCase(),
  } });
  assert.equal(reserved.status, 201);
  const publicationId = (await reserved.json()).reservation.id;
  let body = { publicationId, requestId: randomUUID(), confirmationId: confirmation.id, passportVersion: 4,
    expectedSha256: confirmation.preview.sha256, expectedTargetSha256: fingerprint(configured), acknowledgement: "PUBLISH_CONFIRMED_SNAPSHOT" };
  const post = (patch = {}, user = publisher, origin = base) => api(path, { user, method: "POST", origin, body: { ...body, ...patch } });
  const overview = async (user = publisher) => {
    const response = await api(root, { user }); assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/); return response.json();
  };
  assert.equal((await overview()).pinning.target, null);
  for (const [actor, status] of [[undefined, 401], [operator, 403], [unverified, 403], [other, 503]]) {
    assert.equal((await api(path, { user: actor, method: "POST", body })).status, status);
  }
  assert.equal((await post()).status, 503);
  assert.equal((await post({}, publisher, "https://evil.invalid")).status, 403);
  assert.equal((await post({}, publisher, null)).status, 403);
  for (const patch of [{ acknowledgement: undefined }, { expectedTargetSha256: undefined }, { apiUrl: "https://evil.invalid" }, { unexpected: true }]) {
    assert.equal((await post(patch)).status, 400);
  }
  assert.equal(await db.publicationPinAttempt.count({ where: { publicationId } }), 0);
  await restart(configured);
  assert.equal((await post({}, other)).status, 403);
  assert.equal((await post()).status, 409, "ownership signature is required separately");
  const challenge = (await (await api(`${root}/wallet-challenge`, { user: publisher, method: "POST", body: { publicationId } })).json()).challenge;
  assert.equal((await api(`${root}/wallet-proof`, { user: publisher, method: "POST", body: { publicationId, challengeId: challenge.id,
    signature: await signingAccount.signMessage({ message: challenge.message }) } })).status, 200);
  const before = await overview();
  assert.equal(before.pinning.target.configurationSha256, body.expectedTargetSha256);
  assert.equal(before.pinning.dispatchEnabled, false);
  const target = await createPublicationTarget({ key: configured.key, accountScope: configured.scope, apiUrl: configured.apiUrl,
    gatewayUrl: configured.gatewayUrl, kind: "kubo-raw-v1", storageProfile: "raw-cidv1-sha256-64k-v1" });
  await assert.rejects(preparePinAttempt(publisherId, id, { ...body, expectedTargetSha256: "0".repeat(64) }, target),
    error => error.status === 409, "the domain boundary must reject a changed reviewed target before creating intent");
  assert.equal((await post({ expectedTargetSha256: "0".repeat(64) })).status, 409);
  assert.equal((await post({ expectedSha256: "0".repeat(64) })).status, 409);
  await browserCheckpoint("1", { base, actors: { "/publisher": publisher, "/other": other }, label: id });
  // A browser run can prepare/cancel this fixture; reset only its own PREPARED
  // intent through the real API so the deterministic HTTP assertions start fresh.
  for (const attempt of (await overview()).pinning.attempts.filter(a => a.status === "PREPARED")) {
    assert.equal((await api(path, { user: publisher, method: "DELETE", body: { publicationId, attemptId: attempt.id } })).status, 200);
  }
  const priorPreparedAudit = await db.auditLog.count({ where: { publicationId, action: "PUBLICATION_PIN_PREPARED" } });
  const results = await Promise.all([post(), post(), post()]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 200, 201]);
  const attempts = await Promise.all(results.map(async r => (await r.json()).attempt));
  assert.ok(attempts.every(a => a.id === attempts[0].id));
  const attemptId = attempts[0].id;
  assert.equal(await db.auditLog.count({ where: { publicationId, action: "PUBLICATION_PIN_PREPARED" } }), priorPreparedAudit + 1);
  const saved = await db.publicationPinAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  assert.equal(saved.providerConfigHash, body.expectedTargetSha256); assert.equal(saved.status, "PREPARED");
  assert.equal(saved.providerKey, configured.key); assert.equal(saved.storageProfile, "raw-cidv1-sha256-64k-v1"); assert.equal(saved.dispatchedAt, null);
  const visible = await overview(other);
  assert.equal(visible.publisher.canProve, false); assert.equal(visible.pinning.attempts.find(a => a.id === attemptId).status, "PREPARED");
  assert.equal("canonicalJson" in visible.pinning.attempts[0], false);
  const cancellation = { publicationId, attemptId };
  for (const [actor, status] of [[undefined, 401], [operator, 403], [unverified, 403], [other, 403]]) {
    assert.equal((await api(path, { user: actor, method: "DELETE", body: cancellation })).status, status);
  }
  assert.equal((await api(path, { user: publisher, method: "DELETE", origin: "https://evil.invalid", body: cancellation })).status, 403);
  assert.equal((await api(path, { user: publisher, method: "DELETE", body: { ...cancellation, attemptId: randomUUID() } })).status, 404);
  const changed = { ...configured, scope: "changed-account" };
  await restart(changed);
  assert.equal((await post()).status, 409, "stale consent cannot bind a new server target");
  assert.equal((await post({ expectedTargetSha256: fingerprint(changed) })).status, 409, "existing attempt is never rebound");
  for (let i = 0; i < 2; i++) assert.equal((await api(path, { user: publisher, method: "DELETE", body: cancellation })).status, 200);
  assert.equal((await db.publicationPinAttempt.findUniqueOrThrow({ where: { id: attemptId } })).status, "CANCELLED");
  body = { ...body, requestId: randomUUID(), expectedTargetSha256: fingerprint(changed) };
  assert.equal((await post()).status, 201);
  const stored = await db.publication.findUniqueOrThrow({ where: { id: publicationId } });
  assert.equal(stored.status, "RESERVED"); assert.equal(stored.ipfsCid, null); assert.equal(stored.transactionHash, null); assert.equal(stored.tokenId, null);
  assert.equal(stored.canonicalJson, confirmation.preview.canonicalJson);
  assert.equal((await db.passport.findUniqueOrThrow({ where: { id } })).version, 4);
  assert.equal((await api(`/api/admin/passports/${id}/decision`, { user: publisher, method: "POST", body: { decision: "CORRECTION_REQUIRED", version: 4, note: "Fictional consent recall" } })).status, 200);
  assert.ok((await overview()).pinning.attempts.every(a => a.status === "CANCELLED"));
  assert.equal((await post()).status, 409);
  process.stdout.write("Preparation API passed: private exact-data/target consent, auth/origin, concurrency, cancel/history, stale config and recall; no external dispatch.\n");
}
