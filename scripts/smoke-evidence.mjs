// Fictional fixtures only. Every created database row and object is removed on exit.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createJiti } from "jiti";

nextEnv.loadEnvConfig(process.cwd());
const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const jiti = createJiti(import.meta.url);
const [{ auth }, { getDb }] = await Promise.all([jiti.import("../auth.cli.ts"), jiti.import("../lib/db-core.ts")]);
const db = getDb();
const s3 = new S3Client({ region: process.env.EVIDENCE_S3_REGION, endpoint: process.env.EVIDENCE_S3_ENDPOINT || undefined, forcePathStyle: Boolean(process.env.EVIDENCE_S3_ENDPOINT), credentials: { accessKeyId: process.env.EVIDENCE_S3_ACCESS_KEY, secretAccessKey: process.env.EVIDENCE_S3_SECRET_KEY } });
const bucket = process.env.EVIDENCE_S3_BUCKET;
const suffix = randomBytes(8).toString("hex");
const testIp = `198.51.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}`;
const emails = [`evidence-a-${suffix}@example.invalid`, `evidence-b-${suffix}@example.invalid`];
const password = `${randomBytes(24).toString("base64url")}aA1!`;
const ids = [];
let draftId;
const jar = () => ({ cookies: new Map(), header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }, add(response) { for (const header of response.headers.getSetCookie()) { const [pair] = header.split(";"); const i = pair.indexOf("="); if (i >= 0) this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); } } });

async function api(path, { user, method = "GET", body, origin = base } = {}) {
  const response = await fetch(new URL(path, base), { method, redirect: "manual", headers: { ...(origin ? { origin } : {}), "x-forwarded-for": testIp, ...(body ? { "content-type": "application/json" } : {}), ...(user ? { cookie: user.header() } : {}) }, body: body ? JSON.stringify(body) : undefined });
  user?.add(response);
  return response;
}

async function reserve(user, bytes, filename = "weather.txt", declaredHash) {
  const sha256 = declaredHash ?? createHash("sha256").update(bytes).digest("hex");
  const response = await api(`/api/drafts/${draftId}/evidence`, { user, method: "POST", body: { kind: "METEO", filename, contentType: "text/plain", sizeBytes: bytes.length, sha256 } });
  assert.equal(response.status, 201, `reservation: ${await response.clone().text()}`);
  const result = await response.json();
  ids.push(result.file.id);
  assert.equal(result.file.objectKey, undefined, "private object key is never returned");
  assert.equal(result.file.ownerId, undefined, "owner metadata is never returned");
  return result;
}

async function directUpload(reservation, bytes, filename = "weather.txt") {
  const form = new FormData();
  for (const [key, value] of Object.entries(reservation.upload.fields)) form.append(key, value);
  form.append("file", new Blob([bytes], { type: "text/plain" }), filename);
  const response = await fetch(reservation.upload.url, { method: "POST", body: form });
  assert.ok(response.ok, `signed upload: ${response.status} ${await response.text()}`);
}

try {
  assert.equal((await api("/api/drafts/00000000-0000-0000-0000-000000000000/evidence")).status, 401);
  for (const email of emails) await auth.api.createUser({ body: { name: "Fictional Evidence Tester", email, password, role: "user" } });
  const a = jar(), b = jar();
  assert.equal((await api("/api/auth/sign-in/email", { user: a, method: "POST", body: { email: emails[0], password } })).status, 200);
  assert.equal((await api("/api/auth/sign-in/email", { user: b, method: "POST", body: { email: emails[1], password } })).status, 200);
  const draftResponse = await api("/api/drafts", { user: a, method: "POST" });
  assert.equal(draftResponse.status, 201);
  draftId = (await draftResponse.json()).draft.id;
  const path = `/api/drafts/${draftId}/evidence`;
  assert.equal((await api(path, { user: b })).status, 404, "other owner cannot list");
  assert.equal((await api(path, { user: a, method: "POST", origin: "https://evil.invalid", body: {} })).status, 403, "cross-origin reservation denied");
  assert.equal((await api(path, { user: a, method: "POST", body: { kind: "METEO", filename: "script.exe", contentType: "text/plain", sizeBytes: 10, sha256: "a".repeat(64) } })).status, 400, "unsafe extension denied");
  const bytes = Buffer.from("fictional weather evidence\n");
  const good = await reserve(a, bytes);
  assert.equal((await api(`${path}/${good.file.id}/preview`, { user: a })).status, 404, "pending file cannot be downloaded");
  assert.equal((await api(`${path}/${good.file.id}/complete`, { user: b, method: "POST" })).status, 404, "other owner cannot complete");
  const unsigned = await fetch(`${process.env.EVIDENCE_S3_ENDPOINT}/${bucket}/quarantine/${good.file.id}`);
  assert.ok(unsigned.status === 403 || unsigned.status === 404, `anonymous bucket read denied: ${unsigned.status}`);
  await directUpload(good, bytes);
  const completeResponse = await api(`${path}/${good.file.id}/complete`, { user: a, method: "POST" });
  assert.equal(completeResponse.status, 200, `complete: ${await completeResponse.clone().text()}`);
  assert.equal((await completeResponse.json()).file.status, "READY");
  const preview = await api(`${path}/${good.file.id}/preview`, { user: a });
  assert.equal(preview.status, 307, "owner receives a redirect to a short-lived URL");
  const signedUrl = preview.headers.get("location");
  assert.match(signedUrl, /X-Amz-Expires=60/);
  assert.equal((await api(`${path}/${good.file.id}/preview`, { user: b })).status, 404, "other owner cannot preview");
  const downloaded = await fetch(signedUrl);
  assert.equal(downloaded.status, 200);
  assert.equal(Buffer.compare(Buffer.from(await downloaded.arrayBuffer()), bytes), 0);
  const finalObjectKey = (await db.evidenceFile.findUniqueOrThrow({ where: { id: good.file.id } })).objectKey;
  const shortUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: finalObjectKey }), { expiresIn: 1 });
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert.notEqual((await fetch(shortUrl)).status, 200, "expired signed link denied");
  const wrong = await reserve(a, bytes, "wrong.txt", "0".repeat(64));
  await directUpload(wrong, bytes, "wrong.txt");
  assert.equal((await api(`${path}/${wrong.file.id}/complete`, { user: a, method: "POST" })).status, 409, "hash mismatch rejected");
  assert.equal((await api(`${path}/${wrong.file.id}/preview`, { user: a })).status, 404);
  const eicar = Buffer.from(["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join(""));
  const infected = await reserve(a, eicar, "scanner.txt");
  await directUpload(infected, eicar, "scanner.txt");
  assert.equal((await api(`${path}/${infected.file.id}/complete`, { user: a, method: "POST" })).status, 409, "malware test signature rejected");
  assert.equal((await api(`${path}/${infected.file.id}/preview`, { user: a })).status, 404);
  assert.equal((await db.evidenceFile.count({ where: { id: { in: ids }, status: "READY" } })), 1);
  assert.equal((await api(`${path}/${good.file.id}`, { user: b, method: "DELETE" })).status, 404, "other owner cannot remove");
  assert.equal((await api(`${path}/${good.file.id}`, { user: a, method: "DELETE" })).status, 204, "owner can remove");
  assert.equal((await api(`${path}/${good.file.id}/preview`, { user: a })).status, 404, "removed file cannot be previewed");
  assert.equal((await db.evidenceFile.findUniqueOrThrow({ where: { id: good.file.id } })).rejectionCode, "REMOVED");
  process.stdout.write("Evidence smoke passed: private bucket, owner and origin, direct upload, hash and scanner, preview, expiry, removal.\n");
} finally {
  for (const id of ids) {
    const file = await db.evidenceFile.findUnique({ where: { id }, select: { objectKey: true } });
    for (const key of new Set([`quarantine/${id}`, file?.objectKey].filter(Boolean))) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
  }
  if (draftId) {
    const draft = await db.passport.findUnique({ where: { id: draftId }, select: { farmerId: true, fieldId: true } });
    if (draft) {
      await db.auditLog.deleteMany({ where: { passportId: draftId } });
      await db.evidenceFile.deleteMany({ where: { passportId: draftId } });
      await db.chemicalApplication.deleteMany({ where: { passportId: draftId } });
      await db.meteoMeasurement.deleteMany({ where: { passportId: draftId } });
      await db.treatment.deleteMany({ where: { passportId: draftId } });
      await db.passport.delete({ where: { id: draftId } });
      await db.field.delete({ where: { id: draft.fieldId } });
      await db.farmer.delete({ where: { id: draft.farmerId } });
    }
  }
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect();
  s3.destroy();
}
