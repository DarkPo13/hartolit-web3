// Uses only fictional fixture accounts and removes every row it creates.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createJiti } from "jiti";

const base = "http://localhost:3000";
const jiti = createJiti(import.meta.url);
const [{ auth }, { getDb }] = await Promise.all([
  jiti.import("../auth.cli.ts"),
  jiti.import("../lib/db-core.ts"),
]);
const db = getDb();
const suffix = randomBytes(8).toString("hex");
const testIp = `198.51.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}`;
const emails = [`draft-a-${suffix}@example.invalid`, `draft-b-${suffix}@example.invalid`];
const password = `${randomBytes(24).toString("base64url")}aA1!`;
const draftIds = [];

function makeJar() {
  const cookies = new Map();
  return {
    header: () => [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
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

async function request(path, { jar, method = "GET", body, origin = base } = {}) {
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

const data = {
  farmer: { farmerName: "Fictional Farm", farmerId: "FICTIONAL-1", fieldArea: 12.5, gpsCoords: "49.0, 34.0", cadastralNumber: "", crop: "sunflower" },
  treatment: { treatmentType: "herbicide", treatmentDate: "2026-09-01", treatmentTime: "09:30", droneModel: "Fictional Drone", droneSerial: "", operator: "Test Pilot", pilotCert: "", notes: "" },
  meteo: { temperatureCelsius: 22.5, humidityPercent: 60, windSpeedMps: 2.5, rainfallMm: 0, measuredAt: "2026-09-01T09:30:00.000Z" },
  chemical: { chemical: "Fictional Product", chemicalActive: "", dose: 1.25, workingVolume: 25, manufacturer: "", regNumber: "", supplierName: "", supplierEdrpou: "" },
};

try {
  assert.equal((await request("/api/drafts")).status, 401, "anonymous list denied");
  assert.equal((await request("/api/drafts", { method: "POST" })).status, 401, "anonymous create denied");
  for (const email of emails) await auth.api.createUser({ body: { name: "Fictional Operator", email, password, role: "user" } });
  const [a, b] = [makeJar(), makeJar()];
  assert.equal((await request("/api/auth/sign-in/email", { jar: a, method: "POST", body: { email: emails[0], password } })).status, 200);
  assert.equal((await request("/api/auth/sign-in/email", { jar: b, method: "POST", body: { email: emails[1], password } })).status, 200);
  assert.equal((await request("/api/drafts", { jar: a, method: "POST", origin: "https://evil.invalid" })).status, 403, "cross-origin create denied");
  const createdResponse = await request("/api/drafts", { jar: a, method: "POST" });
  assert.equal(createdResponse.status, 201, `create draft: ${await createdResponse.clone().text()}`);
  const created = (await createdResponse.json()).draft;
  draftIds.push(created.id);
  assert.equal(created.version, 1);
  assert.equal(created.status, "DRAFT");
  assert.match(createdResponse.headers.get("cache-control"), /no-store/);
  assert.equal((await request(`/api/drafts/${created.id}`, { jar: b })).status, 404, "other owner cannot read");
  assert.equal((await request(`/api/drafts/${created.id}`, { jar: b, method: "PATCH", body: { version: 1, data } })).status, 404, "other owner cannot write");
  const unsafeBody = { version: 1, data: { ...data, meteoFile: { url: "internal://fake" } } };
  assert.equal((await request(`/api/drafts/${created.id}`, { jar: a, method: "PATCH", body: unsafeBody })).status, 400, "file references rejected");
  assert.equal((await request(`/api/drafts/${created.id}`, { jar: a, method: "PATCH", body: { version: 1, data }, origin: null })).status, 403, "missing origin denied");
  const savedResponse = await request(`/api/drafts/${created.id}`, { jar: a, method: "PATCH", body: { version: 1, data } });
  assert.equal(savedResponse.status, 200, "save draft");
  const saved = (await savedResponse.json()).draft;
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.data, data);
  assert.equal((await request(`/api/drafts/${created.id}`, { jar: a, method: "PATCH", body: { version: 1, data } })).status, 409, "stale version rejected");
  const [raceA, raceB] = await Promise.all([
    request(`/api/drafts/${created.id}`, { jar: a, method: "PATCH", body: { version: 2, data: { ...data, treatment: { ...data.treatment, notes: "A" } } } }),
    request(`/api/drafts/${created.id}`, { jar: a, method: "PATCH", body: { version: 2, data: { ...data, treatment: { ...data.treatment, notes: "B" } } } }),
  ]);
  assert.deepEqual([raceA.status, raceB.status].sort(), [200, 409], "concurrent writes serialize");
  const id = (await db.user.findUniqueOrThrow({ where: { email: emails[0] } })).id;
  await db.user.update({ where: { id }, data: { banned: true } });
  assert.equal((await request(`/api/drafts/${created.id}`, { jar: a })).status, 401, "ban invalidates draft read");
  await db.user.update({ where: { id }, data: { banned: false } });
  const anotherSession = makeJar();
  assert.equal((await request("/api/auth/sign-in/email", { jar: anotherSession, method: "POST", body: { email: emails[0], password } })).status, 200);
  const reopened = await request(`/api/drafts/${created.id}`, { jar: anotherSession });
  assert.equal(reopened.status, 200, "another session can read persisted draft");
  assert.equal((await reopened.json()).draft.version, 3);
  assert.equal((await db.auditLog.count({ where: { passportId: created.id } })), 3, "audit contains create and successful updates only");
  const row = await db.passport.findUniqueOrThrow({ where: { id: created.id }, include: { farmer: true, field: true, treatment: true, meteo: true, chemical: true } });
  assert.equal(row.ownerId, id);
  assert.equal(row.farmer.ownerId, id);
  assert.equal(row.field.ownerId, id);
  assert.equal(row.chemical.product, data.chemical.chemical);
  process.stdout.write("Draft smoke passed: auth, ownership, schema, origin, save/reload, concurrency, ban, audit, second session.\n");
} finally {
  for (const draftId of draftIds) {
    const row = await db.passport.findUnique({ where: { id: draftId }, select: { farmerId: true, fieldId: true } });
    if (!row) continue;
    await db.auditLog.deleteMany({ where: { passportId: draftId } });
    await db.chemicalApplication.deleteMany({ where: { passportId: draftId } });
    await db.meteoMeasurement.deleteMany({ where: { passportId: draftId } });
    await db.treatment.deleteMany({ where: { passportId: draftId } });
    await db.passport.delete({ where: { id: draftId } });
    await db.field.delete({ where: { id: row.fieldId } });
    await db.farmer.delete({ where: { id: row.farmerId } });
  }
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect();
}
