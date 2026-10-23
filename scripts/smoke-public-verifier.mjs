// Live public-verifier smoke: owned Anvil + actual contract, a loopback raw-block
// gateway and the production build. Anonymous requests only; fictional data only.
import assert from "node:assert/strict";
import path from "node:path";
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { createJiti } from "jiti";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { localMintChain } from "./local-mint-chain.mjs";
import { fictionalChainSnapshot } from "./fixtures/public-chain.mjs";
import { startRawGateway, startVerifierServer } from "./public-verifier-server.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { createMintIntent, mintTransactionRequest } = await jiti.import("../lib/publication/chain-mint.ts");
const { canonicalize } = await jiti.import("../lib/hash.ts");
const { rawCidFromSha256 } = await jiti.import("../lib/publication/raw-cid.ts");
const { uk } = await jiti.import("../lib/i18n/translations/uk.ts");
const t = uk.publicVerifier;
const blocks = new Map();
const gateway = await startRawGateway(blocks), gatewayUrl = gateway.url;

const account = privateKeyToAccount(generatePrivateKey());
let chain, server;
try {
  chain = await localMintChain(account);
  const mint = async ({ depth }) => {
    const canonicalJson = canonicalize(fictionalChainSnapshot(randomUUID()));
    const payloadHash = createHash("sha256").update(canonicalJson).digest("hex"), ipfsCid = rawCidFromSha256(payloadHash);
    blocks.set(ipfsCid, Buffer.from(canonicalJson));
    const intent = await createMintIntent(chain.target, { canonicalJson, payloadHash, ipfsCid });
    const request = await mintTransactionRequest(intent);
    const hash = await chain.send({ request: { ...request, nonce: await chain.reader.getTransactionCount({ address: account.address }) } });
    assert.equal((await chain.reader.waitForTransactionReceipt({ hash })).status, "success");
    if (depth > 1) await chain.reader.request({ method: "anvil_mine", params: [`0x${(depth - 1).toString(16)}`] });
    return { intent, canonicalJson };
  };
  const first = await mint({ depth: 3 });

  const rpcUrl = chain.url;
  server = await startVerifierServer({ rpcUrl, gatewayUrl, target: chain.target });
  const { base, port } = server;

  // Anonymous: no cookies, no session; the page must not leak configuration.
  const page = async tokenId => {
    const response = await fetch(`${base}/passports/${tokenId}`, { redirect: "manual" });
    return { status: response.status, headers: response.headers, html: await response.text() };
  };
  const valid = await page("1");
  assert.equal(valid.status, 200);
  for (const text of [t.validBadge, t.validTitle, t.limits, t.testnet, first.intent.ipfsCid, first.intent.payloadHash, first.intent.certificateId,
    "Fictional Chain Farm", "Fictional Product", chain.target.contractAddress]) assert.ok(valid.html.includes(text), `VALID page missing ${text}`);
  for (const secret of [rpcUrl, gatewayUrl, rpcUrl.replace("http://", ""), "HARTOLIT_VERIFY", "@example.invalid", "objectKey", "ownerId"]) {
    assert.ok(!valid.html.includes(secret), `public page leaks ${secret}`);
  }
  assert.equal(valid.headers.get("cache-control"), "no-store");
  assert.match(valid.headers.get("x-robots-tag") ?? "", /noindex/);
  assert.equal(valid.headers.get("referrer-policy"), "no-referrer");
  for (const text of [t.shareTitle, `${base}/passports/1`, "data:image/png;base64,", t.downloadJson]) assert.ok(valid.html.includes(text), `share section missing ${text}`);
  // A forged Host header must not change the share link or QR target.
  const forged = await new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/passports/1", headers: { host: "evil.example.invalid" } }, response => {
      let body = ""; response.setEncoding("utf8"); response.on("data", chunk => { body += chunk; }); response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    request.on("error", reject);
  });
  assert.equal(forged.status, 200); assert.ok(forged.body.includes(`${base}/passports/1`)); assert.ok(!forged.body.includes("evil.example.invalid"), "share link follows the Host header");
  assert.equal((await page("2")).status, 404, "a token that was never minted is not found");
  for (const bad of ["0", "abc", "01", "1.0"]) assert.equal((await page(bad)).status, 404);

  await mint({ depth: 1 });
  const pending = await page("2");
  assert.equal(pending.status, 200); assert.ok(pending.html.includes(t.pendingBadge)); assert.ok(!pending.html.includes("Fictional Chain Farm")); assert.ok(!pending.html.includes(t.shareTitle));
  gateway.control.mode = "tamper";
  const tampered = await page("1");
  assert.ok(tampered.html.includes(t.mismatchBadge) && tampered.html.includes(t.mismatchBytes)); assert.ok(!tampered.html.includes("Fictional Chain Farm"));
  gateway.control.mode = "down";
  const down = await page("1");
  assert.ok(down.html.includes(t.unavailableBadge) && down.html.includes(t.unavailableDescription)); assert.ok(!down.html.includes(t.validBadge));
  gateway.control.mode = "serve";
  assert.ok((await page("1")).html.includes(t.validBadge), "recovers once the gateway serves the committed bytes");
  process.stdout.write("Public verifier smoke passed: anonymous production page, actual contract on owned Anvil, VALID/PENDING/not-found/MISMATCH/UNAVAILABLE, share link/QR from the configured origin despite a forged Host, no configuration leak, no-store/noindex/no-referrer headers. No public network or database.\n");
} finally {
  await server?.stop();
  await chain?.stop();
  await gateway.close();
}
