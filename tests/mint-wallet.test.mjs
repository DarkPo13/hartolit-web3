import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { mintWalletHistory, verifyMintWalletAnchors, finalizedMintReceipt, failedMintReceipt } = await jiti.import("../lib/publication/mint-wallet.ts");
const hash = digit => `0x${digit.repeat(64)}`;
const receipt = { version: 1, status: "VERIFIED", issued: false, canResend: false, transactionHash: hash("a"),
  blockHash: hash("b"), blockNumber: "5", contractAddress: `0x${"1".repeat(40)}`, intentSha256: "c".repeat(64), tokenId: "1", confirmations: "3" };
const observation = { status: "VERIFIED", transactionId: "fictional-matched-transaction", reportedHash: hash("a"), resultJson: JSON.stringify(receipt) };
const rows = [{ id: "fictional-attempt", status: "FINALIZED", nonce: 7n, observationVersion: 3, finalizedAt: new Date("2026-10-22T10:00:00Z"),
  quarantinedAt: null, finalizedObservation: observation }];
// Fictional transaction double for the wallet-state queries: the latest
// checkpoint, rows after it, whole-wallet quarantine and checkpoint counts.
const transaction = (selected, { checkpoint = null, closed = 0, open = 0, reanchors = 0, onQuery = () => {} } = {}) => ({ $queryRaw: async () => [],
  publicationMintWalletCheckpoint: { findFirst: async () => checkpoint },
  publicationMintReanchor: { count: async () => reanchors },
  publicationMintAttempt: {
    count: async args => args.where.status.in ? closed : open,
    findMany: async args => { onQuery(args.where);
      return args.where.quarantinedAt ? selected.filter(row => row.quarantinedAt) : selected; },
  } });

test("wallet history rejects quarantine, malformed proof and oversized histories without truncation", async () => {
  const healthy = await mintWalletHistory(transaction(rows), 97, `0x${"2".repeat(40)}`);
  assert.equal(healthy.anchors[0].nonce, 7n); assert.equal(healthy.anchors[0].receipt.blockHash, hash("b"));
  await assert.rejects(mintWalletHistory(transaction([{ ...rows[0], quarantinedAt: new Date() }]), 97, "fictional-wallet"), error => error.status === 409);
  await assert.rejects(mintWalletHistory(transaction(Array.from({ length: 65 }, () => rows[0])), 97, "fictional-wallet"), error => error.status === 503);
  for (const patch of [{ status: "UNKNOWN" }, { transactionId: null }, { reportedHash: hash("d") },
    { resultJson: JSON.stringify({ ...receipt, confirmations: "0" }) }]) {
    assert.throws(() => finalizedMintReceipt({ ...observation, ...patch }), error => error.status === 409);
  }
});

test("released wallet receipts require stable canonical blocks and at least their original depth", async () => {
  const anchors = [{ attemptId: "fictional-attempt", nonce: 7n, receipt }];
  const reader = { getChainId: async () => 97,
    getBlock: async args => args?.blockNumber === 5n ? { number: 5n, hash: hash("b") } : { number: 7n, hash: hash("c") } };
  assert.deepEqual(await verifyMintWalletAnchors(anchors, reader), { number: 7n, hash: hash("c") });
  for (const patch of [
    { getChainId: async () => 56 },
    { getBlock: async () => ({ number: 6n, hash: hash("b") }) },
    { getBlock: async args => args?.blockNumber === 5n ? { number: 5n, hash: hash("d") } : reader.getBlock(args) },
    { getBlock: async args => args?.blockNumber === undefined ? { number: 6n, hash: hash("c") } : reader.getBlock(args) },
    { getBlock: async args => args?.blockNumber === 7n ? { number: 7n, hash: hash("d") } : reader.getBlock(args) },
    { getBlock: async () => { throw new Error("fictional-private-provider-detail"); } },
  ]) await assert.rejects(verifyMintWalletAnchors(anchors, { ...reader, ...patch }),
    error => error.status === 503 && !error.message.includes("fictional-private"));
});

test("closed reverted sends retain canonical nonce anchors and independently quarantine the wallet", async () => {
  const { tokenId: ignored, ...failure } = { ...receipt, status: "REVERTED" }; void ignored;
  const failedObservation = { ...observation, status: "REVERTED", resultJson: JSON.stringify(failure) };
  const failed = { ...rows[0], status: "FAILED_TERMINAL", finalizedAt: null, finalizedObservation: null,
    failedAt: new Date("2026-10-22T10:00:00Z"), failedObservation };
  const queried = [];
  const active = { ...rows[0], id: "fictional-active", status: "DISPATCHING", nonce: 8n, finalizedAt: null, finalizedObservation: null };
  const history = await mintWalletHistory(transaction([failed, active], { onQuery: where => queried.push(where) }), 97, "fictional-wallet");
  assert.deepEqual(queried[0], { chainId: 97, publisherWallet: "fictional-wallet" }, "no checkpoint means the whole wallet history");
  assert.equal(history.anchors.length, 1, "open attempts are never anchors"); assert.equal(history.uncheckpointed, 1);
  assert.equal(history.anchors[0].receipt.status, "REVERTED"); assert.equal(history.anchors[0].nonce, 7n);
  assert.equal(failedMintReceipt(failedObservation).blockHash, receipt.blockHash);
  for (const patch of [{ status: "VERIFIED" }, { transactionId: null }, { reportedHash: hash("d") }, { resultJson: JSON.stringify({ ...failure, tokenId: "1" }) }]) {
    assert.throws(() => failedMintReceipt({ ...failedObservation, ...patch }), error => error.status === 409);
  }
  await assert.rejects(mintWalletHistory(transaction([{ ...failed, quarantinedAt: new Date() }]), 97, "fictional-wallet"), error => error.status === 409);
});

test("closed cancellation proofs retain the exact nonce/wallet without becoming matched mint transactions", async () => {
  const { tokenId: ignored, ...base } = receipt; void ignored;
  const publisherWallet = `0x${"2".repeat(40)}`;
  const cancellation = { ...base, status: "CANCELLED", proofKind: "CANCELLATION", nonce: "7", publisherWallet,
    headBlockNumber: "7", headBlockHash: hash("c") };
  const proof = { ...observation, status: "CANCELLED", transactionId: null, resultJson: JSON.stringify(cancellation) };
  const row = { ...rows[0], status: "FAILED_TERMINAL", publisherWallet, finalizedObservation: null, failedObservation: proof };
  assert.equal(failedMintReceipt(proof).status, "CANCELLED");
  const history = await mintWalletHistory(transaction([row]), 97, publisherWallet);
  assert.equal(history.anchors[0].nonce, 7n); assert.equal(history.anchors[0].receipt.status, "CANCELLED");
  for (const patch of [{ transactionId: "fictional-mint-transaction" }, { reportedHash: hash("d") },
    { resultJson: JSON.stringify({ ...cancellation, headBlockNumber: "6" }) }, { resultJson: JSON.stringify({ ...cancellation, tokenId: "1" }) }]) {
    assert.throws(() => failedMintReceipt({ ...proof, ...patch }), error => error.status === 409);
  }
  for (const patch of [{ nonce: 8n }, { publisherWallet: `0x${"3".repeat(40)}` }, { quarantinedAt: new Date() }]) {
    await assert.rejects(mintWalletHistory(transaction([{ ...row, ...patch }]), 97, publisherWallet), error => error.status === 409);
  }
});

test("a current checkpoint replaces covered anchors; stale checkpoints and covered quarantine fail closed", async () => {
  const checkpoint = { id: "fictional-checkpoint", chainId: 97, publisherWallet: "fictional-wallet", sequence: 2, coveredThroughNonce: 70n,
    coveredCount: 64, coveredReanchorCount: 1, blockNumber: 40n, blockHash: hash("e"), confirmations: 3 };
  const after = { ...rows[0], nonce: 71n }, queried = [];
  const history = await mintWalletHistory(transaction([after], { checkpoint, closed: 64, reanchors: 1, onQuery: where => queried.push(where) }), 97, "fictional-wallet");
  assert.deepEqual(queried[0].nonce, { gt: 70n }, "only proofs after the checkpoint are loaded");
  assert.equal(history.uncheckpointed, 1); assert.equal(history.anchors.length, 2);
  assert.deepEqual(history.anchors[0], { attemptId: null, nonce: 70n, receipt: { blockNumber: "40", blockHash: hash("e"), confirmations: "3" } });
  for (const counts of [{ closed: 63, reanchors: 1 }, { closed: 64, reanchors: 2 }, { closed: 64, reanchors: 1, open: 1 }]) {
    await assert.rejects(mintWalletHistory(transaction([after], { checkpoint, ...counts }), 97, "fictional-wallet"),
      error => error.status === 503 && /stale/.test(error.message));
  }
  // The quarantine query spans the whole wallet, including covered attempts.
  const covered = { ...rows[0], id: "fictional-covered", nonce: 3n, quarantinedAt: new Date() }, quarantineQueries = [];
  await assert.rejects(mintWalletHistory(transaction([after, covered], { checkpoint, closed: 64, reanchors: 1,
    onQuery: where => { if (where.quarantinedAt) quarantineQueries.push(where); } }), 97, "fictional-wallet"), error => error.status === 409);
  assert.equal(quarantineQueries[0].nonce, undefined);
});
