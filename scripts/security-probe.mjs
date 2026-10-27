// HTTP security probe against a production build it starts on port 3200: every API
// route as anonymous, another operator and an admin with MFA pending; Origin checks;
// invite-only sign-up, reset enumeration and foreign redirects; password and TOTP rate
// limits; sign-out revocation; malformed and oversized input; legacy routes; response
// headers including the nonce CSP. Local only: migrated PostgreSQL and a production build.
// Fictional @example.invalid users only; everything it creates is deleted.
import assert from "node:assert/strict";
import path from "node:path";
import net from "node:net";
import { once as onceEvent } from "node:events";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import { createJiti } from "jiti";
import { isolatePublicationEnv } from "./fixtures/isolated-env.mjs";

isolatePublicationEnv();
nextEnv.loadEnvConfig(process.cwd());
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("The security probe requires a local database");
const port = 3200, base = `http://127.0.0.1:${port}`;
process.env.BETTER_AUTH_URL = base;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const [{ auth }, { getDb }] = await Promise.all([jiti.import("../auth.cli.ts"), jiti.import("../lib/db-core.ts")]);
const db = getDb();
let server;
const suffix = randomBytes(6).toString("hex");
const password = `${randomBytes(18).toString("base64url")}aA1!`;
const emails = { a: `sec-a-${suffix}@example.invalid`, b: `sec-b-${suffix}@example.invalid`, admin: `sec-admin-${suffix}@example.invalid` };
const ip = `198.18.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}`;
const rows = [], note = (ok, text) => { rows.push(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) process.exitCode = 1; };
const rateBefore = new Set((await db.rateLimit.findMany({ select: { key: true } })).map(r => r.key));

function jar() {
  const cookies = new Map(), raw = [];
  return { raw, header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    add(response) { for (const h of response.headers.getSetCookie()) { raw.push(h); const [pair] = h.split(";"); const i = pair.indexOf("="); if (i >= 0) cookies.set(pair.slice(0, i), pair.slice(i + 1)); } } };
}
async function api(p, { user, method = "GET", body, origin = base, headers = {}, rawBody, forwarded = ip } = {}) {
  const once = () => fetch(new URL(p, base), { method, redirect: "manual",
    headers: { ...(origin ? { origin } : {}), "x-forwarded-for": forwarded, ...(body || rawBody ? { "content-type": "application/json" } : {}), ...(user ? { cookie: user.header() } : {}), ...headers },
    body: rawBody ?? (body ? JSON.stringify(body) : undefined) });
  // A 413 answered before the upload finished closes the socket; retry once on a fresh one.
  const response = await once().catch(async error => { rows.push(`INFO retried ${method} ${p.slice(0, 40)} after ${error.cause?.code ?? error.message}`); return once(); });
  user?.add(response);
  return response;
}
// offset -1 is the previous 30-second step, still accepted: enrolment uses it so the
// sign-in right after can use the current step (a reused step is refused).
function totp(uri, offset = 0) {
  const secret = new URL(uri).searchParams.get("secret"), alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replace(/=+$/, "")].map(l => alphabet.indexOf(l).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map(b => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const d = createHmac("sha1", key).update(counter).digest();
  return ((d.readUInt32BE(d[d.length - 1] & 15) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}
// Exact refusals: a 404 for a made-up ID would also hide a missing access check.
const denied = s => [401, 403, 404, 405].includes(s);
const refusal = { anonymous: [401, 405], operator: [403, 405], "admin-mfa-pending": [401, 403, 405] }; // no session exists until the TOTP step

let draftA;
try {
  const probe = net.createServer(); await new Promise((r, j) => { probe.once("error", j); probe.listen(port, "127.0.0.1", r); }); await new Promise(r => probe.close(r));
  server = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, NODE_ENV: "production", BETTER_AUTH_URL: base }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let ready = false; server.stdout.on("data", chunk => { if (chunk.toString().includes("Ready in")) ready = true; });
  for (let i = 0; i < 120 && !ready; i++) await new Promise(r => setTimeout(r, 250));
  assert.ok(ready, "server not ready");
  for (const [k, email] of Object.entries(emails)) await auth.api.createUser({ body: { name: `Fictional Sec ${k}`, email, password, role: k === "admin" ? "admin" : "user" } });
  const a = jar(), b = jar(), adminNoMfa = jar(), admin = jar();
  for (const [user, email] of [[a, emails.a], [b, emails.b], [adminNoMfa, emails.admin]]) assert.equal((await api("/api/auth/sign-in/email", { user, method: "POST", body: { email, password } })).status, 200);
  const enable = await api("/api/auth/two-factor/enable", { user: adminNoMfa, method: "POST", body: { password, method: "totp" } });
  const { totpURI } = await enable.json();
  assert.equal((await api("/api/auth/two-factor/verify-totp", { user: adminNoMfa, method: "POST", body: { code: totp(totpURI, -1) } })).status, 200);
  const halfAdmin = jar(); // password only, MFA pending
  assert.equal((await api("/api/auth/sign-in/email", { user: halfAdmin, method: "POST", body: { email: emails.admin, password } })).status, 200);
  assert.equal((await api("/api/auth/sign-in/email", { user: admin, method: "POST", body: { email: emails.admin, password } })).status, 200);
  assert.equal((await api("/api/auth/two-factor/verify-totp", { user: admin, method: "POST", body: { code: totp(totpURI) } })).status, 200);
  note((await api("/api/admin/overview", { user: admin })).status === 200, "verified admin reaches the admin API (fixture sanity)");

  // Session cookie attributes.
  const sessionCookie = a.raw.find(h => /session_token=/.test(h)) ?? "";
  note(/HttpOnly/i.test(sessionCookie) && /SameSite=Lax|SameSite=Strict/i.test(sessionCookie), `session cookie is HttpOnly with SameSite (${sessionCookie.split(";").slice(1).map(s => s.trim()).join("; ")})`);

  const created = await api("/api/drafts", { user: a, method: "POST" });
  draftA = (await created.json()).draft.id;
  const fake = "00000000-0000-4000-8000-000000000000";

  // 1. Operator-scoped routes: anonymous and the other operator.
  const ownerRoutes = [["GET", "/api/drafts"], ["GET", `/api/drafts/${draftA}`], ["PATCH", `/api/drafts/${draftA}`, { version: 1, data: { farmer: { farmerName: "Overwritten", publicFarmLabel: "", farmerId: "", fieldArea: 1, gpsCoords: "", cadastralNumber: "", crop: "sunflower" }, treatment: { treatmentType: "herbicide", treatmentDate: "", treatmentTime: "", timeZone: "", treatedAreaHectares: 1, droneModel: "", droneSerial: "", operator: "", pilotCert: "", notes: "" }, meteo: { temperatureCelsius: 1, humidityPercent: 1, windSpeedMps: 1, rainfallMm: 0, measuredAt: "2026-09-01T06:30:00.000Z" }, chemical: { chemical: "", chemicalActive: "", dose: 1, doseUnit: "L_PER_HA", workingVolume: 1, manufacturer: "", regNumber: "", supplierName: "", supplierEdrpou: "" } } }], ["DELETE", `/api/drafts/${draftA}`],
    ["GET", `/api/drafts/${draftA}/evidence`], ["POST", `/api/drafts/${draftA}/evidence`, { kind: "METEO", filename: "x.txt", contentType: "text/plain", sizeBytes: 1, sha256: "0".repeat(64) }],
    ["POST", `/api/drafts/${draftA}/evidence/${fake}/complete`], ["DELETE", `/api/drafts/${draftA}/evidence/${fake}`], ["GET", `/api/drafts/${draftA}/evidence/${fake}/preview`],
    ["POST", `/api/passports/${draftA}/submit`, { version: 1 }], ["POST", `/api/passports/${draftA}/reopen`, { version: 1 }], ["GET", `/api/passports/${draftA}/evidence/${fake}/preview`],
    ["GET", "/api/passports/mine"], ["POST", "/api/feedback", { message: "x" }]];
  for (const [method, p, body] of ownerRoutes) {
    const anon = await api(p, { method, body });
    note(refusal.anonymous.includes(anon.status), `anonymous ${method} ${p.replace(draftA, "{A}")} → ${anon.status}`);
    if (p.includes(draftA)) {
      const other = await api(p, { user: b, method, body });
      note(denied(other.status), `other operator ${method} ${p.replace(draftA, "{A}")} → ${other.status}`);
    }
  }
  { const own = await api(`/api/drafts/${draftA}`, { user: a }); const body = await own.json(); note(own.status === 200 && JSON.stringify(body).indexOf("Overwritten") < 0, "owner still reads the draft unchanged after the probes"); }
  { const ownPatch = await api(`/api/drafts/${draftA}`, { user: a, method: "PATCH", body: ownerRoutes[2][2] }); rows.push(`INFO owner PATCH with the same body → ${ownPatch.status} ${(await ownPatch.text()).slice(0, 200)}`); }

  // 2. Admin routes: anonymous, operator, admin with MFA pending, admin with MFA but never verified this session.
  const adminRoutes = [["GET", "/api/admin/overview"], ["GET", "/api/admin/passports"], ["GET", `/api/admin/passports/${draftA}`], ["POST", `/api/admin/passports/${draftA}/assign`, {}],
    ["POST", `/api/admin/passports/${draftA}/decision`, {}], ["GET", `/api/admin/passports/${draftA}/evidence-access`], ["POST", `/api/admin/passports/${draftA}/evidence-access`, {}],
    ["GET", `/api/admin/passports/${draftA}/evidence/${fake}/preview`], ["GET", `/api/admin/passports/${draftA}/holds`], ["POST", `/api/admin/passports/${draftA}/holds`, {}],
    ["GET", `/api/admin/passports/${draftA}/public-preview`], ["POST", `/api/admin/passports/${draftA}/public-confirmation`, {}], ["DELETE", `/api/admin/passports/${draftA}/public-confirmation`, {}],
    ["GET", `/api/admin/passports/${draftA}/publication`], ["POST", `/api/admin/passports/${draftA}/publication/correction`, {}], ["POST", `/api/admin/passports/${draftA}/publication/withdrawal`, {}],
    ["POST", `/api/admin/passports/${draftA}/publication/wallet-challenge`, {}], ["POST", `/api/admin/passports/${draftA}/publication/wallet-proof`, {}],
    ["POST", `/api/admin/passports/${draftA}/publication/pin-attempts`, {}], ["DELETE", `/api/admin/passports/${draftA}/publication/pin-attempts`, {}],
    ["POST", `/api/admin/passports/${draftA}/publication/pin-attempts/upload`, {}], ["POST", `/api/admin/passports/${draftA}/publication/pin-attempts/readback`, {}],
    ["GET", `/api/admin/passports/${draftA}/publication/mint`], ["POST", `/api/admin/passports/${draftA}/publication/mint/preparation`, {}], ["POST", `/api/admin/passports/${draftA}/publication/mint/dispatch`, {}],
    ["POST", `/api/admin/passports/${draftA}/publication/mint/report`, {}], ["POST", `/api/admin/passports/${draftA}/publication/mint/check`, {}],
    ["GET", `/api/admin/passports/${draftA}/publication/mint/cancellation?attemptId=${fake}&discoveryId=${fake}`], ["POST", `/api/admin/passports/${draftA}/publication/mint/cancellation`, { attemptId: fake }],
    ["GET", `/api/admin/passports/${draftA}/publication/mint/incident?attemptId=${fake}`], ["POST", `/api/admin/passports/${draftA}/publication/mint/incident`, { attemptId: fake, action: "RESTORE" }],
    ["GET", "/api/admin/records"], ["GET", `/api/admin/records/passport/${draftA}`], ["GET", "/api/admin/users"], ["POST", "/api/admin/users", { name: "x", email: `x-${suffix}@example.invalid` }],
    ["PATCH", `/api/admin/users/${fake}`, {}]];
  for (const [method, p, body] of adminRoutes) {
    const statuses = [];
    for (const [label, user] of [["anonymous", undefined], ["operator", a], ["admin-mfa-pending", halfAdmin]]) {
      const r = await api(p, { user, method, body }); statuses.push(`${label}=${r.status}`);
      if (!refusal[label].includes(r.status)) note(false, `${label} ${method} ${p.replace(draftA, "{A}")} → ${r.status} ${(await r.text()).slice(0, 120)}`);
    }
    note(true, `admin route ${method} ${p.replace(draftA, "{A}").replace(fake, "{f}")} denied (${statuses.join(", ")})`);
  }
  const usersStatus = (await api(`/api/admin/users`, { user: admin })).status, invited = await db.user.count({ where: { email: `x-${suffix}@example.invalid` } });
  note(invited === 0, `no user was invited by the unauthorized probes (admin users list ${usersStatus}, invited ${invited})`);

  // 3. Cross-site requests: wrong and missing Origin on state-changing calls, with valid cookies.
  for (const [label, origin] of [["foreign origin", "https://evil.example.invalid"], ["missing origin", null], ["lookalike origin", base.replace("127.0.0.1", "127.0.0.1.evil.example.invalid")], ["null origin", "null"]]) {
    const draft = await api("/api/drafts", { user: a, method: "POST", origin });
    note(draft.status === 403, `${label}: operator POST /api/drafts → ${draft.status}`);
    const patch = await api(`/api/drafts/${draftA}`, { user: a, method: "PATCH", origin, body: { version: 1, data: {} } });
    note(patch.status === 403, `${label}: operator PATCH draft → ${patch.status}`);
    const invite = await api("/api/admin/users", { user: admin, method: "POST", origin, body: { name: "x", email: `y-${suffix}@example.invalid` } });
    note(invite.status === 403, `${label}: admin invite → ${invite.status}`);
  }

  // 4. Invite-only: public sign-up refused; reset does not reveal accounts.
  const signUp = await api("/api/auth/sign-up/email", { method: "POST", body: { name: "x", email: `signup-${suffix}@example.invalid`, password } });
  note(signUp.status >= 400 && (await db.user.count({ where: { email: `signup-${suffix}@example.invalid` } })) === 0, `public sign-up refused (${signUp.status})`);
  const resetKnown = await api("/api/auth/request-password-reset", { method: "POST", body: { email: emails.b, redirectTo: `${base}/reset-password` }, forwarded: "198.18.250.1" });
  const resetUnknown = await api("/api/auth/request-password-reset", { method: "POST", body: { email: `nobody-${suffix}@example.invalid`, redirectTo: `${base}/reset-password` }, forwarded: "198.18.250.2" });
  note(resetKnown.status === resetUnknown.status && (await resetKnown.text()) === (await resetUnknown.text()), `password reset answers the same for known and unknown accounts (${resetKnown.status}/${resetUnknown.status})`);
  const openRedirect = await api("/api/auth/request-password-reset", { method: "POST", body: { email: emails.b, redirectTo: "https://evil.example.invalid/steal" }, forwarded: "198.18.250.3" });
  note(openRedirect.status >= 400, `reset link to a foreign site refused (${openRedirect.status})`);
  const loginRedirect = await api("/api/auth/sign-in/email", { method: "POST", body: { email: emails.b, password, callbackURL: "https://evil.example.invalid/" }, forwarded: "198.18.250.4" });
  note(loginRedirect.status === 403 || loginRedirect.status === 400, `sign-in with a foreign callback URL refused (${loginRedirect.status})`);

  // 5. Brute force: repeated wrong passwords from one address are throttled.
  let throttled = 0, statuses = [];
  for (let i = 0; i < 12; i++) { const r = await api("/api/auth/sign-in/email", { method: "POST", body: { email: emails.b, password: `wrong-${i}-aA1!` }, forwarded: "198.18.251.9" }); statuses.push(r.status); if (r.status === 429) throttled++; }
  note(throttled > 0, `wrong-password attempts are rate limited (${statuses.join(",")})`);
  let totpThrottled = 0; statuses = [];
  const brute = jar(); await api("/api/auth/sign-in/email", { user: brute, method: "POST", body: { email: emails.admin, password }, forwarded: "198.18.251.10" });
  for (let i = 0; i < 12; i++) { const r = await api("/api/auth/two-factor/verify-totp", { user: brute, method: "POST", body: { code: String(100000 + i) }, forwarded: "198.18.251.10" }); statuses.push(r.status); if (r.status === 429) totpThrottled++; }
  note(totpThrottled > 0, `wrong TOTP codes are rate limited (${statuses.join(",")})`);

  // 6. Sign-out invalidates the session server-side.
  const c = jar(); await api("/api/auth/sign-in/email", { user: c, method: "POST", body: { email: emails.b, password }, forwarded: "198.18.252.1" });
  const stolen = c.header();
  await api("/api/auth/sign-out", { user: c, method: "POST", body: {} });
  const replay = await fetch(new URL("/api/drafts", base), { headers: { cookie: stolen } });
  note(replay.status === 401, `a signed-out session cookie is rejected (${replay.status})`);

  // 7. Malformed input never causes a server error.
  const version = (await (await api(`/api/drafts/${draftA}`, { user: a })).json()).draft.version;
  const bad = [["not JSON", "{not json"], ["array", "[]"], ["null", "null"], ["string version", JSON.stringify({ version: "1", data: {} })],
    ["negative area", JSON.stringify({ version, data: { farmer: { fieldArea: -5 } } })], ["huge number", JSON.stringify({ version, data: { farmer: { fieldArea: 1e308 } } })],
    ["prototype key", `{"version":${version},"data":{"__proto__":{"admin":true},"farmer":{"constructor":{"prototype":{"x":1}}}}}`],
    ["wrong type", JSON.stringify({ version, data: { meteo: { temperatureCelsius: "hot" } } })], ["unknown section", JSON.stringify({ version, data: { evil: { x: 1 } } })],
    ["very long text", JSON.stringify({ version, data: { farmer: { farmerName: "x".repeat(200_000) } } })], ["2 MB body", JSON.stringify({ version, data: { farmer: { farmerName: "y".repeat(2_000_000) } } })],
    ["control characters", JSON.stringify({ version, data: { farmer: { farmerName: "a\u0000b‮c" } } })]];
  for (const [label, rawBody] of bad) {
    const r = await api(`/api/drafts/${draftA}`, { user: a, method: "PATCH", rawBody });
    const text = await r.text();
    note(r.status < 500 && !/at .*\.(js|ts):\d+|prisma|stack/i.test(text), `draft PATCH with ${label} → ${r.status}${r.status === 200 ? " (accepted)" : ""}`);
  }
  for (const id of ["not-a-uuid", "1", "' OR 1=1 --", "%00", "..%2F..%2Fetc%2Fpasswd", "a".repeat(5000)]) {
    const r = await api(`/api/drafts/${encodeURIComponent(id)}`, { user: a });
    note(r.status < 500, `draft GET with id ${JSON.stringify(id.slice(0, 20))} → ${r.status}`);
    const r2 = await api(`/api/admin/passports/${encodeURIComponent(id)}`, { user: admin });
    note(r2.status < 500, `admin GET passport ${JSON.stringify(id.slice(0, 20))} → ${r2.status}`);
  }
  for (const id of ["0", "-1", "01", "1e3", "abc", "9".repeat(100), "1.5", " 1", "0x1", "115792089237316195423570985008687907853269984665640564039457584007913129639936"]) {
    const r = await fetch(new URL(`/passports/${encodeURIComponent(id)}`, base));
    note(r.status < 500, `public page /passports/${JSON.stringify(id.slice(0, 24))} → ${r.status}`);
  }

  // 8. Legacy demo routes stay closed in production.
  for (const [method, p] of [["POST", "/api/mint"], ["POST", "/api/ipfs/pin"], ["POST", "/api/files/upload"], ["POST", "/api/diia/sign"], ["POST", "/api/diia/verify"], ["GET", "/api/passport/1"], ["GET", "/verify/1"]]) {
    const r = await api(p, { user: admin, method, body: method === "POST" ? {} : undefined });
    note(r.status >= 400 && r.status !== 500, `legacy ${method} ${p} closed for a verified admin (${r.status})`);
  }

  // 9. Response headers.
  for (const p of ["/", "/login", "/admin", `/passports/1`, "/api/drafts"]) {
    const r = await fetch(new URL(p, base), { redirect: "manual", headers: p === "/api/drafts" ? { cookie: a.header() } : {} });
    const h = Object.fromEntries(r.headers);
    note(h["x-frame-options"] === "DENY" && h["x-content-type-options"] === "nosniff", `${p}: frame/nosniff headers (${r.status})`);
    note(!h["x-powered-by"], `${p}: no X-Powered-By`);
    note(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(h["content-security-policy"] ?? "") || p.startsWith("/api/"), `${p}: nonce CSP for scripts`);
    rows.push(`INFO ${p}: referrer-policy=${h["referrer-policy"]}; cache-control=${h["cache-control"]}; hsts=${h["strict-transport-security"] ? "set" : "absent (TLS terminator)"}`);
  }
  const apiCache = (await fetch(new URL("/api/drafts", base), { headers: { cookie: a.header() } })).headers.get("cache-control");
  note(/no-store|private/.test(apiCache ?? ""), `private API responses are not cacheable (${apiCache})`);
} catch (error) {
  note(false, `aborted: ${error.stack?.split("\n").slice(0, 3).join(" ")}`);
} finally {
  if (server?.pid && server.exitCode === null) { const exited = onceEvent(server, "exit"); server.kill(); await exited; }
  for (const email of [...Object.values(emails), `signup-${suffix}@example.invalid`, `x-${suffix}@example.invalid`, `y-${suffix}@example.invalid`]) {
    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) continue;
    for (const passport of await db.passport.findMany({ where: { ownerId: user.id }, select: { id: true, farmerId: true, fieldId: true } })) {
      for (const model of ["auditLog", "evidenceFile", "chemicalApplication", "meteoMeasurement", "treatment", "draftRetentionNotice"]) await db[model].deleteMany({ where: { passportId: passport.id } });
      await db.passport.delete({ where: { id: passport.id } });
      await db.field.deleteMany({ where: { id: passport.fieldId } }); await db.farmer.deleteMany({ where: { id: passport.farmerId } });
    }
    await db.field.deleteMany({ where: { ownerId: user.id } }); await db.farmer.deleteMany({ where: { ownerId: user.id } });
    await db.feedback?.deleteMany?.({ where: { userId: user.id } }).catch(() => {});
    await db.adminAction.deleteMany({ where: { OR: [{ actorId: user.id }, { targetUserId: user.id }] } }).catch(() => db.adminAction.deleteMany({ where: { actorId: user.id } }).catch(() => {}));
    await db.user.delete({ where: { id: user.id } }).catch(e => rows.push(`CLEANUP ${email}: ${e.message.split("\n")[0]}`));
  }
  const newKeys = (await db.rateLimit.findMany({ select: { key: true } })).map(r => r.key).filter(k => !rateBefore.has(k));
  await db.rateLimit.deleteMany({ where: { key: { in: newKeys } } });
  await db.$disconnect();
  process.stdout.write(rows.join("\n") + "\n");
}
