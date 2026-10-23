import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { createJiti } from "jiti";
import pg from "pg";
import { syntheticMintFrame } from "./smoke-publication-mint-observation.mjs";
import { tickMintMonitor } from "./smoke-publication-mint-monitor.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { beginMintDispatch } = await jiti.import("@/lib/publication/mint-dispatch");
const { observeMintAttempt, finalizeMintPublication } = await jiti.import("@/lib/publication/mint-observation");
const { getMintReanchorReview, adoptReincludedMintAnchor, getMintRecoveryReview, restoreOriginalMint } = await jiti.import("@/lib/publication/mint-recovery");
const { checkpointMintWallet } = await jiti.import("@/lib/publication/mint-checkpoint");
const { mintWalletHistory } = await jiti.import("@/lib/publication/mint-wallet");
const rejects = (promise, status = 409) => assert.rejects(promise, error => error.status === status);
const digits = digit => `0x${digit.repeat(64)}`;
const dispatchInput = candidate => ({ preparationId: candidate.preparationId, requestId: randomUUID(), expectedIntentSha256: candidate.intent.sha256, acknowledgement: "SEND_EXACT_MINT" });
const body = review => ({ requestId: randomUUID(), expectedIntentSha256: review.intentSha256, expectedWalletStateSha256: review.walletStateSha256,
  expectedFirstObservationId: review.firstObservationId, expectedAnchorObservationId: review.anchorObservationId,
  expectedObservationVersion: review.observationVersion, expectedQuarantinedAt: review.quarantinedAt, acknowledgement: "ADOPT_REINCLUDED_MINT_ANCHOR" });
const recoveryBody = review => ({ requestId: randomUUID(), expectedIntentSha256: review.intentSha256, expectedWalletStateSha256: review.walletStateSha256,
  expectedFinalizedObservationId: review.finalizedObservationId, expectedObservationVersion: review.observationVersion,
  expectedQuarantinedAt: review.quarantinedAt, acknowledgement: "RESTORE_ORIGINAL_MINT" });

/** Independent owned fixture: a finalized mint whose exact signed transaction is
 * re-included in another canonical block. Deletes its own attempts afterward and,
 * on actual Anvil, reverts to its starting snapshot so later stages are unaffected.
 */
export async function smokeMintReanchor({ db, publisherId, candidate, peer, chain }) {
  const owned = [], checkpoints = [];
  const preflight = { getChainId: async () => 97, getCode: async () => "0x60006000",
    getBlock: async () => ({ number: 4n, hash: digits("a") }), getTransactionCount: async () => 7,
    readContract: async ({ functionName }) => ({ MINTER_ROLE: digits("b"), paused: false, hasRole: true, hashToTokenId: 0n })[functionName] };
  const start = chain ? await chain.reader.request({ method: "evm_snapshot" }) : null;
  try {
    const command = await beginMintDispatch(publisherId, candidate.passportId, dispatchInput(candidate), candidate.target, chain?.reader ?? preflight);
    const passportId = candidate.passportId, attemptId = command.attemptId, nonce = command.request.nonce; owned.push(attemptId);
    const attempt = () => db.publicationMintAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const frame = options => syntheticMintFrame(candidate.intent, nonce, "0x60006000", hash, options).reader;
    let hash = `0x${randomBytes(32).toString("hex")}`, raw, branch;
    if (chain) {
      branch = await chain.reader.request({ method: "evm_snapshot" });
      raw = await chain.sign(command);
      hash = await chain.reader.request({ method: "eth_sendRawTransaction", params: [raw] });
      assert.equal((await chain.reader.waitForTransactionReceipt({ hash })).status, "success");
      await chain.reader.request({ method: "anvil_mine", params: ["0x2"] });
    }
    const first = chain?.reader ?? frame();
    const observed = await observeMintAttempt(passportId, attemptId, { transactionHash: hash }, first);
    assert.equal(observed.status, "VERIFIED");
    assert.equal((await finalizeMintPublication(passportId, attemptId, { transactionId: observed.matchedTransactionId }, first)).publicationStatus, "PUBLISHED");
    const original = await attempt();
    const firstProof = JSON.parse((await db.publicationMintObservation.findUniqueOrThrow({ where: { id: original.finalizedObservationId } })).resultJson);
    const publicBefore = await db.publication.findUniqueOrThrow({ where: { id: candidate.publication.id } });

    // Actual reorg: drop the branch, then the same signed bytes land one block later.
    if (chain) {
      assert.equal(await chain.reader.request({ method: "evm_revert", params: [branch] }), true);
      await chain.reader.request({ method: "anvil_mine", params: ["0x1"] });
      branch = await chain.reader.request({ method: "evm_snapshot" });
      assert.equal(await chain.reader.request({ method: "eth_sendRawTransaction", params: [raw] }), hash);
      await chain.reader.waitForTransactionReceipt({ hash });
      await chain.reader.request({ method: "anvil_mine", params: ["0x2"] });
    }
    const moved = chain?.reader ?? frame({ blockNumber: 6n, blockHash: digits("c"), head: { number: 8n, hash: digits("e") } });
    const review = () => getMintReanchorReview(publisherId, passportId, attemptId);
    const adopt = (input, reader = moved, actor = publisherId) => adoptReincludedMintAnchor(actor, passportId, attemptId, input, reader);
    await rejects(review());
    await tickMintMonitor(db, passportId, attemptId, moved);
    assert.ok((await attempt()).quarantinedAt, "a changed inclusion block quarantines the finalized mint");
    assert.equal((await db.publication.findUniqueOrThrow({ where: { id: candidate.publication.id } })).status, "CHAIN_SUSPENDED");
    await rejects(restoreOriginalMint(publisherId, passportId, attemptId, recoveryBody(await getMintRecoveryReview(publisherId, passportId, attemptId)), moved), 503); // first anchor block is no longer canonical

    const input = body(await review()); let calls = 0;
    assert.equal(input.expectedFirstObservationId, original.finalizedObservationId); assert.equal(input.expectedAnchorObservationId, original.finalizedObservationId);
    const offline = { ...moved, getChainId: async () => { calls++; throw new Error("fictional-private-reanchor-detail"); } };
    await rejects(adopt({ ...input, acknowledgement: "RESTORE_ORIGINAL_MINT" }, offline), 422);
    await rejects(adopt({ ...input, rpcUrl: "https://untrusted.example.invalid" }, offline), 422);
    await rejects(adopt(input, offline, "not-the-publisher"), 403);
    for (const patch of [{ expectedFirstObservationId: randomUUID() }, { expectedAnchorObservationId: randomUUID() }, { expectedIntentSha256: "0".repeat(64) },
      { expectedWalletStateSha256: "0".repeat(64) }, { expectedObservationVersion: input.expectedObservationVersion + 1 }]) await rejects(adopt({ ...input, ...patch }, offline));
    assert.equal(calls, 0, "stale or mismatched review is refused before RPC");
    await rejects(adopt(input, offline), 503);
    await rejects(adopt(input, { ...moved, getTransaction: async () => { const error = new Error(); error.name = "TransactionNotFoundError"; throw error; } }));
    if (!chain) {
      // Unchanged anchor belongs to restoration; changed outcome/token or shallow depth is never adopted.
      for (const options of [{}, { blockNumber: 6n, blockHash: digits("c"), head: { number: 8n, hash: digits("e") }, tokenId: 2n },
        { blockNumber: 6n, blockHash: digits("c"), head: { number: 8n, hash: digits("e") }, status: "reverted" },
        { blockNumber: 6n, blockHash: digits("c"), head: { number: 7n, hash: digits("d") } }]) await rejects(adopt(input, frame(options)));
    }
    const actor = await db.user.findUniqueOrThrow({ where: { id: publisherId } });
    for (const field of ["banned", "twoFactorEnabled", "role"]) {
      let changed = false;
      try { await rejects(adopt(input, { ...moved, getChainId: async () => {
        if (!changed) { changed = true; await db.user.update({ where: { id: publisherId }, data: { [field]: field === "role" ? "user" : field === "banned" } }); }
        return moved.getChainId();
      } }), 403); } finally { await db.user.update({ where: { id: publisherId }, data: { [field]: actor[field] } }); }
    }
    const originalNow = Date.now, now = originalNow(); Date.now = () => now;
    try { await rejects(adopt(input, { ...moved, getChainId: async () => { Date.now = () => now + 16_000; return moved.getChainId(); } })); }
    finally { Date.now = originalNow; }
    assert.equal(await db.publicationMintReanchor.count({ where: { attemptId } }), 0); assert.ok((await attempt()).quarantinedAt);

    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const stale = observeMintAttempt(passportId, attemptId, { transactionHash: hash }, { ...moved, getChainId: async () => { enter(); await gate; throw new Error(); } });
    await entered;
    const fresh = body(await review()); let results;
    try { results = await Promise.all([adopt(fresh), adopt(fresh)]); } finally { release(); }
    assert.equal((await stale).status, "SUPERSEDED");
    assert.ok(results.every(row => row.status === "RECORDED" && !row.currentlyQuarantined && !row.issued && !row.canResend));
    assert.equal(results[0].reanchorId, results[1].reanchorId);
    const journal = await db.publicationMintReanchor.findUniqueOrThrow({ where: { id: results[0].reanchorId } });
    const anchor = await db.publicationMintObservation.findUniqueOrThrow({ where: { id: journal.anchorObservationId } });
    const anchorProof = JSON.parse(anchor.resultJson), restored = await attempt();
    assert.equal(journal.proofStatus, "VERIFIED"); assert.equal(journal.finalizedObservationId, original.finalizedObservationId);
    assert.equal(journal.failedObservationId, null); assert.equal(journal.previousAnchorObservationId, null); assert.equal(journal.actorId, publisherId);
    assert.equal(anchor.status, "VERIFIED"); assert.equal(anchor.reportedHash, hash); assert.equal(anchor.transactionId, observed.matchedTransactionId);
    assert.equal(anchorProof.tokenId, firstProof.tokenId); assert.notEqual(anchorProof.blockHash, firstProof.blockHash);
    assert.equal(restored.status, "FINALIZED"); assert.equal(restored.finalizedObservationId, original.finalizedObservationId);
    assert.equal(restored.finalizedAt.getTime(), original.finalizedAt.getTime()); assert.equal(restored.anchorObservationId, anchor.id);
    assert.equal(restored.quarantinedAt, null); assert.equal(restored.nonce, original.nonce);
    const publication = await db.publication.findUniqueOrThrow({ where: { id: candidate.publication.id } });
    assert.equal(publication.status, "PUBLISHED");
    for (const field of ["transactionHash", "tokenId", "contractAddress"]) assert.equal(publication[field], publicBefore[field]);
    const projection = await db.publicationMintResult.findUniqueOrThrow({ where: { attemptId } });
    assert.equal(projection.status, "VERIFIED"); assert.equal(projection.verifiedObservationId, anchor.id);
    assert.equal(await db.auditLog.count({ where: { publicationId: candidate.publication.id, action: "PUBLICATION_MINT_REANCHORED" } }), 1);
    assert.equal((await adopt(fresh, offline)).reanchorId, journal.id);
    await rejects(adopt({ ...fresh, requestId: randomUUID() }, offline));

    // Later checks compare with the current anchor; the first proof stays history.
    assert.equal((await tickMintMonitor(db, passportId, attemptId, moved)).status, "VERIFIED");
    assert.equal((await attempt()).quarantinedAt, null, "the adopted anchor, not the first block, is monitored");
    await tickMintMonitor(db, passportId, attemptId, chain ? offline : first);
    assert.ok((await attempt()).quarantinedAt);
    const recovered = await restoreOriginalMint(publisherId, passportId, attemptId, recoveryBody(await getMintRecoveryReview(publisherId, passportId, attemptId)), moved);
    assert.equal(recovered.currentlyQuarantined, false, "unchanged-anchor restoration still works after re-inclusion");
    assert.equal((await db.publicationMintRecovery.findUniqueOrThrow({ where: { id: recovered.recoveryId } })).finalizedObservationId, original.finalizedObservationId);

    // Wallet checkpoint (D51): attests the current anchor, not the first block.
    const wallet = candidate.intent.publisherWallet, target = { chainId: 97, publisherWallet: wallet };
    const history = () => db.$transaction(tx => mintWalletHistory(tx, 97, wallet));
    const checkpoint = async reader => { const row = await checkpointMintWallet(target, reader); if (row.status === "CHECKPOINTED") checkpoints.push(row.checkpointId); return row; };
    await rejects(checkpointMintWallet({ ...target, fromNonce: 0 }, offline), 422);
    await rejects(checkpoint(offline), 503);
    const first1 = await checkpoint(moved);
    assert.equal(first1.status, "CHECKPOINTED"); assert.equal(first1.coveredCount, 1); assert.equal(first1.coveredThroughNonce, String(nonce));
    const cp1 = await db.publicationMintWalletCheckpoint.findUniqueOrThrow({ where: { id: first1.checkpointId } });
    assert.equal(cp1.blockHash, anchorProof.blockHash); assert.equal(cp1.blockNumber.toString(), anchorProof.blockNumber); assert.equal(cp1.baseCheckpointId, null);
    const compact = await history();
    assert.equal(compact.uncheckpointed, 0); assert.equal(compact.anchors.length, 1); assert.equal(compact.anchors[0].attemptId, null);
    assert.equal((await checkpoint(moved)).status, "CURRENT");

    // A covered quarantine still blocks the wallet; a checkpoint does not clear it.
    await tickMintMonitor(db, passportId, attemptId, offline);
    await rejects(history());
    assert.equal((await checkpoint(moved)).status, "CURRENT");
    assert.equal((await restoreOriginalMint(publisherId, passportId, attemptId,
      recoveryBody(await getMintRecoveryReview(publisherId, passportId, attemptId)), moved)).currentlyQuarantined, false);

    // A deeper reorg moves the covered transaction again: the checkpoint block is
    // no longer canonical, then the re-anchor makes it stale, and a new one starts over.
    if (chain) {
      assert.equal(await chain.reader.request({ method: "evm_revert", params: [branch] }), true);
      await chain.reader.request({ method: "anvil_mine", params: ["0x1"] });
      assert.equal(await chain.reader.request({ method: "eth_sendRawTransaction", params: [raw] }), hash);
      await chain.reader.waitForTransactionReceipt({ hash });
      await chain.reader.request({ method: "anvil_mine", params: ["0x2"] });
    }
    const third = chain?.reader ?? frame({ blockNumber: 9n, blockHash: digits("f"), head: { number: 11n, hash: digits("1") } });
    await rejects(checkpoint(third), 503);
    assert.equal(await db.publicationMintWalletCheckpoint.count({ where: { id: { in: checkpoints } } }), 1);
    await tickMintMonitor(db, passportId, attemptId, third);
    assert.ok((await attempt()).quarantinedAt);
    const second = await adoptReincludedMintAnchor(publisherId, passportId, attemptId, body(await getMintReanchorReview(publisherId, passportId, attemptId)), third);
    const secondJournal = await db.publicationMintReanchor.findUniqueOrThrow({ where: { id: second.reanchorId } });
    assert.equal(secondJournal.previousAnchorObservationId, anchor.id);
    await rejects(history(), 503);
    const fresh2 = await checkpoint(third);
    assert.equal(fresh2.status, "CHECKPOINTED"); assert.equal(fresh2.coveredCount, 1);
    const cp2 = await db.publicationMintWalletCheckpoint.findUniqueOrThrow({ where: { id: fresh2.checkpointId } });
    assert.equal(cp2.sequence, cp1.sequence + 1); assert.equal(cp2.baseCheckpointId, null, "a stale checkpoint is never a base");
    assert.notEqual(cp2.blockHash, cp1.blockHash);
    assert.equal((await history()).uncheckpointed, 0);

    // Another passport's permission verifies the wallet through the checkpoint.
    const next = await beginMintDispatch(publisherId, peer.passportId, dispatchInput(peer), peer.target, chain?.reader ??
      { ...third, getTransactionCount: async () => nonce + 1, readContract: preflight.readContract });
    owned.push(next.attemptId); assert.equal(next.request.nonce, nonce + 1);

    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 }); await client.connect();
    try {
      for (const [sql, values, code, constraint] of [
        ['UPDATE "PublicationMintReanchor" SET "failedObservationId"="finalizedObservationId" WHERE "id"=$1', [journal.id], "23514", "PublicationMintReanchor_shape_check"],
        ['UPDATE "PublicationMintReanchor" SET "anchorObservationId"="finalizedObservationId" WHERE "id"=$1', [journal.id], "23514", "PublicationMintReanchor_shape_check"],
        ['UPDATE "PublicationMintReanchor" SET "anchorObservationId"=$2 WHERE "id"=$1', [journal.id, randomUUID()], "23503", "PublicationMintReanchor_anchor_proof_fkey"],
        ['UPDATE "PublicationMintReanchor" SET "transactionHash"=$2 WHERE "id"=$1', [journal.id, digits("9")], "23503", ["PublicationMintReanchor_first_success_proof_fkey", "PublicationMintReanchor_anchor_proof_fkey"]],
        ['UPDATE "PublicationMintReanchor" SET "finalizedObservationId"=$2 WHERE "id"=$1', [journal.id, anchor.id], "23514", "PublicationMintReanchor_shape_check"],
        ['UPDATE "PublicationMintReanchor" SET "previousAnchorObservationId"=$2 WHERE "id"=$1', [journal.id, randomUUID()], "23503", "PublicationMintReanchor_previous_fkey"],
        ['UPDATE "PublicationMintAttempt" SET "anchorObservationId"="finalizedObservationId" WHERE "id"=$1', [attemptId], "23514", "PublicationMintAttempt_anchor_check"],
        ['UPDATE "PublicationMintAttempt" SET "anchorObservationId"=$2 WHERE "id"=$1', [attemptId, randomUUID()], "23503", "PublicationMintAttempt_anchor_fkey"],
        ['UPDATE "PublicationMintAttempt" SET "anchorObservationId"=$2 WHERE "id"=$1', [next.attemptId, anchor.id], "23514", "PublicationMintAttempt_anchor_check"],
        ['UPDATE "PublicationMintWalletCheckpoint" SET "confirmations"=1 WHERE "id"=$1', [cp2.id], "23514", "PublicationMintWalletCheckpoint_shape_check"],
        ['UPDATE "PublicationMintWalletCheckpoint" SET "headBlockNumber"="blockNumber" - 1 WHERE "id"=$1', [cp2.id], "23514", "PublicationMintWalletCheckpoint_shape_check"],
        ['UPDATE "PublicationMintWalletCheckpoint" SET "publisherWallet"=$2 WHERE "id"=$1', [cp2.id, `0x${"0".repeat(40)}`], "23514", "PublicationMintWalletCheckpoint_shape_check"],
        ['UPDATE "PublicationMintWalletCheckpoint" SET "baseCheckpointId"=$2 WHERE "id"=$1', [cp2.id, randomUUID()], "23503", "PublicationMintWalletCheckpoint_base_fkey"],
        ['UPDATE "PublicationMintWalletCheckpoint" SET "sequence"=$2 WHERE "id"=$1', [cp2.id, cp1.sequence], "23505", "PublicationMintWalletCheckpoint_chainId_publisherWallet_seq_key"],
      ]) {
        await client.query("BEGIN");
        try {
          await client.query("SET CONSTRAINTS ALL IMMEDIATE");
          await assert.rejects(client.query(sql, values), error => error.code === code && [constraint].flat().includes(error.constraint));
        } finally { await client.query("ROLLBACK"); }
      }
    } finally { await client.end(); }
    process.stdout.write(`Mint re-inclusion passed: separate MFA review, same transaction/outcome/token at a new canonical block, refused unchanged/changed/shallow/missing proof, atomic journal with immutable first proof, anchor-based monitoring/restoration, wallet checkpoint use/staleness/restart and next permission (${chain ? "actual signed re-broadcast after rollback" : "injected RPC"} plus PostgreSQL).\n`);
  } finally {
    // Only disposable fixture records are deleted; no business cleanup path exists.
    for (const id of checkpoints.reverse()) await db.publicationMintWalletCheckpoint.delete({ where: { id } });
    await db.$transaction(async tx => {
      const where = { attemptId: { in: owned } };
      await tx.publicationMintRecovery.deleteMany({ where });
      await tx.publicationMintReanchor.deleteMany({ where });
      await tx.publicationMintResult.deleteMany({ where });
      await tx.publicationMintDiscovery.deleteMany({ where });
      await tx.publicationMintObservation.deleteMany({ where });
      await tx.publicationMintTransaction.deleteMany({ where });
      await tx.publicationMintAttempt.deleteMany({ where: { id: { in: owned } } });
    });
    await db.auditLog.deleteMany({ where: { publicationId: { in: [candidate.publication.id, peer.publication.id] } } });
    await db.publication.updateMany({ where: { id: { in: [candidate.publication.id, peer.publication.id] } },
      data: { status: "PINNED", contractAddress: null, transactionHash: null, tokenId: null } });
    if (chain) assert.equal(await chain.reader.request({ method: "evm_revert", params: [start] }), true);
  }
}
