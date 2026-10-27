import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createHash } from "node:crypto";
import { createJiti } from "jiti";
import { keccak256 } from "viem";
import { fictionalChainSnapshot } from "../scripts/fixtures/public-chain.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { inspectMintCancellation } = await jiti.import("../lib/publication/mint-cancellation.ts");
const { createMintIntent } = await jiti.import("../lib/publication/chain-mint.ts");
const { canonicalize } = await jiti.import("../lib/hash.ts");
const { rawCidFromSha256 } = await jiti.import("../lib/publication/raw-cid.ts");
const address = digit => `0x${digit.repeat(40)}`, hash = digit => `0x${digit.repeat(64)}`;
const code = "0x60006000", txHash = hash("a"), blockHash = hash("b"), headHash = hash("c");
const canonicalJson = canonicalize(fictionalChainSnapshot("f837b2a1-9401-4fd8-860c-aa02d7d3fe49"));
const payloadHash = createHash("sha256").update(canonicalJson).digest("hex");
const intent = await createMintIntent({ chainId: 97, contractAddress: address("1"), publisherWallet: address("2"), recipientWallet: address("3"),
  contractCodeHash: keccak256(code), requiredConfirmations: 3 }, { canonicalJson, payloadHash, ipfsCid: rawCidFromSha256(payloadHash) });
const tx = { hash: txHash, chainId: 97, type: "legacy", from: intent.publisherWallet, to: intent.publisherWallet, value: 0n, input: "0x",
  nonce: 7, blockNumber: 5n, blockHash, transactionIndex: 0 };
const receipt = { transactionHash: txHash, blockNumber: 5n, blockHash, transactionIndex: 0, from: tx.from, to: tx.to,
  status: "success", contractAddress: null, logs: [] };
const included = { number: 5n, hash: blockHash, transactions: [txHash] }, head = { number: 7n, hash: headHash, transactions: [] };
const reader = (patch = {}) => ({ getChainId: async () => 97, getTransaction: async () => tx, getTransactionReceipt: async () => receipt,
  getBlock: async args => args?.blockNumber === 5n ? included : head,
  getCode: async args => args.address === intent.contractAddress ? code : undefined, readContract: async () => 0n, ...patch });
const inspect = value => inspectMintCancellation(intent, txHash, 7n, reader(value));
const reject = promise => assert.rejects(promise, error => error.message === "Chain data is unavailable or does not match the mint commitment");
const notFound = name => async () => { throw Object.assign(new Error("fictional-private-provider-detail"), { name }); };

test("cancellation requires the saved intent, exact nonce and a plain zero-value self-send", async () => {
  let calls = 0;
  const offline = reader({ getChainId: async () => { calls++; throw new Error(); } });
  for (const [value, hashValue, nonce] of [[{ ...intent, recipientWallet: address("4") }, txHash, 7n], [intent, "invalid", 7n],
    [intent, { toString: () => txHash }, 7n], [intent, txHash, -1n], [intent, txHash, BigInt(Number.MAX_SAFE_INTEGER) + 1n]]) await reject(inspectMintCancellation(value, hashValue, nonce, offline));
  assert.equal(calls, 0);
  for (const patch of [{ hash: hash("d") }, { chainId: 56 }, { from: address("4") }, { to: address("4") }, { to: null },
    { to: intent.contractAddress, input: intent.data }, { value: 1n }, { input: "0x00" }, { nonce: 8 }, { nonce: -1 },
    { nonce: Number.MAX_SAFE_INTEGER + 1 }, { type: "eip7702" }, { authorizationList: [{}] }]) {
    await reject(inspect({ getTransaction: async () => ({ ...tx, ...patch }) }));
  }
  for (const type of ["legacy", "eip2930", "eip1559"]) assert.equal((await inspect({ getTransaction: async () => ({ ...tx, type }) })).status, "CANCELLED");
});

test("confirmed cancellation binds canonical membership, empty EOA code and absent mint at inclusion/head", async () => {
  const result = await inspect();
  assert.equal(result.status, "CANCELLED"); assert.equal(result.nonce, "7"); assert.equal(result.confirmations, "3");
  assert.equal(result.headBlockNumber, "7"); assert.equal(result.headBlockHash, headHash);
  assert.equal(result.intentSha256, intent.sha256); assert.equal(result.issued, false); assert.equal(result.canResend, false);
  for (const patch of [{ transactionHash: hash("d") }, { blockNumber: 6n }, { blockHash: hash("d") }, { transactionIndex: 1 },
    { from: address("4") }, { to: address("4") }, { status: "reverted" }, { contractAddress: address("4") }, { logs: [{}] }]) {
    await reject(inspect({ getTransactionReceipt: async () => ({ ...receipt, ...patch }) }));
  }
  for (const transactions of [[], [hash("d")], Array(2049).fill(txHash)]) await reject(inspect({
    getBlock: async args => args?.blockNumber === 5n ? { ...included, transactions } : head,
  }));
  for (const at of [4n, 5n, 7n]) await reject(inspect({ getCode: async args => args.address === intent.contractAddress ? code : args.blockNumber === at ? "0xef0100" : "0x" }));
  for (const at of [5n, 7n]) {
    await reject(inspect({ getCode: async args => args.address === intent.contractAddress ? args.blockNumber === at ? "0x6001" : code : "0x" }));
    await reject(inspect({ readContract: async args => args.blockNumber === at ? 1n : 0n }));
  }
});

test("missing, pending, shallow, changed and unavailable cancellation never authorize retry", async () => {
  for (const [status, patch] of [["UNKNOWN", { getTransaction: notFound("TransactionNotFoundError") }],
    ["UNKNOWN", { getTransactionReceipt: notFound("TransactionReceiptNotFoundError") }],
    ["PENDING", { getTransaction: async () => ({ ...tx, blockNumber: null, blockHash: null }) }],
    ["CONFIRMING", { getBlock: async () => included }],
    ["REORG", { getBlock: async args => args?.blockNumber === 5n ? { ...included, hash: hash("d") } : head }]]) {
    const result = await inspect(patch); assert.equal(result.status, status); assert.equal(result.canResend, false); assert.equal(result.issued, false);
  }
  for (const patch of [{ getChainId: async () => 56 }, { getBlock: notFound("ProviderUnavailableError") },
    { readContract: notFound("ProviderUnavailableError") }]) await reject(inspect(patch));
  for (const field of ["blockHash", "transactionHash", "transactionIndex", "status"]) {
    let reads = 0;
    const result = await inspect({ getTransactionReceipt: async () => ++reads === 1 ? receipt : { ...receipt,
      [field]: field === "transactionIndex" ? 1 : field === "status" ? "reverted" : hash("d") } });
    assert.equal(result.status, "REORG");
  }
  let reads = 0;
  assert.equal((await inspect({ getBlock: async args => args?.blockNumber === 5n ? ++reads === 1 ? included : { ...included, transactions: [] } : head })).status, "REORG");
  let chainReads = 0;
  assert.equal((await inspect({ getChainId: async () => ++chainReads === 1 ? 97 : 56 })).status, "REORG");
  assert.equal((await inspect({ getBlock: async args => args?.blockNumber === 7n ? { ...head, hash: hash("d") } : args?.blockNumber === 5n ? included : head })).status, "REORG");
  assert.equal((await inspect({ getBlock: notFound("BlockNotFoundError") })).status, "REORG");
});

test("re-checking a closed cancellation needs no pruned inclusion state; the first closure still does (D76)", async () => {
  // Public nodes answer "missing trie node" for state older than their window; head is block 7.
  const pruned = fn => async args => { if (args.blockNumber !== 7n) throw new Error("missing trie node"); return fn(args); };
  const base = reader(), late = patch => inspectMintCancellation(intent, txHash, 7n, reader(patch), { closedProof: true });
  const prunedNode = { getCode: pruned(base.getCode), readContract: pruned(base.readContract) };
  await reject(inspect(prunedNode));
  assert.equal((await late(prunedNode)).status, "CANCELLED");
  // A later mint of the same facts (publishing the record again, D74) does not break the closed proof.
  assert.equal((await late({ readContract: async () => 1n })).status, "CANCELLED");
  // Head code, membership and the exact log-free self-send still bind it.
  await reject(late({ getCode: async args => args.address === intent.contractAddress ? code : args.blockNumber === 7n ? "0xef0100" : "0x" }));
  await reject(late({ getCode: async args => args.address === intent.contractAddress ? args.blockNumber === 7n ? "0x6001" : code : "0x" }));
  await reject(late({ getTransactionReceipt: async () => ({ ...receipt, logs: [{}] }) }));
  await reject(late({ getBlock: async args => args?.blockNumber === 5n ? { ...included, transactions: [hash("d")] } : head }));
});

test("cancellation RPC calls share the cumulative deadline without exposing provider details", async t => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  await reject(inspect({ getChainId: async () => { now = 20_001; return 97; } }));
});
