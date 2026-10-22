import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
import pg from "pg";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { getMintRecoveryReview, restoreOriginalMint } = await jiti.import("../lib/publication/mint-recovery.ts");
const { observeMintAttempt } = await jiti.import("../lib/publication/mint-observation.ts");
const rejects = (promise, status = 409) => assert.rejects(promise, error => error.status === status);
const body = review => ({ requestId: randomUUID(), acknowledgement: "RESTORE_ORIGINAL_MINT",
  expectedIntentSha256: review.intentSha256, expectedWalletStateSha256: review.walletStateSha256,
  expectedFinalizedObservationId: review.finalizedObservationId, expectedObservationVersion: review.observationVersion,
  expectedQuarantinedAt: review.quarantinedAt });

export async function smokeMintRecovery({ db, publisherId, passportId, attemptId, nextCommand, base }) {
  const attempt = () => db.publicationMintAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  const initial = await attempt(), firstProof = await db.publicationMintObservation.findUniqueOrThrow({ where: { id: initial.finalizedObservationId } });
  const count = () => db.publicationMintRecovery.count({ where: { attemptId } });
  const review = () => getMintRecoveryReview(publisherId, passportId, attemptId);
  const restore = (data, reader = base, actor = publisherId) => restoreOriginalMint(actor, passportId, attemptId, data, reader);
  let calls = 0;
  const offline = { ...base, getChainId: async () => { calls++; throw new Error("fictional-private-recovery-provider-detail"); } };
  const quarantine = () => observeMintAttempt(passportId, attemptId, { transactionHash: firstProof.reportedHash }, offline);
  await rejects(review());
  await quarantine();
  const input = body(await review());
  calls = 0;
  await rejects(restore({ ...input, acknowledgement: "SEND_EXACT_MINT" }, offline), 422);
  await rejects(restore({ ...input, rpcUrl: "https://untrusted.example.invalid" }, offline), 422);
  await rejects(restore(input, offline, "not-the-publisher"), 403);
  for (const patch of [{ expectedIntentSha256: "0".repeat(64) }, { expectedWalletStateSha256: "0".repeat(64) },
    { expectedFinalizedObservationId: randomUUID() }, { expectedObservationVersion: input.expectedObservationVersion + 1 },
    { expectedQuarantinedAt: "2000-01-01T00:00:00.000Z" }]) await rejects(restore({ ...input, ...patch }, offline));
  assert.equal(calls, 0, "strict consent/current authority and reviewed commitments reject before RPC");
  for (const reader of [offline, { ...base, getChainId: async () => 56 },
    { ...base, getBlock: async args => { const block = await base.getBlock(args); return { ...block, hash: `0x${"f".repeat(64)}` }; } },
    { ...base, getBlock: args => args?.blockNumber === undefined ? base.getBlock({ blockNumber: BigInt(JSON.parse(firstProof.resultJson).blockNumber) }) : base.getBlock(args) },
  ]) await rejects(restore(input, reader), 503);
  assert.equal(await count(), 0); assert.ok((await attempt()).quarantinedAt);

  // No transaction remains open over RPC: all these mutations must complete.
  const actor = await db.user.findUniqueOrThrow({ where: { id: publisherId } });
  const peer = await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: nextCommand.attemptId } });
  const confirmation = await db.publication.findUniqueOrThrow({ where: { id: (await db.publicationMintPreparation.findUniqueOrThrow({ where: { id: initial.preparationId } })).publicationId } });
  const transaction = await db.publicationMintTransaction.findUniqueOrThrow({ where: { id: firstProof.transactionId } });
  const originalWallet = process.env.HARTOLIT_PUBLISHER_WALLET;
  for (const [mutate, reset, status] of [
    [() => db.user.update({ where: { id: publisherId }, data: { banned: true } }), () => db.user.update({ where: { id: publisherId }, data: { banned: actor.banned } }), 403],
    [() => db.user.update({ where: { id: publisherId }, data: { twoFactorEnabled: false } }), () => db.user.update({ where: { id: publisherId }, data: { twoFactorEnabled: actor.twoFactorEnabled } }), 403],
    [() => db.user.update({ where: { id: publisherId }, data: { role: "user" } }), () => db.user.update({ where: { id: publisherId }, data: { role: actor.role } }), 403],
    [() => { process.env.HARTOLIT_PUBLISHER_WALLET = `0x${"e".repeat(40)}`; }, () => { process.env.HARTOLIT_PUBLISHER_WALLET = originalWallet; }, 403],
    [() => db.publicSnapshotConfirmation.update({ where: { id: confirmation.confirmationId }, data: { invalidatedAt: new Date() } }), () => db.publicSnapshotConfirmation.update({ where: { id: confirmation.confirmationId }, data: { invalidatedAt: null } }), 409],
    [() => db.publicationMintTransaction.update({ where: { id: transaction.id }, data: { transactionHash: `0x${"e".repeat(64)}` } }), () => db.publicationMintTransaction.update({ where: { id: transaction.id }, data: { transactionHash: transaction.transactionHash } }), 409],
    [() => db.publicationMintAttempt.update({ where: { id: peer.id }, data: { observationVersion: peer.observationVersion + 1 } }), () => db.publicationMintAttempt.update({ where: { id: peer.id }, data: { observationVersion: peer.observationVersion } }), 409],
  ]) {
    let changed = false;
    try { await rejects(restore(input, { ...base, getChainId: async () => { if (!changed) { changed = true; await mutate(); } return base.getChainId(); } }), status); }
    finally { await reset(); }
    assert.equal(await count(), 0, "post-RPC authority/commitment/wallet change cannot restore");
  }
  const originalNow = Date.now, now = originalNow();
  Date.now = () => now;
  try { await rejects(restore(input, { ...base, getChainId: async () => { Date.now = () => now + 16_000; return base.getChainId(); } })); }
  finally { Date.now = originalNow; }
  assert.equal(await count(), 0, "expired verification cannot clear quarantine");

  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const slow = restore(input, { ...base, getChainId: async () => { enter(); await gate; return base.getChainId(); } });
  await entered;
  await observeMintAttempt(passportId, attemptId, { transactionHash: firstProof.reportedHash }, base);
  release(); await rejects(slow);
  assert.equal(await count(), 0, "a newer observation invalidates the exact reviewed state");

  // A stale failed observer cannot undo a separately reviewed successful restoration.
  let enterOld, releaseOld;
  const oldEntered = new Promise(resolve => { enterOld = resolve; }), oldGate = new Promise(resolve => { releaseOld = resolve; });
  const stale = observeMintAttempt(passportId, attemptId, { transactionHash: firstProof.reportedHash }, {
    ...base, getChainId: async () => { enterOld(); await oldGate; throw new Error(); },
  });
  await oldEntered;
  const fresh = body(await review());
  let restored;
  try {
    const results = await Promise.all([restore(fresh), restore(fresh)]);
    assert.ok(results.every(row => row.status === "RECORDED" && !row.currentlyQuarantined && !row.issued && !row.canResend));
    assert.equal(results[0].recoveryId, results[1].recoveryId); restored = results[0];
  } finally { releaseOld(); }
  assert.equal((await stale).status, "SUPERSEDED");
  assert.equal(await count(), 1); assert.equal((await attempt()).quarantinedAt, null);
  assert.equal((await attempt()).finalizedObservationId, initial.finalizedObservationId);
  assert.equal((await attempt()).finalizedAt.getTime(), initial.finalizedAt.getTime()); assert.equal((await attempt()).nonce, initial.nonce);
  assert.equal((await db.publication.findUniqueOrThrow({ where: { id: confirmation.id } })).status, "PUBLISHED");
  const record = await db.publicationMintRecovery.findUniqueOrThrow({ where: { id: restored.recoveryId } });
  assert.equal(record.actorId, publisherId); assert.equal(record.quarantinedAt.toISOString(), fresh.expectedQuarantinedAt);
  const verified = await db.publicationMintObservation.findUniqueOrThrow({ where: { id: record.verifiedObservationId } });
  assert.equal(verified.status, "VERIFIED"); assert.equal(verified.revision, fresh.expectedObservationVersion + 1);
  assert.equal(JSON.parse(verified.resultJson).blockHash, JSON.parse(firstProof.resultJson).blockHash);
  assert.equal((await db.publicationMintResult.findUniqueOrThrow({ where: { attemptId } })).verifiedObservationId, verified.id);
  assert.equal((await restore(fresh, offline)).recoveryId, record.id, "a lost-response retry returns historical evidence without RPC");
  await rejects(restore({ ...fresh, expectedWalletStateSha256: "0".repeat(64) }, offline));
  await rejects(restore({ ...fresh, requestId: randomUUID() }, offline));
  await rejects(review());

  // Every new incident needs a new review; old idempotent success never clears it.
  await quarantine();
  const historical = await restore(fresh, offline);
  assert.equal(historical.currentlyQuarantined, true); assert.ok((await attempt()).quarantinedAt);
  const nextReview = body(await review());
  const second = await restore(nextReview);
  assert.equal(second.currentlyQuarantined, false); assert.equal(await count(), 2);
  assert.equal((await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: peer.id } })).status, peer.status);
  assert.equal((await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: peer.id } })).nonce, peer.nonce);
  assert.equal(await db.auditLog.count({ where: { publicationId: confirmation.id, action: "PUBLICATION_MINT_RESTORED" } }), 2);

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    const negative = await db.publicationMintObservation.findFirstOrThrow({ where: { attemptId, status: "UNKNOWN" } });
    for (const [query, values, code, constraint] of [
      ['UPDATE "PublicationMintRecovery" SET "verificationStatus"=\'UNKNOWN\' WHERE "id"=$1', [record.id], "23514", "PublicationMintRecovery_shape_check"],
      ['UPDATE "PublicationMintRecovery" SET "restoredAt"="quarantinedAt"-INTERVAL \'1 second\' WHERE "id"=$1', [record.id], "23514", "PublicationMintRecovery_shape_check"],
      ['UPDATE "PublicationMintRecovery" SET "verifiedObservationId"="finalizedObservationId" WHERE "id"=$1', [record.id], "23514", "PublicationMintRecovery_shape_check"],
      ['UPDATE "PublicationMintRecovery" SET "finalizedObservationId"=$2 WHERE "id"=$1', [record.id, negative.id], "23503", "PublicationMintRecovery_finalizedObservationId_attemptId_v_fkey"],
      ['UPDATE "PublicationMintRecovery" SET "verifiedObservationId"=$2 WHERE "id"=$1', [record.id, negative.id], "23503", "PublicationMintRecovery_verifiedObservationId_attemptId_ve_fkey"],
      ['UPDATE "PublicationMintRecovery" SET "attemptId"=$2 WHERE "id"=$1', [record.id, peer.id], "23503",
        ["PublicationMintRecovery_finalizedObservationId_attemptId_v_fkey", "PublicationMintRecovery_verifiedObservationId_attemptId_ve_fkey"]],
      ['UPDATE "PublicationMintRecovery" SET "requestId"=$2 WHERE "id"=$1', [second.recoveryId, record.requestId], "23505", "PublicationMintRecovery_requestId_key"],
    ]) {
      await client.query("BEGIN");
      try { await assert.rejects(client.query(query, values), error => error.code === code && [constraint].flat().includes(error.constraint)); }
      finally { await client.query("ROLLBACK"); }
    }
  } finally { await client.end(); }
  process.stdout.write("Mint recovery passed: exact separate current-publisher review, fresh unchanged original proof/depth, post-RPC auth/commitment/wallet checks, expiry, races, idempotence/new quarantine, immutable proof/nonce/active slot and SQL journal constraints.\n");
  return { input: nextReview, recoveryId: second.recoveryId };
}

export async function smokeLostOriginalRecovery({ db, publisherId, passportId, attemptId, base, previous, actualChain }) {
  const review = await getMintRecoveryReview(publisherId, passportId, attemptId);
  if (actualChain) {
    await rejects(restoreOriginalMint(publisherId, passportId, attemptId, body(review), base), 503);
    assert.ok((await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: attemptId } })).quarantinedAt);
  }
  const historical = await restoreOriginalMint(publisherId, passportId, attemptId, previous.input, base);
  assert.equal(historical.recoveryId, previous.recoveryId); assert.equal(historical.currentlyQuarantined, true);
}
