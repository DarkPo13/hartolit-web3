// Password reset through the outbox (D81), against production servers this script starts on
// loopback port 3007 (or RESET_SMOKE_PORT). 1) Inline delivery behind an SMTP relay that
// holds every connection 1.5 s: a known and an unknown address get the same status and body,
// their response times stay far below that delay and close to each other, every known
// request is delivered exactly once through Mailpit with a working link, and decoys vanish.
// 2) AWS Lambda with an external worker: requests only write rows; `npm run mail:outbox`
// retries after an SMTP failure, delivers once SMTP works and drops an expired link.
// 3) Lambda without a worker and 4) no SMTP: 503 for every address, no rows. No address,
// link or token in any server or worker output. Needs a migrated local PostgreSQL, a
// production build and the STARTTLS Mailpit (README "Production mail locally": SMTP_HOST,
// SMTP_PORT, SMTP_FROM, NODE_EXTRA_CA_CERTS, MAILPIT_API_URL). Fictional @example.invalid
// addresses; everything it creates is deleted.
import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import nextEnv from "@next/env";
import { createJiti } from "jiti";
import { isolatePublicationEnv } from "./fixtures/isolated-env.mjs";

isolatePublicationEnv();
nextEnv.loadEnvConfig(process.cwd());
for (const name of ["SMTP_HOST", "SMTP_PORT", "SMTP_FROM"]) {
  if (!process.env[name]) throw new Error(`${name} must point at the STARTTLS Mailpit (README "Production mail locally")`);
}
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("The reset smoke requires a local database");
const port = Number(process.env.RESET_SMOKE_PORT ?? 3007), base = `http://127.0.0.1:${port}`;
const mailpit = process.env.MAILPIT_API_URL ?? "http://127.0.0.1:8025";
const DELAY = 1500;
process.env.BETTER_AUTH_URL = base;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const [{ auth }, { getDb }] = await Promise.all([jiti.import("../auth.cli.ts"), jiti.import("../lib/db-core.ts")]);
const db = getDb();
const run = promisify(execFile);
const suffix = randomBytes(5).toString("hex");
const known = `reset-known-${suffix}@example.invalid`, unknown = `reset-unknown-${suffix}@example.invalid`;
const ipPrefix = `198.18.${parseInt(suffix.slice(0, 2), 16)}.`;
let ipCount = 0;
const nextIp = () => `${ipPrefix}${++ipCount}`;
const rateBefore = new Set((await db.rateLimit.findMany({ select: { key: true } })).map(row => row.key));
const startedAt = new Date(Date.now() - 1000);
const servers = [], relays = [], capturedMail = new Set();
let output = "";

async function freePort() {
  const probe = net.createServer(); await new Promise(ok => probe.listen(0, "127.0.0.1", ok));
  const free = probe.address().port; await new Promise(ok => probe.close(ok)); return free;
}
// A transparent TCP relay to the SMTP server that holds back the server's first bytes (the
// greeting) for DELAY ms, so any delivery waits at least that long. STARTTLS passes through.
async function slowSmtp() {
  const relayPort = await freePort();
  const handle = client => {
    const upstream = net.connect(Number(process.env.SMTP_PORT), process.env.SMTP_HOST);
    let open = false; const held = [];
    const end = () => { client.destroy(); upstream.destroy(); };
    setTimeout(() => { open = true; for (const chunk of held.splice(0)) client.write(chunk); }, DELAY);
    upstream.on("data", chunk => open ? client.write(chunk) : held.push(chunk));
    client.on("data", chunk => upstream.write(chunk));
    for (const socket of [client, upstream]) { socket.on("error", end); socket.on("close", end); }
  };
  for (const host of ["127.0.0.1", "::1"]) {
    const relay = net.createServer(handle);
    await new Promise(ok => { relay.once("error", ok); relay.listen(relayPort, host, ok); });
    relays.push(relay);
  }
  return relayPort;
}
async function start(env) {
  const child = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, NODE_ENV: "production", BETTER_AUTH_URL: base, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  servers.push(child);
  let ready = false;
  child.stdout.on("data", chunk => { output += chunk; if (chunk.toString().includes("Ready in")) ready = true; });
  child.stderr.on("data", chunk => { output += chunk; });
  for (let i = 0; i < 120 && !ready; i++) await new Promise(ok => setTimeout(ok, 250));
  assert.ok(ready, "server not ready");
  return async () => { child.kill(); await new Promise(ok => child.exitCode !== null ? ok() : child.once("exit", ok)); };
}
async function reset(email, ipHeader = "x-forwarded-for") {
  const begin = performance.now();
  const response = await fetch(`${base}/api/auth/request-password-reset`, { method: "POST", redirect: "manual",
    headers: { origin: base, "content-type": "application/json", [ipHeader]: nextIp() },
    body: JSON.stringify({ email, redirectTo: `${base}/reset-password` }) });
  const text = await response.text();
  return { status: response.status, text, ms: performance.now() - begin };
}
async function worker(env) {
  const result = await run(process.execPath, ["scripts/mail-outbox.mjs"], { env: { ...process.env, ...env } }).catch(error => error);
  output += `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { code: result.code ?? 0, counts: JSON.parse((result.stdout ?? "").trim().split("\n").at(-1)) };
}
async function inbox(address) {
  const found = await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=200`)).json();
  for (const message of found.messages ?? []) capturedMail.add(message.ID);
  return found.messages ?? [];
}
const rows = () => db.passwordResetOutbox.findMany({ where: { createdAt: { gte: startedAt }, OR: [{ user: { email: known } }, { userId: null }] } });
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
const sleep = ms => new Promise(ok => setTimeout(ok, ms));

try {
  const created = await auth.api.createUser({ body: { name: "Fictional reset user", email: known, password: `${randomBytes(18).toString("base64url")}aA1!`, role: "user" } });
  const userId = created.user.id;

  // 1. Inline delivery behind a slow SMTP relay.
  const relayPort = await slowSmtp();
  let stop = await start({ SMTP_PORT: String(relayPort), HARTOLIT_PASSWORD_RESET_WORKER: "" });
  for (let i = 0; i < 3; i++) { await reset(known); await reset(unknown); } // warm-up, not measured
  const timings = { known: [], unknown: [] }, bodies = new Set(), statuses = new Set();
  for (let i = 0; i < 16; i++) {
    for (const [label, email] of Math.random() < 0.5 ? [["known", known], ["unknown", unknown]] : [["unknown", unknown], ["known", known]]) {
      const answer = await reset(email);
      timings[label].push(answer.ms); bodies.add(answer.text); statuses.add(answer.status);
    }
  }
  assert.deepEqual([...statuses], [200], "every request answered 200");
  assert.equal(bodies.size, 1, `one body for both addresses: ${[...bodies].join(" | ")}`);
  const mKnown = median(timings.known), mUnknown = median(timings.unknown);
  const summary = `median known ${mKnown.toFixed(1)} ms, unknown ${mUnknown.toFixed(1)} ms, max known ${Math.max(...timings.known).toFixed(1)} ms, SMTP hold ${DELAY} ms`;
  console.log(`timing: ${summary}`);
  assert.ok(Math.max(...timings.known) < DELAY, `a known address waited for SMTP: ${summary}`);
  assert.ok(Math.abs(mKnown - mUnknown) < 50, `known and unknown medians differ: ${summary}`);
  const expected = 3 + 16;
  let delivered = [];
  for (let i = 0; i < 180 && (delivered.length < expected || (await rows()).length); i++) { await sleep(500); delivered = await inbox(known); }
  assert.equal(delivered.length, expected, "each known request delivered exactly once");
  assert.equal((await inbox(unknown)).length, 0, "nothing sent to the unknown address");
  assert.equal((await rows()).length, 0, "sent rows and decoys are gone");
  const message = await (await fetch(`${mailpit}/api/v1/message/${delivered[0].ID}`)).json();
  const link = message.Text.match(/https?:\/\/\S+\/reset-password\/[A-Za-z0-9]+\?callbackURL=\S*/)?.[0];
  assert.ok(link, "the email carries a reset link");
  const callback = await fetch(link, { redirect: "manual" });
  assert.equal(callback.status, 302); assert.ok(new URL(callback.headers.get("location")).searchParams.get("token"), "the link opens the reset page with its token");
  const tokens = await Promise.all(delivered.slice(0, 5).map(async item => (await (await fetch(`${mailpit}/api/v1/message/${item.ID}`)).json()).Text.match(/reset-password\/([A-Za-z0-9]+)/)[1]));
  await stop();

  // 2. Lambda with an external worker: requests only write rows; the worker delivers.
  const closed = await freePort();
  stop = await start({ AWS_LAMBDA_FUNCTION_NAME: "fictional-server", HARTOLIT_CLIENT_IP_SOURCE: "cloudfront",
    HARTOLIT_PASSWORD_RESET_WORKER: "external", SMTP_PORT: String(closed) });
  const lambdaAnswers = [await reset(known, "x-hartolit-client-ip"), await reset(unknown, "x-hartolit-client-ip")];
  assert.deepEqual(lambdaAnswers.map(a => a.status), [200, 200]);
  assert.equal(lambdaAnswers[0].text, lambdaAnswers[1].text, "same body on Lambda");
  await sleep(2000);
  let pending = await rows();
  assert.equal(pending.filter(row => row.userId === userId).length, 1, "one real row");
  assert.equal(pending.filter(row => row.userId === null).length, 1, "one decoy row for the unknown address");
  assert.ok(pending.every(row => row.attempts === 0), "nothing was sent from the request process");
  assert.ok(pending.every(row => !row.linkSealed.includes("reset-password")), "the stored link is sealed");
  const failed = await worker({ SMTP_PORT: String(closed) });
  assert.equal(failed.code, 1); assert.deepEqual([failed.counts.sent, failed.counts.retried, failed.counts.decoys], [0, 1, 1]);
  pending = await rows();
  assert.equal(pending.length, 1); assert.equal(pending[0].attempts, 1); assert.ok(pending[0].nextAttemptAt > new Date(), "a failed attempt waits before the retry");
  await db.passwordResetOutbox.updateMany({ where: { id: pending[0].id }, data: { nextAttemptAt: new Date() } });
  const before = (await inbox(known)).length;
  const retried = await worker({});
  assert.equal(retried.code, 0); assert.equal(retried.counts.sent, 1, "the retry delivers once SMTP works");
  assert.equal((await inbox(known)).length, before + 1);
  await reset(known, "x-hartolit-client-ip");
  const stale = (await rows())[0];
  await db.$executeRaw`UPDATE "PasswordResetOutbox" SET "expiresAt" = "createdAt" + interval '1 millisecond', "nextAttemptAt" = now() WHERE "id" = ${stale.id}::uuid`;
  const expired = await worker({});
  assert.equal(expired.counts.expired, 1); assert.equal(expired.counts.sent, 0, "an expired link is not sent");
  assert.equal((await inbox(known)).length, before + 1);
  await stop();

  // 3. Lambda without a worker and 4. no SMTP: the feature is off, for every address.
  for (const [label, env] of [["Lambda without a worker", { AWS_LAMBDA_FUNCTION_NAME: "fictional-server", HARTOLIT_CLIENT_IP_SOURCE: "cloudfront", HARTOLIT_PASSWORD_RESET_WORKER: "" }],
    ["no SMTP", { SMTP_HOST: "", SMTP_PORT: "", SMTP_FROM: "", HARTOLIT_PASSWORD_RESET_WORKER: "" }]]) {
    stop = await start(env);
    const header = env.AWS_LAMBDA_FUNCTION_NAME ? "x-hartolit-client-ip" : "x-forwarded-for";
    const answers = [await reset(known, header), await reset(unknown, header)];
    assert.deepEqual(answers.map(a => a.status), [503, 503], label);
    assert.equal(answers[0].text, answers[1].text, `${label}: same body`);
    await stop();
  }
  assert.equal((await rows()).length, 0, "the disabled modes wrote nothing");

  for (const secret of [known, unknown, ...tokens, "/reset-password/"]) assert.ok(!output.includes(secret), `server or worker output contains ${secret.includes("@") ? "an address" : "a link"}`);
  // The class depends on how the connection failed (Node may try IPv6 and IPv4 and report an AggregateError).
  assert.match(output, /Password reset email delivery failed [A-Za-z]*Error E[A-Z]+\n/, "the failed attempt is logged with its class and code only");
  console.log(`Password reset smoke passed: one status and body for known and unknown addresses (${summary}), exactly one delivery per known request with a working link, decoys removed, nothing sent to unknown addresses, worker retry after an SMTP failure, expired link dropped, off on Lambda without a worker and without SMTP, no address, link or token in any output.`);
} finally {
  for (const child of servers) if (child.exitCode === null) child.kill();
  for (const relay of relays) relay.close();
  await db.passwordResetOutbox.deleteMany({ where: { createdAt: { gte: startedAt }, OR: [{ user: { email: known } }, { userId: null }] } });
  await db.user.deleteMany({ where: { email: known } });
  const createdKeys = (await db.rateLimit.findMany({ select: { key: true } })).map(row => row.key).filter(key => !rateBefore.has(key));
  await db.rateLimit.deleteMany({ where: { key: { in: createdKeys } } });
  for (const address of [known, unknown]) await inbox(address).catch(() => []);
  if (capturedMail.size) await fetch(`${mailpit}/api/v1/messages`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ IDs: [...capturedMail] }) });
  await db.$disconnect();
}
