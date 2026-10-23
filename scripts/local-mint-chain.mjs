// Test-only owned local chain. No fork, public RPC or application signing key.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { createPublicClient, createWalletClient, defineChain, http, keccak256 } from "viem";

export async function localMintChain(account) {
  const artifact = JSON.parse(await readFile(new URL("../contracts/out/HartolitFieldPassport.sol/HartolitFieldPassport.json", import.meta.url), "utf8"));
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const node = spawn(process.env.ANVIL_BIN || "anvil", ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "97", "--accounts", "0", "--hardfork", "cancun"],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  node.stderr.on("data", () => {});
  const stop = async () => {
    if (node.pid && node.exitCode === null && node.signalCode === null) { const exited = once(node, "exit"); node.kill(); await exited; }
  };
  let timer;
  try {
    await new Promise((resolve, reject) => {
      let output = "";
      timer = setTimeout(() => reject(new Error("Owned local Anvil startup timed out")), 15_000);
      node.once("error", () => reject(new Error("Anvil unavailable; set ANVIL_BIN")));
      node.once("exit", () => reject(new Error("Owned local Anvil exited before readiness")));
      node.stdout.on("data", chunk => { output = (output + chunk.toString()).slice(-8192); if (output.includes(`Listening on 127.0.0.1:${port}`)) resolve(); });
    });
    clearTimeout(timer);
    const url = `http://127.0.0.1:${port}`;
    const chain = defineChain({ id: 97, name: "Fictional local BSC chain", nativeCurrency: { name: "Test", symbol: "TEST", decimals: 18 }, rpcUrls: { default: { http: [url] } } });
    const reader = createPublicClient({ chain, transport: http(url, { timeout: 5000, retryCount: 0 }) });
    const wallet = createWalletClient({ account, chain, transport: http(url, { timeout: 5000, retryCount: 0 }) });
    assert.equal(await reader.getChainId(), 97);
    assert.match(await reader.request({ method: "web3_clientVersion" }), /anvil/i);
    await reader.request({ method: "anvil_setBalance", params: [account.address, "0x56bc75e2d63100000"] });
    const bytecode = `0x${artifact.bytecode.object.replace(/^0x/, "")}`;
    const runtime = `0x${artifact.deployedBytecode.object.replace(/^0x/, "")}`;
    const deployed = await reader.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: artifact.abi, bytecode, args: [account.address] }) });
    assert.equal(deployed.status, "success"); assert.ok(deployed.contractAddress);
    assert.equal(await reader.getCode({ address: deployed.contractAddress }), runtime);
    return { reader, stop, target: { chainId: 97, contractAddress: deployed.contractAddress.toLowerCase(), contractCodeHash: keccak256(runtime),
      publisherWallet: account.address.toLowerCase(), recipientWallet: account.address.toLowerCase(), requiredConfirmations: 3 },
      async send(command, gasPrice, gas = 500_000n) {
        assert.equal(command.request.from, account.address.toLowerCase()); assert.equal(command.request.chainId, 97);
        return wallet.sendTransaction({ to: command.request.to, data: command.request.data, nonce: command.request.nonce, value: BigInt(command.request.value), gas,
          ...(gasPrice === undefined ? {} : { gasPrice }) });
      },
      async sign(command, gas = 500_000n) {
        // Test-only signed bytes, so the same transaction hash can be re-broadcast on another branch.
        assert.equal(command.request.from, account.address.toLowerCase()); assert.equal(command.request.chainId, 97);
        return wallet.signTransaction(await wallet.prepareTransactionRequest({ to: command.request.to, data: command.request.data,
          nonce: command.request.nonce, value: BigInt(command.request.value), gas }));
      },
      async cancel(command) {
        // Test-only same-nonce cancellation outside the application process.
        assert.equal(command.request.from, account.address.toLowerCase());
        return wallet.sendTransaction({ to: account.address, data: "0x", value: 0n, nonce: command.request.nonce, gas: 21_000n, gasPrice: 23_000_000_000n });
      },
    };
  } catch (error) { await stop(); throw error; }
  finally { clearTimeout(timer); }
}
