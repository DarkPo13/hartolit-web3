import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createJiti } from "jiti";
import { mintSearchFrame } from "../scripts/fixtures/mint-search.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { searchMintPage } = await jiti.import("../lib/publication/mint-search.ts");
const intent = { chainId: 97, publisherWallet: `0x${"1".repeat(40)}`, contractAddress: `0x${"2".repeat(40)}`, data: "0xabcd" };
const anchor = { number: 5n, hash: `0x${"a".repeat(64)}` }, nonce = 7n;
const search = (frame, cursor = anchor) => searchMintPage(intent, nonce, anchor, cursor, frame.reader);

test("mint search pages from a saved anchor and distinguishes exact calls from nonce conflicts", async () => {
  const frame = mintSearchFrame(intent, nonce, { anchor, candidate: 40n });
  const first = await search(frame); assert.equal(first.status, "SCANNED"); assert.equal(first.scannedBlocks, 32); assert.equal(first.throughBlock, 37n);
  const second = await search(frame, { number: first.throughBlock, hash: first.throughBlockHash });
  assert.equal(second.status, "FOUND"); assert.equal(second.transactionHash, frame.tx.hash); assert.equal(second.throughBlock, 40n);
  const conflict = await search(mintSearchFrame(intent, nonce, { anchor, candidate: 6n, cancel: true }));
  assert.equal(conflict.status, "CONFLICT");
  const wrongNonce = await search(mintSearchFrame(intent, nonce + 1n, { anchor, candidate: 6n }));
  assert.equal(wrongNonce.status, "SCANNED"); assert.equal(wrongNonce.transactionHash, null);
  const caught = await search(mintSearchFrame(intent, nonce, { anchor, head: anchor.number }));
  assert.equal(caught.status, "CAUGHT_UP"); assert.equal(caught.scannedBlocks, 0); assert.equal(caught.fromBlock, null);
});

test("mint search rejects malformed blocks, unstable branches and inconsistent candidate lookups", async () => {
  const frame = mintSearchFrame(intent, nonce, { anchor, candidate: 6n }), base = frame.reader;
  for (const reader of [
    { ...base, getChainId: async () => 56 },
    { ...base, getBlock: async args => { const block = await base.getBlock(args); return args?.includeTransactions ? { ...block, transactions: [frame.tx.hash] } : block; } },
    { ...base, getBlock: async args => { const block = await base.getBlock(args); return args?.includeTransactions ? { ...block, parentHash: `0x${"f".repeat(64)}` } : block; } },
    { ...base, getTransaction: async () => ({ ...frame.tx, nonce: 8 }) },
  ]) assert.equal((await search({ reader })).status, "UNAVAILABLE");
  const cursor = { number: 37n, hash: `0x${"b".repeat(64)}` };
  const reset = await search(frame, cursor); assert.equal(reset.status, "REORG"); assert.equal(reset.resetToDispatchAnchor, true);
  const originChanged = await search({ reader: { ...base, getBlock: async args => args?.blockNumber === anchor.number
    ? { number: anchor.number, hash: `0x${"f".repeat(64)}` } : base.getBlock(args) } });
  assert.equal(originChanged.status, "REORG"); assert.equal(originChanged.resetToDispatchAnchor, false);
  let headReads = 0;
  const changedHead = await search({ reader: { ...base, getBlock: async args => {
    const block = await base.getBlock(args);
    return args?.blockNumber === 45n && ++headReads ? { ...block, hash: `0x${"f".repeat(64)}` } : block;
  } } });
  assert.equal(changedHead.status, "REORG"); assert.equal(changedHead.transactionHash, null);
});

test("mint search bounds transaction work and expires an unresponsive RPC", async () => {
  const frame = mintSearchFrame(intent, nonce, { anchor, candidate: 6n });
  const oversized = await search({ reader: { ...frame.reader, getBlock: async args => {
    const block = await frame.reader.getBlock(args);
    return args?.includeTransactions ? { ...block, transactions: Array(2049).fill(frame.tx) } : block;
  } } });
  assert.equal(oversized.status, "UNAVAILABLE"); assert.equal(oversized.scannedBlocks, 0);
  const bounded = await search({ reader: { ...frame.reader, getBlock: async args => {
    const block = await frame.reader.getBlock(args);
    return args?.includeTransactions ? { ...block, transactions: Array.from({ length: 129 }, (_, index) => ({ ...frame.tx,
      hash: `0x${(Number(block.number) * 1000 + index).toString(16).padStart(64, "0")}`, from: `0x${"f".repeat(40)}`, nonce: index,
      blockNumber: block.number, blockHash: block.hash, transactionIndex: index })) } : block;
  } } });
  assert.equal(bounded.status, "UNAVAILABLE"); assert.equal(bounded.scannedTransactions, 0);
  const started = Date.now();
  const timeout = await search({ reader: { ...frame.reader, getChainId: () => new Promise(() => {}) } });
  assert.equal(timeout.status, "UNAVAILABLE"); assert.ok(Date.now() - started < 15_000);
});
