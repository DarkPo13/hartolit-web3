import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { mintWalletHistory, verifyMintWalletAnchors, finalizedMintReceipt } = await jiti.import("../lib/publication/mint-wallet.ts");
const hash = digit => `0x${digit.repeat(64)}`;
const receipt = { version: 1, status: "VERIFIED", issued: false, canResend: false, transactionHash: hash("a"),
  blockHash: hash("b"), blockNumber: "5", contractAddress: `0x${"1".repeat(40)}`, intentSha256: "c".repeat(64), tokenId: "1", confirmations: "3" };
const observation = { status: "VERIFIED", transactionId: "fictional-matched-transaction", reportedHash: hash("a"), resultJson: JSON.stringify(receipt) };
const rows = [{ id: "fictional-attempt", nonce: 7n, observationVersion: 3, finalizedAt: new Date("2026-10-22T10:00:00Z"),
  quarantinedAt: null, finalizedObservation: observation }];
const transaction = selected => ({ $queryRaw: async () => [], publicationMintAttempt: { findMany: async () => selected } });

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
