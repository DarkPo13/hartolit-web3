// Isolated local chain only. No fork, provider account, DB or app server.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createJiti } from "jiti";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, encodeFunctionData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { fictionalChainSnapshot } from "./fixtures/public-chain.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { createMintIntent, mintTransactionRequest, inspectMintReadiness, inspectMintTransaction } = await jiti.import("../lib/publication/chain-mint.ts");
const { inspectMintCancellation } = await jiti.import("../lib/publication/mint-cancellation.ts");
const { canonicalize } = await jiti.import("../lib/hash.ts");
const { rawCidFromSha256 } = await jiti.import("../lib/publication/raw-cid.ts");
const artifact = JSON.parse(await readFile(new URL("../contracts/out/HartolitFieldPassport.sol/HartolitFieldPassport.json", import.meta.url), "utf8"));
const { abi } = artifact;
const bytecode = `0x${artifact.bytecode.object.replace(/^0x/, "")}`;
const runtime = `0x${artifact.deployedBytecode.object.replace(/^0x/, "")}`;
const listener = net.createServer();
await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const node = spawn(process.env.ANVIL_BIN || "anvil", ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "97", "--accounts", "0", "--hardfork", "cancun"],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
node.stderr.on("data", () => {});
let readyTimer;
try {
  await new Promise((resolve, reject) => {
    let output = "";
    readyTimer = setTimeout(() => reject(new Error("Owned local Anvil did not start")), 15_000);
    node.once("error", () => reject(new Error("Anvil unavailable; set ANVIL_BIN or install Foundry")));
    node.once("exit", () => reject(new Error("Owned local Anvil exited before readiness")));
    node.stdout.on("data", chunk => { output = (output + chunk.toString()).slice(-8192); if (output.includes(`Listening on 127.0.0.1:${port}`)) resolve(); });
  });
  clearTimeout(readyTimer);
  // RPC is used only after this exact child confirms its own loopback listener.
  const url = `http://127.0.0.1:${port}`;
  const chain = defineChain({ id: 97, name: "Fictional local BSC chain", nativeCurrency: { name: "Test", symbol: "TEST", decimals: 18 }, rpcUrls: { default: { http: [url] } } });
  const transport = () => http(url, { timeout: 5_000, retryCount: 0 });
  const reader = createPublicClient({ chain, transport: transport() });
  assert.equal(await reader.getChainId(), 97);
  assert.match(await reader.request({ method: "web3_clientVersion" }), /anvil/i);
  // Ephemeral test key stays only in this process; never in app/server env or logs.
  const account = privateKeyToAccount(generatePrivateKey());
  const wallet = createWalletClient({ account, chain, transport: transport() });
  await reader.request({ method: "anvil_setBalance", params: [account.address, "0x56bc75e2d63100000"] });
  const deployed = await reader.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi, bytecode, args: [account.address] }) });
  assert.equal(deployed.status, "success"); assert.ok(deployed.contractAddress);
  const address = deployed.contractAddress;
  assert.equal(await reader.getCode({ address }), runtime, "compiled runtime equals actual deployed code");
  const target = { chainId: 97, contractAddress: address, contractCodeHash: keccak256(runtime), publisherWallet: account.address,
    recipientWallet: account.address, requiredConfirmations: 3 };
  const make = async (patch = {}) => {
    const canonicalJson = canonicalize(fictionalChainSnapshot(randomUUID()));
    const payloadHash = createHash("sha256").update(canonicalJson).digest("hex");
    return createMintIntent({ ...target, ...patch }, { canonicalJson, payloadHash, ipfsCid: rawCidFromSha256(payloadHash) });
  };
  const mine = blocks => reader.request({ method: "anvil_mine", params: [`0x${blocks.toString(16)}`] });
  const send = async value => {
    const request = await mintTransactionRequest(value);
    assert.equal(request.from, account.address.toLowerCase()); assert.equal(request.chainId, chain.id);
    return wallet.sendTransaction({ to: request.to, data: request.data, value: BigInt(request.value), gas: 500_000n });
  };
  const denied = promise => assert.rejects(promise, e => e.message === "Chain data is unavailable or does not match the mint commitment");
  const value = await make();
  assert.equal((await inspectMintReadiness(value, reader)).status, "READY");
  const stranger = privateKeyToAccount(generatePrivateKey()).address;
  assert.equal((await inspectMintReadiness(await make({ publisherWallet: stranger }), reader)).status, "UNAUTHORIZED");
  await denied(inspectMintReadiness(await make({ contractCodeHash: `0x${"0".repeat(64)}` }), reader));
  await denied(inspectMintReadiness(value, { ...reader, getChainId: async () => 56 }));
  const snapshot = await reader.request({ method: "evm_snapshot" });
  await reader.request({ method: "evm_setAutomine", params: [false] });
  const hash = await send(value);
  assert.equal((await inspectMintTransaction(value, hash, reader)).status, "PENDING");
  await mine(1);
  assert.equal((await inspectMintTransaction(value, hash, reader)).status, "CONFIRMING");
  await mine(2);
  const verified = await inspectMintTransaction(value, hash, reader);
  assert.equal(verified.status, "VERIFIED"); assert.equal(verified.tokenId, "1"); assert.equal(verified.confirmations, "3");
  assert.equal(verified.issued, false); assert.equal(verified.canResend, false);
  assert.equal(await reader.readContract({ abi, address, functionName: "ownerOf", args: [1n] }), account.address);
  assert.equal(await reader.readContract({ abi, address, functionName: "payloadHash", args: [1n] }), `0x${value.payloadHash}`);
  assert.equal((await inspectMintReadiness(value, reader)).status, "ALREADY_MINTED");
  // A duplicate transaction is sent deliberately only on this disposable local chain.
  await reader.request({ method: "evm_setAutomine", params: [true] });
  const duplicate = await send(value); await reader.waitForTransactionReceipt({ hash: duplicate }); await mine(2);
  assert.equal((await inspectMintTransaction(value, duplicate, reader)).status, "REVERTED");
  assert.equal(await reader.readContract({ abi, address, functionName: "totalMinted" }), 1n);
  const oldTx = await reader.getTransaction({ hash }), oldReceipt = await reader.getTransactionReceipt({ hash });
  assert.equal(await reader.request({ method: "evm_revert", params: [snapshot] }), true);
  const vanished = await inspectMintTransaction(value, hash, reader);
  assert.ok(["UNKNOWN", "PENDING"].includes(vanished.status)); assert.equal(vanished.canResend, false);
  await reader.request({ method: "anvil_dropTransaction", params: [hash] });
  await mine(4);
  const stale = await inspectMintTransaction(value, hash, { ...reader, getTransaction: async () => oldTx, getTransactionReceipt: async () => oldReceipt });
  assert.equal(stale.status, "REORG", "actual new branch rejects cached old receipt");
  assert.equal(await reader.readContract({ abi, address, functionName: "totalMinted" }), 0n);
  await reader.request({ method: "evm_setAutomine", params: [true] });
  await reader.waitForTransactionReceipt({ hash: await wallet.writeContract({ abi, address, functionName: "pause" }) });
  const paused = await make(); assert.equal((await inspectMintReadiness(paused, reader)).status, "PAUSED");
  const reverted = await send(paused); await reader.waitForTransactionReceipt({ hash: reverted }); await mine(2);
  assert.equal((await inspectMintTransaction(paused, reverted, reader)).status, "REVERTED");
  await reader.waitForTransactionReceipt({ hash: await wallet.writeContract({ abi, address, functionName: "unpause" }) });
  const wrongRecipient = await make();
  const wrongHash = await wallet.sendTransaction({ to: address, data: encodeFunctionData({ abi, functionName: "mintPassport",
    args: [stranger, `0x${wrongRecipient.payloadHash}`, `ipfs://${wrongRecipient.ipfsCid}`] }), gas: 500_000n });
  await reader.waitForTransactionReceipt({ hash: wrongHash }); await mine(2);
  await denied(inspectMintTransaction(wrongRecipient, wrongHash, reader));
  const wrongTx = await reader.getTransaction({ hash: wrongHash });
  await denied(inspectMintTransaction(wrongRecipient, wrongHash, { ...reader, getTransaction: async () => ({ ...wrongTx, input: wrongRecipient.data }) }));
  const extraCalldata = await make();
  const extraHash = await wallet.sendTransaction({ to: address, data: `${extraCalldata.data}00`, gas: 500_000n });
  assert.equal((await reader.waitForTransactionReceipt({ hash: extraHash })).status, "success", "Solidity accepts trailing calldata");
  await mine(2);
  await denied(inspectMintTransaction(extraCalldata, extraHash, reader));
  assert.equal((await inspectMintTransaction(value, `0x${"f".repeat(64)}`, reader)).status, "UNKNOWN");
  const cancellation = await make(), cancellationNonce = await reader.getTransactionCount({ address: account.address, blockTag: "latest" });
  const beforeCancellation = await reader.request({ method: "evm_snapshot" });
  await reader.request({ method: "evm_setAutomine", params: [false] });
  // This test-only self-send is never constructed or broadcast by the app.
  const cancelHash = await wallet.sendTransaction({ to: account.address, data: "0x", value: 0n, nonce: cancellationNonce, gas: 21_000n });
  const inspectCancel = (client = reader) => inspectMintCancellation(cancellation, cancelHash, BigInt(cancellationNonce), client);
  assert.equal((await inspectCancel()).status, "PENDING");
  await mine(1); assert.equal((await inspectCancel()).status, "CONFIRMING");
  await mine(2); const cancelled = await inspectCancel();
  assert.equal(cancelled.status, "CANCELLED"); assert.equal(cancelled.confirmations, "3");
  assert.equal(cancelled.canResend, false); assert.equal(cancelled.issued, false);
  await denied(inspectMintCancellation(cancellation, cancelHash, BigInt(cancellationNonce + 1), reader));
  await denied(inspectMintCancellation(extraCalldata, extraHash, BigInt((await reader.getTransaction({ hash: extraHash })).nonce), reader));
  const cancelTx = await reader.getTransaction({ hash: cancelHash }), cancelReceipt = await reader.getTransactionReceipt({ hash: cancelHash });
  assert.equal(await reader.request({ method: "evm_revert", params: [beforeCancellation] }), true);
  assert.ok(["UNKNOWN", "PENDING"].includes((await inspectCancel()).status));
  await reader.request({ method: "anvil_dropTransaction", params: [cancelHash] });
  await mine(4);
  assert.equal((await inspectCancel({ ...reader, getTransaction: async () => cancelTx, getTransactionReceipt: async () => cancelReceipt })).status, "REORG");
  process.stdout.write("Local chain smoke passed: actual deployment/code, exact mint, pending/depth, duplicate/revert/pause, wrong recipient, lost chain branch/stale receipt and exact self-send cancellation/depth/rollback. No public network, slot release or issued app certificate.\n");
} finally {
  clearTimeout(readyTimer);
  if (node.pid && node.exitCode === null && node.signalCode === null) { const exited = once(node, "exit"); node.kill(); await exited; }
}
