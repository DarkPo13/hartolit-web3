// Unused-draft retention smoke: local PostgreSQL and Mailpit only; fictional
// owner and drafts; time is injected, never by editing business timestamps.
import assert from "node:assert/strict";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import nextEnv from "@next/env";
import { createJiti } from "jiti";

nextEnv.loadEnvConfig(process.cwd());
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Retention smoke requires a local database");
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { draftRetentionPlan, sendDraftNotices, deleteNoticedDrafts } = await jiti.import("../lib/retention/drafts.ts");
const { createDraft, saveDraft, getDraft } = await jiti.import("../lib/drafts/service.ts");
const { getDb } = await jiti.import("../lib/db-core.ts");
const db = getDb();
const DAY = 86_400_000, suffix = randomBytes(6).toString("hex"), email = `retention-owner-${suffix}@example.invalid`;
const at = days => new Date(Date.now() + days * DAY);
const mine = (rows, ids) => rows.filter(row => ids.includes(row.id)).map(row => row.id).sort();
const mailpit = process.env.MAILPIT_API_URL ?? "http://127.0.0.1:8025";
const run = promisify(execFile);

const owner = await db.user.create({ data: { id: `retention-${suffix}`, name: "Fictional Retention Owner", email, emailVerified: true, role: "user" } });
const admin = await db.user.create({ data: { id: `retention-admin-${suffix}`, name: "Fictional Retention Admin", email: `retention-admin-${suffix}@example.invalid`,
  emailVerified: true, role: "admin", twoFactorEnabled: true } });
const ids = [];
try {
  const draft = async () => { const row = await createDraft(owner.id); ids.push(row.id); return row; };
  const [plain, held, edited, withFile, submitted] = [await draft(), await draft(), await draft(), await draft(), await draft()];
  await db.passport.update({ where: { id: submitted.id }, data: { submittedAt: new Date() } }); // treated as once-submitted
  await db.preservationHold.create({ data: { passportId: held.id, reference: "FICTIONAL-HOLD", reason: "Fictional retention exclusion", placedById: admin.id } });
  await db.evidenceFile.create({ data: { ownerId: owner.id, passportId: withFile.id, kind: "METEO", status: "READY", objectKey: `fictional-retention/${randomUUID()}`,
    filename: "fictional.txt", contentType: "text/plain", sizeBytes: 1, sha256: createHash("sha256").update("fictional").digest("hex"), uploadExpiresAt: new Date() } });

  // Day 0 and day 89: nothing is eligible.
  const plan = now => draftRetentionPlan(now, ids);
  assert.deepEqual(mine((await plan(at(89))).needsNotice, ids), []);
  // Day 91: never-submitted, unheld drafts need a notice; held and once-submitted do not.
  const day91 = await plan(at(91));
  assert.deepEqual(mine(day91.needsNotice, ids), [plain.id, edited.id, withFile.id].sort());
  assert.deepEqual(mine([...day91.waiting, ...day91.deletable], ids), []);
  assert.deepEqual(mine(day91.deletable, ids), [], "no deletion without a notice");

  // A failed email records a notice that never starts the period.
  const failing = await sendDraftNotices(at(91), async () => { throw new Error("fictional smtp outage"); }, ids);
  assert.deepEqual(failing, { sent: 0, failed: 3 });
  assert.deepEqual(mine((await plan(at(200))).deletable, ids), [], "failed notices never lead to deletion");
  await db.draftRetentionNotice.deleteMany({ where: { passportId: { in: ids } } });

  // Real email through Mailpit.
  const before = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).then(r => r.json());
  const sent = await sendDraftNotices(at(91), undefined, ids);
  assert.deepEqual(sent, { sent: 3, failed: 0 });
  const after = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).then(r => r.json());
  assert.equal(after.messages_count - before.messages_count, 3, "one email per eligible draft");
  const message = await fetch(`${mailpit}/api/v1/message/${after.messages[0].ID}`).then(r => r.json());
  assert.match(message.Text, /will be deleted after \d{4}-\d{2}-\d{2}/); assert.ok(!message.Text.includes(plain.id), "no record identifiers in the email");
  assert.equal((await sendDraftNotices(at(92), undefined, ids)).sent, 0, "a valid notice is not repeated");

  // Editing during the notice period voids the notice.
  const current = await getDraft(owner.id, edited.id);
  await saveDraft(owner.id, edited.id, { version: current.version, data: { ...current.data, farmer: { ...current.data.farmer, publicFarmLabel: "Fictional Edited Farm" } } });

  // Day 120: still inside the notice period. Day 122: deletable, except the edited draft.
  assert.deepEqual(mine((await plan(at(120))).deletable, ids), []);
  const day122 = await plan(at(122));
  assert.deepEqual(mine(day122.deletable, ids), [plain.id, withFile.id].sort());
  assert.ok(!mine(day122.deletable, ids).includes(edited.id), "an edit after notice resets the clock");

  // Storage failure skips the draft with a file (nothing deleted), the plain draft is deleted.
  const saved = { endpoint: process.env.EVIDENCE_S3_ENDPOINT };
  process.env.EVIDENCE_S3_ENDPOINT = "http://127.0.0.1:1";
  let outcome;
  const plainRows = await db.passport.findUniqueOrThrow({ where: { id: plain.id }, select: { fieldId: true, farmerId: true } });
  try { outcome = await deleteNoticedDrafts(at(122), ids); } finally { process.env.EVIDENCE_S3_ENDPOINT = saved.endpoint; }
  assert.deepEqual(outcome, { deleted: 1, skipped: 1 });
  assert.equal(await db.passport.count({ where: { id: plain.id } }), 0, "the eligible draft is deleted");
  assert.equal(await db.passport.count({ where: { id: withFile.id } }), 1, "a storage failure deletes nothing");
  assert.equal(await db.evidenceFile.count({ where: { passportId: withFile.id } }), 1);
  for (const id of [held.id, edited.id, submitted.id]) assert.equal(await db.passport.count({ where: { id } }), 1);
  const tombstone = await db.draftRetentionNotice.findFirstOrThrow({ where: { passportId: plain.id, deletedAt: { not: null } } });
  assert.equal(tombstone.emailStatus, "SENT");
  assert.equal(await db.field.count({ where: { id: plainRows.fieldId } }), 0); assert.equal(await db.farmer.count({ where: { id: plainRows.farmerId } }), 0);
  assert.equal(await db.auditLog.count({ where: { passportId: plain.id } }), 0);

  // The held draft stays protected even if it reaches deletion through a race.
  const heldRow = await db.passport.findUniqueOrThrow({ where: { id: held.id }, select: { updatedAt: true } });
  await db.draftRetentionNotice.create({ data: { passportId: held.id, ownerId: owner.id, noticedAt: at(91), deleteAfter: at(121), draftUpdatedAt: heldRow.updatedAt, emailStatus: "SENT" } });
  assert.equal(mine((await plan(at(122))).deletable, ids).includes(held.id), false, "held drafts are never deletable");
  assert.deepEqual(await deleteNoticedDrafts(at(122), [held.id]), { deleted: 0, skipped: 0 });

  // The CLI defaults to a dry run and prints counts only.
  const { stdout } = await run(process.execPath, ["scripts/retention-drafts.mjs"]);
  const summary = JSON.parse(stdout);
  assert.equal(summary.mode, "dry-run"); assert.equal(summary.notices, null); assert.equal(summary.deletion, null);
  assert.ok(!stdout.includes(owner.id) && !stdout.includes(email), "no identifiers in CLI output");
  process.stdout.write("Retention smoke passed: 90-day eligibility with hold and once-submitted exclusions, sent-only notice via Mailpit, edit voids notice, 30-day period, deletion with storage-failure rollback, tombstone without private data, dry-run CLI.\n");
} finally {
  await db.$executeRaw`UPDATE "PreservationHold" SET "releasedAt" = now(), "releasedById" = ${admin.id}, "releaseNote" = 'Fictional cleanup' WHERE "passportId" = ANY(${ids}::uuid[]) AND "releasedAt" IS NULL`;
  await db.preservationHold.deleteMany({ where: { passportId: { in: ids } } });
  await db.draftRetentionNotice.deleteMany({ where: { passportId: { in: ids } } });
  for (const id of ids) {
    const row = await db.passport.findUnique({ where: { id }, select: { farmerId: true, fieldId: true } });
    if (!row) continue;
    await db.evidenceFile.deleteMany({ where: { passportId: id } });
    for (const model of ["chemicalApplication", "meteoMeasurement", "treatment", "auditLog"]) await db[model].deleteMany({ where: { passportId: id } });
    await db.passport.delete({ where: { id } });
    await db.field.delete({ where: { id: row.fieldId } }); await db.farmer.delete({ where: { id: row.farmerId } });
  }
  await db.user.deleteMany({ where: { id: { in: [owner.id, admin.id] } } });
  await db.$disconnect();
}
