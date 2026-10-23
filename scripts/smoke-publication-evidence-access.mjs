import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const days = n => new Date(Date.now() + n * 86_400_000);

/** Issued records release private evidence to staff only under an active,
 * recorded grant; every admin download is audited, before and after issuance.
 */
export async function smokeEvidenceAccess({ api, db, publisher, issuedPassportId, unissuedPassportId }) {
  const access = `/api/admin/passports/${issuedPassportId}/evidence-access`;
  const files = await db.evidenceFile.findMany({ where: { passportId: issuedPassportId, status: "READY" }, select: { id: true } });
  assert.ok(files.length >= 1);
  const download = (fileId, grantId, passportId = issuedPassportId) => api(`/api/admin/passports/${passportId}/evidence/${fileId}/preview${grantId ? `?grantId=${grantId}` : ""}`, { user: publisher });
  const grant = { organization: "Fictional Insurer X", basis: "DATA_SUBJECT_CONSENT", basisReference: "FICTIONAL-CONSENT-1", purpose: "Fictional claim review",
    scope: "EVIDENCE", days: 14, acknowledgement: "RECORD_EVIDENCE_ACCESS_BASIS" };
  const downloads = () => db.auditLog.count({ where: { passportId: issuedPassportId, action: "EVIDENCE_DOWNLOADED" } });
  try {
    assert.equal((await api(access)).status, 401);
    const before = await (await api(access, { user: publisher })).json();
    assert.equal(before.issued, true); assert.equal(before.files.length, files.length); assert.deepEqual(before.grants, []);
    assert.ok(!JSON.stringify(before).includes("objectKey"), "storage keys never reach the client");

    assert.equal((await download(files[0].id)).status, 403, "issued evidence needs a grant");
    assert.equal((await download(files[0].id, randomUUID())).status, 403);
    assert.equal((await download(files[0].id, "not-a-uuid")).status, 400);
    assert.equal(await downloads(), 0, "refused requests are not recorded as downloads");
    for (const patch of [{ days: 31 }, { days: 0 }, { acknowledgement: undefined }, { basis: "OTHER" }, { organization: " " }, { extra: true }]) {
      assert.equal((await api(access, { user: publisher, method: "POST", body: { ...grant, ...patch } })).status, 400, JSON.stringify(patch));
    }
    assert.equal((await api(access, { method: "POST", body: grant })).status, 401);

    const created = await api(access, { user: publisher, method: "POST", body: grant });
    assert.equal(created.status, 201);
    const grantId = (await created.json()).grant.id;
    const allowed = await download(files[0].id, grantId);
    assert.ok([302, 307].includes(allowed.status) && allowed.headers.get("location"), "an active evidence grant releases a short-lived signed URL");
    assert.equal(allowed.headers.get("cache-control"), "private, no-store");
    const audit = await db.auditLog.findFirstOrThrow({ where: { passportId: issuedPassportId, action: "EVIDENCE_DOWNLOADED" } });
    assert.equal(audit.note, `File ${files[0].id} under grant ${grantId}`);
    assert.equal(await db.auditLog.count({ where: { passportId: issuedPassportId, action: "EVIDENCE_ACCESS_GRANTED" } }), 1);

    const mapping = await (await api(access, { user: publisher, method: "POST", body: { ...grant, scope: "MAPPING" } })).json();
    assert.equal((await download(files[0].id, mapping.grant.id)).status, 403, "a mapping-only grant does not release files");
    await db.evidenceAccessGrant.update({ where: { id: mapping.grant.id }, data: { grantedAt: days(-3), expiresAt: days(-1), scope: "EVIDENCE" } });
    assert.equal((await download(files[0].id, mapping.grant.id)).status, 403, "an expired grant does not release files");

    assert.equal((await api(access, { user: publisher, method: "DELETE", body: { grantId } })).status, 200);
    assert.equal((await download(files[0].id, grantId)).status, 403, "a revoked grant does not release files");
    assert.equal((await api(access, { user: publisher, method: "DELETE", body: { grantId } })).status, 409);
    const after = await (await api(access, { user: publisher })).json();
    assert.ok(after.grants.every(row => !row.active)); assert.equal(after.grants.length, 2);

    // Before issuance, review downloads need no grant but are still audited.
    const unissued = await db.evidenceFile.findFirstOrThrow({ where: { passportId: unissuedPassportId, status: "READY" }, select: { id: true } });
    assert.ok([302, 307].includes((await download(unissued.id, null, unissuedPassportId)).status));
    assert.equal(await db.auditLog.count({ where: { passportId: unissuedPassportId, action: "EVIDENCE_DOWNLOADED", note: `File ${unissued.id}` } }), 1);

    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 }); await client.connect();
    try {
      for (const [sql, values] of [
        ['UPDATE "EvidenceAccessGrant" SET "expiresAt"="grantedAt" + interval \'31 days\' WHERE "id"=$1', [grantId]],
        ['UPDATE "EvidenceAccessGrant" SET "revokedById"=NULL WHERE "id"=$1', [grantId]],
        ['UPDATE "EvidenceAccessGrant" SET "organization"=$2 WHERE "id"=$1', [grantId, " "]],
        ['UPDATE "EvidenceAccessGrant" SET "expiresAt"="grantedAt" WHERE "id"=$1', [grantId]],
      ]) {
        await client.query("BEGIN");
        try { await assert.rejects(client.query(sql, values), error => error.code === "23514" && error.constraint === "EvidenceAccessGrant_shape_check"); }
        finally { await client.query("ROLLBACK"); }
      }
    } finally { await client.end(); }
    process.stdout.write("Evidence access passed: issued evidence only under an active recorded grant (scope, expiry, revocation), every admin download audited before and after issuance, strict grant input and SQL shape.\n");
  } finally {
    await db.evidenceAccessGrant.deleteMany({ where: { passportId: { in: [issuedPassportId, unissuedPassportId] } } });
    await db.auditLog.deleteMany({ where: { passportId: { in: [issuedPassportId, unissuedPassportId] },
      action: { in: ["EVIDENCE_ACCESS_GRANTED", "EVIDENCE_ACCESS_REVOKED", "EVIDENCE_DOWNLOADED"] } } });
  }
}
