import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
import pg from "pg";
import { tickMintMonitor } from "./smoke-publication-mint-monitor.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { getMintCancellationRecoveryReview, restoreCancelledMint, getMintFailureRecoveryReview, getMintRecoveryReview, restoreFailedMint } =
  await jiti.import("../lib/publication/mint-recovery.ts");
const { observeMintAttempt } = await jiti.import("../lib/publication/mint-observation.ts");
const rejects = (promise, status = 409) => assert.rejects(promise, error => error.status === status);
const body = review => ({ requestId: randomUUID(), expectedIntentSha256: review.intentSha256, expectedWalletStateSha256: review.walletStateSha256,
  expectedCancelledObservationId: review.cancelledObservationId, expectedCancellationId: review.cancellationId,
  expectedObservationVersion: review.observationVersion, expectedQuarantinedAt: review.quarantinedAt, acknowledgement: "RESTORE_CANCELLED_MINT" });

/** Temporary uncertainty may be cleared only through separate review of the
 * unchanged closure proof; first proof, nonce and a later active slot stay put.
 */
export async function smokeCancelledRecovery({ db, publisherId, passportId, attemptId, hash, journal, publicationId, confirmationId, base }) {
  const attempt = () => db.publicationMintAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  const original = await attempt();
  const count = () => db.publicationMintRecovery.count({ where: { attemptId, kind: "CANCELLATION" } });
  const review = () => getMintCancellationRecoveryReview(publisherId, passportId, attemptId);
  const restore = (input, reader = base, actor = publisherId) => restoreCancelledMint(actor, passportId, attemptId, input, reader);
  let calls = 0;
  const offline = { ...base, getChainId: async () => { calls++; throw new Error("fictional-private-cancelled-recovery-detail"); } };
  await rejects(review());
  assert.equal((await tickMintMonitor(db, passportId, attemptId, offline)).status, "UNAVAILABLE");
  assert.ok((await attempt()).quarantinedAt);
  const input = body(await review()); calls = 0;
  assert.equal(input.expectedCancellationId, journal.id); assert.equal(input.expectedCancelledObservationId, journal.observationId);
  await rejects(restore({ ...input, acknowledgement: "RESTORE_FAILED_MINT" }, offline), 422);
  await rejects(restore({ ...input, rpcUrl: "https://untrusted.example.invalid" }, offline), 422);
  await rejects(restore(input, offline, "not-the-publisher"), 403);
  await rejects(getMintFailureRecoveryReview(publisherId, passportId, attemptId));
  await rejects(getMintRecoveryReview(publisherId, passportId, attemptId));
  const { expectedCancelledObservationId, expectedCancellationId, ...shared } = input;
  await rejects(restoreFailedMint(publisherId, passportId, attemptId, { ...shared, expectedFailedObservationId: expectedCancelledObservationId,
    acknowledgement: "RESTORE_FAILED_MINT" }, offline), 409);
  assert.ok(expectedCancellationId);
  for (const patch of [{ expectedCancelledObservationId: randomUUID() }, { expectedCancellationId: randomUUID() }, { expectedIntentSha256: "0".repeat(64) },
    { expectedWalletStateSha256: "0".repeat(64) }, { expectedObservationVersion: input.expectedObservationVersion + 1 }]) await rejects(restore({ ...input, ...patch }, offline));
  assert.equal(calls, 0, "stale or mismatched review is refused before RPC");
  await rejects(restore(input, offline), 503);
  const changedAnchor = { ...base, getBlock: async args => args?.blockNumber === original.dispatchBlockNumber
    ? { number: original.dispatchBlockNumber, hash: `0x${"f".repeat(64)}` } : base.getBlock(args) };
  await rejects(restore(input, changedAnchor), 503);
  await rejects(restore(input, { ...base, getTransaction: async args => ({ ...await base.getTransaction(args), nonce: Number(original.nonce) + 1 }) }), 503);
  await rejects(restore(input, { ...base, getTransaction: async () => { const error = new Error(); error.name = "TransactionNotFoundError"; throw error; } }));
  await rejects(restore(input, { ...base, getTransaction: async args => ({ ...await base.getTransaction(args), blockNumber: null, blockHash: null }) }));
  const actor = await db.user.findUniqueOrThrow({ where: { id: publisherId } });
  for (const field of ["banned", "twoFactorEnabled", "role"]) {
    let changed = false;
    try { await rejects(restore(input, { ...base, getChainId: async () => {
      if (!changed) { changed = true; await db.user.update({ where: { id: publisherId }, data: { [field]: field === "role" ? "user" : field === "banned" } }); }
      return base.getChainId();
    } }), 403); } finally { await db.user.update({ where: { id: publisherId }, data: { [field]: actor[field] } }); }
  }
  const configured = process.env.HARTOLIT_PUBLISHER_WALLET;
  try { await rejects(restore(input, { ...base, getChainId: async () => { process.env.HARTOLIT_PUBLISHER_WALLET = `0x${"3".repeat(40)}`; return base.getChainId(); } }), 403); }
  finally { process.env.HARTOLIT_PUBLISHER_WALLET = configured; }
  let invalidated = false;
  try { await rejects(restore(input, { ...base, getChainId: async () => {
    if (!invalidated) { invalidated = true; await db.publicSnapshotConfirmation.update({ where: { id: confirmationId }, data: { invalidatedAt: new Date() } }); }
    return base.getChainId();
  } })); } finally { await db.publicSnapshotConfirmation.update({ where: { id: confirmationId }, data: { invalidatedAt: null } }); }
  const originalNow = Date.now, now = originalNow(); Date.now = () => now;
  try { await rejects(restore(input, { ...base, getChainId: async () => { Date.now = () => now + 16_000; return base.getChainId(); } })); }
  finally { Date.now = originalNow; }
  assert.equal(await count(), 0); assert.ok((await attempt()).quarantinedAt);

  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const stale = observeMintAttempt(passportId, attemptId, { transactionHash: hash }, {
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
  assert.equal(record.kind, "CANCELLATION"); assert.equal(record.verificationStatus, "CANCELLED"); assert.equal(record.finalizedObservationId, null);
  assert.equal(record.failedObservationId, original.failedObservationId); assert.equal(record.cancellationId, journal.id); assert.equal(record.actorId, publisherId);
  assert.equal(proof.status, "CANCELLED"); assert.equal(proof.transactionId, null); assert.equal(proof.reportedHash, hash);
  assert.equal(JSON.parse(proof.resultJson).proofKind, "CANCELLATION"); assert.equal(JSON.parse(proof.resultJson).nonce, original.nonce.toString());
  const restored = await attempt();
  assert.equal(restored.status, "FAILED_TERMINAL"); assert.equal(restored.failureStatus, "CANCELLED"); assert.equal(restored.quarantinedAt, null);
  assert.equal(restored.failedAt.getTime(), original.failedAt.getTime()); assert.equal(restored.failedObservationId, original.failedObservationId);
  assert.equal(restored.nonce, original.nonce); assert.equal(restored.preparationId, original.preparationId);
  assert.equal(await db.publicationMintTransaction.count({ where: { attemptId } }), 0);
  assert.equal(await db.publicationMintCancellation.count({ where: { attemptId } }), 1);
  const publication = await db.publication.findUniqueOrThrow({ where: { id: publicationId } });
  assert.equal(publication.status, "CHAIN_FAILED"); assert.equal(publication.tokenId, null); assert.equal(publication.transactionHash, null); assert.equal(publication.contractAddress, null);
  const projection = await db.publicationMintResult.findUniqueOrThrow({ where: { attemptId } });
  assert.equal(projection.status, "SUSPENDED"); assert.equal(projection.checkedObservationId, proof.id);
  assert.equal(await db.auditLog.count({ where: { publicationId, action: "PUBLICATION_MINT_CANCELLATION_RESTORED" } }), 1);

  assert.equal((await restore(fresh, offline)).recoveryId, record.id);
  await rejects(restore({ ...fresh, requestId: randomUUID() }, offline));
  await tickMintMonitor(db, passportId, attemptId, offline);
  assert.equal((await restore(fresh, offline)).currentlyQuarantined, true, "old recorded recovery cannot clear a new incident");
  const second = await restore(body(await review()));
  assert.equal(await count(), 2); assert.equal(second.currentlyQuarantined, false);
  assert.equal((await attempt()).failedObservationId, original.failedObservationId);

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 }); await client.connect();
  try {
    for (const [sql, values, code, constraints] of [
      ['UPDATE "PublicationMintRecovery" SET "kind"=\'FAILURE\' WHERE "id"=$1', [record.id], "23514", ["PublicationMintRecovery_shape_check"]],
      ['UPDATE "PublicationMintRecovery" SET "verificationStatus"=\'REVERTED\' WHERE "id"=$1', [record.id], "23514", ["PublicationMintRecovery_shape_check"]],
      ['UPDATE "PublicationMintRecovery" SET "cancellationId"=NULL WHERE "id"=$1', [record.id], "23514", ["PublicationMintRecovery_shape_check"]],
      ['UPDATE "PublicationMintRecovery" SET "failedObservationId"="verifiedObservationId" WHERE "id"=$1', [record.id], "23514", ["PublicationMintRecovery_shape_check"]],
      ['UPDATE "PublicationMintRecovery" SET "cancellationId"=$2 WHERE "id"=$1', [record.id, randomUUID()], "23503", ["PublicationMintRecovery_cancellation_fkey"]],
      // Another same-attempt CANCELLED proof is not the reviewed closure proof.
      ['UPDATE "PublicationMintRecovery" SET "failedObservationId"=$2 WHERE "id"=$1', [second.recoveryId, record.verifiedObservationId], "23503", ["PublicationMintRecovery_cancellation_fkey"]],
      ['UPDATE "PublicationMintRecovery" SET "requestId"=$2 WHERE "id"=$1', [second.recoveryId, record.requestId], "23505", ["PublicationMintRecovery_requestId_key"]],
    ]) {
      await client.query("BEGIN");
      try { await assert.rejects(client.query(sql, values), error => error.code === code && constraints.includes(error.constraint)); }
      finally { await client.query("ROLLBACK"); }
    }
  } finally { await client.end(); }
  return { passportId, attemptId, attempt, original, restore, review, offline };
}

/** After a newer slot exists: restoration leaves it untouched; a genuinely lost
 * proof can never be cleared by consent or by replaying an old request.
 */
export async function smokeCancelledRecoveryWithActive({ db, recovery, active }) {
  const peer = await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: active } });
  await tickMintMonitor(db, recovery.passportId, recovery.attemptId, recovery.offline);
  assert.ok((await recovery.attempt()).quarantinedAt);
  recovery.lastInput = body(await recovery.review());
  assert.equal((await recovery.restore(recovery.lastInput)).currentlyQuarantined, false);
  const after = await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: active } });
  assert.equal(after.status, peer.status); assert.equal(after.nonce, peer.nonce); assert.equal(after.observationVersion, peer.observationVersion);
  assert.equal((await recovery.attempt()).nonce, recovery.original.nonce);
}

export async function smokeLostCancelledRecovery({ recovery, base }) {
  await assert.rejects(recovery.restore(body(await recovery.review()), base), error => error.status === 409 || error.status === 503);
  assert.equal((await recovery.restore(recovery.lastInput, recovery.offline)).currentlyQuarantined, true);
  assert.ok((await recovery.attempt()).quarantinedAt, "a lost or remined cancellation stays quarantined");
  assert.equal((await recovery.attempt()).failedObservationId, recovery.original.failedObservationId);
}
