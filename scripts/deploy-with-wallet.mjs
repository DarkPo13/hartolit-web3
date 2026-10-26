// Deploys the compiled HartolitFieldPassport to BSC Testnet from the browser wallet:
// the wallet signs, so no private key enters this process or a shell variable.
// Serves one page on 127.0.0.1:3311 (DEPLOY_PORT), checks the result on chain and
// prints the non-secret settings for .env.local. Needs `npm run contracts:build`.
// RPC: BSC_TESTNET_RPC or BNB Chain's public Testnet endpoint.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createPublicClient, encodeDeployData, getAddress, http, keccak256 } from "viem";

const chainId = 97;
const rpcUrl = process.env.BSC_TESTNET_RPC || "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const port = Number(process.env.DEPLOY_PORT || 3311);
const artifact = JSON.parse(await readFile("contracts/out/HartolitFieldPassport.sol/HartolitFieldPassport.json", "utf8"));
const bytecode = `0x${artifact.bytecode.object.replace(/^0x/, "")}`;
const runtime = `0x${artifact.deployedBytecode.object.replace(/^0x/, "")}`;
const reader = createPublicClient({ transport: http(rpcUrl, { timeout: 15_000, retryCount: 2 }) });
if (await reader.getChainId() !== chainId) throw new Error(`The RPC at ${new URL(rpcUrl).host} is not BSC Testnet (chain 97)`);

const page = `<!doctype html><meta charset="utf-8"><title>Deploy Hartolit Field Passport (BSC Testnet)</title>
<body style="font:16px system-ui;max-width:40rem;margin:2rem auto;padding:0 1rem">
<h1>Deploy to BSC Testnet</h1>
<p>Your browser wallet signs one contract deployment. The connected account becomes the contract admin and the only minter.
Nothing here asks for or sees a seed phrase or private key.</p>
<button id="go" style="font-size:1rem;padding:.6rem 1rem">Connect wallet and deploy</button>
<pre id="log" style="white-space:pre-wrap;background:#f5f5f3;padding:1rem"></pre>
<script>
const log = text => { document.getElementById("log").textContent += text + "\\n"; };
const post = async (path, body) => { const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const v = await r.json(); if (!r.ok) throw new Error(v.error); return v; };
document.getElementById("go").onclick = async () => {
  try {
    if (!window.ethereum) throw new Error("No browser wallet found (install MetaMask)");
    const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
    log("Account: " + account);
    if (await window.ethereum.request({ method: "eth_chainId" }) !== "0x61") {
      try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x61" }] }); }
      catch (error) {
        if (error.code !== 4902) throw error;
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x61", chainName: "BNB Smart Chain Testnet",
          nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 }, rpcUrls: ["https://data-seed-prebsc-1-s1.bnbchain.org:8545"], blockExplorerUrls: ["https://testnet.bscscan.com"] }] });
      }
    }
    const { data } = await post("/data", { admin: account });
    log("Confirm the deployment in your wallet...");
    const hash = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ from: account, data }] });
    log("Transaction: " + hash + "\\nWaiting for the network to include it...");
    const result = await post("/done", { admin: account, hash });
    log("Deployed at " + result.contractAddress + ". The terminal shows the settings for .env.local; you can close this tab.");
  } catch (error) { log("Stopped: " + (error.message || error)); }
};
</script>`;

let finished;
const done = new Promise(resolve => { finished = resolve; });
const server = createServer(async (req, res) => {
  const reply = (status, value) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(value)); };
  try {
    if (req.method === "GET" && req.url === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(page); return; }
    if (req.method !== "POST" || req.headers.origin !== `http://127.0.0.1:${port}`) { reply(404, { error: "Not found" }); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const admin = getAddress(body.admin);
    if (req.url === "/data") { reply(200, { data: encodeDeployData({ abi: artifact.abi, bytecode, args: [admin] }) }); return; }
    if (req.url === "/done" && /^0x[0-9a-fA-F]{64}$/.test(body.hash)) {
      const receipt = await reader.waitForTransactionReceipt({ hash: body.hash, timeout: 180_000 });
      const transaction = await reader.getTransaction({ hash: body.hash });
      if (receipt.status !== "success" || !receipt.contractAddress || getAddress(transaction.from) !== admin) throw new Error("The deployment failed or came from another account");
      const code = await reader.getCode({ address: receipt.contractAddress });
      if (code !== runtime) throw new Error("The deployed code differs from contracts/out; rebuild and deploy again");
      const minterRole = keccak256(new TextEncoder().encode("MINTER_ROLE"));
      const isMinter = await reader.readContract({ address: receipt.contractAddress, abi: artifact.abi, functionName: "hasRole", args: [minterRole, admin] });
      if (!isMinter) throw new Error("The admin account does not hold MINTER_ROLE");
      reply(200, { contractAddress: receipt.contractAddress });
      finished({ contractAddress: receipt.contractAddress.toLowerCase(), admin: admin.toLowerCase(), codeHash: keccak256(code), hash: body.hash, block: receipt.blockNumber });
      return;
    }
    reply(400, { error: "Unexpected request" });
  } catch (error) { reply(409, { error: String(error?.shortMessage ?? error?.message ?? error) }); }
});
await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
process.stdout.write(`Open http://127.0.0.1:${port} in the browser that has your Testnet wallet.\n`);
const result = await done;
server.closeAllConnections(); server.close();
process.stdout.write(`\nDeployed and checked on BSC Testnet (block ${result.block}, transaction ${result.hash}).
Admin and minter: ${result.admin}
Add to .env.local (public values, no secrets):
HARTOLIT_PUBLISHER_WALLET=${result.admin}
HARTOLIT_MINT_CONTRACT_ADDRESS=${result.contractAddress}
HARTOLIT_MINT_CONTRACT_CODE_HASH=${result.codeHash}
HARTOLIT_VERIFY_CONTRACT_ADDRESS=${result.contractAddress}
HARTOLIT_VERIFY_CONTRACT_CODE_HASH=${result.codeHash}
Explorer: https://testnet.bscscan.com/address/${result.contractAddress}
`);
