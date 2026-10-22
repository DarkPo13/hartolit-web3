import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
import pg from "pg";
import { tickMintMonitor } from "./smoke-publication-mint-monitor.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { getMintFailureRecoveryReview, restoreFailedMint, getMintRecoveryReview, restoreOriginalMint } = await jiti.import("../lib/publication/mint-recovery.ts");
const { observeMintAttempt } = await jiti.import("../lib/publication/mint-observation.ts");
const rejects = (promise, status = 409) => assert.rejects(promise, error => error.status === status);
const body = review => ({ requestId: randomUUID(), expectedIntentSha256: review.intentSha256, expectedWalletStateSha256: review.walletStateSha256,
  expectedFailedObservationId: review.failedObservationId, expectedObservationVersion: review.observationVersion,
  expectedQuarantinedAt: review.quarantinedAt, acknowledgement: "RESTORE_FAILED_MINT" });

export async function smokeFailedRecovery({ db, publisherId, failure, active, successful, successReader, chain }) {
  const { passportId, attemptId, base } = failure;
  const attempt = () => db.publicationMintAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  const original = await attempt();
  const count = () => db.publicationMintRecovery.count({ where: { attemptId, kind: "FAILURE" } });
  const review = () => getMintFailureRecoveryReview(publisherId, passportId, attemptId);
  const restore = (input, reader = base, actor = publisherId) => restoreFailedMint(actor, passportId, attemptId, input, reader);
  let calls = 0;
  const offline = { ...base, getChainId: async () => { calls++; throw new Error("fictional-private-failed-recovery-detail"); } };
  await rejects(review());
  assert.equal((await tickMintMonitor(db, passportId, attemptId, offline)).status, "UNAVAILABLE");
  const input = body(await review()); calls = 0;
  await rejects(restore({ ...input, acknowledgement: "RESTORE_ORIGINAL_MINT" }, offline), 422);
  await rejects(restore({ ...input, rpcUrl: "https://untrusted.example.invalid" }, offline), 422);
  await rejects(restore(input, offline, "not-the-publisher"), 403);
  await rejects(getMintRecoveryReview(publisherId, passportId, attemptId));
  for (const patch of [{ expectedFailedObservationId: randomUUID() }, { expectedIntentSha256: "0".repeat(64) },
    { expectedWalletStateSha256: "0".repeat(64) }, { expectedObservationVersion: input.expectedObservationVersion + 1 }]) await rejects(restore({ ...input, ...patch }, offline));
  assert.equal(calls, 0);
  await rejects(restore(input, offline), 503);
  await rejects(restore(input, { ...base, getBlock: async () => ({ number: 1n, hash: `0x${"f".repeat(64)}` }) }), 503);
  if (!chain) await rejects(restore(input, failure.frame.reader)); // A successful receipt cannot restore a closed failure.
  const actor = await db.user.findUniqueOrThrow({ where: { id: publisherId } });
  for (const field of ["banned", "twoFactorEnabled", "role"]) {
    let changed = false;
    try { await rejects(restore(input, { ...base, getChainId: async () => {
      if (!changed) { changed = true; await db.user.update({ where: { id: publisherId }, data: { [field]: field === "role" ? "user" : field === "banned" } }); }
      return base.getChainId();
    } }), 403); } finally { await db.user.update({ where: { id: publisherId }, data: { [field]: actor[field] } }); }
  }
  const peer = await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: active.attemptId } }); let changed = false;
  try { await rejects(restore(input, { ...base, getChainId: async () => {
    if (!changed) { changed = true; await db.publicationMintAttempt.update({ where: { id: peer.id }, data: { observationVersion: peer.observationVersion + 1 } }); }
    return base.getChainId();
  } })); } finally { await db.publicationMintAttempt.update({ where: { id: peer.id }, data: { observationVersion: peer.observationVersion } }); }
  const originalNow = Date.now, now = originalNow(); Date.now = () => now;
  try { await rejects(restore(input, { ...base, getChainId: async () => { Date.now = () => now + 16_000; return base.getChainId(); } })); }
  finally { Date.now = originalNow; }
  assert.equal(await count(), 0); assert.ok((await attempt()).quarantinedAt);

  // Another canonical but quarantined attempt stays quarantined after this recovery.
  await observeMintAttempt(successful.passportId, successful.attemptId, { transactionHash: successful.hash }, offline);
  const otherQuarantine = (await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: successful.attemptId } })).quarantinedAt;
  assert.ok(otherQuarantine);
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const stale = observeMintAttempt(passportId, attemptId, { transactionHash: failure.hash }, {
    ...base, getChainId: async () => { enter(); await gate; throw new Error(); },
  });
  await entered;
  const fresh = body(await review()); let first;
  try {
    const results = await Promise.all([restore(fresh), restore(fresh)]);
    assert.ok(results.every(row => row.status === "RECORDED" && !row.currentlyQuarantined && !row.issued && !row.canResend));
    assert.equal(results[0].recoveryId, results[1].recoveryId); first = results[0];
  } finally { release(); }
  assert.equal((await stale).status, "SUPERSEDED"); assert.equal(await count(), 1);
  const record = await db.publicationMintRecovery.findUniqueOrThrow({ where: { id: first.recoveryId } });
  const proof = await db.publicationMintObservation.findUniqueOrThrow({ where: { id: record.verifiedObservationId } });
  assert.equal(record.kind, "FAILURE"); assert.equal(record.verificationStatus, "REVERTED"); assert.equal(record.finalizedObservationId, null);
  assert.equal(record.failedObservationId, original.failedObservationId); assert.equal(record.actorId, publisherId);
  assert.equal(proof.status, "REVERTED"); assert.equal(proof.transactionId, failure.matched.matchedTransactionId);
  assert.equal((await attempt()).status, "FAILED_TERMINAL"); assert.equal((await attempt()).failedAt.getTime(), original.failedAt.getTime());
  assert.equal((await attempt()).failedObservationId, original.failedObservationId); assert.equal((await attempt()).nonce, original.nonce);
  const publication = await db.publication.findUniqueOrThrow({ where: { id: (await db.publicationMintPreparation.findUniqueOrThrow({ where: { id: original.preparationId } })).publicationId } });
  assert.equal(publication.status, "CHAIN_FAILED"); assert.equal(publication.tokenId, null); assert.equal(publication.transactionHash, null); assert.equal(publication.contractAddress, null);
  const projection = await db.publicationMintResult.findUniqueOrThrow({ where: { attemptId } });
  assert.equal(projection.status, "SUSPENDED"); assert.equal(projection.checkedObservationId, proof.id);
  assert.equal((await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: active.attemptId } })).status, peer.status);
  assert.equal((await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: successful.attemptId } })).quarantinedAt.getTime(), otherQuarantine.getTime());
  const successReview = await getMintRecoveryReview(publisherId, successful.passportId, successful.attemptId);
  const successInput = { requestId: fresh.requestId, expectedIntentSha256: successReview.intentSha256, expectedWalletStateSha256: successReview.walletStateSha256,
    expectedFinalizedObservationId: successReview.finalizedObservationId, expectedObservationVersion: successReview.observationVersion,
    expectedQuarantinedAt: successReview.quarantinedAt, acknowledgement: "RESTORE_ORIGINAL_MINT" };
  await rejects(restoreOriginalMint(publisherId, successful.passportId, successful.attemptId, successInput, offline));
  await restoreOriginalMint(publisherId, successful.passportId, successful.attemptId, { ...successInput, requestId: randomUUID() }, successReader);

  assert.equal((await restore(fresh, offline)).recoveryId, record.id);
  await rejects(restore({ ...fresh, requestId: randomUUID() }, offline));
  await tickMintMonitor(db, passportId, attemptId, offline);
  assert.equal((await restore(fresh, offline)).currentlyQuarantined, true, "old recorded recovery cannot clear a new incident");
  const nextInput = body(await review()), second = await restore(nextInput);
  assert.equal(await count(), 2); assert.equal(second.currentlyQuarantined, false);
  assert.equal((await attempt()).failedObservationId, original.failedObservationId);
  assert.equal(await db.auditLog.count({ where: { publicationId: publication.id, action: "PUBLICATION_MINT_FAILURE_RESTORED" } }), 2);

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 }); await client.connect();
  try {
    const negative = await db.publicationMintObservation.findFirstOrThrow({ where: { attemptId, status: "UNKNOWN" } });
    for (const [sql, values, code, constraints] of [
      ['UPDATE "PublicationMintRecovery" SET "kind"=\'SUCCESS\' WHERE "id"=$1', [record.id], "23514", ["PublicationMintRecovery_shape_check"]],
      ['UPDATE "PublicationMintRecovery" SET "verificationStatus"=\'VERIFIED\' WHERE "id"=$1', [record.id], "23514", ["PublicationMintRecovery_shape_check"]],
      ['UPDATE "PublicationMintRecovery" SET "failedObservationId"=NULL WHERE "id"=$1', [record.id], "23514", ["PublicationMintRecovery_shape_check"]],
      ['UPDATE "PublicationMintRecovery" SET "failedObservationId"="verifiedObservationId" WHERE "id"=$1', [record.id], "23514", ["PublicationMintRecovery_shape_check"]],
      ['UPDATE "PublicationMintRecovery" SET "failedObservationId"=$2 WHERE "id"=$1', [record.id, negative.id], "23503", ["PublicationMintRecovery_failed_original_fkey"]],
      ['UPDATE "PublicationMintRecovery" SET "attemptId"=$2 WHERE "id"=$1', [record.id, active.attemptId], "23503", ["PublicationMintRecovery_failed_original_fkey", "PublicationMintRecovery_verifiedObservationId_attemptId_ve_fkey"]],
      ['UPDATE "PublicationMintRecovery" SET "requestId"=$2 WHERE "id"=$1', [second.recoveryId, record.requestId], "23505", ["PublicationMintRecovery_requestId_key"]],
    ]) {
      await client.query("BEGIN");
      try { await assert.rejects(client.query(sql, values), error => error.code === code && constraints.includes(error.constraint)); }
      finally { await client.query("ROLLBACK"); }
    }
  } finally { await client.end(); }
  failure.lastRecovery = nextInput;
  process.stdout.write("Failed-proof recovery passed: separate MFA consent, unchanged REVERTED receipt/depth, stale authority/wallet refusal, atomic idempotent journal, kind isolation, renewed incident, retained first failure/nonce/active slot and other quarantine.\n");
}

export async function smokeLostFailedRecovery({ publisherId, failure, chain }) {
  const { passportId, attemptId, base } = failure;
  if (chain) {
    const review = await getMintFailureRecoveryReview(publisherId, passportId, attemptId);
    await rejects(restoreFailedMint(publisherId, passportId, attemptId, body(review), base), 503);
  }
  assert.equal((await restoreFailedMint(publisherId, passportId, attemptId, failure.lastRecovery, base)).currentlyQuarantined, true);
}
