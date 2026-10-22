// Private publication smoke. Fictional READY evidence rows model a prior scan;
// no real evidence upload/scan, public-network mint or customer data is accepted.
// The opt-in offline variant writes only fictional public blocks to isolated Kubo.
// The opt-in chain variant owns non-forked Anvil; it never issues an app certificate.
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import net from "node:net";
import nextEnv from "@next/env";
import pg from "pg";
import { createJiti } from "jiti";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { smokeWalletProof } from "./smoke-publication-wallet.mjs";
import { smokePinPreparation, smokePinDispatch, smokePinRecallRace } from "./smoke-publication-pinning.mjs";
import { smokePinUploads } from "./smoke-publication-upload.mjs";
import { smokePublicationPreparation } from "./smoke-publication-preparation.mjs";

nextEnv.loadEnvConfig(process.cwd());
const database = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Publication fixtures require a local database");
const preflight = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
try { await preflight.connect(); await preflight.query("SELECT 1"); }
catch { throw new Error("Local PostgreSQL not ready; publication assertions were not run"); }
finally { await preflight.end(); }
const port = Number(process.env.PUBLICATION_SMOKE_PORT ?? 3001);
assert.ok(Number.isInteger(port) && port > 1023 && port < 65536);
const base = `http://127.0.0.1:${port}`;
process.env.BETTER_AUTH_URL = base;
const jiti = createJiti(import.meta.url);
const [{ auth }, { getDb }] = await Promise.all([jiti.import("../auth.cli.ts"), jiti.import("../lib/db-core.ts")]);
const db = getDb();
const suffix = randomBytes(8).toString("hex");
const password = `${randomBytes(24).toString("base64url")}aA1!`;
const emails = ["publisher", "other-admin", "no-mfa", "operator"].map((role) => `publication-${role}-${suffix}@example.invalid`);
// Ephemeral test-only signing key stays in this process, never in server env or logs.
const signingAccount = privateKeyToAccount(generatePrivateKey());
const wallet = signingAccount.address.toLowerCase();
const marker = `PRIVATE_${suffix}`;
const passportIds = [];
const ipPrefix = `198.51.${parseInt(suffix.slice(0, 2), 16)}.`;
let nextIp = 1;
let server;

function jar() {
  const cookies = new Map();
  return { ip: `${ipPrefix}${nextIp++}`, header: () => [...cookies].map(([key, value]) => `${key}=${value}`).join("; "), add(response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";"); const separator = pair.indexOf("=");
      if (separator >= 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  } };
}

async function api(route, { user, method = "GET", body, origin = base } = {}) {
  const response = await fetch(new URL(route, base), { redirect: "manual", method,
    headers: { ...(origin ? { origin } : {}), "x-forwarded-for": user?.ip ?? `${ipPrefix}250`,
      ...(user ? { cookie: user.header() } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  user?.add(response); return response;
}

async function stopServer() {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, "exit"); server.kill(); await exited;
}

async function startServer(publisherId = "", configuredWallet = "", target = {}) {
  // Use the same literal loopback for listener and requests. localhost can resolve
  // to an unrelated IPv6 app even while our child owns the IPv4 port on Windows.
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", resolve); });
  await new Promise(resolve => probe.close(resolve));
  server = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, NODE_ENV: "production", BETTER_AUTH_URL: base,
      HARTOLIT_PUBLISHER_USER_ID: publisherId, HARTOLIT_PUBLISHER_WALLET: configuredWallet,
      HARTOLIT_PUBLICATION_TARGET_KEY: target.key ?? "", HARTOLIT_PUBLICATION_TARGET_SCOPE: target.scope ?? "",
      HARTOLIT_PUBLICATION_API_ORIGIN: target.apiUrl ?? "", HARTOLIT_PUBLICATION_GATEWAY_ORIGIN: target.gatewayUrl ?? "" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let ready = false;
  let startupError;
  server.on("error", (error) => { startupError = error; });
  server.stdout.on("data", (chunk) => { if (chunk.toString().includes("Ready in")) ready = true; });
  // Consume stderr without logging private server details. Fail using status/assertion evidence.
  server.stderr.on("data", () => {});
  for (let attempt = 0; attempt < 120; attempt++) {
    if (startupError) throw startupError;
    if (server.exitCode !== null) throw new Error("Isolated publication server exited before startup (check build/port)");
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Isolated publication server did not become ready");
}

function totp(uri) {
  const secret = new URL(uri).searchParams.get("secret"); assert.ok(secret);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replace(/=+$/, "")].map((letter) => alphabet.indexOf(letter).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return ((digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

async function signIn(email, mfa = false) {
  const user = jar();
  assert.equal((await api("/api/auth/sign-in/email", { user, method: "POST", body: { email, password } })).status, 200);
  if (!mfa) return user;
  const enabled = await api("/api/auth/two-factor/enable", { user, method: "POST", body: { password, method: "totp" } });
  assert.equal(enabled.status, 200);
  const { totpURI } = await enabled.json();
  assert.equal((await api("/api/auth/two-factor/verify-totp", { user, method: "POST", body: { code: totp(totpURI) } })).status, 200);
  const verified = jar();
  assert.equal((await api("/api/auth/sign-in/email", { user: verified, method: "POST", body: { email, password } })).status, 200);
  assert.equal((await api("/api/auth/two-factor/verify-totp", { user: verified, method: "POST", body: { code: totp(totpURI) } })).status, 200);
  return verified;
}

async function fixture(ownerId, reviewerId) {
  const row = await db.$transaction(async (tx) => {
    const farmer = await tx.farmer.create({ data: { ownerId, legalName: marker, registrationId: marker } });
    const field = await tx.field.create({ data: { ownerId, farmerId: farmer.id, areaHectares: 12.5, crop: "sunflower", gpsCoords: marker } });
    const passport = await tx.passport.create({ data: {
      ownerId, farmerId: farmer.id, fieldId: field.id, status: "APPROVED", version: 4, approvedVersion: 2, submittedVersion: 2,
      reviewerId, reviewedById: reviewerId, publicFarmLabel: "Fictional Publication Farm",
      treatment: { create: { treatmentType: "herbicide", treatmentDate: "2026-09-01", treatmentTime: "09:30", timeZone: "Europe/Kyiv",
        treatedAreaHectares: 10.25, droneModel: "Fictional Drone", operator: marker, notes: marker } },
      meteo: { create: { temperatureCelsius: 22.5, humidityPercent: 60, windSpeedMps: 2.5, rainfallMm: 0, measuredAt: new Date("2026-09-01T06:30:00.000Z") } },
      chemical: { create: { product: "Fictional Product", dosePerHa: 1.25, doseUnit: "L_PER_HA", workingVolume: 25, supplierName: marker } },
    } });
    const files = [];
    for (const kind of ["METEO", "CHEMICAL"]) files.push(await tx.evidenceFile.create({ data: {
      ownerId, passportId: passport.id, kind, status: "READY", objectKey: `fictional-publication/${randomUUID()}`,
      filename: `${marker}.txt`, contentType: "text/plain", sizeBytes: 1,
      sha256: createHash("sha256").update(`fictional ${kind}`).digest("hex"), uploadExpiresAt: new Date(),
    } }));
    return { passport, weather: files[0], chemical: files[1] };
  });
  passportIds.push(row.passport.id); return row;
}

async function confirm(user, row) {
  const previewPath = `/api/admin/passports/${row.passport.id}/public-preview?${new URLSearchParams({ weatherFileId: row.weather.id, chemicalFileId: row.chemical.id })}`;
  const response = await api(previewPath, { user }); assert.equal(response.status, 200);
  const { preview } = await response.json();
  const saved = await api(`/api/admin/passports/${row.passport.id}/public-confirmation`, { user, method: "POST", body: {
    passportVersion: row.passport.version, weatherFileId: row.weather.id, chemicalFileId: row.chemical.id,
    certificateId: preview.snapshot.certificateId, snapshotAt: preview.snapshot.snapshotAt, expectedSha256: preview.sha256,
  } });
  assert.equal(saved.status, 201); return (await saved.json()).confirmation;
}

try {
  for (let index = 0; index < emails.length; index++) await auth.api.createUser({ body: {
    name: "Fictional Publication User", email: emails[index], password, role: index === 3 ? "user" : "admin",
  } });
  const publisherId = (await db.user.findUniqueOrThrow({ where: { email: emails[0] } })).id;
  const ownerId = (await db.user.findUniqueOrThrow({ where: { email: emails[3] } })).id;
  await startServer();
  const publisher = await signIn(emails[0], true), other = await signIn(emails[1], true);
  const unverified = await signIn(emails[2]), operator = await signIn(emails[3]);
  const row = await fixture(ownerId, publisherId);
  const id = row.passport.id, route = `/api/admin/passports/${id}/publication`;
  const confirmation = await confirm(publisher, row);
  const body = { confirmationId: confirmation.id, passportVersion: 4, expectedSha256: confirmation.preview.sha256, walletAddress: wallet };
  const reserve = (patch = {}, user = publisher, origin = base) => api(route, { user, method: "POST", origin, body: { ...body, ...patch } });
  assert.equal((await api(route)).status, 401, "reservation history is private");
  assert.equal((await api(route, { user: operator })).status, 403);
  assert.equal((await api(route, { user: unverified })).status, 403);
  assert.equal((await api(route, { method: "POST", body })).status, 401);
  assert.equal((await reserve({}, operator)).status, 403);
  assert.equal((await reserve({}, unverified)).status, 403);
  assert.equal((await reserve()).status, 503, "missing publisher configuration fails closed");
  const unavailable = await (await api(route, { user: publisher })).json();
  assert.deepEqual(unavailable.publisher, { configured: false, canProve: false, walletAddress: null, chainId: 97 });
  assert.equal(await db.publication.count({ where: { passportId: id } }), 0);
  await stopServer(); await startServer(publisherId, wallet);
  // Internal domain tests use the same fictional configuration as the isolated server.
  process.env.HARTOLIT_PUBLISHER_USER_ID = publisherId;
  process.env.HARTOLIT_PUBLISHER_WALLET = wallet;
  assert.equal((await reserve({}, other)).status, 403, "other MFA admin is not the designated publisher");
  assert.equal((await reserve({ walletAddress: `0x${"2".repeat(40)}` })).status, 403);
  assert.equal((await reserve({}, publisher, "https://evil.invalid")).status, 403);
  assert.equal((await reserve({}, publisher, null)).status, 403);
  assert.equal((await reserve({ unexpectedPrivateField: marker })).status, 400);
  assert.equal((await reserve({ walletAddress: "0x0000000000000000000000000000000000000000" })).status, 400);
  assert.equal((await reserve({ passportVersion: 3 })).status, 409);
  assert.equal((await reserve({ confirmationId: randomUUID() })).status, 409);
  assert.equal((await reserve({ expectedSha256: "0".repeat(64) })).status, 409);
  const foreign = await fixture(ownerId, publisherId);
  const foreignConfirmation = await confirm(publisher, foreign);
  assert.equal((await reserve({ confirmationId: foreignConfirmation.id, expectedSha256: foreignConfirmation.preview.sha256 })).status, 409, "confirmation cannot cross passports");
  // Assert PostgreSQL's actual constraint, independently of Prisma's error formatting
  // (the runtime's stack formatter is not compatible with jiti on Windows).
  const constraintClient = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  try {
    await constraintClient.connect();
    await constraintClient.query("BEGIN");
    try {
      await assert.rejects(constraintClient.query(`
        INSERT INTO "Publication" ("id", "passportId", "confirmationId", "reservedById", "publisherWallet",
          "passportVersion", "approvedVersion", "idempotencyKey", "canonicalJson", "payloadHash", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      `, [randomUUID(), foreign.passport.id, confirmation.id, publisherId, wallet, 4, 2,
        `fictional:${randomUUID()}`, confirmation.preview.canonicalJson, confirmation.preview.sha256]),
      (error) => error.code === "23503" && error.constraint === "Publication_confirmationId_passportId_fkey",
      "database rejects a confirmation from another passport");
    } finally { await constraintClient.query("ROLLBACK"); }
  } finally { await constraintClient.end(); }
  await db.user.update({ where: { id: publisherId }, data: { banned: true } });
  assert.equal((await reserve()).status, 401, "disabled publisher is rejected immediately");
  await db.user.update({ where: { id: publisherId }, data: { banned: false } });
  await db.user.update({ where: { id: publisherId }, data: { twoFactorEnabled: false } });
  assert.equal((await reserve()).status, 403, "MFA removal applies to an existing session");
  await db.user.update({ where: { id: publisherId }, data: { twoFactorEnabled: true } });
  await db.user.update({ where: { id: publisherId }, data: { role: "user" } });
  assert.equal((await reserve()).status, 403, "role removal applies to an existing session");
  await db.user.update({ where: { id: publisherId }, data: { role: "admin" } });
  await db.publicSnapshotConfirmation.update({ where: { id: confirmation.id }, data: { canonicalJson: `${confirmation.preview.canonicalJson} ` } });
  assert.equal((await reserve()).status, 409, "noncanonical or tampered stored bytes are rejected");
  await db.publicSnapshotConfirmation.update({ where: { id: confirmation.id }, data: { canonicalJson: confirmation.preview.canonicalJson } });
  await db.evidenceFile.update({ where: { id: row.weather.id }, data: { status: "REJECTED" } });
  assert.equal((await reserve()).status, 422, "selected source must remain verified");
  await db.evidenceFile.update({ where: { id: row.weather.id }, data: { status: "READY", rejectionCode: "FICTIONAL_REJECTION" } });
  assert.equal((await reserve()).status, 422, "READY status cannot override a source rejection");
  await db.evidenceFile.update({ where: { id: row.weather.id }, data: { rejectionCode: null, objectPurgedAt: new Date() } });
  assert.equal((await reserve()).status, 422, "purged source cannot be reserved");
  await db.evidenceFile.update({ where: { id: row.weather.id }, data: { objectPurgedAt: null } });
  await db.evidenceFile.update({ where: { id: row.weather.id }, data: { status: "READY", sha256: "0".repeat(64) } });
  assert.equal((await reserve()).status, 409, "changed source digest cannot change the confirmed publication");
  await db.evidenceFile.update({ where: { id: row.weather.id }, data: { sha256: row.weather.sha256 } });
  assert.equal(await db.publication.count({ where: { passportId: id } }), 0, "rejected requests have no reservation side effects");

  const parallel = await Promise.all([reserve(), reserve(), reserve(), reserve()]);
  assert.deepEqual(parallel.map((response) => response.status).sort(), [200, 200, 200, 201], "one concurrent creator, three idempotent repeats");
  const reservations = await Promise.all(parallel.map((response) => response.json()));
  const reservationId = reservations[0].reservation.id;
  assert.ok(reservations.every((result) => result.reservation.id === reservationId));
  const stored = await db.publication.findUniqueOrThrow({ where: { id: reservationId } });
  assert.equal(stored.canonicalJson, confirmation.preview.canonicalJson);
  assert.equal(stored.payloadHash, confirmation.preview.sha256);
  assert.equal(stored.reservedById, publisherId); assert.equal(stored.publisherWallet, wallet);
  assert.equal(stored.chainId, 97); assert.equal(stored.ipfsCid, null); assert.equal(stored.transactionHash, null); assert.equal(stored.tokenId, null);
  assert.ok(!stored.canonicalJson.includes(marker));
  assert.equal(await db.publication.count({ where: { passportId: id } }), 1);
  assert.equal(await db.auditLog.count({ where: { passportId: id, publicationId: reservationId, action: "PUBLICATION_RESERVED" } }), 1);
  assert.equal((await db.passport.findUniqueOrThrow({ where: { id } })).version, 4, "reservation preserves the confirmed version");
  assert.equal((await api(`/admin/passports/${id}/certificate`, { user: publisher })).status, 200, "private confirmed view stays usable");
  const listed = await api(route, { user: other }); assert.equal(listed.status, 200);
  assert.equal(listed.headers.get("cache-control"), "private, no-store");
  const listing = await listed.json();
  assert.deepEqual(listing.publisher, { configured: true, canProve: false, walletAddress: null, chainId: 97 });
  const publisherView = await (await api(route, { user: publisher })).json();
  assert.deepEqual(publisherView.publisher, { configured: true, canProve: true, walletAddress: wallet, chainId: 97 });
  assert.equal(listing.reservations.length, 1);
  assert.equal(listing.reservations[0].id, reservationId);
  assert.equal(listing.reservations[0].status, "RESERVED");
  assert.equal(listing.reservations[0].payloadHash, stored.payloadHash);
  assert.ok(!JSON.stringify(listing).includes(marker));
  assert.ok(!("canonicalJson" in listing.reservations[0]), "history returns metadata, not stored payload bytes");

  const foreignRoute = `/api/admin/passports/${foreign.passport.id}/publication`;
  const foreignReserved = await api(foreignRoute, { user: publisher, method: "POST", body: {
    confirmationId: foreignConfirmation.id, passportVersion: 4, expectedSha256: foreignConfirmation.preview.sha256, walletAddress: wallet,
  } });
  assert.equal(foreignReserved.status, 201);
  const foreignReservationId = (await foreignReserved.json()).reservation.id;
  const proof = await smokeWalletProof({
    api, db, base, publisher, other, operator, unverified, publisherId, signingAccount,
    route, reservationId, passportId: id, confirmation, weatherFileId: row.weather.id, marker,
    foreignRoute, foreignReservationId, foreignPassportId: foreign.passport.id,
  });

  const preparedAttemptId = await smokePinPreparation({ db, publisherId, passportId: id, publicationId: reservationId,
    confirmation, proof, weatherFileId: row.weather.id });
  const recallBody = { version: 4, decision: "CORRECTION_REQUIRED", note: "Fictional correction" };
  const recallRoute = `/api/admin/passports/${id}/decision`;
  const [repeat, recalled] = await Promise.all([reserve(), api(recallRoute, { user: publisher, method: "POST", body: recallBody })]);
  assert.ok([200, 409].includes(repeat.status)); assert.equal(recalled.status, 200);
  const cancelled = await db.publication.findUniqueOrThrow({ where: { id: reservationId } });
  assert.equal(cancelled.status, "CANCELLED"); assert.ok(cancelled.cancelledAt);
  assert.equal(cancelled.walletVerifiedAt, null, "recall revokes the wallet proof");
  const recalledAttempt = await db.publicationPinAttempt.findUniqueOrThrow({ where: { id: preparedAttemptId } });
  assert.equal(recalledAttempt.status, "CANCELLED"); assert.equal(recalledAttempt.dispatchedAt, null); assert.ok(recalledAttempt.closedAt);
  assert.ok((await db.publicationWalletChallenge.findUniqueOrThrow({ where: { id: proof.challengeId } })).invalidatedAt);
  assert.equal((await api(`${route}/wallet-proof`, { user: publisher, method: "POST", body: proof.body })).status, 409);
  assert.equal(cancelled.canonicalJson, stored.canonicalJson, "recall preserves historical confirmed bytes");
  assert.equal(await db.auditLog.count({ where: { publicationId: reservationId, action: "PUBLICATION_CANCELLED" } }), 1);
  assert.equal((await reserve()).status, 409);
  assert.ok((await db.publicSnapshotConfirmation.findUniqueOrThrow({ where: { id: confirmation.id } })).invalidatedAt);

  // Model a later corrected approval. The review lifecycle itself has its own live smoke.
  row.passport = await db.passport.update({ where: { id }, data: { status: "APPROVED", version: 8, submittedVersion: 6, approvedVersion: 6 } });
  const nextConfirmation = await confirm(publisher, row);
  const next = await reserve({ confirmationId: nextConfirmation.id, passportVersion: 8, expectedSha256: nextConfirmation.preview.sha256 });
  assert.equal(next.status, 201, "a corrected approval can reserve a new snapshot");
  const nextPublicationId = (await next.json()).reservation.id;
  assert.equal(await db.publication.count({ where: { passportId: id } }), 2, "cancelled reservation history is retained");
  assert.equal((await db.publication.findUniqueOrThrow({ where: { id: reservationId } })).status, "CANCELLED");
  await smokePinDispatch({ api, db, publisherId, publisher, passportId: id, publicationId: nextPublicationId,
    confirmation: nextConfirmation, signingAccount });
  const racing = await fixture(ownerId, publisherId);
  const racingConfirmation = await confirm(publisher, racing);
  const racingReserved = await api(`/api/admin/passports/${racing.passport.id}/publication`, { user: publisher, method: "POST", body: {
    confirmationId: racingConfirmation.id, passportVersion: 4, expectedSha256: racingConfirmation.preview.sha256, walletAddress: wallet,
  } });
  assert.equal(racingReserved.status, 201);
  await smokePinRecallRace({ api, db, publisherId, publisher, passportId: racing.passport.id,
    publicationId: (await racingReserved.json()).reservation.id, confirmation: racingConfirmation, signingAccount });
  await smokePinUploads({ api, db, fixture, confirm, ownerId, publisherId, publisher, signingAccount });
  await smokePublicationPreparation({ api, db, fixture, confirm, ownerId, publisherId, publisher, other, unverified, operator, signingAccount,
    restart: async target => { await stopServer(); await startServer(publisherId, wallet, target); }, base });
  process.stdout.write("Publication smoke passed: exact bytes, private EOA proof, bound upload target, explicit intent, single send, lost acknowledgement/readback, concurrency, recall, constraints and audit. No public side effects.\n");
} finally {
  await stopServer();
  for (const id of passportIds) {
    const row = await db.passport.findUnique({ where: { id }, select: { farmerId: true, fieldId: true } });
    if (!row) continue;
    await db.auditLog.deleteMany({ where: { passportId: id } });
    // The finalization proof FK is deferred; delete this owned cycle atomically.
    await db.$transaction(async tx => {
      await tx.publicationMintResult.deleteMany({ where: { attempt: { preparation: { publication: { passportId: id } } } } });
      await tx.publicationMintObservation.deleteMany({ where: { attempt: { preparation: { publication: { passportId: id } } } } });
      await tx.publicationMintTransaction.deleteMany({ where: { attempt: { preparation: { publication: { passportId: id } } } } });
      await tx.publicationMintAttempt.deleteMany({ where: { preparation: { publication: { passportId: id } } } });
    });
    await db.publicationMintPreparation.deleteMany({ where: { publication: { passportId: id } } });
    await db.publicationPinAttempt.deleteMany({ where: { publication: { passportId: id } } });
    await db.publication.deleteMany({ where: { passportId: id } });
    await db.publicSnapshotConfirmation.deleteMany({ where: { passportId: id } });
    await db.evidenceFile.deleteMany({ where: { passportId: id } });
    await db.chemicalApplication.deleteMany({ where: { passportId: id } });
    await db.meteoMeasurement.deleteMany({ where: { passportId: id } });
    await db.treatment.deleteMany({ where: { passportId: id } });
    await db.passport.delete({ where: { id } });
    await db.field.delete({ where: { id: row.fieldId } }); await db.farmer.delete({ where: { id: row.farmerId } });
  }
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.rateLimit.deleteMany({ where: { OR: Array.from({ length: nextIp }, (_, index) => ({ key: { contains: `${ipPrefix}${index + 1}:` } })) } });
  await db.$disconnect();
}
