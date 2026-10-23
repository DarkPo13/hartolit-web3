// Test-only owned servers for public verification: a loopback raw-block gateway
// and a production `next start` configured only with HARTOLIT_VERIFY_* values.
import assert from "node:assert/strict";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";

/** Serves `blocks` (cid -> bytes) as raw blocks; `mode` can tamper or fail. */
export async function startRawGateway(blocks) {
  const control = { mode: "serve" };
  const server = http.createServer((request, response) => {
    const cid = new URL(request.url, "http://127.0.0.1").pathname.replace(/^\/ipfs\//, "");
    if (control.mode === "down" || request.headers.authorization) { response.writeHead(503).end(); return; }
    const bytes = blocks.get(cid);
    if (!bytes) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": "application/vnd.ipld.raw" })
      .end(control.mode === "tamper" ? Buffer.concat([Buffer.from(bytes), Buffer.from(" ")]) : Buffer.from(bytes));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { url: `http://127.0.0.1:${server.address().port}/`, control, close: () => new Promise(resolve => server.close(resolve)) };
}

export async function startVerifierServer({ rpcUrl, gatewayUrl, target, env = {}, port = Number(process.env.PUBLIC_VERIFIER_SMOKE_PORT ?? 3002) }) {
  const base = `http://127.0.0.1:${port}`;
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", resolve); });
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, NODE_ENV: "production", BETTER_AUTH_URL: base, HARTOLIT_VERIFY_RPC_URL: rpcUrl, HARTOLIT_VERIFY_GATEWAY_URL: gatewayUrl,
      HARTOLIT_VERIFY_CONTRACT_ADDRESS: target.contractAddress, HARTOLIT_VERIFY_CONTRACT_CODE_HASH: target.contractCodeHash,
      HARTOLIT_VERIFY_CONFIRMATIONS: String(target.requiredConfirmations), ...env },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  const stop = async () => { if (child.pid && child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill(); await exited; } };
  let ready = false;
  child.stdout.on("data", chunk => { if (chunk.toString().includes("Ready in")) ready = true; });
  // Consume stderr without logging private server details.
  child.stderr.on("data", () => {});
  try {
    for (let attempt = 0; attempt < 120 && !ready; attempt++) {
      if (child.exitCode !== null) throw new Error("Public verifier server exited before startup (check build/port)");
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, "Public verifier server did not become ready");
  } catch (error) { await stop(); throw error; }
  return { base, port, stop };
}
