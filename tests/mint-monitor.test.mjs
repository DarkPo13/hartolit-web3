import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { boundedMintMonitorReader } = await jiti.import("../lib/publication/mint-monitor.ts");

test("monitor RPC budget is cumulative across methods and keeps the reader receiver", async t => {
  let now = 0, calls = 0;
  t.mock.method(performance, "now", () => now);
  const original = { value: 97, getChainId: async function () { calls++; return this.value; }, getBlock: async () => { calls++; return {}; } };
  const reader = boundedMintMonitorReader(original);
  assert.equal(await reader.getChainId(), 97);
  now = 19_999; await reader.getBlock();
  now = 20_001;
  await assert.rejects(reader.getChainId(), /deadline exceeded/);
  assert.equal(calls, 2, "another method must not restart the budget or contact RPC after expiry");
});

test("monitor RPC timeout rejects a stalled call and ignores its late resolution", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release;
  const reader = boundedMintMonitorReader({ getChainId: () => new Promise(resolve => { release = resolve; }) });
  const pending = reader.getChainId();
  const rejected = assert.rejects(pending, /deadline exceeded/);
  await Promise.resolve();
  t.mock.timers.tick(20_000);
  await rejected;
  release(97);
  await Promise.resolve();
});
