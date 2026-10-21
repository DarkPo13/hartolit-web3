// Fictional accounts only; validates private collection, retries and the per-user quota.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { createJiti } from "jiti";

nextEnv.loadEnvConfig(process.cwd());
const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const jiti = createJiti(import.meta.url);
const [{ auth }, { getDb }] = await Promise.all([jiti.import("../auth.cli.ts"), jiti.import("../lib/db-core.ts")]);
const db = getDb();
const suffix = randomBytes(8).toString("hex");
const emails = ["operator", "other", "admin"].map(role => `feedback-${role}-${suffix}@example.invalid`);
const password = `${randomBytes(24).toString("base64url")}aA1!`;
const ip = `198.51.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}`;

async function request(path, { cookie, body, origin = base } = {}) {
  return fetch(new URL(path, base), { method: body ? "POST" : "GET", redirect: "manual", headers: { origin, "x-forwarded-for": ip, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
}
const input = () => ({ id: randomUUID(), rating: 4, comment: `Fictional feedback ${suffix}: make the dose unit easier to find.` });

try {
  await db.$queryRaw`SELECT 1`;
  assert.equal((await request("/api/feedback", { body: input() })).status, 401);
  assert.equal((await request("/feedback")).status, 307);
  assert.equal((await request("/admin/feedback")).status, 307);
  const cookies = [];
  for (const [index, email] of emails.entries()) {
    await auth.api.createUser({ body: { name: "Fictional Feedback User", email, password, role: index === 2 ? "admin" : "user" } });
    const response = await request("/api/auth/sign-in/email", { body: { email, password } });
    assert.equal(response.status, 200);
    cookies.push(response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "));
  }
  const [cookie, other, unverifiedAdmin] = cookies;
  assert.equal((await request("/feedback", { cookie })).status, 200);
  assert.equal((await request("/admin/feedback", { cookie })).status, 307, "operators cannot see private feedback");
  assert.equal((await request("/api/feedback", { cookie: unverifiedAdmin, body: input() })).status, 403, "admin must enroll MFA");
  assert.equal((await request("/api/feedback", { cookie, origin: "https://evil.invalid", body: input() })).status, 403);
  for (const invalid of [{ ...input(), rating: 0 }, { ...input(), rating: 6 }, { ...input(), rating: 1.5 }, { ...input(), comment: "   " }, { ...input(), comment: "x".repeat(2001) }, { ...input(), userId: "forged" }]) {
    assert.equal((await request("/api/feedback", { cookie, body: invalid })).status, 400);
  }
  const first = input();
  const saved = await request("/api/feedback", { cookie, body: first });
  assert.equal(saved.status, 201);
  assert.match(saved.headers.get("cache-control"), /private.*no-store/);
  const row = await db.productFeedback.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal(row.rating, first.rating); assert.equal(row.comment, first.comment);
  assert.equal(row.userId, (await db.user.findUniqueOrThrow({ where: { email: emails[0] } })).id);
  assert.equal((await request("/api/feedback", { cookie, body: first })).status, 200, "retry returns the existing response");
  assert.equal((await request("/api/feedback", { cookie, body: { ...first, rating: 3 } })).status, 409);
  assert.equal((await request("/api/feedback", { cookie: other, body: first })).status, 409, "another account cannot reuse the response");
  const concurrent = await Promise.all(Array.from({ length: 6 }, () => request("/api/feedback", { cookie, body: input() })));
  assert.deepEqual(concurrent.map(response => response.status).sort(), [201, 201, 201, 201, 429, 429]);
  assert.equal(await db.productFeedback.count({ where: { userId: row.userId } }), 5, "quota is atomic under concurrent writes");
  assert.equal((await request("/api/feedback", { cookie, body: first })).status, 200, "quota does not block an identical retry");
  assert.equal((await request("/api/feedback", { cookie: other, body: input() })).status, 201, "quota is scoped to each account");
  console.log("Feedback smoke passed: auth/MFA, private reads, origin, strict validation, persisted values, ownership, idempotence and concurrent quota.");
} finally {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect();
}
