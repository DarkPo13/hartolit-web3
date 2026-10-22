import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { createJiti } from "jiti";
import pg from "pg";
import { syntheticMintFrame } from "./smoke-publication-mint-observation.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { observeMintAttempt, reconcileMintResult } = await jiti.import("../lib/publication/mint-observation.ts");
const { beginMintDispatch } = await jiti.import("../lib/publication/mint-dispatch.ts");
const rejects = (promise, status = 409) => assert.rejects(promise, error => error.status === status);

/** An as-of projection is deliberately not publication or wallet-slot release. */
export async function smokeMintResult({ db, publisherId, dispatched, chain, resultFixture }) {
  const { winner, loser, command } = dispatched, attemptId = command.attemptId, passportId = winner.passportId;
  const code = chain ? await chain.reader.getCode({ address: winner.target.contractAddress }) : "0x60006000";
  const hash = resultFixture?.hash ?? `0x${randomBytes(32).toString("hex")}`;
  const frame = syntheticMintFrame(winner.intent, command.request.nonce, code, hash), base = chain?.reader ?? frame.reader;
  const report = (reader = base, transactionHash = hash) => observeMintAttempt(passportId, attemptId, { transactionHash }, reader);
  const historical = await report(); assert.equal(historical.status, "VERIFIED");
  const transactionId = historical.matchedTransactionId;
  const reconcile = (reader = base) => reconcileMintResult(passportId, attemptId, { transactionId }, reader);
  const projection = () => db.publicationMintResult.findUniqueOrThrow({ where: { attemptId } });
  const count = () => db.publicationMintObservation.count({ where: { attemptId } });
  assert.equal(await db.publicationMintResult.count({ where: { attemptId } }), 0, "history cannot select a result");
  let rpc = 0;
  const offline = { ...base, getChainId: async () => { rpc++; throw new Error("fictional-provider-secret"); } };
  await rejects(reconcileMintResult(passportId, attemptId, { transactionId, observationId: historical.observationId }, offline), 422);
  await rejects(reconcileMintResult(passportId, attemptId, { transactionHash: hash }, offline), 422);
  await rejects(reconcileMintResult(passportId, attemptId, { transactionId: randomUUID() }, offline));
  await rejects(reconcileMintResult(loser.passportId, attemptId, { transactionId }, offline), 404);
  assert.equal(rpc, 0, "invalid candidates never reach RPC");
  const unavailable = await reconcile(offline);
  assert.equal(unavailable.status, "UNAVAILABLE"); assert.equal(unavailable.resultStatus, "SUSPENDED");
  assert.equal((await projection()).verifiedObservationId, null, "historical success is not reused when fresh RPC fails");
  assert.ok(!(await db.publicationMintObservation.findUniqueOrThrow({ where: { id: unavailable.observationId } })).resultJson.includes("fictional-provider-secret"));

  const fresh = await reconcile(); assert.equal(fresh.resultStatus, "VERIFIED"); assert.equal(fresh.status, "VERIFIED");
  assert.equal(fresh.issued, false); assert.equal(fresh.canResend, false);
  assert.notEqual(fresh.observationId, historical.observationId);
  let selected = await projection();
  assert.equal(selected.checkedObservationId, fresh.observationId); assert.equal(selected.verifiedObservationId, fresh.observationId);
  assert.equal(selected.verificationStatus, "VERIFIED");
  const receipt = chain ? await base.getTransactionReceipt({ hash }) : frame.receipt;
  const proof = await db.publicationMintObservation.findUniqueOrThrow({ where: { id: selected.verifiedObservationId } });
  assert.equal(JSON.parse(proof.resultJson).blockHash, receipt.blockHash);
  assert.equal(JSON.parse(proof.resultJson).transactionHash, hash);

  // Even diagnostic success cannot implicitly select/refresh a canonical result.
  const diagnostic = await report(); assert.equal(diagnostic.status, "VERIFIED");
  assert.equal(diagnostic.resultStatus, "SUSPENDED");
  selected = await projection(); assert.equal(selected.status, "SUSPENDED");
  assert.equal(selected.checkedObservationId, diagnostic.observationId); assert.equal(selected.verifiedObservationId, fresh.observationId);
  for (const [reader, expected] of [
    [{ ...frame.reader, getTransaction: async () => ({ ...frame.tx, blockNumber: null, blockHash: null }) }, "PENDING"],
    [{ ...frame.reader, getBlock: async () => ({ number: 5n, hash: frame.receipt.blockHash }) }, "CONFIRMING"],
    [{ ...frame.reader, getTransactionReceipt: async () => ({ ...frame.receipt, status: "reverted", logs: [] }) }, "REVERTED"],
    [{ ...frame.reader, getBlock: async () => ({ number: 7n, hash: `0x${"f".repeat(64)}` }) }, "REORG"],
    [{ ...frame.reader, getTransaction: async () => ({ ...frame.tx, nonce: frame.tx.nonce + 1 }) }, "MISMATCH"],
    [{ ...frame.reader, getTransaction: async () => { throw Object.assign(new Error(), { name: "TransactionNotFoundError" }); } }, "UNKNOWN"],
  ]) {
    const result = await reconcile(reader); assert.equal(result.status, expected); assert.equal(result.resultStatus, "SUSPENDED");
    selected = await projection(); assert.equal(selected.verifiedObservationId, fresh.observationId);
    assert.equal(selected.checkedObservationId, result.observationId);
  }
  const beforeExpiry = await count(), originalNow = Date.now, initialNow = originalNow();
  Date.now = () => initialNow;
  try {
    await rejects(reconcile({ ...base, getTransaction: async args => {
      const tx = await base.getTransaction(args); Date.now = () => initialNow + 16_000; return tx;
    } }));
  } finally { Date.now = originalNow; }
  assert.equal(await count(), beforeExpiry, "expired result checks leave no partial writes");

  // Both directions of stale-read protection apply to the projection atomically.
  for (const lateSuccess of [true, false]) {
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; }), waiting = new Promise(resolve => { entered = resolve; });
    const stale = reconcile({ ...base, getTransaction: async args => {
      entered(); await gate;
      if (!lateSuccess) throw Object.assign(new Error(), { name: "TransactionNotFoundError" });
      return base.getTransaction(args);
    } });
    await waiting;
    if (lateSuccess) assert.equal((await reconcile(offline)).resultStatus, "SUSPENDED");
    else assert.equal((await reconcile()).resultStatus, "VERIFIED");
    const current = await projection(), total = await count(); release();
    assert.equal((await stale).status, "SUPERSEDED"); assert.equal(await count(), total);
    assert.deepEqual(await projection(), current, "late reads cannot change the selected result");
  }
  // Candidate and confirmation changes after RPC must roll back the entire check.
  for (const [mutate, restore] of [
    [() => db.publicationMintTransaction.update({ where: { id: transactionId }, data: { transactionHash: `0x${randomBytes(32).toString("hex")}` } }),
      () => db.publicationMintTransaction.update({ where: { id: transactionId }, data: { transactionHash: hash } })],
    [() => db.publicSnapshotConfirmation.update({ where: { id: winner.publication.confirmationId }, data: { invalidatedAt: new Date() } }),
      () => db.publicSnapshotConfirmation.update({ where: { id: winner.publication.confirmationId }, data: { invalidatedAt: null } })],
  ]) {
    const total = await count(), current = await projection(); let changed = false;
    try { await rejects(reconcile({ ...base, getTransaction: async args => { if (!changed) { changed = true; await mutate(); } return base.getTransaction(args); } })); }
    finally { await restore(); }
    assert.equal(await count(), total); assert.deepEqual(await projection(), current);
  }
  const configured = process.env.HARTOLIT_PUBLISHER_USER_ID;
  delete process.env.HARTOLIT_PUBLISHER_USER_ID;
  await db.user.update({ where: { id: publisherId }, data: { banned: true } });
  try { assert.equal((await reconcile()).resultStatus, "VERIFIED"); }
  finally { process.env.HARTOLIT_PUBLISHER_USER_ID = configured; await db.user.update({ where: { id: publisherId }, data: { banned: false } }); }

  let finalizationFixture = { transactionId, hash };
  if (chain) {
    const tx = await base.getTransaction({ hash }), previous = await projection();
    assert.equal(await base.request({ method: "evm_revert", params: [resultFixture.snapshot] }), true);
    await base.request({ method: "anvil_mine", params: ["0x3"] });
    const reorg = await report({ ...base, getTransaction: async () => tx, getTransactionReceipt: async () => receipt });
    assert.equal(reorg.status, "REORG"); assert.equal(reorg.resultStatus, "SUSPENDED");
    assert.equal((await projection()).verifiedObservationId, previous.verifiedObservationId);
    assert.equal((await db.publicationMintObservation.findUniqueOrThrow({ where: { id: previous.verifiedObservationId } })).status, "VERIFIED");
    assert.equal((await reconcile()).resultStatus, "SUSPENDED", "removed branch cannot be selected through historical evidence");
    const snapshot = await base.request({ method: "evm_snapshot" });
    const replacement = await chain.send(command, 19_000_000_000n);
    assert.notEqual(replacement, hash); await base.waitForTransactionReceipt({ hash: replacement });
    await base.request({ method: "anvil_mine", params: ["0x2"] });
    const adopted = await report(base, replacement); assert.equal(adopted.status, "VERIFIED"); assert.equal(adopted.resultStatus, "SUSPENDED");
    const result = await reconcileMintResult(passportId, attemptId, { transactionId: adopted.matchedTransactionId }, base);
    assert.equal(result.resultStatus, "VERIFIED");
    assert.equal((await projection()).verifiedObservationId, result.observationId);
    assert.equal(JSON.parse((await db.publicationMintObservation.findUniqueOrThrow({ where: { id: result.observationId } })).resultJson).transactionHash, replacement);
    finalizationFixture = { transactionId: adopted.matchedTransactionId, hash: replacement, snapshot };
  }
  const current = await projection();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    const negative = await db.publicationMintObservation.findFirstOrThrow({ where: { attemptId, status: "UNKNOWN" } });
    for (const [query, values, code, constraint] of [
      ['UPDATE "PublicationMintResult" SET "verificationStatus" = NULL WHERE "attemptId" = $1', [attemptId], "23514", "PublicationMintResult_state_check"],
      ['UPDATE "PublicationMintResult" SET "checkedObservationId" = $2 WHERE "attemptId" = $1', [attemptId, negative.id], "23514", "PublicationMintResult_state_check"],
      ['UPDATE "PublicationMintResult" SET "checkedObservationId"=$2,"verifiedObservationId"=$2 WHERE "attemptId"=$1', [attemptId, negative.id], "23503", "PublicationMintResult_verifiedObservationId_attemptId_veri_fkey"],
    ]) {
      await client.query("BEGIN");
      try { await assert.rejects(client.query(query, values), error => error.code === code && error.constraint === constraint); }
      finally { await client.query("ROLLBACK"); }
    }
    // Construct only rolled-back foreign rows to test actual cross-attempt FK ownership.
    await client.query("BEGIN");
    try {
      const foreignAttempt = randomUUID(), foreignObservation = randomUUID();
      await client.query('INSERT INTO "PublicationMintAttempt" ("id","preparationId","requestId","chainId","publisherWallet","nonce","deadlineAt") VALUES ($1,$2,$3,97,$4,0,NOW()+INTERVAL \'5 minutes\')',
        [foreignAttempt, loser.preparationId, randomUUID(), `0x${"e".repeat(40)}`]);
      await client.query('INSERT INTO "PublicationMintObservation" ("id","attemptId","revision","status","resultJson") VALUES ($1,$2,1,\'UNKNOWN\',$3)',
        [foreignObservation, foreignAttempt, JSON.stringify({ version: 1, status: "UNKNOWN", issued: false, canResend: false })]);
      await assert.rejects(client.query('UPDATE "PublicationMintResult" SET "status"=\'SUSPENDED\',"checkedObservationId"=$2 WHERE "attemptId"=$1', [attemptId, foreignObservation]),
        error => error.code === "23503" && error.constraint === "PublicationMintResult_checkedObservationId_attemptId_fkey");
    } finally { await client.query("ROLLBACK"); }
  } finally { await client.end(); }
  assert.deepEqual(await projection(), current, "SQL failures preserve the current proof");
  const savedAttempt = await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  const checked = await db.publicationMintObservation.findUniqueOrThrow({ where: { id: current.checkedObservationId } });
  assert.equal(savedAttempt.observationVersion, checked.revision); assert.equal(savedAttempt.status, "UNKNOWN");
  const publication = await db.publication.findUniqueOrThrow({ where: { id: winner.publication.id } });
  assert.equal(publication.status, "CHAIN_PENDING"); assert.equal(publication.transactionHash, null); assert.equal(publication.tokenId, null);
  assert.equal(publication.contractAddress, null);
  let slotRpc = 0;
  await rejects(beginMintDispatch(publisherId, loser.passportId, { preparationId: loser.preparationId, requestId: randomUUID(),
    expectedIntentSha256: loser.intent.sha256, acknowledgement: "SEND_EXACT_MINT" }, loser.target,
  { ...base, getChainId: async () => { slotRpc++; throw new Error(); } }));
  assert.equal(slotRpc, 0, "even selected success never releases the wallet slot");
  const resultAudits = await db.auditLog.count({ where: { publicationId: winner.publication.id, action: "PUBLICATION_MINT_RESULT_CHECKED" } });
  assert.equal(resultAudits, await db.publicationMintObservation.count({ where: { attemptId, revision: { gte: unavailable.revision } } }));
  process.stdout.write(`Mint result passed: fresh persisted-candidate selection, atomic suspension/history, stale-read races, expiry, revoked-actor recovery and SQL ownership; no issuance or slot release (${chain ? "actual local-chain rollback/replacement and PostgreSQL" : "injected RPC and PostgreSQL"}).\n`);
  return finalizationFixture;
}
