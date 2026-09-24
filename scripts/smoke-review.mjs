// Fictional fixtures only. Removes its users, passports, audit entries, and objects.
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createJiti } from "jiti";

nextEnv.loadEnvConfig(process.cwd());
const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const jiti = createJiti(import.meta.url);
const [{ auth }, { getDb }] = await Promise.all([jiti.import("../auth.cli.ts"), jiti.import("../lib/db-core.ts")]);
const db = getDb();
const s3 = new S3Client({ region: process.env.EVIDENCE_S3_REGION, endpoint: process.env.EVIDENCE_S3_ENDPOINT || undefined, forcePathStyle: Boolean(process.env.EVIDENCE_S3_ENDPOINT), credentials: { accessKeyId: process.env.EVIDENCE_S3_ACCESS_KEY, secretAccessKey: process.env.EVIDENCE_S3_SECRET_KEY } });
const suffix = randomBytes(8).toString("hex");
const emails = [`review-operator-${suffix}@example.invalid`, `review-admin-${suffix}@example.invalid`];
const password = `${randomBytes(24).toString("base64url")}aA1!`;
const ip = `198.51.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}`;
const files = [];
let passportId;

function jar() {
  const cookies = new Map();
  return { header: () => [...cookies].map(([key, value]) => `${key}=${value}`).join("; "), add(response) { for (const header of response.headers.getSetCookie()) { const [pair] = header.split(";"); const i = pair.indexOf("="); if (i >= 0) cookies.set(pair.slice(0, i), pair.slice(i + 1)); } } };
}

async function api(path, { user, method = "GET", body, origin = base } = {}) {
  const response = await fetch(new URL(path, base), { method, redirect: "manual", headers: { ...(origin ? { origin } : {}), "x-forwarded-for": ip, ...(body ? { "content-type": "application/json" } : {}), ...(user ? { cookie: user.header() } : {}) }, body: body ? JSON.stringify(body) : undefined });
  user?.add(response);
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
  return ((digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

async function uploadEvidence(user, kind) {
  const bytes = Buffer.from(`fictional ${kind.toLowerCase()} evidence\n`);
  const filename = `${kind.toLowerCase()}.txt`;
  const reservation = await api(`/api/drafts/${passportId}/evidence`, { user, method: "POST", body: { kind, filename, contentType: "text/plain", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } });
  assert.equal(reservation.status, 201, `reserve ${kind}: ${await reservation.clone().text()}`);
  const result = await reservation.json();
  files.push(result.file.id);
  const form = new FormData();
  for (const [key, value] of Object.entries(result.upload.fields)) form.append(key, value);
  form.append("file", new Blob([bytes], { type: "text/plain" }), filename);
  const posted = await fetch(result.upload.url, { method: "POST", body: form });
  assert.ok(posted.ok, `upload ${kind}: ${posted.status}`);
  const completed = await api(`/api/drafts/${passportId}/evidence/${result.file.id}/complete`, { user, method: "POST" });
  assert.equal(completed.status, 200, `complete ${kind}: ${await completed.clone().text()}`);
  return result.file.id;
}

const data = {
  farmer: { farmerName: "Fictional Review Farm", farmerId: "FICTIONAL-REVIEW", fieldArea: 12.5, gpsCoords: "49.0, 34.0", cadastralNumber: "", crop: "sunflower" },
  treatment: { treatmentType: "herbicide", treatmentDate: "2026-09-01", treatmentTime: "09:30", droneModel: "Fictional Drone", droneSerial: "", operator: "Test Pilot", pilotCert: "", notes: "" },
  meteo: { temperatureCelsius: 22.5, humidityPercent: 60, windSpeedMps: 2.5, rainfallMm: 0, measuredAt: "2026-09-01T09:30:00.000Z" },
  chemical: { chemical: "Fictional Product", chemicalActive: "", dose: 1.25, workingVolume: 25, manufacturer: "", regNumber: "", supplierName: "", supplierEdrpou: "" },
};

try {
  assert.equal((await api("/api/admin/overview")).status, 401);
  await auth.api.createUser({ body: { name: "Fictional Operator", email: emails[0], password, role: "user" } });
  await auth.api.createUser({ body: { name: "Fictional Admin", email: emails[1], password, role: "admin" } });
  const operator = jar(), admin = jar();
  assert.equal((await api("/api/auth/sign-in/email", { user: operator, method: "POST", body: { email: emails[0], password } })).status, 200);
  assert.equal((await api("/api/admin/overview", { user: operator })).status, 403);
  assert.equal((await api("/api/auth/sign-in/email", { user: admin, method: "POST", body: { email: emails[1], password } })).status, 200);
  assert.equal((await api("/api/admin/overview", { user: admin })).status, 403, "MFA required");
  const enable = await api("/api/auth/two-factor/enable", { user: admin, method: "POST", body: { password, method: "totp" } });
  assert.equal(enable.status, 200);
  const { totpURI } = await enable.json();
  assert.equal((await api("/api/auth/two-factor/verify-totp", { user: admin, method: "POST", body: { code: totp(totpURI) } })).status, 200);
  const verified = jar();
  assert.equal((await api("/api/auth/sign-in/email", { user: verified, method: "POST", body: { email: emails[1], password } })).status, 200);
  assert.equal((await api("/api/auth/two-factor/verify-totp", { user: verified, method: "POST", body: { code: totp(totpURI) } })).status, 200);
  assert.equal((await api("/api/admin/overview", { user: verified })).status, 200);
  const adminId = (await db.user.findUniqueOrThrow({ where: { email: emails[1] } })).id;

  const created = await api("/api/drafts", { user: operator, method: "POST" });
  assert.equal(created.status, 201);
  passportId = (await created.json()).draft.id;
  const saved = await api(`/api/drafts/${passportId}`, { user: operator, method: "PATCH", body: { version: 1, data } });
  assert.equal(saved.status, 200);
  let version = (await saved.json()).draft.version;
  const submitPath = `/api/passports/${passportId}/submit`;
  const incomplete = await api(submitPath, { user: operator, method: "POST", body: { version } });
  assert.equal(incomplete.status, 422, "verified evidence required");
  assert.deepEqual((await incomplete.json()).issues.sort(), ["chemicalEvidence", "meteoEvidence"]);
  const meteoId = await uploadEvidence(operator, "METEO");
  await uploadEvidence(operator, "CHEMICAL");
  assert.equal((await api(submitPath, { user: operator, method: "POST", body: { version }, origin: "https://evil.invalid" })).status, 403);
  const submitted = await api(submitPath, { user: operator, method: "POST", body: { version } });
  assert.equal(submitted.status, 200, `submit: ${await submitted.clone().text()}`);
  version = (await submitted.json()).passport.version;
  assert.equal((await api(`/api/drafts/${passportId}`, { user: operator })).status, 409, "submitted draft is frozen");
  assert.equal((await api(`/api/drafts/${passportId}`, { user: operator, method: "PATCH", body: { version, data } })).status, 409, "submitted draft cannot change");
  assert.equal((await api(`/api/drafts/${passportId}/evidence`, { user: operator, method: "POST", body: { kind: "OTHER", filename: "x.txt", contentType: "text/plain", sizeBytes: 1, sha256: "0".repeat(64) } })).status, 404, "submitted evidence cannot change");
  assert.equal((await api(`/api/admin/passports/${passportId}`, { user: operator })).status, 403);
  assert.equal((await api("/api/admin/records?view=users", { user: operator })).status, 403, "operator cannot inspect users");
  assert.equal((await api(`/api/passports/${passportId}/evidence/${meteoId}/preview`, { user: operator })).status, 307, "owner can still view submitted evidence");
  const detail = await api(`/api/admin/passports/${passportId}`, { user: verified });
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).passport.status, "SUBMITTED");
  assert.equal((await api(`/api/admin/passports/${passportId}/evidence/${meteoId}/preview`, { user: verified })).status, 307);
  assert.equal((await api(`/api/admin/passports?status=SUBMITTED&search=Fictional%20Review`, { user: verified })).status, 200);
  for (const view of ["farmers", "fields", "users", "publications", "audit"]) {
    const records = await api(`/api/admin/records?view=${view}`, { user: verified });
    assert.equal(records.status, 200, `${view} records load`);
    assert.ok(Array.isArray((await records.json()).items));
  }
  const assignment = await api(`/api/admin/passports/${passportId}/assign`, { user: verified, method: "POST", body: { version, reviewerId: adminId } });
  assert.equal(assignment.status, 200);
  version = (await assignment.json()).passport.version;
  assert.equal((await api(`/api/admin/passports/${passportId}/assign`, { user: verified, method: "POST", body: { version: version - 1, reviewerId: adminId } })).status, 409, "stale assignment rejected");
  assert.equal((await api(`/api/admin/passports/${passportId}/decision`, { user: verified, method: "POST", body: { version, decision: "CORRECTION_REQUIRED", note: "" } })).status, 422, "correction reason required");
  const corrected = await api(`/api/admin/passports/${passportId}/decision`, { user: verified, method: "POST", body: { version, decision: "CORRECTION_REQUIRED", note: "Check treatment note" } });
  assert.equal(corrected.status, 200);
  version = (await corrected.json()).passport.version;
  const mine = await api("/api/passports/mine", { user: operator });
  assert.equal(mine.status, 200);
  assert.equal((await mine.json()).passports.find((item) => item.id === passportId).reviewNote, "Check treatment note");
  const reopened = await api(`/api/passports/${passportId}/reopen`, { user: operator, method: "POST", body: { version } });
  assert.equal(reopened.status, 200);
  version = (await reopened.json()).passport.version;
  assert.equal((await api(`/api/drafts/${passportId}`, { user: operator })).status, 200, "correction draft editable");
  assert.equal((await api(submitPath, { user: operator, method: "POST", body: { version } })).status, 200, "resubmission succeeds");
  const after = await db.passport.findUniqueOrThrow({ where: { id: passportId } });
  assert.equal(after.status, "SUBMITTED");
  assert.equal((await api(`/api/admin/passports/${passportId}/decision`, { user: verified, method: "POST", body: { version: after.version, decision: "APPROVED", note: "Evidence checked" } })).status, 200);
  const approved = await db.passport.findUniqueOrThrow({ where: { id: passportId } });
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.approvedVersion, approved.submittedVersion, "approval pins the submitted version");
  const recalled = await api(`/api/admin/passports/${passportId}/decision`, { user: verified, method: "POST", body: { version: approved.version, decision: "CORRECTION_REQUIRED", note: "Recheck approved record" } });
  assert.equal(recalled.status, 200, "approved passport can be recalled before publication");
  version = (await recalled.json()).passport.version;
  const reopenedAgain = await api(`/api/passports/${passportId}/reopen`, { user: operator, method: "POST", body: { version } });
  assert.equal(reopenedAgain.status, 200);
  version = (await reopenedAgain.json()).passport.version;
  const submittedAgain = await api(submitPath, { user: operator, method: "POST", body: { version } });
  assert.equal(submittedAgain.status, 200);
  version = (await submittedAgain.json()).passport.version;
  const rejected = await api(`/api/admin/passports/${passportId}/decision`, { user: verified, method: "POST", body: { version, decision: "REJECTED", note: "Incorrect treatment" } });
  assert.equal(rejected.status, 200, "reject decision works");
  version = (await rejected.json()).passport.version;
  const reopenedRejected = await api(`/api/passports/${passportId}/reopen`, { user: operator, method: "POST", body: { version } });
  assert.equal(reopenedRejected.status, 200, "rejected passport can be reopened");
  version = (await reopenedRejected.json()).passport.version;
  const finalSubmission = await api(submitPath, { user: operator, method: "POST", body: { version } });
  assert.equal(finalSubmission.status, 200);
  version = (await finalSubmission.json()).passport.version;
  assert.equal((await api(`/api/admin/passports/${passportId}/decision`, { user: verified, method: "POST", body: { version, decision: "APPROVED", note: "Corrected" } })).status, 200);
  assert.equal((await db.passport.findUniqueOrThrow({ where: { id: passportId } })).status, "APPROVED");
  assert.equal((await db.auditLog.count({ where: { passportId, action: { in: ["PASSPORT_SUBMITTED", "REVIEW_ASSIGNED", "CORRECTION_REQUESTED", "PASSPORT_REOPENED", "REVIEW_REJECTED", "REVIEW_APPROVED"] } } })), 13);
  process.stdout.write("Review smoke passed: MFA, ownership, evidence freeze, submit, assign, conflict, correction, recall, rejection, resubmission, approval, audit.\n");
} finally {
  for (const id of files) {
    const file = await db.evidenceFile.findUnique({ where: { id }, select: { objectKey: true } });
    for (const key of new Set([`quarantine/${id}`, file?.objectKey].filter(Boolean))) await s3.send(new DeleteObjectCommand({ Bucket: process.env.EVIDENCE_S3_BUCKET, Key: key })).catch(() => undefined);
  }
  if (passportId) {
    const row = await db.passport.findUnique({ where: { id: passportId }, select: { farmerId: true, fieldId: true } });
    if (row) {
      await db.auditLog.deleteMany({ where: { passportId } });
      await db.evidenceFile.deleteMany({ where: { passportId } });
      await db.chemicalApplication.deleteMany({ where: { passportId } });
      await db.meteoMeasurement.deleteMany({ where: { passportId } });
      await db.treatment.deleteMany({ where: { passportId } });
      await db.passport.delete({ where: { id: passportId } });
      await db.field.delete({ where: { id: row.fieldId } });
      await db.farmer.delete({ where: { id: row.farmerId } });
    }
  }
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect(); s3.destroy();
}
