import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { matchesOriginalMintReceipt } = await jiti.import("../lib/publication/mint-recovery.ts");
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
