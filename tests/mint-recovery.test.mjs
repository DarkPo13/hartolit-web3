import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { matchesOriginalMintReceipt, matchesReincludedMintReceipt } = await jiti.import("../lib/publication/mint-recovery.ts");
const hash = value => `0x${value.repeat(64)}`;
const failed = { status: "REVERTED", transactionHash: hash("a"), blockHash: hash("b"), blockNumber: "5",
  contractAddress: `0x${"c".repeat(40)}`, intentSha256: "d".repeat(64), confirmations: "3" };

test("recovery preserves the original success or failure, inclusion anchor and attested depth", () => {
  assert.equal(matchesOriginalMintReceipt(failed, { ...failed, confirmations: "4" }), true);
  for (const patch of [{ status: "VERIFIED", tokenId: "1" }, { status: "CONFIRMING" }, { status: "UNKNOWN" },
    { transactionHash: hash("e") }, { blockHash: hash("f") }, { blockNumber: "6" }, { confirmations: "2" },
    { intentSha256: "e".repeat(64) }, { contractAddress: `0x${"e".repeat(40)}` }]) {
    assert.equal(matchesOriginalMintReceipt(failed, { ...failed, ...patch }), false);
  }
  const success = { ...failed, status: "VERIFIED", tokenId: "1" };
  assert.equal(matchesOriginalMintReceipt(success, { ...success, confirmations: "4" }), true);
  assert.equal(matchesOriginalMintReceipt(success, { ...success, tokenId: "2" }), false);
  assert.equal(matchesOriginalMintReceipt(success, failed), false);
});

test("cancellation recovery requires the same self-send proof, nonce and wallet", () => {
  const cancelled = { ...failed, status: "CANCELLED", proofKind: "CANCELLATION", nonce: "7", publisherWallet: `0x${"9".repeat(40)}`,
    headBlockNumber: "7", headBlockHash: hash("e") };
  assert.equal(matchesOriginalMintReceipt(cancelled, { ...cancelled, confirmations: "4", headBlockNumber: "8", headBlockHash: hash("f") }), true);
  for (const patch of [{ nonce: "8" }, { publisherWallet: `0x${"8".repeat(40)}` }, { status: "REVERTED" }, { status: "CONFIRMING" },
    { status: "UNKNOWN" }, { status: "REORG" }, { blockHash: hash("f") }, { confirmations: "2" }, { transactionHash: hash("e") }]) {
    assert.equal(matchesOriginalMintReceipt(cancelled, { ...cancelled, ...patch }), false);
  }
  assert.equal(matchesOriginalMintReceipt(failed, cancelled), false);
  assert.equal(matchesOriginalMintReceipt(cancelled, failed), false);
});

test("re-inclusion adopts only the same transaction and outcome at a new block, at least as deep", () => {
  const success = { ...failed, status: "VERIFIED", tokenId: "1" }, moved = { blockNumber: "6", blockHash: hash("e"), confirmations: "3" };
  assert.equal(matchesReincludedMintReceipt(success, success, { ...success, ...moved }), true);
  assert.equal(matchesReincludedMintReceipt(failed, failed, { ...failed, ...moved }), true);
  assert.equal(matchesReincludedMintReceipt(success, success, { ...success, blockHash: hash("e") }), true, "same height on another branch");
  for (const patch of [{}, { confirmations: "2" }, { tokenId: "2" }, { status: "REVERTED", tokenId: undefined }, { transactionHash: hash("f") },
    { contractAddress: `0x${"e".repeat(40)}` }, { intentSha256: "e".repeat(64) }, { status: "CONFIRMING" }, { status: "UNKNOWN" }]) {
    assert.equal(matchesReincludedMintReceipt(success, success, { ...success, ...moved, ...patch, ...(Object.keys(patch).length ? {} : { blockNumber: "5", blockHash: hash("b") }) }), false);
  }
  assert.equal(matchesReincludedMintReceipt(failed, failed, { ...success, ...moved }), false, "a failed send never becomes success");
  const cancelled = { ...failed, status: "CANCELLED", nonce: "7", publisherWallet: `0x${"9".repeat(40)}` };
  assert.equal(matchesReincludedMintReceipt(cancelled, cancelled, { ...cancelled, ...moved }), true);
  for (const patch of [{ nonce: "8" }, { publisherWallet: `0x${"8".repeat(40)}` }]) {
    assert.equal(matchesReincludedMintReceipt(cancelled, cancelled, { ...cancelled, ...moved, ...patch }), false);
  }
  const anchor = { ...success, ...moved, confirmations: "5" };
  assert.equal(matchesReincludedMintReceipt(success, anchor, { ...success, blockNumber: "7", blockHash: hash("c"), confirmations: "4" }), false,
    "a replacement anchor cannot be shallower than the anchor it replaces");
});
