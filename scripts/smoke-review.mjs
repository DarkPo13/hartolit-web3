// Fictional fixtures only. Removes its users, passports, audit entries, and objects.
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createJiti } from "jiti";

nextEnv.loadEnvConfig(process.cwd());
const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const jiti = createJiti(import.meta.url);
const [{ auth }, { getDb }, { publicSnapshotSchema }, { canonicalize, sha256Json }] = await Promise.all([jiti.import("../auth.cli.ts"), jiti.import("../lib/db-core.ts"), jiti.import("../lib/public-snapshot/schema.ts"), jiti.import("../lib/hash.ts")]);
const db = getDb();
const s3 = new S3Client({ region: process.env.EVIDENCE_S3_REGION, endpoint: process.env.EVIDENCE_S3_ENDPOINT || undefined, forcePathStyle: Boolean(process.env.EVIDENCE_S3_ENDPOINT), credentials: { accessKeyId: process.env.EVIDENCE_S3_ACCESS_KEY, secretAccessKey: process.env.EVIDENCE_S3_SECRET_KEY } });
const suffix = randomBytes(8).toString("hex");
const emails = [`review-operator-${suffix}@example.invalid`, `review-admin-${suffix}@example.invalid`];
const password = `${randomBytes(24).toString("base64url")}aA1!`;
const ip = `198.51.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}`;
const files = [];
const privateMarker = `PRIVATE_${suffix}`;
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
  farmer: { farmerName: "Fictional Review Farm", publicFarmLabel: "Fictional Public Review Farm", farmerId: privateMarker, fieldArea: 12.5, gpsCoords: privateMarker, cadastralNumber: privateMarker, crop: "sunflower" },
  treatment: { treatmentType: "herbicide", treatmentDate: "2026-09-01", treatmentTime: "09:30", timeZone: "Europe/Kyiv", treatedAreaHectares: 10.25, droneModel: "Fictional Drone", droneSerial: privateMarker, operator: privateMarker, pilotCert: privateMarker, notes: privateMarker },
  meteo: { temperatureCelsius: 22.5, humidityPercent: 60, windSpeedMps: 2.5, rainfallMm: 0, measuredAt: "2026-09-01T09:30:00.000Z" },
  chemical: { chemical: "Fictional Product", chemicalActive: "", dose: 1.25, doseUnit: "L_PER_HA", workingVolume: 25, manufacturer: "", regNumber: "", supplierName: privateMarker, supplierEdrpou: privateMarker },
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
  const withoutUnit = await api(`/api/drafts/${passportId}`, { user: operator, method: "PATCH", body: { version, data: { ...data, chemical: { ...data.chemical, doseUnit: "" } } } });
  assert.equal(withoutUnit.status, 200, "older or incomplete drafts may lack a dose unit");
  version = (await withoutUnit.json()).draft.version;
  const unitlessSubmission = await api(`/api/passports/${passportId}/submit`, { user: operator, method: "POST", body: { version } });
  assert.equal(unitlessSubmission.status, 422);
  assert.ok((await unitlessSubmission.json()).issues.includes("chemicalDoseUnit"), "unitless dose cannot be submitted");
  const restoredUnit = await api(`/api/drafts/${passportId}`, { user: operator, method: "PATCH", body: { version, data } });
  assert.equal(restoredUnit.status, 200);
  version = (await restoredUnit.json()).draft.version;
  const withoutFacts = await api(`/api/drafts/${passportId}`, { user: operator, method: "PATCH", body: { version, data: { ...data, farmer: { ...data.farmer, publicFarmLabel: "" }, treatment: { ...data.treatment, timeZone: "", treatedAreaHectares: null } } } });
  assert.equal(withoutFacts.status, 200, "incomplete drafts remain saveable");
  version = (await withoutFacts.json()).draft.version;
  const incompleteFacts = await api(`/api/passports/${passportId}/submit`, { user: operator, method: "POST", body: { version } });
  assert.equal(incompleteFacts.status, 422);
  const incompleteIssues = (await incompleteFacts.json()).issues;
  for (const issue of ["publicFarmLabel", "timeZone", "treatedArea"]) assert.ok(incompleteIssues.includes(issue), `${issue} is required for submission`);
  const tooMuchArea = await api(`/api/drafts/${passportId}`, { user: operator, method: "PATCH", body: { version, data: { ...data, treatment: { ...data.treatment, treatedAreaHectares: 13 } } } });
  assert.equal(tooMuchArea.status, 200);
  version = (await tooMuchArea.json()).draft.version;
  const overAreaSubmission = await api(`/api/passports/${passportId}/submit`, { user: operator, method: "POST", body: { version } });
  assert.equal(overAreaSubmission.status, 422);
  assert.ok((await overAreaSubmission.json()).issues.includes("treatedAreaExceedsField"), "treated area cannot exceed field area");
  const restoredFacts = await api(`/api/drafts/${passportId}`, { user: operator, method: "PATCH", body: { version, data } });
  assert.equal(restoredFacts.status, 200);
  version = (await restoredFacts.json()).draft.version;
  const invalidCategories = await api(`/api/drafts/${passportId}`, { user: operator, method: "PATCH", body: { version, data: { ...data, farmer: { ...data.farmer, crop: "unrecognized" }, treatment: { ...data.treatment, treatmentType: "unrecognized" }, meteo: { ...data.meteo, measuredAt: null } } } });
  assert.equal(invalidCategories.status, 200, "incomplete historical draft facts remain saveable");
  version = (await invalidCategories.json()).draft.version;
  const categorySubmission = await api(`/api/passports/${passportId}/submit`, { user: operator, method: "POST", body: { version } });
  assert.equal(categorySubmission.status, 422);
  const categoryIssues = (await categorySubmission.json()).issues;
  for (const issue of ["cropCategory", "treatmentCategory", "meteoMeasuredAt"]) assert.ok(categoryIssues.includes(issue), `${issue} must be valid for submission`);
  const restoredCategories = await api(`/api/drafts/${passportId}`, { user: operator, method: "PATCH", body: { version, data } });
  assert.equal(restoredCategories.status, 200);
  version = (await restoredCategories.json()).draft.version;
  const linked = await db.passport.findUniqueOrThrow({ where: { id: passportId }, select: { farmerId: true, fieldId: true } });
  const farmerPath = `/api/admin/records/farmers/${linked.farmerId}`;
  const fieldPath = `/api/admin/records/fields/${linked.fieldId}`;
  assert.equal((await api(farmerPath, { user: operator })).status, 403, "operator cannot inspect admin record detail");
  const farmerRecord = (await (await api(farmerPath, { user: verified })).json()).record;
  assert.equal((await api(farmerPath, { user: verified, method: "PATCH", body: { updatedAt: farmerRecord.updatedAt, data: { ...farmerRecord.data, legalName: "Fictional Review Farm Updated" } }, origin: "https://evil.invalid" })).status, 403, "admin edit requires same origin");
  const farmerChanged = await api(farmerPath, { user: verified, method: "PATCH", body: { updatedAt: farmerRecord.updatedAt, data: { ...farmerRecord.data, legalName: "Fictional Review Farm Updated" } } });
  assert.equal(farmerChanged.status, 200, `farmer edit: ${await farmerChanged.clone().text()}`);
  assert.equal((await db.farmer.findUniqueOrThrow({ where: { id: linked.farmerId } })).legalName, "Fictional Review Farm Updated", "admin edit persisted");
  assert.equal((await api(farmerPath, { user: verified, method: "PATCH", body: { updatedAt: farmerRecord.updatedAt, data: farmerRecord.data } })).status, 409, "stale admin edit denied");
  assert.equal((await api(`/api/drafts/${passportId}`, { user: operator, method: "PATCH", body: { version, data } })).status, 409, "admin edit invalidated operator draft version");
  const fieldRecord = (await (await api(fieldPath, { user: verified })).json()).record;
  const fieldChanged = await api(fieldPath, { user: verified, method: "PATCH", body: { updatedAt: fieldRecord.updatedAt, data: { ...fieldRecord.data, label: "Fictional Field" } } });
  assert.equal(fieldChanged.status, 200, `field edit: ${await fieldChanged.clone().text()}`);
  const today = new Date().toISOString().slice(0, 10);
  const adminHistory = await api(`/api/admin/records?view=adminActions&search=RECORD_UPDATED&from=${today}&to=${today}`, { user: verified });
  assert.equal(adminHistory.status, 200);
  assert.ok((await adminHistory.json()).items.filter((item) => item.detail.includes(emails[1])).length >= 2, "admin history filters action and date and shows actor");
  const draftHistory = await api(`/api/admin/records?view=audit&search=ADMIN_RECORD_UPDATED&from=${today}&to=${today}`, { user: verified });
  assert.equal(draftHistory.status, 200);
  assert.ok((await draftHistory.json()).items.length >= 2, "audit action and date filters work");
  assert.equal((await api("/api/admin/records?view=audit&from=2026-09-26&to=2026-09-25", { user: verified })).status, 400, "reversed audit dates rejected");
  version = (await db.passport.findUniqueOrThrow({ where: { id: passportId } })).version;
  const submitPath = `/api/passports/${passportId}/submit`;
  const incomplete = await api(submitPath, { user: operator, method: "POST", body: { version } });
  assert.equal(incomplete.status, 422, "verified evidence required");
  assert.deepEqual((await incomplete.json()).issues.sort(), ["chemicalEvidence", "meteoEvidence"]);
  const meteoId = await uploadEvidence(operator, "METEO");
  const chemicalId = await uploadEvidence(operator, "CHEMICAL");
  assert.equal((await api(submitPath, { user: operator, method: "POST", body: { version }, origin: "https://evil.invalid" })).status, 403);
  const submitted = await api(submitPath, { user: operator, method: "POST", body: { version } });
  assert.equal(submitted.status, 200, `submit: ${await submitted.clone().text()}`);
  version = (await submitted.json()).passport.version;
  assert.equal((await api(`/api/drafts/${passportId}`, { user: operator })).status, 409, "submitted draft is frozen");
  assert.equal((await api(`/api/drafts/${passportId}`, { user: operator, method: "PATCH", body: { version, data } })).status, 409, "submitted draft cannot change");
  assert.equal((await api(farmerPath, { user: verified, method: "PATCH", body: { updatedAt: (await farmerChanged.json()).record.updatedAt, data: farmerRecord.data } })).status, 409, "submitted farmer details are immutable");
  assert.equal((await api(fieldPath, { user: verified, method: "POST", body: { updatedAt: (await fieldChanged.json()).record.updatedAt, archived: true } })).status, 409, "submitted field cannot be archived");
  assert.equal((await api(`/api/drafts/${passportId}/evidence`, { user: operator, method: "POST", body: { kind: "OTHER", filename: "x.txt", contentType: "text/plain", sizeBytes: 1, sha256: "0".repeat(64) } })).status, 404, "submitted evidence cannot change");
  assert.equal((await api(`/api/admin/passports/${passportId}`, { user: operator })).status, 403);
  const previewPath = `/api/admin/passports/${passportId}/public-preview?${new URLSearchParams({ weatherFileId: meteoId, chemicalFileId: chemicalId })}`;
  assert.equal((await api(previewPath)).status, 401, "public preview requires authentication");
  assert.equal((await api(previewPath, { user: operator })).status, 403, "operator cannot inspect public preview");
  assert.equal((await api(previewPath, { user: verified })).status, 409, "only approved passports have a public preview");
  assert.equal((await api("/api/admin/records?view=users", { user: operator })).status, 403, "operator cannot inspect users");
  assert.equal((await api(`/api/passports/${passportId}/evidence/${meteoId}/preview`, { user: operator })).status, 307, "owner can still view submitted evidence");
  const detail = await api(`/api/admin/passports/${passportId}`, { user: verified });
  assert.equal(detail.status, 200);
  const reviewedRecord = (await detail.json()).passport;
  assert.equal(reviewedRecord.status, "SUBMITTED");
  assert.equal(reviewedRecord.publicFarmLabel, data.farmer.publicFarmLabel);
  assert.equal(reviewedRecord.treatment.timeZone, data.treatment.timeZone);
  assert.equal(reviewedRecord.treatment.treatedAreaHectares, data.treatment.treatedAreaHectares);
  assert.notEqual(reviewedRecord.field.publicReference, reviewedRecord.field.id, "public reference is independent of private field id");
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
  const correctionFarmer = (await (await api(farmerPath, { user: verified })).json()).record;
  const archivedCorrection = await api(farmerPath, { user: verified, method: "POST", body: { updatedAt: correctionFarmer.updatedAt, archived: true } });
  assert.equal(archivedCorrection.status, 200, "correction record can be archived without changing its content");
  assert.equal((await api(`/api/passports/${passportId}/reopen`, { user: operator, method: "POST", body: { version } })).status, 409, "archived farmer blocks reopening");
  assert.equal((await api(farmerPath, { user: verified, method: "POST", body: { updatedAt: (await archivedCorrection.json()).record.updatedAt, archived: false } })).status, 200, "record can be restored before reopening");
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
  assert.equal((await api(`/api/admin/passports/${passportId}/public-preview`, { user: verified })).status, 400, "source selection is required");
  const wrongSources = await api(`/api/admin/passports/${passportId}/public-preview?${new URLSearchParams({ weatherFileId: chemicalId, chemicalFileId: meteoId })}`, { user: verified });
  assert.equal(wrongSources.status, 422, "source files must match their kind");
  const previewResponse = await api(previewPath, { user: verified });
  assert.equal(previewResponse.status, 200, `public preview: ${await previewResponse.clone().text()}`);
  const { preview } = await previewResponse.json();
  const snapshot = preview.snapshot;
  assert.equal(snapshot.schemaVersion, "2.0.0");
  assert.equal(snapshot.treatment.treatedAreaHectares, data.treatment.treatedAreaHectares);
  assert.equal(snapshot.field.areaHectares, data.farmer.fieldArea);
  assert.equal(snapshot.field.reference, reviewedRecord.field.publicReference);
  assert.notEqual(snapshot.certificateId, passportId, "certificate ID is independent of private passport ID");
  assert.equal(snapshot.evidence.weatherSha256, (await db.evidenceFile.findUniqueOrThrow({ where: { id: meteoId } })).sha256);
  assert.equal(snapshot.evidence.chemicalSha256, (await db.evidenceFile.findUniqueOrThrow({ where: { id: chemicalId } })).sha256);
  assert.equal(preview.canonicalJson, canonicalize(snapshot));
  assert.equal(preview.sha256, await sha256Json(JSON.parse(preview.canonicalJson)), "hash matches transported public JSON");
  assert.deepEqual(Object.keys(snapshot).sort(), ["schemaName", "schemaVersion", "certificateId", "snapshotAt", "issuer", "farm", "field", "treatment", "weather", "chemical", "evidence"].sort());
  assert.deepEqual(Object.keys(snapshot.treatment).sort(), ["category", "date", "localTime", "timeZone", "treatedAreaHectares", "droneModel"].sort());
  const serialized = JSON.stringify(preview);
  for (const secret of [privateMarker, passportId, linked.farmerId, linked.fieldId, meteoId, chemicalId, emails[0], emails[1], "Fictional Review Farm Updated"]) assert.ok(!serialized.includes(secret), `private value leaked: ${secret}`);
  assert.ok(!publicSnapshotSchema.safeParse({ ...snapshot, farmerId: privateMarker }).success, "unknown private key is rejected");
  assert.ok(!publicSnapshotSchema.safeParse({ ...snapshot, schemaVersion: "1.0.0" }).success, "legacy demo version is rejected");
  const confirmationPath = `/api/admin/passports/${passportId}/public-confirmation`;
  const privateViews = ["certificate", "verification"].map((view) => `/admin/passports/${passportId}/${view}`);
  const confirmationBody = { passportVersion: approved.version, weatherFileId: meteoId, chemicalFileId: chemicalId, certificateId: snapshot.certificateId, snapshotAt: snapshot.snapshotAt, expectedSha256: preview.sha256 };
  assert.equal((await api(confirmationPath)).status, 401, "confirmation is private");
  assert.equal((await api(confirmationPath, { user: operator })).status, 403, "operator cannot read confirmations");
  assert.equal((await api(confirmationPath, { user: admin })).status, 401, "MFA enrollment revoked the old admin session");
  assert.equal((await api(confirmationPath, { user: verified })).status, 200);
  assert.equal((await (await api(confirmationPath, { user: verified })).json()).confirmation, null, "no confirmation before explicit action");
  for (const path of privateViews) {
    assert.equal((await api(path)).status, 307, `${path} redirects anonymous visitors`);
    assert.equal((await api(path, { user: operator })).status, 307, `${path} redirects operators`);
    assert.equal((await api(path, { user: verified })).status, 404, `${path} needs a saved confirmation`);
  }
  assert.equal((await api(confirmationPath, { user: operator, method: "POST", body: confirmationBody })).status, 403);
  assert.equal((await api(confirmationPath, { user: verified, method: "POST", body: confirmationBody, origin: "https://evil.invalid" })).status, 403);
  assert.equal((await api(confirmationPath, { user: verified, method: "POST", body: { ...confirmationBody, unexpected: privateMarker } })).status, 400, "confirmation input is strict");
  assert.equal((await api(confirmationPath, { user: verified, method: "POST", body: { ...confirmationBody, passportVersion: approved.version - 1 } })).status, 409, "stale version cannot be confirmed");
  assert.equal((await api(confirmationPath, { user: verified, method: "POST", body: { ...confirmationBody, expectedSha256: "0".repeat(64) } })).status, 409, "changed hash cannot be confirmed");
  assert.equal(await db.publicSnapshotConfirmation.count({ where: { passportId } }), 0, "rejected confirmation does not persist");
  const confirmedResponse = await api(confirmationPath, { user: verified, method: "POST", body: confirmationBody });
  assert.equal(confirmedResponse.status, 201, `confirmation: ${await confirmedResponse.clone().text()}`);
  const confirmed = (await confirmedResponse.json()).confirmation;
  assert.equal(confirmed.preview.canonicalJson, preview.canonicalJson, "confirmed exact JSON matches preview transport");
  assert.equal(confirmed.preview.sha256, preview.sha256);
  for (const secret of [privateMarker, passportId, linked.farmerId, linked.fieldId, meteoId, chemicalId, emails[0], emails[1]]) assert.ok(!JSON.stringify(confirmed).includes(secret), `private value leaked from confirmation: ${secret}`);
  const storedConfirmation = await db.publicSnapshotConfirmation.findUniqueOrThrow({ where: { id: confirmed.id } });
  assert.equal(storedConfirmation.canonicalJson, preview.canonicalJson, "DB stores exact preview bytes");
  assert.equal(storedConfirmation.payloadHash, preview.sha256);
  for (const path of privateViews) {
    const response = await api(path, { user: verified });
    assert.equal(response.status, 200, `${path} should render for an MFA admin`);
    const html = await response.text();
    for (const publicValue of [snapshot.certificateId, snapshot.farm.label, snapshot.field.reference, snapshot.chemical.product, preview.sha256]) {
      assert.ok(html.includes(publicValue), `${path} omits confirmed value: ${publicValue}`);
    }
    assert.ok(!html.includes(privateMarker), `${path} leaks a private source value`);
    assert.ok(html.includes("Не опубліковано"), `${path} must show unpublished status`);
  }
  assert.equal(storedConfirmation.confirmedById, adminId);
  assert.equal(storedConfirmation.approvedVersion, approved.approvedVersion);
  assert.equal((await (await api(confirmationPath, { user: verified })).json()).confirmation.id, confirmed.id, "saved confirmation can be reloaded");
  assert.equal((await api(confirmationPath, { user: verified, method: "POST", body: confirmationBody })).status, 200, "same confirmation is idempotent");
  assert.equal((await api(confirmationPath, { user: verified, method: "POST", body: { ...confirmationBody, certificateId: randomUUID() } })).status, 409, "second snapshot cannot replace a confirmation");
  assert.equal(await db.publicSnapshotConfirmation.count({ where: { passportId } }), 1);
  assert.equal(await db.auditLog.count({ where: { passportId, action: "PUBLIC_SNAPSHOT_CONFIRMED" } }), 1, "one confirmation audit event");
  const recalled = await api(`/api/admin/passports/${passportId}/decision`, { user: verified, method: "POST", body: { version: approved.version, decision: "CORRECTION_REQUIRED", note: "Recheck approved record" } });
  assert.equal(recalled.status, 200, "approved passport can be recalled before publication");
  assert.equal((await (await api(confirmationPath, { user: verified })).json()).confirmation, null, "recall hides the old confirmation");
  assert.ok((await db.publicSnapshotConfirmation.findUniqueOrThrow({ where: { id: confirmed.id } })).invalidatedAt, "recall invalidates in the database");
  for (const path of privateViews) assert.equal((await api(path, { user: verified })).status, 404, `${path} closes after recall`);
  assert.equal((await api(confirmationPath, { user: verified, method: "POST", body: confirmationBody })).status, 409, "recalled confirmation cannot be reused");
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
  const approvedFarmer = (await (await api(farmerPath, { user: verified })).json()).record;
  const archived = await api(farmerPath, { user: verified, method: "POST", body: { updatedAt: approvedFarmer.updatedAt, archived: true } });
  assert.equal(archived.status, 200, "completed farmer can be archived");
  const restored = await api(farmerPath, { user: verified, method: "POST", body: { updatedAt: (await archived.json()).record.updatedAt, archived: false } });
  assert.equal(restored.status, 200, "archived farmer can be restored");
  assert.equal((await db.adminAction.count({ where: { entity: "farmers", entityId: linked.farmerId } })), 5, "record edits and archive actions audited");
  assert.equal((await db.auditLog.count({ where: { passportId, action: "ADMIN_RECORD_UPDATED" } })), 2, "draft record edits attributed to admin");
  assert.equal((await db.auditLog.count({ where: { passportId, action: { in: ["PASSPORT_SUBMITTED", "REVIEW_ASSIGNED", "CORRECTION_REQUESTED", "PASSPORT_REOPENED", "REVIEW_REJECTED", "REVIEW_APPROVED"] } } })), 13);
  process.stdout.write("Review smoke passed: MFA, owner and admin edits, immutable submissions, archive, evidence freeze, submit, assign, conflict, correction, recall, rejection, resubmission, approval, exact public confirmation, private certificate/verification views, audit.\n");
} finally {
  for (const id of files) {
    const file = await db.evidenceFile.findUnique({ where: { id }, select: { objectKey: true } });
    for (const key of new Set([`quarantine/${id}`, file?.objectKey].filter(Boolean))) await s3.send(new DeleteObjectCommand({ Bucket: process.env.EVIDENCE_S3_BUCKET, Key: key })).catch(() => undefined);
  }
  if (passportId) {
    const row = await db.passport.findUnique({ where: { id: passportId }, select: { farmerId: true, fieldId: true } });
    if (row) {
      await db.publicSnapshotConfirmation.deleteMany({ where: { passportId } });
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
  await db.adminAction.deleteMany({ where: { actor: { email: { in: emails } } } });
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect(); s3.destroy();
}
