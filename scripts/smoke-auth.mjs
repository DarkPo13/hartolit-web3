// Run against a local dev server and the isolated Docker services only.
// All fixture users and captured reset messages created here are removed.
import assert from "node:assert/strict";
import { randomBytes, createHmac } from "node:crypto";
import { createJiti } from "jiti";

const base = "http://localhost:3000";
const mailpit = "http://127.0.0.1:8025";
const jiti = createJiti(import.meta.url);
const [{ auth }, { getDb }] = await Promise.all([
  jiti.import("../auth.cli.ts"),
  jiti.import("../lib/db-core.ts"),
]);
const db = getDb();
const suffix = randomBytes(8).toString("hex");
const testIp = `198.51.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}`;
const operatorEmail = `phase1-operator-${suffix}@example.invalid`;
const adminEmail = `phase1-admin-${suffix}@example.invalid`;
const password = `${randomBytes(24).toString("base64url")}aA1!`;
const createdEmails = [operatorEmail, adminEmail];
const capturedIds = [];

function makeJar() {
  const cookies = new Map();
  return {
    header() { return [...cookies].map(([name, value]) => `${name}=${value}`).join("; "); },
    add(response) {
      for (const header of response.headers.getSetCookie()) {
        const [pair] = header.split(";");
        const divider = pair.indexOf("=");
        if (divider < 0) continue;
        const name = pair.slice(0, divider);
        const value = pair.slice(divider + 1);
        if (value) cookies.set(name, value);
        else cookies.delete(name);
      }
    },
  };
}

async function request(path, { jar, body, method = body ? "POST" : "GET", origin = base } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(origin ? { origin } : {}),
      "x-forwarded-for": testIp,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(jar?.header() ? { cookie: jar.header() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  jar?.add(response);
  return response;
}

function totp(uri) {
  const secret = new URL(uri).searchParams.get("secret");
  assert.ok(secret);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const letter of secret.toUpperCase().replace(/=+$/, "")) bits += alphabet.indexOf(letter).toString(2).padStart(5, "0");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

try {
  const loginPage = await request("/login");
  assert.equal(loginPage.status, 200, "login page renders");
  assert.equal((await request("/")).headers.get("location"), "/login", "anonymous home denied");
  assert.equal((await request("/api/auth/admin/list-users")).status, 401, "anonymous admin API denied");
  assert.equal((await request("/api/auth/sign-up/email", { body: { name: "Unknown", email: `unknown-${suffix}@example.invalid`, password } })).status, 400, "public signup disabled");

  await auth.api.createUser({ body: { name: "Smoke Operator", email: operatorEmail, password, role: "user" } });
  await auth.api.createUser({ body: { name: "Smoke Admin", email: adminEmail, password, role: "admin" } });

  const operator = makeJar();
  const operatorLogin = await request("/api/auth/sign-in/email", { jar: operator, body: { email: operatorEmail, password } });
  assert.equal(operatorLogin.status, 200, "operator sign in");
  assert.equal((await request("/", { jar: operator })).status, 200, "operator home allowed");
  assert.equal((await request("/admin", { jar: operator })).headers.get("location"), "/", "operator admin page denied");
  assert.equal((await request("/api/auth/admin/list-users", { jar: operator })).status, 403, "operator admin API denied");
  await request("/api/auth/update-user", { jar: operator, body: { role: "admin" } });
  assert.equal((await db.user.findUniqueOrThrow({ where: { email: operatorEmail } })).role, "user", "self-service role change ignored");
  assert.equal((await request("/api/mint", { jar: operator, body: {}, origin: null })).status, 403, "write without origin denied");

  await db.user.update({ where: { email: operatorEmail }, data: { banned: true } });
  assert.equal((await request("/", { jar: operator })).headers.get("location"), "/login", "ban takes effect immediately");
  assert.equal((await request("/api/mint", { jar: operator, body: {} })).status, 401, "banned write denied");
  await db.user.update({ where: { email: operatorEmail }, data: { banned: false } });

  const admin = makeJar();
  assert.equal((await request("/api/auth/sign-in/email", { jar: admin, body: { email: adminEmail, password } })).status, 200, "admin sign in");
  assert.equal((await request("/", { jar: admin })).headers.get("location"), "/settings/security", "admin must enroll MFA");
  assert.equal((await request("/api/auth/admin/list-users", { jar: admin })).status, 403, "admin API denied before MFA");
  const enrollment = await request("/api/auth/two-factor/enable", { jar: admin, body: { password, method: "totp" } });
  assert.equal(enrollment.status, 200, "MFA enrollment starts");
  const { totpURI } = await enrollment.json();
  assert.ok(totpURI);
  const verified = await request("/api/auth/two-factor/verify-totp", { jar: admin, body: { code: totp(totpURI) } });
  assert.equal(verified.status, 200, "MFA enrollment verifies");
  assert.equal((await request("/admin", { jar: admin })).headers.get("location"), "/login", "enrollment revokes old sessions");
  const adminVerified = makeJar();
  const challenge = await request("/api/auth/sign-in/email", { jar: adminVerified, body: { email: adminEmail, password } });
  assert.equal(challenge.status, 200, "admin credential accepted");
  assert.equal((await challenge.json()).twoFactorRedirect, true, "MFA challenge required on next login");
  assert.equal((await request("/admin", { jar: adminVerified })).headers.get("location"), "/login", "MFA challenge is not a session");
  assert.equal((await request("/api/auth/two-factor/verify-totp", { jar: adminVerified, body: { code: totp(totpURI) } })).status, 200, "MFA login succeeds");
  assert.equal((await request("/admin", { jar: adminVerified })).status, 200, "admin page opens after MFA");
  assert.equal((await request("/api/auth/admin/list-users", { jar: adminVerified })).status, 200, "admin API opens after MFA");
  assert.equal((await request("/api/auth/admin/impersonate-user", { jar: adminVerified, body: { userId: "none" } })).status, 404, "unsafe admin operation remains unavailable");

  const reset = await request("/api/auth/request-password-reset", { body: { email: operatorEmail, redirectTo: `${base}/reset-password` } });
  assert.equal(reset.status, 200, "reset request accepted");
  let message;
  for (let attempt = 0; attempt < 15; attempt++) {
    const inbox = await (await fetch(`${mailpit}/api/v1/messages?limit=20`)).json();
    message = inbox.messages?.find((item) => item.To?.some((recipient) => recipient.Address === operatorEmail));
    if (message) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(message, "reset email reached local inbox");
  capturedIds.push(message.ID);
  const fullMessage = await (await fetch(`${mailpit}/api/v1/message/${message.ID}`)).json();
  const link = fullMessage.Text?.match(/https?:\/\/[^\s]+/)?.[0];
  assert.ok(link, "reset link present");
  const callback = await fetch(link, { redirect: "manual" });
  assert.equal(callback.status, 302, "reset link callback redirects");
  const token = new URL(callback.headers.get("location")).searchParams.get("token");
  assert.ok(token, "callback carries reset token");
  const newPassword = `${randomBytes(24).toString("base64url")}bB2!`;
  assert.equal((await request("/api/auth/reset-password", { body: { token, newPassword } })).status, 200, "password reset succeeds");
  assert.equal((await request("/", { jar: operator })).headers.get("location"), "/login", "reset revoked old session");
  assert.notEqual((await request("/api/auth/sign-in/email", { body: { email: operatorEmail, password } })).status, 200, "old password rejected");
  assert.equal((await request("/api/auth/sign-in/email", { body: { email: operatorEmail, password: newPassword } })).status, 200, "new password works");

  console.log("PASS: signup denied, roles enforced, ban immediate, admin MFA, SMTP reset, session revocation");
} finally {
  await db.user.deleteMany({ where: { email: { in: createdEmails } } });
  assert.equal(await db.user.count({ where: { email: { in: createdEmails } } }), 0, "fixture users removed");
  if (capturedIds.length) {
    const deletion = await fetch(`${mailpit}/api/v1/messages`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ IDs: capturedIds }),
    });
    assert.equal(deletion.status, 200, "fixture reset messages removed");
  }
  await db.$disconnect();
}
