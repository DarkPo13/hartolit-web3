// Client IP for Better Auth rate limits (D78), against production servers this script
// starts on loopback port 3006 (or CLIENT_IP_SMOKE_PORT). With HARTOLIT_CLIENT_IP_SOURCE=
// cloudfront, as on AWS: each address in CloudFront's header has its own sign-in limit,
// X-Forwarded-For and malformed values cannot choose or reset a bucket, requests without
// an address share one limited bucket, IPv6 counts per /64, and a correct sign-in still
// works. Then a hosted URL without a source, and AWS Lambda with X-Forwarded-For, must
// refuse auth requests. Needs a migrated local PostgreSQL and `npm run build`.
// Fictional @example.invalid user and documentation-range addresses; everything it
// creates is deleted.
import assert from "node:assert/strict";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import { createJiti } from "jiti";
import { isolatePublicationEnv } from "./fixtures/isolated-env.mjs";

isolatePublicationEnv();
nextEnv.loadEnvConfig(process.cwd());
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("The client IP smoke requires a local database");
const port = Number(process.env.CLIENT_IP_SMOKE_PORT ?? 3006), base = `http://127.0.0.1:${port}`;
process.env.BETTER_AUTH_URL = base;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const [{ auth }, { getDb }, { CLOUDFRONT_CLIENT_IP_HEADER: header }] = await Promise.all([
  jiti.import("../auth.cli.ts"), jiti.import("../lib/db-core.ts"), jiti.import("../lib/client-ip.ts")]);
const db = getDb();
const path_ = "/sign-in/email", shared = `no-trusted-ip|${path_}`;
const suffix = randomBytes(4).toString("hex"), r = i => parseInt(suffix.slice(i, i + 2), 16);
const email = `client-ip-${suffix}@example.invalid`, password = `${randomBytes(18).toString("base64url")}aA1!`;
// 198.18.0.0/15 is reserved for benchmarking, 2001:db8::/32 for documentation.
const ipA = `198.18.${r(0)}.${r(2)}`, ipB = `198.19.${r(0)}.${r(2)}`, ipC = `198.18.${r(4)}.${r(6)}`;
const v6 = `2001:db8:${suffix.slice(0, 4)}:${suffix.slice(4, 8)}`, v6Other = `2001:db8:${suffix.slice(0, 4)}:${(parseInt(suffix.slice(4, 8), 16) ^ 1).toString(16)}`;
const rateBefore = new Set((await db.rateLimit.findMany({ select: { key: true } })).map(row => row.key));
const servers = [];

async function start(env) {
  const probe = net.createServer(); await new Promise((ok, fail) => { probe.once("error", fail); probe.listen(port, "127.0.0.1", ok); }); await new Promise(ok => probe.close(ok));
  const child = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, NODE_ENV: "production", ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  servers.push(child);
  let ready = false, errors = "";
  child.stdout.on("data", chunk => { if (chunk.toString().includes("Ready in")) ready = true; });
  child.stderr.on("data", chunk => { errors += chunk.toString(); });
  for (let i = 0; i < 120 && !ready; i++) await new Promise(ok => setTimeout(ok, 250));
  assert.ok(ready, "server not ready");
  return { errors: () => errors, async stop() { child.kill(); await new Promise(ok => child.exitCode !== null ? ok() : child.once("exit", ok)); } };
}
function signIn(headers, body = { email: `nobody-${suffix}@example.invalid`, password: "not-the-password-aA1!" }) {
  return fetch(new URL(`/api/auth${path_}`, base), { method: "POST", redirect: "manual",
    headers: { origin: base, "content-type": "application/json", ...headers }, body: JSON.stringify(body) }).then(async response => { await response.arrayBuffer(); return response.status; });
}
async function attempts(count, headersFor) { const statuses = []; for (let i = 0; i < count; i++) statuses.push(await signIn(headersFor(i))); return statuses; }
const keyRow = key => db.rateLimit.findUnique({ where: { key } });

try {
  const hosted = await start({ BETTER_AUTH_URL: base, HARTOLIT_CLIENT_IP_SOURCE: "cloudfront" });
  await auth.api.createUser({ body: { name: "Fictional client IP", email, password, role: "user" } });

  // The sign-in rule is 5 per 15 minutes. Five wrong passwords from A, then A is limited.
  const fromA = await attempts(6, () => ({ [header]: ipA }));
  assert.deepEqual(fromA.slice(0, 5).filter(s => s === 429), [], `A was limited early: ${fromA}`);
  assert.equal(fromA[5], 429, `A's sixth attempt: ${fromA}`);
  assert.equal((await keyRow(`${ipA}|${path_}`))?.count >= 5, true, "A's bucket is keyed by CloudFront's address");
  // B is another client and has its own limit.
  assert.notEqual(await signIn({ [header]: ipB }), 429, "B shares A's limit");
  // A cannot escape with a fresh X-Forwarded-For or other IP headers each time.
  const spoofed = await attempts(4, i => ({ [header]: ipA, "x-forwarded-for": `203.0.113.${10 + i}`, "x-real-ip": `203.0.113.${20 + i}` }));
  assert.deepEqual(spoofed, [429, 429, 429, 429], `spoofed headers reset A's limit: ${spoofed}`);
  // Without CloudFront's header, rotating X-Forwarded-For lands in one shared bucket: at most five get through.
  const noHeader = await attempts(8, i => ({ "x-forwarded-for": `203.0.113.${100 + i}` }));
  assert.ok(noHeader.filter(s => s !== 429).length <= 5 && noHeader.at(-1) === 429, `rotating X-Forwarded-For was not limited: ${noHeader}`);
  assert.ok(await keyRow(shared), "requests without an address are counted in the shared bucket");
  // Malformed values CloudFront never writes also land in the (now full) shared bucket.
  for (const bad of [`${ipC}, ${ipB}`, `${ipC}:443`, "not-an-ip", ""]) assert.equal(await signIn({ [header]: bad }), 429, `malformed ${JSON.stringify(bad)} got a bucket of its own`);
  // IPv6: a client rotating inside its /64 keeps its limit; another /64 is another client.
  const sameSubnet = await attempts(6, i => ({ [header]: `${v6}::${(i + 1).toString(16)}` }));
  assert.equal(sameSubnet[5], 429, `rotating inside one /64 reset the limit: ${sameSubnet}`);
  assert.notEqual(await signIn({ [header]: `${v6Other}::1` }), 429, "a different /64 shares the limit");
  // Keys hold only CloudFront's addresses: none for any spoofed or malformed value.
  const keys = (await db.rateLimit.findMany({ select: { key: true } })).map(row => row.key).filter(key => !rateBefore.has(key));
  assert.deepEqual(keys.filter(key => /^(203\.0\.113\.|not-an-ip|\||198\.18\.\d+\.\d+:)/.test(key) || key.startsWith(`${ipC}`)), [], `unexpected keys: ${keys}`);
  assert.ok(keys.includes(`2001:0db8:${suffix.slice(0, 4)}:${suffix.slice(4, 8)}:0000:0000:0000:0000|${path_}`), `IPv6 key: ${keys}`);
  // A correct password from a fresh client still signs in.
  assert.equal(await signIn({ [header]: ipC }, { email, password }), 200, "correct sign-in through CloudFront's header");
  await hosted.stop();

  // Fail closed: a hosted URL without a source, and AWS Lambda with X-Forwarded-For.
  for (const [label, env] of [["hosted URL without a source", { BETTER_AUTH_URL: "https://staging.example.invalid", HARTOLIT_CLIENT_IP_SOURCE: "" }],
    ["AWS Lambda with forwarded-for", { BETTER_AUTH_URL: base, HARTOLIT_CLIENT_IP_SOURCE: "forwarded-for", AWS_LAMBDA_FUNCTION_NAME: "fictional-server" }]]) {
    const refused = await start(env);
    const status = await signIn({ "x-forwarded-for": ipA });
    assert.equal(status, 500, `${label}: answered ${status}`);
    assert.match(refused.errors(), /HARTOLIT_CLIENT_IP_SOURCE/, `${label}: no configuration error logged`);
    await refused.stop();
  }
  console.log(`Client IP smoke passed: per-address limits from CloudFront's header (${ipA} limited, ${ipB} not), spoofed X-Forwarded-For/X-Real-IP ignored, missing and malformed addresses share one limited bucket, IPv6 per /64, correct sign-in works, hosted and Lambda misconfiguration refused.`);
} finally {
  for (const child of servers) if (child.exitCode === null) child.kill();
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (user) await db.user.delete({ where: { id: user.id } });
  const created = (await db.rateLimit.findMany({ select: { key: true } })).map(row => row.key).filter(key => !rateBefore.has(key));
  await db.rateLimit.deleteMany({ where: { key: { in: created } } });
  await db.$disconnect();
}
