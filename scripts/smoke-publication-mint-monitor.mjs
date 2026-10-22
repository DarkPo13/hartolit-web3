import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
import pg from "pg";
import { mintSearchFrame } from "./fixtures/mint-search.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { monitorMintAttempt, runMintMonitorBatch } = await jiti.import("../lib/publication/mint-monitor.ts");
const { observeMintAttempt } = await jiti.import("../lib/publication/mint-observation.ts");
const due = new Date("2000-01-01T00:00:00Z");
export async function dueMintMonitor(db, attemptId) {
  await db.publicationMintAttempt.update({ where: { id: attemptId }, data: { monitorNextAt: due } });
}
export async function tickMintMonitor(db, passportId, attemptId, reader) {
  await dueMintMonitor(db, attemptId);
  return monitorMintAttempt(passportId, attemptId, () => reader);
}

export async function smokeMintMonitor({ db, dispatched }) {
  const { winner, loser, command } = dispatched, attemptId = command.attemptId, passportId = winner.passportId;
  const saved = () => db.publicationMintAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  const initial = await saved(), anchor = { number: initial.dispatchBlockNumber, hash: initial.dispatchBlockHash };
  const frame = mintSearchFrame(winner.intent, initial.nonce, { anchor, head: anchor.number + 1n });
  const count = () => db.publicationMintDiscovery.count({ where: { attemptId } });
  let calls = 0;
  const offline = { ...frame.reader, getChainId: async () => { calls++; throw new Error("fictional-private-monitor-detail"); } };
  for (const input of [{ limit: 0 }, { limit: 6 }, { limit: 1, rpcUrl: "https://untrusted.example.invalid" }, {}]) {
    await assert.rejects(runMintMonitorBatch(input, () => { calls++; return offline; }), error => error.status === 422);
  }
  assert.equal((await monitorMintAttempt(loser.passportId, attemptId, () => offline)).status, "SKIPPED");
  assert.equal(calls, 0);
  await dueMintMonitor(db, attemptId);
  const batch = await runMintMonitorBatch({ limit: 1 }, intent => {
    assert.equal(intent.sha256, winner.intent.sha256, "only the oldest due fictional attempt is selected");
    return frame.reader;
  });
  assert.equal(batch.checked, 1); assert.equal(batch.results[0].status, "CAUGHT_UP");
  assert.equal(batch.issued, false); assert.equal(batch.canResend, false);
  assert.equal((await saved()).monitorToken, null); assert.equal((await saved()).monitorUntil, null);
  assert.ok((await saved()).monitorNextAt > new Date());
  assert.equal((await monitorMintAttempt(passportId, attemptId, () => offline)).status, "SKIPPED");
  assert.equal(calls, 0, "cooldown does not contact a provider");

  const startSlow = async () => {
    await dueMintMonitor(db, attemptId);
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const work = monitorMintAttempt(passportId, attemptId, () => ({ ...frame.reader, getChainId: async () => { enter(); await gate; return 97; } }));
    await entered;
    return { work, release };
  };
  const single = await startSlow();
  try { assert.equal((await monitorMintAttempt(passportId, attemptId, () => offline)).status, "SKIPPED"); }
  finally { single.release(); }
  assert.equal((await single.work).status, "CAUGHT_UP"); assert.equal(calls, 0);

  // Expiry without a peer still fences a late read; revision equality alone is insufficient.
  const expired = await startSlow(), beforeExpired = await count();
  await db.publicationMintAttempt.update({ where: { id: attemptId }, data: { monitorUntil: due } });
  expired.release(); assert.equal((await expired.work).status, "BLOCKED");
  assert.equal(await count(), beforeExpired, "an expired worker cannot persist even without a replacement");

  // Reclaim an abandoned/expired lease. Old completion cannot clear the new token or due time.
  const old = await startSlow();
  await db.publicationMintAttempt.update({ where: { id: attemptId }, data: { monitorUntil: due } });
  const replacement = await startSlow(), replacementToken = (await saved()).monitorToken, beforeReclaim = await count();
  try {
    old.release(); assert.equal((await old.work).status, "BLOCKED");
    assert.equal((await saved()).monitorToken, replacementToken); assert.equal(await count(), beforeReclaim);
  } finally { replacement.release(); }
  assert.equal((await replacement.work).status, "CAUGHT_UP"); assert.equal((await saved()).monitorToken, null);

  // Claiming fences earlier unleased reads too, before any new journal has committed.
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const oldRead = observeMintAttempt(passportId, attemptId, { transactionHash: `0x${"a".repeat(64)}` }, {
    ...frame.reader, getChainId: async () => { enter(); await gate; throw new Error(); },
  });
  await entered;
  const active = await startSlow();
  try { release(); assert.equal((await oldRead).status, "SUPERSEDED"); }
  finally { active.release(); }
  assert.equal((await active.work).status, "CAUGHT_UP");

  assert.equal((await tickMintMonitor(db, passportId, attemptId, offline)).status, "UNAVAILABLE");
  const failure = await db.publicationMintDiscovery.findFirstOrThrow({ where: { attemptId }, orderBy: { revision: "desc" } });
  assert.equal(failure.status, "UNAVAILABLE"); assert.equal((await saved()).monitorToken, null);
  assert.ok((await saved()).monitorNextAt.getTime() - Date.now() > 100_000, "failures back off");
  assert.ok(!JSON.stringify(failure).includes("fictional-private-monitor-detail"));
  await dueMintMonitor(db, attemptId);
  const beforeFactory = await count();
  assert.equal((await monitorMintAttempt(passportId, attemptId, () => { throw new Error("fictional-private-config-detail"); })).status, "UNAVAILABLE");
  assert.equal((await saved()).monitorToken, null); assert.equal(await count(), beforeFactory, "factory failures clear only the lease and back off");
  const beforeLegacy = await count();
  await db.publicationMintAttempt.update({ where: { id: attemptId }, data: {
    dispatchBlockNumber: null, dispatchBlockHash: null, discoveryBlockNumber: null, discoveryBlockHash: null, discoveryVersion: 0,
  } });
  try { assert.equal((await tickMintMonitor(db, passportId, attemptId, offline)).status, "BLOCKED"); }
  finally { await db.publicationMintAttempt.update({ where: { id: attemptId }, data: {
    dispatchBlockNumber: anchor.number, dispatchBlockHash: anchor.hash, discoveryBlockNumber: null, discoveryBlockHash: null,
    discoveryVersion: failure.revision,
  } }); }
  assert.equal(await count(), beforeLegacy, "legacy anchors are not guessed");

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    for (const [query, values] of [
      ['UPDATE "PublicationMintAttempt" SET "monitorToken"=$2 WHERE "id"=$1', [attemptId, randomUUID()]],
      ['UPDATE "PublicationMintAttempt" SET "monitorUntil"=NOW() WHERE "id"=$1', [attemptId]],
      ['UPDATE "PublicationMintAttempt" SET "monitorNextAt"=\'infinity\' WHERE "id"=$1', [attemptId]],
    ]) {
      await client.query("BEGIN");
      try { await assert.rejects(client.query(query, values), error => error.code === "23514" && error.constraint === "PublicationMintAttempt_monitor_shape_check"); }
      finally { await client.query("ROLLBACK"); }
    }
  } finally { await client.end(); }
  assert.equal((await saved()).status, initial.status); assert.equal((await saved()).nonce, initial.nonce);
  assert.equal((await db.publication.findUniqueOrThrow({ where: { id: winner.publication.id } })).status, "CHAIN_PENDING");
  process.stdout.write("Mint monitor passed: due batching, cooldown, duplicate exclusion, expired/reclaimed worker fencing, stale diagnostic exclusion, private failure/backoff and SQL lease shape. No resend or scheduler activation.\n");
}
