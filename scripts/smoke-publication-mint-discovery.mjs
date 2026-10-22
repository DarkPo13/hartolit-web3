import assert from "node:assert/strict";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createJiti } from "jiti";
import pg from "pg";
import { mintSearchFrame } from "./fixtures/mint-search.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { discoverMintTransaction } = await jiti.import("../lib/publication/mint-discovery.ts");
const { observeMintAttempt } = await jiti.import("../lib/publication/mint-observation.ts");
const rejects = (promise, status = 409) => assert.rejects(promise, error => error.status === status);

export async function smokeMintDiscovery({ db, publisherId, dispatched, chain }) {
  const { winner, command } = dispatched, attemptId = command.attemptId, passportId = winner.passportId;
  const attempt = await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  const anchor = { number: attempt.dispatchBlockNumber, hash: attempt.dispatchBlockHash };
  assert.equal(await db.publicationMintTransaction.count({ where: { attemptId } }), 0);
  const frame = mintSearchFrame(winner.intent, attempt.nonce, { anchor, candidate: anchor.number + 35n });
  const discover = reader => discoverMintTransaction(passportId, attemptId, {}, reader ?? frame.reader);
  const count = () => db.publicationMintDiscovery.count({ where: { attemptId } });
  const saved = () => db.publicationMintAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  let rpc = 0;
  const offline = { ...frame.reader, getChainId: async () => { rpc++; throw new Error("fictional-private-provider-detail"); } };
  for (const input of [{ fromBlock: "0" }, { transactionHash: `0x${"a".repeat(64)}` }, { rpcUrl: "https://untrusted.example.invalid" }]) {
    await rejects(discoverMintTransaction(passportId, attemptId, input, offline), 422);
  }
  await db.publicationMintAttempt.update({ where: { id: attemptId }, data: { dispatchBlockNumber: null, dispatchBlockHash: null } });
  try { await rejects(discover(offline)); } finally { await db.publicationMintAttempt.update({ where: { id: attemptId }, data: { dispatchBlockNumber: anchor.number, dispatchBlockHash: anchor.hash } }); }
  assert.equal(rpc, 0, "never guess an anchor or use caller search bounds");
  assert.equal((await discover(offline)).status, "UNAVAILABLE"); assert.equal((await saved()).discoveryBlockNumber, null);
  const first = await discover(); assert.equal(first.status, "SCANNED"); assert.equal(first.scannedBlocks, 32);
  assert.equal((await saved()).discoveryBlockNumber, anchor.number + 32n);
  const reset = await discover({ ...frame.reader, getBlock: async args => args?.blockNumber === anchor.number + 32n
    ? { number: anchor.number + 32n, hash: `0x${"f".repeat(64)}` } : frame.reader.getBlock(args) });
  assert.equal(reset.status, "REORG"); assert.equal(reset.resetToDispatchAnchor, true); assert.equal((await saved()).discoveryBlockNumber, anchor.number);
  await discover();
  const found = await discover(); assert.equal(found.status, "FOUND"); assert.equal(found.transactionHash, frame.tx.hash);
  const adopted = await db.publicationMintTransaction.findUniqueOrThrow({ where: { id: found.matchedTransactionId } });
  assert.equal(adopted.nonce, attempt.nonce); assert.equal(adopted.attemptId, attemptId);
  assert.equal((await saved()).discoveryBlockNumber, anchor.number + 32n, "found block is not skipped on repeat or lost response");
  assert.equal(found.issued, false); assert.equal(found.canResend, false);
  const conflictFrame = mintSearchFrame(winner.intent, attempt.nonce, { anchor, candidate: anchor.number + 35n, cancel: true });
  const conflict = await discover(conflictFrame.reader); assert.equal(conflict.status, "CONFLICT"); assert.equal(conflict.matchedTransactionId, null);
  assert.equal(await db.publicationMintTransaction.count({ where: { attemptId } }), 1);
  const empty = mintSearchFrame(winner.intent, attempt.nonce, { anchor, head: anchor.number + 34n });
  assert.equal((await discover(empty.reader)).status, "CAUGHT_UP");
  const noNewBlocks = await discover(empty.reader); assert.equal(noNewBlocks.status, "CAUGHT_UP"); assert.equal(noNewBlocks.scannedBlocks, 0);

  // Search/search and search/observation races share the passport lock and revisions.
  for (const peer of ["search", "observation"]) {
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; }), waiting = new Promise(resolve => { entered = resolve; });
    const slow = discover({ ...frame.reader, getBlock: async args => { if (args?.includeTransactions) { entered(); await gate; } return frame.reader.getBlock(args); } });
    await waiting;
    if (peer === "search") assert.equal((await discover()).status, "FOUND");
    else await observeMintAttempt(passportId, attemptId, { transactionHash: null }, frame.reader);
    const atPeer = await count(); release();
    assert.equal((await slow).status, "SUPERSEDED"); assert.equal(await count(), atPeer);
  }
  let releaseObservation, enteredObservation;
  const observing = new Promise(resolve => { enteredObservation = resolve; }), observationGate = new Promise(resolve => { releaseObservation = resolve; });
  const slowObservation = observeMintAttempt(passportId, attemptId, { transactionHash: frame.tx.hash }, { ...frame.reader, getChainId: async () => {
    enteredObservation(); await observationGate; throw new Error();
  } });
  await observing; await discover();
  const observationCount = await db.publicationMintObservation.count({ where: { attemptId } }); releaseObservation();
  assert.equal((await slowObservation).status, "SUPERSEDED"); assert.equal(await db.publicationMintObservation.count({ where: { attemptId } }), observationCount);
  const total = await count(); let changed = false;
  try { await rejects(discover({ ...frame.reader, getBlock: async args => {
    if (args?.includeTransactions && !changed) { changed = true; await db.publicSnapshotConfirmation.update({ where: { id: winner.publication.confirmationId }, data: { invalidatedAt: new Date() } }); }
    return frame.reader.getBlock(args);
  } })); }
  finally { await db.publicSnapshotConfirmation.update({ where: { id: winner.publication.confirmationId }, data: { invalidatedAt: null } }); }
  assert.equal(await count(), total);
  const originalNow = Date.now, initialNow = originalNow();
  Date.now = () => initialNow;
  try { await rejects(discover({ ...frame.reader, getChainId: async () => { Date.now = () => initialNow + 16_000; return 97; } })); }
  finally { Date.now = originalNow; }
  assert.equal(await count(), total, "expired work makes no journal or progress writes");
  const originalCursor = (await saved()).discoveryBlockHash; let moved = false;
  try { await rejects(discover({ ...frame.reader, getBlock: async args => {
    if (args?.includeTransactions && !moved) { moved = true; await db.publicationMintAttempt.update({ where: { id: attemptId }, data: { discoveryBlockHash: `0x${randomBytes(32).toString("hex")}` } }); }
    return frame.reader.getBlock(args);
  } })); }
  finally { await db.publicationMintAttempt.update({ where: { id: attemptId }, data: { discoveryBlockHash: originalCursor } }); }
  assert.equal(await count(), total, "post-RPC cursor drift cannot commit a stale page");
  const configured = process.env.HARTOLIT_PUBLISHER_USER_ID;
  delete process.env.HARTOLIT_PUBLISHER_USER_ID; await db.user.update({ where: { id: publisherId }, data: { banned: true } });
  try { assert.equal((await discover()).status, "FOUND"); }
  finally { process.env.HARTOLIT_PUBLISHER_USER_ID = configured; await db.user.update({ where: { id: publisherId }, data: { banned: false } }); }

  if (chain) {
    assert.equal((await discover(chain.reader)).status, "REORG", "synthetic cursor does not authorize skipping actual chain history");
    const recovered = await discover(chain.reader); assert.equal(recovered.status, "FOUND"); assert.equal(recovered.transactionHash, dispatched.hash);
    const realTx = await chain.reader.getTransaction({ hash: recovered.transactionHash });
    assert.equal(realTx.nonce, command.request.nonce); assert.equal(realTx.input, command.request.data);
    assert.equal(await chain.reader.request({ method: "evm_revert", params: [dispatched.snapshot] }), true);
    const beforeCancel = await chain.reader.request({ method: "evm_snapshot" });
    const cancelHash = await chain.cancel(command); await chain.reader.waitForTransactionReceipt({ hash: cancelHash });
    const cancelled = await discover(chain.reader); assert.equal(cancelled.status, "CONFLICT"); assert.equal(cancelled.transactionHash, cancelHash);
    assert.equal(await db.publicationMintTransaction.count({ where: { attemptId, transactionHash: cancelHash } }), 0);
    assert.equal(await chain.reader.request({ method: "evm_revert", params: [beforeCancel] }), true);
    dispatched.snapshot = await chain.reader.request({ method: "evm_snapshot" });
    dispatched.hash = await chain.send(command, 13_000_000_000n); await chain.reader.waitForTransactionReceipt({ hash: dispatched.hash });
    const replacement = await discover(chain.reader); assert.equal(replacement.status, "FOUND"); assert.equal(replacement.transactionHash, dispatched.hash);
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    for (const [query, values, code, constraint] of [
      ['UPDATE "PublicationMintAttempt" SET "discoveryVersion"=-1 WHERE "id"=$1', [attemptId], "23514", "PublicationMintAttempt_discovery_check"],
      ['UPDATE "PublicationMintAttempt" SET "discoveryBlockNumber"="dispatchBlockNumber"-1 WHERE "id"=$1', [attemptId], "23514", "PublicationMintAttempt_discovery_check"],
      ['UPDATE "PublicationMintDiscovery" SET "scannedBlocks"=33 WHERE "id"=$1', [found.discoveryId], "23514", "PublicationMintDiscovery_page_check"],
      ['UPDATE "PublicationMintDiscovery" SET "transactionId"=NULL WHERE "id"=$1', [found.discoveryId], "23514", "PublicationMintDiscovery_page_check"],
      ['UPDATE "PublicationMintDiscovery" SET "transactionHash"=$2 WHERE "id"=$1', [found.discoveryId, `0x${randomBytes(32).toString("hex")}`], "23503", "PublicationMintDiscovery_transactionId_attemptId_transacti_fkey"],
    ]) {
      await client.query("BEGIN");
      try { await assert.rejects(client.query(query, values), error => error.code === code && error.constraint === constraint); }
      finally { await client.query("ROLLBACK"); }
    }
  } finally { await client.end(); }
  assert.equal(await count(), await db.auditLog.count({ where: { publicationId: winner.publication.id, action: "PUBLICATION_MINT_SEARCHED" } }));
  assert.equal((await saved()).status, "UNKNOWN");
  const publication = await db.publication.findUniqueOrThrow({ where: { id: winner.publication.id } });
  assert.equal(publication.status, "CHAIN_PENDING"); assert.equal(publication.transactionHash, null); assert.equal(publication.tokenId, null);
  process.stdout.write(`Mint discovery passed: saved anchors, paging/reset, exact nonce/call versus conflicts, durable candidates, bidirectional stale-read protection and SQL bounds/hash ownership (${chain ? "actual lost hash, rollback/cancellation/replacement and PostgreSQL" : "injected standard RPC and PostgreSQL"}). No resend or finalization.\n`);
}
