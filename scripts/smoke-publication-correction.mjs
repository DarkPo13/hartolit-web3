import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
import pg from "pg";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { openPublicationCorrection } = await jiti.import("@/lib/publication/correction");
const { listDrafts } = await jiti.import("@/lib/drafts/service");
const rejects = (promise, status = 409) => assert.rejects(promise, error => error.status === status);
const full = { farmer: true, field: true, treatment: true, meteo: true, chemical: true, evidence: true };

/** Post-mint correction: the published record is untouched; a linked draft copy
 * is created for the same owner. Cleans up only the draft and link it created.
 */
export async function smokePublicationCorrection({ api, db, publisherId, publisher, publication, passportId, whileOpen }) {
  const route = `/api/admin/passports/${passportId}/publication/correction`;
  const body = { publicationId: publication.id, expectedSha256: publication.payloadHash, reason: "Fictional wrong dose found after mint", acknowledgement: "OPEN_PUBLICATION_CORRECTION" };
  const original = await db.passport.findUniqueOrThrow({ where: { id: passportId }, include: full });
  let correction;
  try {
    assert.equal((await api(route)).status, 401);
    assert.equal((await api(route, { method: "POST", body })).status, 401);
    const before = await (await api(route, { user: publisher })).json();
    assert.equal(before.published.id, publication.id); assert.equal(before.correction, null);
    assert.equal((await api(route, { user: publisher, method: "POST", body: { ...body, acknowledgement: "WITHDRAW_UNMINTED_PUBLICATION" } })).status, 400);
    assert.equal((await api(route, { user: publisher, method: "POST", body: { ...body, correctionPassportId: randomUUID() } })).status, 400, "the copy is created by the server, never chosen");
    await rejects(openPublicationCorrection("not-the-publisher", passportId, body), 403);
    await rejects(openPublicationCorrection(publisherId, passportId, { ...body, expectedSha256: "0".repeat(64) }));
    await rejects(openPublicationCorrection(publisherId, randomUUID(), body), 404);

    const results = await Promise.all([api(route, { user: publisher, method: "POST", body }), api(route, { user: publisher, method: "POST", body })]);
    const payloads = await Promise.all(results.map(response => response.json()));
    assert.deepEqual(results.map(response => response.status).sort(), [200, 201], "concurrent opens create one correction");
    assert.equal(payloads[0].correction.correctionPassportId, payloads[1].correction.correctionPassportId);
    correction = await db.publicationCorrection.findUniqueOrThrow({ where: { id: payloads[0].correction.correctionId } });
    assert.equal(correction.actorId, publisherId); assert.equal(correction.reason, body.reason); assert.equal(correction.supersededPassportId, passportId);

    // The published record is untouched.
    const unchanged = await db.publication.findUniqueOrThrow({ where: { id: publication.id } });
    for (const field of ["status", "payloadHash", "tokenId", "transactionHash", "contractAddress", "canonicalJson", "ipfsCid"]) assert.equal(unchanged[field], publication[field], field);
    assert.equal((await db.passport.findUniqueOrThrow({ where: { id: passportId } })).version, original.version);

    // The draft is a separate copy: same owner and facts, own farm/field rows, no evidence.
    const draft = await db.passport.findUniqueOrThrow({ where: { id: correction.correctionPassportId }, include: full });
    assert.equal(draft.status, "DRAFT"); assert.equal(draft.ownerId, original.ownerId); assert.equal(draft.publicFarmLabel, original.publicFarmLabel);
    assert.notEqual(draft.farmerId, original.farmerId); assert.notEqual(draft.fieldId, original.fieldId);
    assert.notEqual(draft.field.publicReference, original.field.publicReference);
    assert.equal(draft.farmer.legalName, original.farmer.legalName); assert.equal(draft.field.crop, original.field.crop);
    assert.equal(String(draft.field.areaHectares), String(original.field.areaHectares));
    assert.equal(draft.treatment.treatmentDate, original.treatment.treatmentDate); assert.equal(String(draft.chemical.dosePerHa), String(original.chemical.dosePerHa));
    assert.equal(String(draft.meteo.temperatureCelsius), String(original.meteo.temperatureCelsius));
    assert.equal(draft.evidence.length, 0); assert.equal(draft.meteo.sourceFileId, null); assert.equal(draft.chemical.sourceFileId, null);
    assert.ok((await listDrafts(original.ownerId)).some(row => row.id === draft.id), "the operator sees the correction draft");
    assert.equal(await db.auditLog.count({ where: { action: "PUBLICATION_CORRECTION_OPENED", passportId: { in: [passportId, draft.id] } } }), 2);
    const after = await (await api(route, { user: publisher })).json();
    assert.equal(after.correction.correctionPassportId, draft.id); assert.equal(after.correction.correctionStatus, "DRAFT"); assert.equal(after.correction.replacementTokenId, null);

    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 }); await client.connect();
    try {
      for (const [sql, values, code, constraint] of [
        ['UPDATE "PublicationCorrection" SET "correctionPassportId"="supersededPassportId" WHERE "id"=$1', [correction.id], "23514", "PublicationCorrection_shape_check"],
        ['UPDATE "PublicationCorrection" SET "reason"=$2 WHERE "id"=$1', [correction.id, "  "], "23514", "PublicationCorrection_shape_check"],
        ['UPDATE "PublicationCorrection" SET "supersededPassportId"="correctionPassportId" WHERE "id"=$1', [correction.id], "23514", "PublicationCorrection_shape_check"],
        ['UPDATE "PublicationCorrection" SET "ownerId"=$2 WHERE "id"=$1', [correction.id, "fictional-other-owner"], "23503", "PublicationCorrection_superseded_passport_fkey"],
        ['INSERT INTO "PublicationCorrection" ("id","supersededPublicationId","supersededPassportId","ownerId","correctionPassportId","actorId","reason") SELECT gen_random_uuid(),"supersededPublicationId","supersededPassportId","ownerId",$2,"actorId",\'Second\' FROM "PublicationCorrection" WHERE "id"=$1',
          [correction.id, randomUUID()], "23505", "PublicationCorrection_supersededPublicationId_key"],
      ]) {
        await client.query("BEGIN");
        try { await assert.rejects(client.query(sql, values), error => error.code === code && error.constraint === constraint); }
        finally { await client.query("ROLLBACK"); }
      }
    } finally { await client.end(); }
    if (whileOpen) await whileOpen();
    process.stdout.write("Post-mint correction passed: publisher-only, exact-hash, idempotent link to a server-created draft copy (own farm/field rows, no evidence), untouched published record, audit and SQL constraints.\n");
  } finally {
    // Look the link up again: a failure before `correction` was assigned (or a
    // regression that let an unexpected open succeed) must still be cleaned.
    const created = await db.publicationCorrection.findUnique({ where: { supersededPublicationId: publication.id } });
    if (created) {
      const draft = await db.passport.findUnique({ where: { id: created.correctionPassportId }, select: { farmerId: true, fieldId: true } });
      await db.publicationCorrection.delete({ where: { id: created.id } });
      await db.auditLog.deleteMany({ where: { OR: [{ passportId: created.correctionPassportId }, { passportId, action: "PUBLICATION_CORRECTION_OPENED" }] } });
      for (const model of ["chemicalApplication", "meteoMeasurement", "treatment"]) await db[model].deleteMany({ where: { passportId: created.correctionPassportId } });
      await db.passport.delete({ where: { id: created.correctionPassportId } });
      // Never delete the original's rows, even if a regression made the draft share them.
      if (draft && draft.fieldId !== original.fieldId) await db.field.delete({ where: { id: draft.fieldId } });
      if (draft && draft.farmerId !== original.farmerId) await db.farmer.delete({ where: { id: draft.farmerId } });
    }
  }
}
