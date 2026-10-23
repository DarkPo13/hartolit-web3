import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
import pg from "pg";
import { mintSearchFrame } from "./fixtures/mint-search.mjs";
import { tickMintMonitor } from "./smoke-publication-mint-monitor.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { getMintCancellationReview, closeCancelledMint } = await jiti.import("@/lib/publication/mint-cancellation-closure");
const { beginMintDispatch, recordUnknownMintOutcome } = await jiti.import("@/lib/publication/mint-dispatch");
const { observeMintAttempt, finalizeMintPublication, reconcileMintCancellation } = await jiti.import("@/lib/publication/mint-observation");
const { discoverMintTransaction } = await jiti.import("@/lib/publication/mint-discovery");
const { getMintFailureRecoveryReview } = await jiti.import("@/lib/publication/mint-recovery");
const rejects = (promise, status = 409) => assert.rejects(promise, error => error.status === status);
const dispatchInput = candidate => ({ preparationId: candidate.preparationId, requestId: randomUUID(), expectedIntentSha256: candidate.intent.sha256, acknowledgement: "SEND_EXACT_MINT" });
const input = review => ({ requestId: randomUUID(), discoveryId: review.discoveryId, expectedIntentSha256: review.intentSha256,
  expectedWalletStateSha256: review.walletStateSha256, expectedObservationVersion: review.observationVersion,
  expectedDiscoveryVersion: review.discoveryVersion, acknowledgement: "CLOSE_CANCELLED_MINT" });

/** Independent owned fixture; removes its attempts before the existing lifecycle
 * starts, so synthetic and actual histories are never mixed or left quarantined.
 */
export async function smokeMintCancellation({ db, publisherId, candidate, peer, probe, chain }) {
  const ownedAttempts = [];
  const preflight = chain?.reader ?? { getChainId: async () => 97, getCode: async () => "0x60006000",
    getBlock: async () => ({ number: 4n, hash: `0x${"a".repeat(64)}` }), getTransactionCount: async () => 7,
    readContract: async ({ functionName }) => ({ MINTER_ROLE: `0x${"b".repeat(64)}`, paused: false, hasRole: true, hashToTokenId: 0n })[functionName] };
  const snapshot = chain ? await chain.reader.request({ method: "evm_snapshot" }) : null;
  try {
    const command = await beginMintDispatch(publisherId, candidate.passportId, dispatchInput(candidate), candidate.target, preflight);
    const passportId = candidate.passportId, attemptId = command.attemptId; ownedAttempts.push(attemptId);
    const attempt = () => db.publicationMintAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const original = await attempt(), anchor = { number: original.dispatchBlockNumber, hash: original.dispatchBlockHash };
    const frame = mintSearchFrame(candidate.intent, original.nonce, { anchor, head: anchor.number + 3n, candidate: anchor.number + 1n, cancel: true });
    frame.tx.type = "legacy";
    const synthetic = { ...frame.reader,
      getBlock: async args => { const block = await frame.reader.getBlock(args); return args?.includeTransactions ? block : { ...block, transactions: block.transactions.map(tx => tx.hash) }; },
      getCode: async args => args.address === candidate.intent.contractAddress ? "0x60006000" : "0x",
      getTransactionReceipt: async () => ({ transactionHash: frame.tx.hash, blockHash: frame.tx.blockHash, blockNumber: frame.tx.blockNumber,
        transactionIndex: 0, from: frame.tx.from, to: frame.tx.to, contractAddress: null, status: "success", logs: [] }),
      readContract: preflight.readContract, getTransactionCount: async () => command.request.nonce + 1,
    };
    const base = chain?.reader ?? synthetic;
    let hash = frame.tx.hash;
    if (chain) { hash = await chain.cancel(command); await base.waitForTransactionReceipt({ hash }); await base.request({ method: "anvil_mine", params: ["0x2"] }); }
    await recordUnknownMintOutcome(passportId, attemptId);
    const conflict = await discoverMintTransaction(passportId, attemptId, {}, base);
    assert.equal(conflict.status, "CONFLICT"); assert.equal(conflict.transactionHash, hash);
    const review = () => getMintCancellationReview(publisherId, passportId, attemptId, conflict.discoveryId);
    const close = (body, reader = base, actor = publisherId) => closeCancelledMint(actor, passportId, attemptId, body, reader);
    const data = input(await review()); let rpc = 0;
    const offline = { ...base, getChainId: async () => { rpc++; throw new Error("fictional-private-cancellation-detail"); } };
    await rejects(close({ ...data, acknowledgement: "CLOSE_REVERTED_MINT" }, offline), 422);
    await rejects(close({ ...data, rpcUrl: "https://untrusted.example.invalid" }, offline), 422);
    await rejects(close(data, offline, "not-the-publisher"), 403);
    for (const patch of [{ expectedIntentSha256: "0".repeat(64) }, { expectedWalletStateSha256: "0".repeat(64) },
      { expectedObservationVersion: data.expectedObservationVersion + 1 }, { expectedDiscoveryVersion: data.expectedDiscoveryVersion + 1 }]) await rejects(close({ ...data, ...patch }, offline));
    assert.equal(rpc, 0);
    await rejects(close(data, offline), 503);
    await rejects(close(data, { ...base, getBlock: async () => ({ number: 0n, hash: `0x${"f".repeat(64)}` }) }), 503);
    await rejects(close(data, { ...base, getTransaction: async args => ({ ...await base.getTransaction(args), nonce: command.request.nonce + 1 }) }), 503);
    await rejects(close(data, { ...base, getTransaction: async args => ({ ...await base.getTransaction(args), blockNumber: null, blockHash: null }) }));
    const actor = await db.user.findUniqueOrThrow({ where: { id: publisherId } });
    for (const field of ["banned", "twoFactorEnabled", "role"]) {
      let changed = false;
      try { await rejects(close(data, { ...base, getChainId: async () => {
        if (!changed) { changed = true; await db.user.update({ where: { id: publisherId }, data: { [field]: field === "role" ? "user" : field === "banned" } }); }
        return base.getChainId();
      } }), 403); } finally { await db.user.update({ where: { id: publisherId }, data: { [field]: actor[field] } }); }
    }
    const configured = process.env.HARTOLIT_PUBLISHER_WALLET;
    try { await rejects(close(data, { ...base, getChainId: async () => { process.env.HARTOLIT_PUBLISHER_WALLET = `0x${"3".repeat(40)}`; return base.getChainId(); } }), 403); }
    finally { process.env.HARTOLIT_PUBLISHER_WALLET = configured; }
    let changed = false;
    try { await rejects(close(data, { ...base, getChainId: async () => {
      if (!changed) { changed = true; await db.publicSnapshotConfirmation.update({ where: { id: candidate.publication.confirmationId }, data: { invalidatedAt: new Date() } }); }
      return base.getChainId();
    } })); } finally { await db.publicSnapshotConfirmation.update({ where: { id: candidate.publication.confirmationId }, data: { invalidatedAt: null } }); }
    const originalNow = Date.now, now = originalNow(); Date.now = () => now;
    try { await rejects(close(data, { ...base, getChainId: async () => { Date.now = () => now + 16_000; return base.getChainId(); } })); }
    finally { Date.now = originalNow; }
    assert.equal(await db.publicationMintCancellation.count({ where: { attemptId } }), 0);
    assert.equal((await attempt()).status, "UNKNOWN");

    // A new search revision invalidates the old consent even for the same hash.
    await discoverMintTransaction(passportId, attemptId, {}, base); await rejects(close(data, offline));
    const latest = await db.publicationMintDiscovery.findFirstOrThrow({ where: { attemptId }, orderBy: { revision: "desc" } });
    const reviewed = input(await getMintCancellationReview(publisherId, passportId, attemptId, latest.id));
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const oldRead = observeMintAttempt(passportId, attemptId, { transactionHash: hash }, { ...base,
      getChainId: async () => { enter(); await gate; throw new Error(); } });
    await entered; let results;
    try { results = await Promise.all([close(reviewed), close(reviewed)]); } finally { release(); }
    assert.equal((await oldRead).status, "SUPERSEDED", "closure revision fences an older in-flight observer");
    assert.equal(results[0].cancellationId, results[1].cancellationId);
    assert.ok(results.every(row => row.status === "RECORDED" && !row.issued && !row.canResend && !row.currentlyQuarantined));
    const closed = await attempt(), journal = await db.publicationMintCancellation.findUniqueOrThrow({ where: { id: results[0].cancellationId } });
    const proof = await db.publicationMintObservation.findUniqueOrThrow({ where: { id: journal.observationId } });
    assert.equal(closed.status, "FAILED_TERMINAL"); assert.equal(closed.failureStatus, "CANCELLED"); assert.equal(closed.nonce, original.nonce);
    assert.equal(closed.failedObservationId, proof.id); assert.equal(proof.transactionId, null); assert.equal(proof.reportedHash, hash);
    assert.equal(journal.actorId, publisherId); assert.equal(journal.discoveryId, latest.id);
    assert.equal(await db.publicationMintTransaction.count({ where: { attemptId } }), 0);
    const publication = await db.publication.findUniqueOrThrow({ where: { id: candidate.publication.id } });
    assert.equal(publication.status, "CHAIN_FAILED"); assert.equal(publication.tokenId, null); assert.equal(publication.transactionHash, null); assert.equal(publication.contractAddress, null);
    assert.equal((await db.publicationMintResult.findUniqueOrThrow({ where: { attemptId } })).status, "SUSPENDED");
    assert.equal(await db.auditLog.count({ where: { publicationId: publication.id, action: "PUBLICATION_MINT_CANCELLED" } }), 1);
    assert.equal((await close(reviewed, offline)).cancellationId, journal.id);
    await rejects(close({ ...reviewed, requestId: randomUUID() }, offline));
    await rejects(recordUnknownMintOutcome(passportId, attemptId));
    await rejects(discoverMintTransaction(passportId, attemptId, {}, offline));
    await rejects(beginMintDispatch(publisherId, passportId, dispatchInput(candidate), candidate.target, offline));
    await rejects(finalizeMintPublication(passportId, attemptId, { transactionId: randomUUID() }, offline));
    await rejects(getMintFailureRecoveryReview(publisherId, passportId, attemptId));
    assert.equal((await tickMintMonitor(db, passportId, attemptId, base)).status, "CANCELLED");
    assert.equal((await attempt()).failedObservationId, proof.id);

    // A different passport gets a fresh higher nonce, not another old command.
    const next = await beginMintDispatch(publisherId, peer.passportId, dispatchInput(peer), peer.target, base);
    ownedAttempts.push(next.attemptId); assert.equal(next.request.nonce, command.request.nonce + 1);
    if (chain) { const sent = await chain.send(next); assert.equal((await base.waitForTransactionReceipt({ hash: sent })).status, "success"); }
    // Actual rollback removes the cancellation, but cannot reclaim a newer slot.
    const lost = chain ? (assert.equal(await base.request({ method: "evm_revert", params: [snapshot] }), true), base) : offline;
    await tickMintMonitor(db, passportId, attemptId, lost);
    const quarantined = await attempt(); assert.ok(quarantined.quarantinedAt); assert.equal(quarantined.failedObservationId, proof.id);
    assert.equal(quarantined.nonce, original.nonce); assert.equal(quarantined.failedAt.getTime(), closed.failedAt.getTime());
    assert.equal((await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: next.attemptId } })).status, "DISPATCHING");
    assert.equal((await db.publication.findUniqueOrThrow({ where: { id: publication.id } })).status, "CHAIN_FAILED_SUSPENDED");
    assert.equal((await close(reviewed, offline)).currentlyQuarantined, true);
    let blockedRpc = 0;
    await assert.rejects(beginMintDispatch(publisherId, probe.passportId, dispatchInput(probe), probe.target, { ...base,
      getChainId: async () => { blockedRpc++; throw new Error(); } }), error => error.status === 409 && error.message.includes("quarantined"));
    assert.equal(blockedRpc, 0, "cancelled-only quarantine blocks other passports before RPC");
    await rejects(reconcileMintCancellation(passportId, attemptId, { transactionHash: hash }, offline), 422);
    await rejects(observeMintAttempt(passportId, attemptId, { transactionHash: `0x${"f".repeat(64)}` }, offline));

    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 }); await client.connect();
    try {
      for (const [sql, values, code, constraint] of [
        ['UPDATE "PublicationMintCancellation" SET "proofStatus"=\'VERIFIED\' WHERE "id"=$1', [journal.id], "23514", "PublicationMintCancellation_shape_check"],
        ['UPDATE "PublicationMintCancellation" SET "discoveryStatus"=\'FOUND\' WHERE "id"=$1', [journal.id], "23514", "PublicationMintCancellation_shape_check"],
        ['UPDATE "PublicationMintCancellation" SET "observationId"=$2 WHERE "id"=$1', [journal.id, randomUUID()], "23503", "PublicationMintCancellation_proof_fkey"],
        ['UPDATE "PublicationMintCancellation" SET "discoveryId"=$2 WHERE "id"=$1', [journal.id, randomUUID()], "23503", "PublicationMintCancellation_discovery_fkey"],
        ['UPDATE "PublicationMintObservation" SET "transactionId"=$2 WHERE "id"=$1', [proof.id, randomUUID()], "23514", "PublicationMintObservation_cancellation_check"],
        ['UPDATE "PublicationMintAttempt" SET "failedObservationId"=NULL WHERE "id"=$1', [attemptId], "23514", "PublicationMintAttempt_shape_check"],
        ['UPDATE "PublicationMintAttempt" SET "nonce"=$2 WHERE "id"=$1', [next.attemptId, original.nonce.toString()], "23505", "PublicationMintAttempt_chainId_publisherWallet_nonce_key"],
      ]) {
        await client.query("BEGIN");
        try { await assert.rejects(client.query(sql, values), error => error.code === code && error.constraint === constraint); }
        finally { await client.query("ROLLBACK"); }
      }
    } finally { await client.end(); }
    process.stdout.write(`Cancellation closure passed: current MFA consent, exact anchored conflict/nonce/depth, stale authority/review refusal, atomic proof/journal, permanent nonce, higher next command and late quarantine (${chain ? "actual self-send, next mint and rollback" : "injected RPC"} plus PostgreSQL).\n`);
  } finally {
    // Only disposable fixture records are deleted; no business cleanup path exists.
    await db.$transaction(async tx => {
      const where = { attemptId: { in: ownedAttempts } };
      await tx.publicationMintCancellation.deleteMany({ where });
      await tx.publicationMintResult.deleteMany({ where });
      await tx.publicationMintDiscovery.deleteMany({ where });
      await tx.publicationMintObservation.deleteMany({ where });
      await tx.publicationMintTransaction.deleteMany({ where });
      await tx.publicationMintAttempt.deleteMany({ where: { id: { in: ownedAttempts } } });
    });
    await db.auditLog.deleteMany({ where: { publicationId: { in: [candidate.publication.id, peer.publication.id] } } });
    await db.publication.updateMany({ where: { id: { in: [candidate.publication.id, peer.publication.id] } }, data: { status: "PINNED" } });
  }
}
