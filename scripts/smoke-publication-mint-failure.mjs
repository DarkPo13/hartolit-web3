import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { createJiti } from "jiti";
import pg from "pg";
import { syntheticMintFrame } from "./smoke-publication-mint-observation.mjs";
import { tickMintMonitor } from "./smoke-publication-mint-monitor.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { getMintFailureReview, closeRevertedMint } = await jiti.import("../lib/publication/mint-failure.ts");
const { beginMintDispatch, recordUnknownMintOutcome } = await jiti.import("../lib/publication/mint-dispatch.ts");
const { observeMintAttempt, finalizeMintPublication, reconcileMintResult } = await jiti.import("../lib/publication/mint-observation.ts");
const { discoverMintTransaction } = await jiti.import("../lib/publication/mint-discovery.ts");
const rejects = (promise, status = 409) => assert.rejects(promise, error => error.status === status);
const dispatchInput = candidate => ({ preparationId: candidate.preparationId, requestId: randomUUID(), expectedIntentSha256: candidate.intent.sha256, acknowledgement: "SEND_EXACT_MINT" });

export async function smokeMintFailure({ db, publisherId, candidate, peer, chain }) {
  const preflight = chain?.reader ?? { getChainId: async () => 97, getCode: async () => "0x60006000",
    getBlock: async () => ({ number: 4n, hash: `0x${"a".repeat(64)}` }), getTransactionCount: async () => 7,
    readContract: async ({ functionName }) => ({ MINTER_ROLE: `0x${"b".repeat(64)}`, paused: false, hasRole: true, hashToTokenId: 0n })[functionName] };
  const command = await beginMintDispatch(publisherId, candidate.passportId, dispatchInput(candidate), candidate.target, preflight);
  const passportId = candidate.passportId, attemptId = command.attemptId;
  const code = await preflight.getCode({ address: candidate.target.contractAddress });
  const snapshot = chain ? await chain.reader.request({ method: "evm_snapshot" }) : null;
  const hash = chain ? await chain.send(command, undefined, 35_000n) : `0x${randomBytes(32).toString("hex")}`;
  if (chain) {
    assert.equal((await chain.reader.waitForTransactionReceipt({ hash })).status, "reverted", "actual exact-call transaction runs out of execution gas");
    await chain.reader.request({ method: "anvil_mine", params: ["0x2"] });
  }
  const frame = syntheticMintFrame(candidate.intent, command.request.nonce, code, hash);
  const reverted = { ...frame.reader, getTransactionReceipt: async () => ({ ...frame.receipt, status: "reverted", logs: [] }) };
  const base = chain?.reader ?? reverted;
  const attempt = () => db.publicationMintAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  const publication = () => db.publication.findUniqueOrThrow({ where: { id: candidate.publication.id } });
  const count = () => db.publicationMintFailure.count({ where: { attemptId } });
  await observeMintAttempt(passportId, attemptId, { transactionHash: null }, base);
  const matched = await observeMintAttempt(passportId, attemptId, { transactionHash: hash }, base);
  assert.equal(matched.status, "REVERTED"); assert.equal((await attempt()).status, "DISPATCHING");
  await rejects(beginMintDispatch(publisherId, peer.passportId, dispatchInput(peer), peer.target, preflight));
  const review = () => getMintFailureReview(publisherId, passportId, attemptId, matched.matchedTransactionId);
  const input = current => ({ requestId: randomUUID(), transactionId: current.transactionId, expectedIntentSha256: current.intentSha256,
    expectedWalletStateSha256: current.walletStateSha256, expectedObservationVersion: current.observationVersion, acknowledgement: "CLOSE_REVERTED_MINT" });
  const data = input(await review());
  const close = (body = data, reader = base, actor = publisherId) => closeRevertedMint(actor, passportId, attemptId, body, reader);
  let calls = 0;
  const offline = { ...base, getChainId: async () => { calls++; throw new Error("fictional-private-failure-detail"); } };
  await rejects(close({ ...data, acknowledgement: "SEND_EXACT_MINT" }, offline), 422);
  await rejects(close({ ...data, nonce: 0 }, offline), 422);
  await rejects(close(data, offline, "not-the-publisher"), 403);
  for (const patch of [{ transactionId: randomUUID() }, { expectedIntentSha256: "0".repeat(64) }, { expectedWalletStateSha256: "0".repeat(64) },
    { expectedObservationVersion: data.expectedObservationVersion + 1 }]) await rejects(close({ ...data, ...patch }, offline));
  assert.equal(calls, 0);
  for (const [reader, status] of [[offline, 503], [frame.reader, 409],
    [{ ...frame.reader, getTransaction: async () => ({ ...frame.tx, blockNumber: null, blockHash: null }) }, 409],
    [{ ...reverted, getBlock: async () => ({ number: 5n, hash: frame.receipt.blockHash }) }, 409],
    [{ ...reverted, getTransaction: async () => ({ ...frame.tx, nonce: command.request.nonce + 1 }) }, 503],
  ]) await rejects(close(data, reader), status);
  const actor = await db.user.findUniqueOrThrow({ where: { id: publisherId } });
  for (const field of ["banned", "twoFactorEnabled", "role"]) {
    let changed = false;
    try { await rejects(close(data, { ...base, getChainId: async () => {
      if (!changed) { changed = true; await db.user.update({ where: { id: publisherId }, data: { [field]: field === "role" ? "user" : field === "banned" } }); }
      return base.getChainId();
    } }), 403); } finally { await db.user.update({ where: { id: publisherId }, data: { [field]: actor[field] } }); }
  }
  const configuredPublisher = process.env.HARTOLIT_PUBLISHER_USER_ID;
  try { await rejects(close(data, { ...base, getChainId: async () => { delete process.env.HARTOLIT_PUBLISHER_USER_ID; return base.getChainId(); } }), 403); }
  finally { process.env.HARTOLIT_PUBLISHER_USER_ID = configuredPublisher; }
  let changedConfirmation = false;
  try { await rejects(close(data, { ...base, getChainId: async () => {
    if (!changedConfirmation) { changedConfirmation = true; await db.publicSnapshotConfirmation.update({ where: { id: candidate.publication.confirmationId }, data: { invalidatedAt: new Date() } }); }
    return base.getChainId();
  } })); } finally { await db.publicSnapshotConfirmation.update({ where: { id: candidate.publication.confirmationId }, data: { invalidatedAt: null } }); }
  const originalNow = Date.now, now = originalNow(); Date.now = () => now;
  try { await rejects(close(data, { ...base, getChainId: async () => { Date.now = () => now + 16_000; return base.getChainId(); } })); }
  finally { Date.now = originalNow; }
  assert.equal(await count(), 0); assert.equal((await attempt()).status, "DISPATCHING");

  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const slow = close(data, { ...base, getChainId: async () => { enter(); await gate; return base.getChainId(); } });
  await entered; await observeMintAttempt(passportId, attemptId, { transactionHash: null }, base); release(); await rejects(slow);
  const fresh = input(await review());
  const results = await Promise.all([close(fresh), close(fresh)]);
  assert.ok(results.every(row => row.status === "RECORDED" && !row.issued && !row.canResend));
  assert.equal(results[0].failureId, results[1].failureId); assert.equal(await count(), 1);
  const closed = await attempt(), stored = await publication();
  assert.equal(closed.status, "FAILED_TERMINAL"); assert.equal(closed.failureStatus, "REVERTED"); assert.equal(closed.finalizedObservationId, null);
  assert.equal(stored.status, "CHAIN_FAILED"); assert.equal(stored.transactionHash, null); assert.equal(stored.tokenId, null);
  const journal = await db.publicationMintFailure.findUniqueOrThrow({ where: { attemptId } });
  assert.equal(journal.actorId, publisherId); assert.equal(journal.observationId, closed.failedObservationId);
  assert.equal(journal.transactionId, matched.matchedTransactionId); assert.equal(journal.reviewedObservationVersion, fresh.expectedObservationVersion);
  assert.equal((await db.publicationMintResult.findUniqueOrThrow({ where: { attemptId } })).status, "SUSPENDED");
  assert.equal((await close(fresh, offline)).failureId, journal.id);
  await rejects(close({ ...fresh, requestId: randomUUID() }, offline));
  await rejects(finalizeMintPublication(passportId, attemptId, { transactionId: matched.matchedTransactionId }, offline));
  await rejects(discoverMintTransaction(passportId, attemptId, {}, offline)); await rejects(recordUnknownMintOutcome(passportId, attemptId));
  await rejects(beginMintDispatch(publisherId, passportId, dispatchInput(candidate), candidate.target, preflight));
  assert.equal((await tickMintMonitor(db, passportId, attemptId, base)).status, "REVERTED");
  assert.equal((await attempt()).quarantinedAt, null); assert.equal((await attempt()).failedObservationId, closed.failedObservationId);
  assert.equal(await db.auditLog.count({ where: { publicationId: candidate.publication.id, action: "PUBLICATION_MINT_FAILED" } }), 1);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 }); await client.connect();
  try {
    const negative = await db.publicationMintObservation.findFirstOrThrow({ where: { attemptId, status: "UNKNOWN" } });
    for (const [sql, values, codeName, constraint] of [
      ['UPDATE "PublicationMintAttempt" SET "failedObservationId"=NULL WHERE "id"=$1', [attemptId], "23514", "PublicationMintAttempt_shape_check"],
      ['UPDATE "PublicationMintAttempt" SET "failedObservationId"=$2 WHERE "id"=$1', [attemptId, negative.id], "23503", "PublicationMintAttempt_failure_proof_fkey"],
      ['UPDATE "PublicationMintFailure" SET "proofStatus"=\'VERIFIED\' WHERE "id"=$1', [journal.id], "23514", "PublicationMintFailure_shape_check"],
      ['UPDATE "PublicationMintFailure" SET "transactionId"=$2 WHERE "id"=$1', [journal.id, randomUUID()], "23503", "PublicationMintFailure_proof_fkey"],
      ['INSERT INTO "PublicationMintAttempt" ("id","preparationId","requestId","chainId","publisherWallet","nonce","deadlineAt") VALUES ($1,$2,$3,97,$4,$5,NOW()+INTERVAL \'5 minutes\')',
        [randomUUID(), peer.preparationId, randomUUID(), closed.publisherWallet, closed.nonce], "23505", "PublicationMintAttempt_chainId_publisherWallet_nonce_key"],
    ]) {
      await client.query("BEGIN");
      try { await client.query("SET CONSTRAINTS ALL IMMEDIATE"); await assert.rejects(client.query(sql, values), error => error.code === codeName && error.constraint === constraint); }
      finally { await client.query("ROLLBACK"); }
    }
  } finally { await client.end(); }
  process.stdout.write(`Reverted mint closure passed: exact current-publisher consent, fresh failure/depth, stale/unauthorized refusal, concurrent journal, permanent nonce/preparation and canonical monitor (${chain ? "actual execution out-of-gas plus PostgreSQL" : "injected RPC plus PostgreSQL"}).\n`);
  return { attemptId, passportId, command, snapshot, hash, data: fresh, closed, matched, frame, base,
    tx: await base.getTransaction({ hash }), receipt: await base.getTransactionReceipt({ hash }) };
}

export async function smokeLateMintFailure({ db, publisherId, failure, chain }) {
  const { attemptId, passportId, base, hash, closed } = failure;
  const peer = await db.publicationMintAttempt.findFirstOrThrow({ where: { id: { not: attemptId }, preparation: { publication: { reservedById: publisherId } } } });
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 }); await client.connect();
  try {
    await client.query("BEGIN");
    try { await assert.rejects(client.query('UPDATE "PublicationMintFailure" SET "attemptId"=$2 WHERE "attemptId"=$1', [attemptId, peer.id]),
      error => error.code === "23503" && error.constraint === "PublicationMintFailure_proof_fkey"); }
    finally { await client.query("ROLLBACK"); }
  } finally { await client.end(); }
  const offline = { ...base, getChainId: async () => { throw new Error(); } };
  assert.equal((await tickMintMonitor(db, passportId, attemptId, offline)).status, "UNAVAILABLE");
  if (chain) {
    assert.equal(await base.request({ method: "evm_revert", params: [failure.snapshot] }), true);
    const replacement = await chain.send(failure.command, 29_000_000_000n);
    assert.equal((await base.waitForTransactionReceipt({ hash: replacement })).status, "success");
    await base.request({ method: "anvil_mine", params: ["0x2"] });
    const reorg = await observeMintAttempt(passportId, attemptId, { transactionHash: hash }, { ...base,
      getTransaction: async () => failure.tx, getTransactionReceipt: async () => failure.receipt });
    assert.equal(reorg.status, "REORG");
    await rejects(observeMintAttempt(passportId, attemptId, { transactionHash: replacement }, base));
  } else {
    const alternate = await reconcileMintResult(passportId, attemptId, { transactionId: failure.matched.matchedTransactionId }, failure.frame.reader);
    assert.equal(alternate.status, "VERIFIED"); assert.equal(alternate.resultStatus, "SUSPENDED");
  }
  const saved = await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { preparation: true } });
  assert.equal(saved.status, "FAILED_TERMINAL"); assert.ok(saved.quarantinedAt); assert.equal(saved.failedObservationId, closed.failedObservationId);
  assert.equal(saved.nonce, closed.nonce); assert.equal(saved.failedAt.getTime(), closed.failedAt.getTime());
  const publication = await db.publication.findUniqueOrThrow({ where: { id: saved.preparation.publicationId } });
  assert.equal(publication.status, "CHAIN_FAILED_SUSPENDED"); assert.equal(publication.transactionHash, null); assert.equal(publication.tokenId, null);
  const historical = await closeRevertedMint(publisherId, passportId, attemptId, failure.data, offline);
  assert.equal(historical.currentlyQuarantined, true); assert.equal(historical.canResend, false);
  process.stdout.write("Closed failed-send monitoring passed: late uncertainty/reorg quarantines without reclaiming the active slot, changing first proof or granting success/resend.\n");
}
