// Local backup/restore drill (guide 8.3, D61). Backs up PostgreSQL and the
// evidence bucket as one set, restores into an isolated database and bucket,
// reapplies a separately exported deletion/hold journal before any access, then
// verifies a fictional record end to end. Local database only; everything it
// creates is removed.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import nextEnv from "@next/env";
import { createJiti } from "jiti";
import pg from "pg";
import { CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

nextEnv.loadEnvConfig(process.cwd());
const live = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(live.hostname)) throw new Error("The drill runs only against a local database");
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { getDb } = await jiti.import("../lib/db-core.ts");
const { createDraft } = await jiti.import("../lib/drafts/service.ts");
const { sendDraftNotices, deleteNoticedDrafts } = await jiti.import("../lib/retention/drafts.ts");
const { removeEvidence } = await jiti.import("../lib/evidence/service.ts");
const db = getDb();
const s3 = new S3Client({ region: process.env.EVIDENCE_S3_REGION, endpoint: process.env.EVIDENCE_S3_ENDPOINT || undefined, forcePathStyle: Boolean(process.env.EVIDENCE_S3_ENDPOINT),
  credentials: process.env.EVIDENCE_S3_ACCESS_KEY ? { accessKeyId: process.env.EVIDENCE_S3_ACCESS_KEY, secretAccessKey: process.env.EVIDENCE_S3_SECRET_KEY } : undefined });
const liveBucket = process.env.EVIDENCE_S3_BUCKET;
const suffix = randomBytes(5).toString("hex"), restoreDb = `hartolit_restore_${suffix}`, restoreBucket = `hartolit-restore-${suffix}`;
const dir = path.join(os.tmpdir(), `hartolit-backup-${suffix}`), journalFile = path.join(os.tmpdir(), `hartolit-journal-${suffix}.json`);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const DAY = 86_400_000, at = days => new Date(Date.now() + days * DAY);
const timings = {};
const timed = async (name, fn) => { const start = performance.now(); const value = await fn(); timings[name] = Math.round(performance.now() - start); return value; };

// Database tools run inside the PostgreSQL container, so no host client is needed.
function inContainer(script, { input, output } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "--env-file", ".env.db.local", "exec", "-T", "postgres", "sh", "-c", script], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    if (output) child.stdout.pipe(output); else child.stdout.resume();
    if (input) input.pipe(child.stdin); else child.stdin.end();
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`container command failed (${code}): ${stderr.slice(0, 200)}`)));
  });
}
const bytesOf = async (bucket, key) => Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body.transformToByteArray());
// Per-table content digests: every row, in a stable order, as PostgreSQL text.
async function tableDigests(query) {
  const tables = (await query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).map(row => row.tablename);
  const digests = {};
  for (const table of tables) {
    const [row] = await query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS digest FROM "${table}" t`);
    digests[table] = `${row.n}:${row.digest}`;
  }
  return digests;
}
async function listKeys(bucket) {
  const keys = []; let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    keys.push(...(page.Contents ?? []).map(row => row.Key)); token = page.NextContinuationToken;
  } while (token);
  return keys;
}

// What a restore must reapply: draft deletion tombstones (D60), evidence removals
// and purges, and hold changes since `since`. Hosted, this journal must be kept
// outside the backup it corrects; the drill writes it to its own file.
async function exportJournal(since) {
  const drafts = await db.draftRetentionNotice.findMany({ where: { deletedAt: { gte: since } } });
  const evidence = await db.evidenceFile.findMany({ where: { updatedAt: { gte: since }, OR: [{ rejectionCode: "REMOVED" }, { objectPurgedAt: { not: null } }] },
    select: { id: true, objectKey: true, status: true, rejectionCode: true, objectPurgedAt: true } });
  const holds = await db.preservationHold.findMany({ where: { OR: [{ placedAt: { gte: since } }, { releasedAt: { gte: since } }] } });
  return { since, drafts, evidence, holds };
}

// Idempotent. Order matters: releases first (a deletion may follow a release),
// then deletions, then holds still active (no deletion can follow an active hold).
async function reapplyJournal(client, bucket, journal) {
  const query = (sql, values) => client.query(sql, values).then(result => result.rows);
  const upsertHold = hold => query(`INSERT INTO "PreservationHold" ("id","passportId","reference","reason","placedById","placedAt","releasedAt","releasedById","releaseNote")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT ("id") DO UPDATE SET "releasedAt"=EXCLUDED."releasedAt","releasedById"=EXCLUDED."releasedById","releaseNote"=EXCLUDED."releaseNote"`,
  [hold.id, hold.passportId, hold.reference, hold.reason, hold.placedById, hold.placedAt, hold.releasedAt, hold.releasedById, hold.releaseNote]);
  for (const hold of journal.holds.filter(row => row.releasedAt)) await upsertHold(hold);
  for (const file of journal.evidence) {
    if (file.objectPurgedAt) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: file.objectKey }));
    await query('UPDATE "EvidenceFile" SET status = $2::"EvidenceStatus", "rejectionCode" = $3, "scanLeaseUntil" = NULL, "objectPurgedAt" = $4 WHERE id = $1',
      [file.id, file.status, file.rejectionCode, file.objectPurgedAt]);
  }
  for (const notice of journal.drafts) {
    for (const file of await query('SELECT "objectKey" FROM "EvidenceFile" WHERE "passportId" = $1', [notice.passportId])) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: file.objectKey }));
    }
    await query("BEGIN");
    const [row] = await query('SELECT "farmerId", "fieldId" FROM "Passport" WHERE id = $1', [notice.passportId]);
    for (const table of ["EvidenceFile", "ChemicalApplication", "MeteoMeasurement", "Treatment", "AuditLog"]) await query(`DELETE FROM "${table}" WHERE "passportId" = $1`, [notice.passportId]);
    await query('DELETE FROM "Passport" WHERE id = $1', [notice.passportId]);
    if (row) {
      await query('DELETE FROM "Field" f WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM "Passport" WHERE "fieldId" = f.id)', [row.fieldId]);
      await query('DELETE FROM "Farmer" f WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM "Passport" WHERE "farmerId" = f.id) AND NOT EXISTS (SELECT 1 FROM "Field" WHERE "farmerId" = f.id)', [row.farmerId]);
    }
    await query(`INSERT INTO "DraftRetentionNotice" ("id","passportId","ownerId","noticedAt","deleteAfter","draftUpdatedAt","emailStatus","deletedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7::"DraftNoticeEmailStatus",$8) ON CONFLICT ("id") DO UPDATE SET "deletedAt" = EXCLUDED."deletedAt"`,
    [notice.id, notice.passportId, notice.ownerId, notice.noticedAt, notice.deleteAfter, notice.draftUpdatedAt, notice.emailStatus, notice.deletedAt]);
    await query("COMMIT");
  }
  for (const hold of journal.holds.filter(row => !row.releasedAt)) await upsertHold(hold);
}

const ids = { users: [], passports: [], objects: [] };
let restoreClient;
try {
  // 0. Fictional fixture in the live system.
  const owner = await db.user.create({ data: { id: `drill-owner-${suffix}`, name: "Fictional Drill Owner", email: `drill-owner-${suffix}@example.invalid`, emailVerified: true, role: "user" } });
  const admin = await db.user.create({ data: { id: `drill-admin-${suffix}`, name: "Fictional Drill Admin", email: `drill-admin-${suffix}@example.invalid`, emailVerified: true, role: "admin", twoFactorEnabled: true } });
  ids.users.push(owner.id, admin.id);
  const record = await db.$transaction(async tx => {
    const farmer = await tx.farmer.create({ data: { ownerId: owner.id, legalName: `Fictional Drill Farmer ${suffix}`, registrationId: `DRILL-${suffix}` } });
    const field = await tx.field.create({ data: { ownerId: owner.id, farmerId: farmer.id, areaHectares: 12.5, crop: "sunflower", cadastralNumber: `DRILL-CAD-${suffix}` } });
    return tx.passport.create({ data: { ownerId: owner.id, farmerId: farmer.id, fieldId: field.id, status: "APPROVED", version: 4, approvedVersion: 2, submittedVersion: 2,
      submittedAt: new Date(), reviewerId: admin.id, reviewedById: admin.id, publicFarmLabel: "Fictional Drill Farm",
      treatment: { create: { treatmentType: "herbicide", treatmentDate: "2026-09-01" } }, meteo: { create: {} }, chemical: { create: { product: "Fictional Product" } } } });
  });
  ids.passports.push(record.id);
  const upload = async (passportId, kind, text) => {
    const bytes = Buffer.from(`${text} ${suffix}`), key = `fictional-drill/${randomUUID()}`;
    await s3.send(new PutObjectCommand({ Bucket: liveBucket, Key: key, Body: bytes, ContentType: "text/plain" })); ids.objects.push(key);
    return db.evidenceFile.create({ data: { ownerId: owner.id, passportId, kind, status: "READY", objectKey: key, filename: `${kind}.txt`, contentType: "text/plain",
      sizeBytes: bytes.length, sha256: sha(bytes), uploadExpiresAt: new Date() } });
  };
  await upload(record.id, "METEO", "fictional weather evidence"); await upload(record.id, "CHEMICAL", "fictional chemical evidence");
  const earlyHold = await db.preservationHold.create({ data: { passportId: record.id, reference: "DRILL-CLAIM-1", reason: "Fictional claim before backup", placedById: admin.id } });
  for (const action of ["PASSPORT_SUBMITTED", "REVIEW_APPROVED"]) await db.auditLog.create({ data: { passportId: record.id, actorId: admin.id, action, version: 3 } });
  const draft = await createDraft(owner.id); ids.passports.push(draft.id);
  const draftFile = await upload(draft.id, "METEO", "fictional draft evidence");
  const kept = await createDraft(owner.id); ids.passports.push(kept.id);
  const removedFile = await upload(kept.id, "CHEMICAL", "fictional removed evidence");
  const keptHold = await db.preservationHold.create({ data: { passportId: kept.id, reference: "DRILL-CLAIM-3", reason: "Fictional claim released before removal", placedById: admin.id } });

  // 1. Backup set: database dump plus every bucket object, with a manifest. The
  // journal cutoff precedes the dump, so anything during the backup is reapplied too.
  const startedAt = new Date();
  const manifest = await timed("backupMs", async () => {
    await mkdir(path.join(dir, "objects"), { recursive: true });
    await inContainer('pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"', { output: createWriteStream(path.join(dir, "database.dump")) });
    const objects = [];
    for (const key of await listKeys(liveBucket)) {
      const bytes = await bytesOf(liveBucket, key), file = sha(Buffer.from(key));
      await writeFile(path.join(dir, "objects", file), bytes); objects.push({ key, file, size: bytes.length, sha256: sha(bytes) });
    }
    const migrations = (await db.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`).map(row => row.migration_name);
    // Taken right after the dump on a quiet local database, so they describe the dumped state.
    const tables = await tableDigests(sql => db.$queryRawUnsafe(sql));
    const value = { startedAt: startedAt.toISOString(), databaseSha256: sha(await readFile(path.join(dir, "database.dump"))), objects, migrations, tables };
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify(value)); return value;
  });
  assert.ok(manifest.objects.some(row => row.key === draftFile.objectKey), "the backup contains the draft's object");

  // 2. Events after the backup: a retention deletion, an owner's evidence removal,
  // a hold release and a new hold. Then the journal is exported to its own file.
  await sendDraftNotices(at(91), async () => {}, [draft.id]);
  assert.deepEqual(await deleteNoticedDrafts(at(122), [draft.id]), { deleted: 1, skipped: 0 });
  // The removal is only possible after this release, so the restore must release first.
  await db.preservationHold.update({ where: { id: keptHold.id }, data: { releasedAt: new Date(), releasedById: admin.id, releaseNote: "Fictional claim settled" } });
  await removeEvidence(owner.id, kept.id, removedFile.id);
  ids.objects = ids.objects.filter(key => key !== draftFile.objectKey && key !== removedFile.objectKey);
  await db.preservationHold.update({ where: { id: earlyHold.id }, data: { releasedAt: new Date(), releasedById: admin.id, releaseNote: "Fictional claim settled" } });
  const lateHold = await db.preservationHold.create({ data: { passportId: record.id, reference: "DRILL-CLAIM-2", reason: "Fictional claim after backup", placedById: admin.id } });
  await writeFile(journalFile, JSON.stringify(await exportJournal(startedAt)));

  // 3. Restore into an isolated database and bucket.
  await timed("restoreMs", async () => {
    assert.equal(sha(await readFile(path.join(dir, "database.dump"))), manifest.databaseSha256, "dump integrity");
    await inContainer(`createdb -U "$POSTGRES_USER" ${restoreDb}`);
    await inContainer(`pg_restore --no-owner --exit-on-error -U "$POSTGRES_USER" -d ${restoreDb}`, { input: createReadStream(path.join(dir, "database.dump")) });
    await s3.send(new CreateBucketCommand({ Bucket: restoreBucket }));
    for (const row of manifest.objects) {
      const bytes = await readFile(path.join(dir, "objects", row.file));
      assert.equal(sha(bytes), row.sha256, `object integrity ${row.file}`);
      await s3.send(new PutObjectCommand({ Bucket: restoreBucket, Key: row.key, Body: bytes }));
    }
  });
  const restoreUrl = new URL(live); restoreUrl.pathname = `/${restoreDb}`;
  restoreClient = new pg.Client({ connectionString: restoreUrl.toString(), connectionTimeoutMillis: 3000 }); await restoreClient.connect();
  const restored = (sql, values) => restoreClient.query(sql, values).then(result => result.rows);
  assert.deepEqual(await tableDigests(restored), manifest.tables, "every restored table matches the backed-up rows");
  assert.equal((await restored('SELECT count(*)::int AS n FROM "Passport" WHERE id = $1', [draft.id]))[0].n, 1, "the restored backup still has the later-deleted draft");

  // 4. Before any access: reapply the journal, read only from its own file.
  const journal = JSON.parse(await readFile(journalFile, "utf8"));
  assert.ok(journal.drafts.length && journal.evidence.length && journal.holds.length >= 2, "the journal holds the post-backup events");
  await timed("reapplyMs", () => reapplyJournal(restoreClient, restoreBucket, journal));
  await reapplyJournal(restoreClient, restoreBucket, journal); // idempotent

  // 5. Verify the restored set.
  await timed("verifyMs", async () => {
    const [mapping] = await restored('SELECT f."legalName", f."registrationId", fd."cadastralNumber", p.status FROM "Passport" p JOIN "Farmer" f ON f.id = p."farmerId" JOIN "Field" fd ON fd.id = p."fieldId" WHERE p.id = $1', [record.id]);
    assert.deepEqual(mapping, { legalName: `Fictional Drill Farmer ${suffix}`, registrationId: `DRILL-${suffix}`, cadastralNumber: `DRILL-CAD-${suffix}`, status: "APPROVED" }, "private mapping restored");
    const files = await restored('SELECT "objectKey", sha256 FROM "EvidenceFile" WHERE "passportId" = $1 AND status = $2', [record.id, "READY"]);
    assert.equal(files.length, 2);
    for (const file of files) assert.equal(sha(await bytesOf(restoreBucket, file.objectKey)), file.sha256, "restored object matches its evidence row");
    const holds = await restored('SELECT id, "releasedAt" FROM "PreservationHold" WHERE "passportId" = $1 ORDER BY "placedAt"', [record.id]);
    assert.deepEqual(holds.map(row => [row.id, row.releasedAt !== null]), [[earlyHold.id, true], [lateHold.id, false]], "hold release and new hold reapplied");
    const [removed] = await restored('SELECT status, "rejectionCode", "objectPurgedAt" FROM "EvidenceFile" WHERE id = $1', [removedFile.id]);
    assert.deepEqual([removed.status, removed.rejectionCode, removed.objectPurgedAt !== null], ["REJECTED", "REMOVED", true], "an evidence removal after the backup is reapplied");
    await assert.rejects(s3.send(new GetObjectCommand({ Bucket: restoreBucket, Key: removedFile.objectKey })), "the removed object is gone from the restore");
    assert.equal((await restored('SELECT count(*)::int AS n FROM "DraftRetentionNotice" WHERE "passportId" = $1 AND "deletedAt" IS NOT NULL', [draft.id]))[0].n, 1, "the tombstone travels into the restore");
    assert.equal((await restored('SELECT count(*)::int AS n FROM "AuditLog" WHERE "passportId" = $1', [record.id]))[0].n,
      await db.auditLog.count({ where: { passportId: record.id } }), "audit history restored");
    assert.equal((await restored('SELECT count(*)::int AS n FROM "Passport" WHERE id = $1', [draft.id]))[0].n, 0, "a deletion after the backup is reapplied");
    await assert.rejects(s3.send(new GetObjectCommand({ Bucket: restoreBucket, Key: draftFile.objectKey })), "the deleted draft's object is gone from the restore");
    const restoredKeys = new Set(await listKeys(restoreBucket));
    for (const row of manifest.objects) if (![draftFile.objectKey, removedFile.objectKey].includes(row.key)) assert.ok(restoredKeys.has(row.key), `restored object ${row.file}`);
    const migrations = (await restored("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name")).map(row => row.migration_name);
    assert.deepEqual(migrations, manifest.migrations, "restored schema history");
    // The hold guard travels with the restore.
    await assert.rejects(restoreClient.query('DELETE FROM "Passport" WHERE id = $1', [record.id]), error => error.constraint === "PreservationHold_active_guard");
  });
  process.stdout.write(`${JSON.stringify({ result: "Backup/restore drill passed", objects: manifest.objects.length, tables: Object.keys(manifest.tables).length, migrations: manifest.migrations.length, timings })}\n`);
} finally {
  await restoreClient?.end().catch(() => {});
  await inContainer(`dropdb --if-exists -U "$POSTGRES_USER" ${restoreDb}`).catch(() => { process.exitCode = 1; });
  for (const key of await listKeys(restoreBucket).catch(() => [])) await s3.send(new DeleteObjectCommand({ Bucket: restoreBucket, Key: key }));
  await s3.send(new DeleteBucketCommand({ Bucket: restoreBucket })).catch(() => {});
  await rm(dir, { recursive: true, force: true }); await rm(journalFile, { force: true });
  for (const key of ids.objects) await s3.send(new DeleteObjectCommand({ Bucket: liveBucket, Key: key })).catch(() => {});
  const passports = ids.passports;
  await db.$executeRaw`UPDATE "PreservationHold" SET "releasedAt" = now(), "releasedById" = "placedById", "releaseNote" = 'Fictional drill cleanup' WHERE "passportId" = ANY(${passports}::uuid[]) AND "releasedAt" IS NULL`;
  await db.preservationHold.deleteMany({ where: { passportId: { in: passports } } });
  await db.draftRetentionNotice.deleteMany({ where: { passportId: { in: passports } } });
  for (const id of passports) {
    const row = await db.passport.findUnique({ where: { id }, select: { farmerId: true, fieldId: true } });
    if (!row) continue;
    for (const model of ["evidenceFile", "chemicalApplication", "meteoMeasurement", "treatment", "auditLog"]) await db[model].deleteMany({ where: { passportId: id } });
    await db.passport.delete({ where: { id } });
    await db.field.delete({ where: { id: row.fieldId } }); await db.farmer.delete({ where: { id: row.farmerId } });
  }
  await db.user.deleteMany({ where: { id: { in: ids.users } } });
  await db.$disconnect();
}
