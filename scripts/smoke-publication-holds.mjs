import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { createJiti } from "jiti";
import pg from "pg";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { placeHold, releaseHold } = await jiti.import("@/lib/retention/holds");
const { createDraft } = await jiti.import("@/lib/drafts/service");
const { removeEvidence } = await jiti.import("@/lib/evidence/service");
const run = promisify(execFile);
const rejects = (promise, status = 409) => assert.rejects(promise, error => error.status === status);
const pruneCount = async () => Number((await run(process.execPath, ["scripts/prune-evidence.mjs"])).stdout.match(/Would prune (\d+)/)[1]);

/** Holds block deletion/purging at the application and database layers and
 * are released explicitly. Cleans up its own draft and releases its own holds.
 */
export async function smokePreservationHolds({ api, db, publisherId, publisher, issuedPassportId }) {
  const route = `/api/admin/passports/${issuedPassportId}/holds`;
  const hold = { reference: "FICTIONAL-CLAIM-1", reason: "Fictional dispute about the treatment record", acknowledgement: "PLACE_PRESERVATION_HOLD" };
  const owner = (await db.passport.findUniqueOrThrow({ where: { id: issuedPassportId }, select: { ownerId: true } })).ownerId;
  let draftId;
  try {
    assert.equal((await api(route)).status, 401);
    for (const patch of [{ reference: " " }, { reason: "x" }, { acknowledgement: undefined }, { extra: true }]) {
      assert.equal((await api(route, { user: publisher, method: "POST", body: { ...hold, ...patch } })).status, 400, JSON.stringify(patch));
    }
    await rejects(placeHold("not-an-admin", issuedPassportId, hold), 403);
    const placed = await api(route, { user: publisher, method: "POST", body: hold });
    assert.equal(placed.status, 201);
    const holdId = (await placed.json()).hold.id;
    const listed = (await (await api(route, { user: publisher })).json()).holds;
    assert.equal(listed.length, 1); assert.equal(listed[0].active, true); assert.equal(listed[0].reference, hold.reference);

    // Database backstop, independent of application code.
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 }); await client.connect();
    try {
      for (const [sql, values] of [
        ['DELETE FROM "EvidenceFile" WHERE "passportId"=$1', [issuedPassportId]],
        ['UPDATE "EvidenceFile" SET "objectPurgedAt"=now() WHERE "passportId"=$1', [issuedPassportId]],
        ['DELETE FROM "Passport" WHERE "id"=$1', [issuedPassportId]],
        ['DELETE FROM "PreservationHold" WHERE "id"=$1', [holdId]],
      ]) {
        await client.query("BEGIN");
        try { await assert.rejects(client.query(sql, values), error => error.code === "23514" && error.constraint === "PreservationHold_active_guard", sql); }
        finally { await client.query("ROLLBACK"); }
      }
      await client.query("BEGIN");
      try { await assert.rejects(client.query('UPDATE "PreservationHold" SET "releasedAt"=now() WHERE "id"=$1', [holdId]),
        error => error.code === "23514" && error.constraint === "PreservationHold_shape_check", "release needs actor and note"); }
      finally { await client.query("ROLLBACK"); }
    } finally { await client.end(); }

    // Application: an operator cannot remove evidence from a held draft; prune skips it.
    draftId = (await createDraft(owner)).id;
    const file = await db.evidenceFile.create({ data: { ownerId: owner, passportId: draftId, kind: "METEO", status: "READY",
      objectKey: `fictional-hold/${randomUUID()}`, filename: "fictional-hold.txt", contentType: "text/plain", sizeBytes: 1,
      sha256: createHash("sha256").update("fictional hold").digest("hex"), uploadExpiresAt: new Date() } });
    const stale = await db.evidenceFile.create({ data: { ownerId: owner, passportId: draftId, kind: "CHEMICAL", status: "REJECTED", rejectionCode: "REMOVED",
      objectKey: `fictional-hold/${randomUUID()}`, filename: "fictional-stale.txt", contentType: "text/plain", sizeBytes: 1,
      sha256: createHash("sha256").update("fictional stale").digest("hex"), uploadExpiresAt: new Date() } });
    await db.$executeRaw`UPDATE "EvidenceFile" SET "updatedAt" = now() - interval '2 days' WHERE "id" = ${stale.id}::uuid`;
    const draftHold = await placeHold(publisherId, draftId, { ...hold, reference: "FICTIONAL-CLAIM-2" });
    await rejects(removeEvidence(owner, draftId, file.id), 409);
    assert.equal((await db.evidenceFile.findUniqueOrThrow({ where: { id: file.id } })).status, "READY");
    const heldCount = await pruneCount();
    await rejects(releaseHold(publisherId, draftId, { holdId: draftHold.id, note: "x", acknowledgement: "RELEASE_PRESERVATION_HOLD" }), 422);
    assert.equal((await releaseHold(publisherId, draftId, { holdId: draftHold.id, note: "Fictional dispute closed", acknowledgement: "RELEASE_PRESERVATION_HOLD" })).stillHeld, false);
    assert.equal(await pruneCount(), heldCount + 1, "after release the stale object is eligible for prune again");
    await rejects(releaseHold(publisherId, draftId, { holdId: draftHold.id, note: "Fictional repeat", acknowledgement: "RELEASE_PRESERVATION_HOLD" }), 409);
    await removeEvidence(owner, draftId, file.id);
    assert.equal((await db.evidenceFile.findUniqueOrThrow({ where: { id: file.id } })).rejectionCode, "REMOVED", "removal works again after release");

    const released = await api(route, { user: publisher, method: "DELETE", body: { holdId, note: "Fictional claim settled", acknowledgement: "RELEASE_PRESERVATION_HOLD" } });
    assert.equal(released.status, 200);
    assert.equal(await db.auditLog.count({ where: { passportId: issuedPassportId, action: { in: ["PRESERVATION_HOLD_PLACED", "PRESERVATION_HOLD_RELEASED"] } } }), 2);
    process.stdout.write("Preservation holds passed: audited place/release, database guards on passport/evidence deletion and purge marks, held-draft evidence removal refused, prune exclusion while held, strict input.\n");
  } finally {
    // Release anything this fixture left active, then remove its rows.
    const ids = [issuedPassportId, draftId].filter(Boolean);
    await db.preservationHold.updateMany({ where: { passportId: { in: ids }, releasedAt: null },
      data: { releasedAt: new Date(), releasedById: publisherId, releaseNote: "Fictional fixture cleanup" } });
    await db.preservationHold.deleteMany({ where: { passportId: { in: ids } } });
    await db.auditLog.deleteMany({ where: { passportId: { in: ids }, action: { in: ["PRESERVATION_HOLD_PLACED", "PRESERVATION_HOLD_RELEASED"] } } });
    if (draftId) {
      const draft = await db.passport.findUnique({ where: { id: draftId }, select: { farmerId: true, fieldId: true } });
      await db.evidenceFile.deleteMany({ where: { passportId: draftId } });
      await db.auditLog.deleteMany({ where: { passportId: draftId } });
      for (const model of ["chemicalApplication", "meteoMeasurement", "treatment"]) await db[model].deleteMany({ where: { passportId: draftId } });
      await db.passport.delete({ where: { id: draftId } });
      if (draft) { await db.field.delete({ where: { id: draft.fieldId } }); await db.farmer.delete({ where: { id: draft.farmerId } }); }
    }
  }
}
