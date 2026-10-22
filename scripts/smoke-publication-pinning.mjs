// Tests the internal durable boundary with real PostgreSQL and real wallet proofs.
// No publishing endpoint, live provider, RPC or network write is enabled.
// The read-only IPFS adapter uses an injected fictional HTTP transport.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createJiti } from "jiti";
import pg from "pg";

const jiti = createJiti(import.meta.url, { alias: {
  "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/"),
} });
const lifecycle = await jiti.import("../lib/publication/pinning.ts");
const { reconcilePinAttempt } = await jiti.import("../lib/publication/reconciliation.ts");
const { createPinReader } = await jiti.import("../lib/publication/ipfs-reader.ts");
const { rawCidFromSha256 } = await jiti.import("../lib/publication/raw-cid.ts");
const { createPublicationTarget, RAW_PIN_PROFILE } = await jiti.import("../lib/publication/target.ts");
const target = await createPublicationTarget({ key: "fictional-readback", kind: "kubo-raw-v1", accountScope: "fictional-smoke",
  apiUrl: "https://pin.example.invalid", gatewayUrl: "https://gateway.example.invalid", storageProfile: RAW_PIN_PROFILE });
const rejects = (promise, status = 409) => assert.rejects(promise, (error) => error.status === status);

function input(publicationId, confirmation, version) {
  return { publicationId, requestId: randomUUID(), confirmationId: confirmation.id,
    passportVersion: version, expectedSha256: confirmation.preview.sha256, expectedTargetSha256: target.configurationSha256,
    acknowledgement: "PUBLISH_CONFIRMED_SNAPSHOT" };
}

async function constraints(db, publicationId, attemptId, challengeId) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    for (const [query, values, code, constraint] of [
      ['UPDATE "PublicationPinAttempt" SET "status" = \'DISPATCHING\' WHERE "id" = $1', [attemptId], "23514", "PublicationPinAttempt_timestamps_check"],
      ['UPDATE "PublicationPinAttempt" SET "providerKey" = NULL WHERE "id" = $1', [attemptId], "23514", "PublicationPinAttempt_target_check"],
      ['UPDATE "PublicationPinAttempt" SET "providerConfigHash" = \'invalid\' WHERE "id" = $1', [attemptId], "23514", "PublicationPinAttempt_target_check"],
      ['UPDATE "PublicationPinAttempt" SET "storageProfile" = \'unixfs\' WHERE "id" = $1', [attemptId], "23514", "PublicationPinAttempt_target_check"],
      ['INSERT INTO "PublicationPinAttempt" ("id", "publicationId", "walletChallengeId", "requestId") VALUES ($1,$2,$3,$4)',
        [randomUUID(), publicationId, challengeId, randomUUID()], "23505", "PublicationPinAttempt_one_active_per_publication"],
    ]) {
      await client.query("BEGIN");
      try { await assert.rejects(client.query(query, values), (error) => error.code === code && error.constraint === constraint); }
      finally { await client.query("ROLLBACK"); }
    }
    assert.equal((await db.publicationPinAttempt.findUniqueOrThrow({ where: { id: attemptId } })).status, "PREPARED");
  } finally { await client.end(); }
}

export async function smokePinPreparation({ db, publisherId, passportId, publicationId, confirmation, proof, weatherFileId }) {
  const data = input(publicationId, confirmation, 4);
  const prepare = (patch = {}, actor = publisherId) => lifecycle.preparePinAttempt(actor, passportId, { ...data, ...patch }, target);
  await rejects(prepare({ acknowledgement: undefined }), 422);
  await rejects(prepare({ privateField: "not permitted" }), 422);
  await rejects(prepare({}, "not-the-publisher"), 403);
  await rejects(prepare({ expectedSha256: "0".repeat(64) }));
  const savedProof = await db.publicationWalletChallenge.findUniqueOrThrow({ where: { id: proof.challengeId } });
  await db.publication.update({ where: { id: publicationId }, data: { walletVerifiedAt: null } });
  await rejects(prepare());
  await db.publication.update({ where: { id: publicationId }, data: { walletVerifiedAt: savedProof.consumedAt } });
  for (const patch of [{ invalidatedAt: new Date() }, { signature: `0x${"00".repeat(65)}` }, { origin: "https://changed.invalid" }]) {
    await db.publicationWalletChallenge.update({ where: { id: savedProof.id }, data: patch });
    await rejects(prepare());
    await db.publicationWalletChallenge.update({ where: { id: savedProof.id }, data: {
      invalidatedAt: savedProof.invalidatedAt, signature: savedProof.signature, origin: savedProof.origin,
    } });
  }
  await db.user.update({ where: { id: publisherId }, data: { twoFactorEnabled: false } });
  await rejects(prepare(), 403);
  await db.user.update({ where: { id: publisherId }, data: { twoFactorEnabled: true } });
  assert.equal(await db.publicationPinAttempt.count({ where: { publicationId } }), 0);
  const prepared = await Promise.all([prepare(), prepare(), prepare()]);
  assert.equal(prepared.filter((result) => result.created).length, 1);
  const attemptId = prepared[0].attempt.id;
  assert.ok(prepared.every((result) => result.attempt.id === attemptId));
  assert.equal((await db.publication.findUniqueOrThrow({ where: { id: publicationId } })).status, "RESERVED");
  assert.equal(await db.auditLog.count({ where: { publicationId, action: "PUBLICATION_PIN_PREPARED" } }), 1);
  await rejects(prepare({ requestId: randomUUID() }));
  await constraints(db, publicationId, attemptId, savedProof.id);
  const begin = () => lifecycle.beginPinDispatch(publisherId, passportId, publicationId, attemptId, target);
  await db.evidenceFile.update({ where: { id: weatherFileId }, data: { objectPurgedAt: new Date() } });
  await rejects(begin(), 422);
  await db.evidenceFile.update({ where: { id: weatherFileId }, data: { objectPurgedAt: null } });
  await db.publicationWalletChallenge.update({ where: { id: savedProof.id }, data: { invalidatedAt: new Date() } });
  await rejects(begin());
  await db.publicationWalletChallenge.update({ where: { id: savedProof.id }, data: { invalidatedAt: null } });
  assert.equal((await db.publicationPinAttempt.findUniqueOrThrow({ where: { id: attemptId } })).status, "PREPARED");
  await lifecycle.cancelPreparedPinAttempt(publisherId, passportId, publicationId, attemptId);
  await lifecycle.cancelPreparedPinAttempt(publisherId, passportId, publicationId, attemptId);
  await rejects(begin()); await rejects(prepare());
  assert.equal(await db.auditLog.count({ where: { publicationId, action: "PUBLICATION_PIN_CANCELLED" } }), 1);
  const retry = await prepare({ requestId: randomUUID() });
  assert.notEqual(retry.attempt.id, attemptId, "safe retry creates a new durable attempt, retaining cancelled history");
  return retry.attempt.id;
}

async function prove(api, user, route, publicationId, signingAccount) {
  const challengeResponse = await api(`${route}/wallet-challenge`, { user, method: "POST", body: { publicationId } });
  assert.equal(challengeResponse.status, 201);
  const challenge = (await challengeResponse.json()).challenge;
  const proofResponse = await api(`${route}/wallet-proof`, { user, method: "POST", body: {
    publicationId, challengeId: challenge.id, signature: await signingAccount.signMessage({ message: challenge.message }),
  } });
  assert.equal(proofResponse.status, 200);
}

export async function smokePinDispatch({ api, db, publisherId, publisher, passportId, publicationId, confirmation, signingAccount }) {
  const route = `/api/admin/passports/${passportId}/publication`;
  await prove(api, publisher, route, publicationId, signingAccount);
  const { attempt } = await lifecycle.preparePinAttempt(publisherId, passportId, input(publicationId, confirmation, 8), target);
  const begin = () => lifecycle.beginPinDispatch(publisherId, passportId, publicationId, attempt.id, target);
  const replies = await Promise.allSettled([begin(), begin(), begin()]);
  assert.equal(replies.filter((result) => result.status === "fulfilled").length, 1, "only one caller receives dispatch permission");
  assert.ok(replies.filter((result) => result.status === "rejected").every((result) => result.reason.status === 409));
  const command = replies.find((result) => result.status === "fulfilled").value;
  assert.equal(command.canonicalJson, confirmation.preview.canonicalJson);
  assert.equal(command.payloadHash, confirmation.preview.sha256);
  const publication = await db.publication.findUniqueOrThrow({ where: { id: publicationId } });
  assert.equal(command.idempotencyKey, publication.idempotencyKey);
  assert.equal(publication.status, "PINNING");
  assert.equal(await db.auditLog.count({ where: { publicationId, action: "PUBLICATION_PIN_DISPATCH_STARTED" } }), 1);
  const recall = () => api(`/api/admin/passports/${passportId}/decision`, { user: publisher, method: "POST", body: {
    version: 8, decision: "CORRECTION_REQUIRED", note: "Fictional dispatch recovery" } });
  assert.equal((await recall()).status, 409);
  assert.equal((await db.passport.findUniqueOrThrow({ where: { id: passportId } })).version, 8);
  await rejects(lifecycle.cancelPreparedPinAttempt(publisherId, passportId, publicationId, attempt.id));
  await rejects(lifecycle.recoverExpiredPinAttempt(passportId, publicationId, attempt.id));
  // Model a crashed process whose persisted deadline has elapsed, not a provider failure.
  const dispatchedAt = new Date(Date.now() - 600_000);
  await db.publicationPinAttempt.update({ where: { id: attempt.id }, data: { dispatchedAt, deadlineAt: new Date(dispatchedAt.getTime() + 300_000) } });
  const recovered = await Promise.all([0, 1, 2].map(() => lifecycle.recoverExpiredPinAttempt(passportId, publicationId, attempt.id)));
  assert.ok(recovered.every((result) => result.status === "UNKNOWN"));
  assert.equal(await db.auditLog.count({ where: { publicationId, action: "PUBLICATION_PIN_OUTCOME_UNKNOWN" } }), 1);
  assert.equal((await lifecycle.recordUnknownPinOutcome(passportId, publicationId, attempt.id)).status, "UNKNOWN");
  await rejects(begin());
  await rejects(lifecycle.preparePinAttempt(publisherId, passportId, input(publicationId, confirmation, 8), target));
  assert.equal((await recall()).status, 409, "unknown is not a retryable no-effect failure");
  const final = await db.publication.findUniqueOrThrow({ where: { id: publicationId } });
  assert.equal(final.status, "PINNING"); assert.equal(final.ipfsCid, null); assert.equal(final.transactionHash, null); assert.equal(final.tokenId, null);
  await smokeReconciliation({ api, db, publisherId, publisher, passportId, publicationId, attemptId: attempt.id, confirmation, recall });
}

async function smokeReconciliation({ api, db, publisherId, publisher, passportId, publicationId, attemptId, confirmation, recall }) {
  const cid = rawCidFromSha256(confirmation.preview.sha256);
  const bytes = new TextEncoder().encode(confirmation.preview.canonicalJson);
  const pinId = `fictional-pin-${randomUUID()}`;
  let calls = 0;
  const reader = createPinReader({ apiUrl: "https://pin.example.invalid", token: "fictional-test-only", gatewayUrl: "https://gateway.example.invalid" },
    async (url, options) => {
      calls++;
      assert.equal(options.method, "GET"); assert.equal(options.body, undefined);
      if (new URL(url).pathname === "/pins") return Response.json({ count: 1, results: [{ requestid: pinId, status: "pinned", pin: { cid } }] });
      assert.equal(options.headers.authorization, undefined);
      return new Response(bytes, { headers: { "content-type": "application/vnd.ipld.raw" } });
    });
  const reconcile = (read = reader) => reconcilePinAttempt(passportId, publicationId, attemptId, target, read);
  assert.equal((await reconcile(async () => ({ kind: "not-confirmed" }))).status, "UNKNOWN");
  await rejects(reconcile(async () => { throw new Error("fictional timeout"); }), 503);
  for (const patch of [{ bytes: new TextEncoder().encode(`${confirmation.preview.canonicalJson}\n`) },
    { cid: rawCidFromSha256("0".repeat(64)) }, { pinId: "" }]) {
    await rejects(reconcile(async () => ({ kind: "pinned", cid, bytes, pinId, ...patch })), 503);
  }
  let persisted = await db.publication.findUniqueOrThrow({ where: { id: publicationId } });
  assert.equal(persisted.ipfsCid, null); assert.equal(persisted.status, "PINNING");
  assert.equal(await db.auditLog.count({ where: { publicationId, action: "PUBLICATION_PIN_VERIFIED" } }), 0);
  // Prove external I/O does not hold the passport lock, and the write rechecks its commitment.
  await rejects(reconcile(async () => {
    await db.publicSnapshotConfirmation.update({ where: { id: confirmation.id }, data: { invalidatedAt: new Date() } });
    return { kind: "pinned", cid, bytes, pinId };
  }));
  await db.publicSnapshotConfirmation.update({ where: { id: confirmation.id }, data: { invalidatedAt: null } });
  let touchedNetwork = false;
  await db.publicationPinAttempt.update({ where: { id: attemptId }, data: { expectedCid: null } });
  await rejects(reconcile(async () => { touchedNetwork = true; return { kind: "pinned", cid, bytes, pinId }; }));
  assert.equal(touchedNetwork, false, "legacy/unbound dispatch cannot be silently reinterpreted as raw-block publication");
  await db.publicationPinAttempt.update({ where: { id: attemptId }, data: { expectedCid: cid } });
  // External-result recording is not a new publishing authorization. A revoked user
  // must not make an already-public result disappear from the private audit trail.
  await db.user.update({ where: { id: publisherId }, data: { banned: true } });
  let releaseStale, readStarted;
  const released = new Promise((resolve) => { releaseStale = resolve; });
  const started = new Promise((resolve) => { readStarted = resolve; });
  const staleRead = reconcile(async () => { readStarted(); await released; return { kind: "not-confirmed" }; });
  await started;
  const replies = await Promise.all([reconcile(), reconcile(), reconcile()]);
  releaseStale();
  assert.equal((await staleRead).status, "PINNED", "a stale missing-pin reply cannot hide a concurrently verified receipt");
  assert.ok(replies.every((result) => result.status === "PINNED" && result.cid === cid && result.issued === false));
  assert.ok(calls >= 2);
  persisted = await db.publication.findUniqueOrThrow({ where: { id: publicationId } });
  const attempt = await db.publicationPinAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  assert.equal(persisted.status, "PINNED"); assert.equal(persisted.ipfsCid, cid);
  assert.equal(persisted.canonicalJson, confirmation.preview.canonicalJson);
  assert.equal(persisted.transactionHash, null); assert.equal(persisted.tokenId, null); assert.equal(persisted.contractAddress, null);
  assert.equal(attempt.status, "VERIFIED"); assert.equal(attempt.verifiedCid, cid); assert.equal(attempt.providerPinId, pinId);
  assert.equal(attempt.verifiedAt.toISOString(), replies[0].verifiedAt);
  assert.equal(await db.auditLog.count({ where: { publicationId, action: "PUBLICATION_PIN_VERIFIED", actorId: "system:publication-recovery" } }), 1);
  const before = calls;
  assert.equal((await reconcile()).cid, cid); assert.equal(calls, before, "completed verification is idempotent without more network reads");
  await db.user.update({ where: { id: publisherId }, data: { banned: false } });
  assert.equal((await recall()).status, 409);
  assert.equal((await api(`/admin/passports/${passportId}/certificate`, { user: publisher })).status, 200, "private view remains explicitly unissued");
  // The receipt's state/columns are independently enforced by PostgreSQL.
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    await client.query("BEGIN");
    try { await assert.rejects(client.query('UPDATE "PublicationPinAttempt" SET "verifiedCid" = NULL WHERE "id" = $1', [attemptId]),
      (error) => error.code === "23514" && error.constraint === "PublicationPinAttempt_receipt_check"); }
    finally { await client.query("ROLLBACK"); }
  } finally { await client.end(); }
}

export async function smokePinRecallRace({ api, db, publisherId, publisher, passportId, publicationId, confirmation, signingAccount }) {
  await prove(api, publisher, `/api/admin/passports/${passportId}/publication`, publicationId, signingAccount);
  const { attempt } = await lifecycle.preparePinAttempt(publisherId, passportId, input(publicationId, confirmation, 4), target);
  const [start, recall] = await Promise.allSettled([
    lifecycle.beginPinDispatch(publisherId, passportId, publicationId, attempt.id, target),
    api(`/api/admin/passports/${passportId}/decision`, { user: publisher, method: "POST", body: {
      version: 4, decision: "CORRECTION_REQUIRED", note: "Fictional dispatch/recall race" } }),
  ]);
  assert.equal(recall.status, "fulfilled");
  const stored = await db.publication.findUniqueOrThrow({ where: { id: publicationId } });
  const savedAttempt = await db.publicationPinAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  if (start.status === "fulfilled") {
    assert.equal(recall.value.status, 409); assert.equal(stored.status, "PINNING"); assert.equal(savedAttempt.status, "DISPATCHING");
    assert.equal((await db.publicSnapshotConfirmation.findUniqueOrThrow({ where: { id: confirmation.id } })).invalidatedAt, null);
    assert.equal((await lifecycle.recordUnknownPinOutcome(passportId, publicationId, attempt.id)).status, "UNKNOWN");
  } else {
    assert.equal(start.reason.status, 409); assert.equal(recall.value.status, 200);
    assert.equal(stored.status, "CANCELLED"); assert.equal(savedAttempt.status, "CANCELLED"); assert.equal(savedAttempt.dispatchedAt, null);
  }
}
