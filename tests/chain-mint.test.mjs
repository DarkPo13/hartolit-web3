import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createHash } from "node:crypto";
import { createJiti } from "jiti";
import { encodeAbiParameters, encodeEventTopics, decodeFunctionData, keccak256 } from "viem";
import { fictionalChainSnapshot } from "../scripts/fixtures/public-chain.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { createMintIntent, mintTransactionRequest, inspectMintReadiness, inspectMintTransaction } = await jiti.import("../lib/publication/chain-mint.ts");
const { canonicalize } = await jiti.import("../lib/hash.ts");
const { HARTOLIT_PASSPORT_ABI: abi } = await jiti.import("../lib/contract.ts");
const { rawCidFromSha256 } = await jiti.import("../lib/publication/raw-cid.ts");
const address = digit => `0x${digit.repeat(40)}`, hash = digit => `0x${digit.repeat(64)}`;
const code = "0x60006000", txHash = hash("a"), blockHash = hash("b"), headHash = hash("c");
const target = { chainId: 97, contractAddress: address("1"), publisherWallet: address("2"), recipientWallet: address("3"),
  contractCodeHash: keccak256(code), requiredConfirmations: 3 };
const snapshot = fictionalChainSnapshot("f837b2a1-9401-4fd8-860c-aa02d7d3fe49");
function block(value = snapshot) {
  const canonicalJson = canonicalize(value), payloadHash = createHash("sha256").update(canonicalJson).digest("hex");
  return { canonicalJson, payloadHash, ipfsCid: rawCidFromSha256(payloadHash) };
}
const intent = await createMintIntent(target, block());
const tx = { hash: txHash, chainId: 97, from: target.publisherWallet, to: target.contractAddress, input: intent.data, value: 0n,
  blockNumber: 5n, blockHash, transactionIndex: 0 };
const event = {
  address: target.contractAddress, blockNumber: 5n, blockHash, transactionHash: txHash, transactionIndex: 0, logIndex: 0, removed: false,
  topics: encodeEventTopics({ abi, eventName: "PassportMinted", args: { tokenId: 1n, mintedBy: target.publisherWallet, to: target.recipientWallet } }),
  data: encodeAbiParameters([{ type: "bytes32" }, { type: "string" }], [`0x${intent.payloadHash}`, `ipfs://${intent.ipfsCid}`]),
};
const receipt = { transactionHash: txHash, blockNumber: 5n, blockHash, transactionIndex: 0,
  from: target.publisherWallet, to: target.contractAddress, status: "success", logs: [event] };
function reader(patch = {}) {
  return {
    getChainId: async () => 97, getTransaction: async () => tx, getTransactionReceipt: async () => receipt,
    getCode: async () => code,
    getBlock: async args => args?.blockNumber === 5n ? { number: 5n, hash: blockHash } : { number: 7n, hash: headHash },
    readContract: async ({ functionName }) => ({ MINTER_ROLE: hash("e"), paused: false, hasRole: true,
      ownerOf: target.recipientWallet, tokenURI: `ipfs://${intent.ipfsCid}`, payloadHash: `0x${intent.payloadHash}`, hashToTokenId: 1n })[functionName],
    ...patch,
  };
}
const rejects = promise => assert.rejects(promise, error => error.message === "Chain data is unavailable or does not match the mint commitment");

test("mint intent binds only strict public bytes and exact zero-value calldata", async () => {
  assert.ok(Object.isFrozen(intent));
  const request = await mintTransactionRequest(intent);
  assert.ok(Object.isFrozen(request));
  assert.deepEqual(request, { chainId: 97, from: target.publisherWallet, to: target.contractAddress, data: intent.data, value: "0" });
  const decoded = decodeFunctionData({ abi, data: intent.data });
  assert.equal(decoded.functionName, "mintPassport");
  assert.equal(decoded.args[0].toLowerCase(), target.recipientWallet);
  assert.deepEqual(decoded.args.slice(1), [`0x${intent.payloadHash}`, `ipfs://${intent.ipfsCid}`]);
  for (const patch of [{ chainId: 56 }, { recipientWallet: address("0") }, { requiredConfirmations: 1 }, { extra: "private" }]) {
    await rejects(createMintIntent({ ...target, ...patch }, block()));
  }
  await rejects(createMintIntent(target, block({ ...snapshot, privateFarmerId: "fictional-private" })));
  await rejects(createMintIntent(target, { ...block(), canonicalJson: `${block().canonicalJson}\n` }));
  await rejects(createMintIntent(target, { ...block(), ipfsCid: rawCidFromSha256("0".repeat(64)) }));
  let calls = 0;
  await rejects(inspectMintTransaction({ ...intent, recipientWallet: address("4") }, txHash, reader({ getChainId: async () => { calls++; return 97; } })));
  assert.equal(calls, 0, "a changed intent never reaches RPC");
});

test("receipt requires exact transaction, contract event and anchored state", async () => {
  const verified = await inspectMintTransaction(intent, txHash, reader());
  assert.equal(verified.status, "VERIFIED"); assert.equal(verified.tokenId, "1"); assert.equal(verified.issued, false); assert.equal(verified.canResend, false);
  for (const patch of [{ from: address("4") }, { to: address("4") }, { value: 1n }, { input: `${intent.data}00` }, { chainId: 56 }, { hash: hash("d") }]) {
    await rejects(inspectMintTransaction(intent, txHash, reader({ getTransaction: async () => ({ ...tx, ...patch }) })));
  }
  for (const log of [{ ...event, removed: true }, { ...event, address: address("4") }, { ...event, blockHash: hash("d") },
    { ...event, transactionHash: hash("d") }, { ...event, data: encodeAbiParameters([{ type: "bytes32" }, { type: "string" }], [hash("d"), `ipfs://${intent.ipfsCid}`]) }]) {
    await rejects(inspectMintTransaction(intent, txHash, reader({ getTransactionReceipt: async () => ({ ...receipt, logs: [log] }) })));
  }
  await rejects(inspectMintTransaction(intent, txHash, reader({ getTransactionReceipt: async () => ({ ...receipt, logs: [event, event] }) })));
  for (const [name, wrong] of [["ownerOf", address("4")], ["tokenURI", "ipfs://wrong"], ["payloadHash", hash("d")], ["hashToTokenId", 2n]]) {
    const original = reader();
    await rejects(inspectMintTransaction(intent, txHash, reader({ readContract: async args => args.functionName === name ? wrong : original.readContract(args) })));
  }
  await rejects(inspectMintTransaction(intent, txHash, reader({ getChainId: async () => 56 })));
  await rejects(inspectMintTransaction(intent, txHash, reader({ getCode: async () => "0x6001" })));
  await rejects(inspectMintTransaction(intent, txHash, reader({ getBlock: async () => { throw new Error("fictional-private-provider-detail"); } })));
});

test("a durable attempt also requires the exact observed nonce before any receipt or pending adoption", async () => {
  const observed = reader({ getTransaction: async () => ({ ...tx, nonce: 7 }) });
  assert.equal((await inspectMintTransaction(intent, txHash, observed, 7n)).status, "VERIFIED");
  for (const nonce of [8, -1, Number.MAX_SAFE_INTEGER + 1]) {
    await rejects(inspectMintTransaction(intent, txHash, reader({ getTransaction: async () => ({ ...tx, nonce }) }), 7n));
    await rejects(inspectMintTransaction(intent, txHash, reader({ getTransaction: async () => ({ ...tx, nonce, blockNumber: null, blockHash: null }) }), 7n));
  }
  await rejects(inspectMintTransaction(intent, txHash, observed, -1n));
});

test("pending, missing, confirming, reverted and reorg results never grant a retry", async () => {
  const cases = [
    ["PENDING", { getTransaction: async () => ({ ...tx, blockNumber: null, blockHash: null }) }],
    ["UNKNOWN", { getTransactionReceipt: async () => { throw Object.assign(new Error(), { name: "TransactionReceiptNotFoundError" }); } }],
    ["CONFIRMING", { getBlock: async () => ({ number: 5n, hash: blockHash }) }],
    ["REVERTED", { getTransactionReceipt: async () => ({ ...receipt, status: "reverted", logs: [] }) }],
    ["REORG", { getBlock: async args => args?.blockNumber === 5n ? { number: 5n, hash: hash("d") } : { number: 7n, hash: headHash } }],
  ];
  for (const [expected, patch] of cases) {
    const result = await inspectMintTransaction(intent, txHash, reader(patch));
    assert.equal(result.status, expected); assert.equal(result.issued, false); assert.equal(result.canResend, false); assert.equal(result.tokenId, undefined);
  }
  let reads = 0;
  const changed = await inspectMintTransaction(intent, txHash, reader({ getBlock: async args => args?.blockNumber === 5n ?
    { number: 5n, hash: ++reads > 1 ? hash("d") : blockHash } : { number: 7n, hash: headHash } }));
  assert.equal(changed.status, "REORG");
  for (const [expected, paused, authorized, indexedId] of [["READY", false, true, 0n], ["PAUSED", true, true, 0n],
    ["UNAUTHORIZED", false, false, 0n], ["ALREADY_MINTED", false, true, 1n]]) {
    const original = reader();
    const result = await inspectMintReadiness(intent, reader({ readContract: async args => ({ paused, hasRole: authorized, hashToTokenId: indexedId })[args.functionName] ?? original.readContract(args) }));
    assert.equal(result.status, expected); assert.equal(result.issued, false); assert.equal(result.canResend, false);
  }
});
