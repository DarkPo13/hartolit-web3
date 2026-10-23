import "server-only";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { EvidenceError, signPreview } from "./service";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const evidenceGrantSchema = z.strictObject({
  organization: text(2, 200), basis: z.enum(["DATA_SUBJECT_CONSENT", "CONTRACT", "LEGAL_OBLIGATION", "LEGITIMATE_INTEREST"]),
  basisReference: text(2, 200), purpose: text(3, 500), scope: z.enum(["EVIDENCE", "MAPPING", "EVIDENCE_AND_MAPPING"]),
  days: z.number().int().min(1).max(30), acknowledgement: z.literal("RECORD_EVIDENCE_ACCESS_BASIS"),
});
export const evidenceGrantRevokeSchema = z.strictObject({ grantId: z.uuid() });

async function requireMfaAdmin(tx: Prisma.TransactionClient, adminId: string) {
  if (!await tx.user.findFirst({ where: { id: adminId, role: "admin", banned: false, twoFactorEnabled: true }, select: { id: true } })) {
    throw new EvidenceError(403, "An active MFA administrator is required");
  }
}

/** A record is issued once any publication carries a token; from then on its
 * private evidence is released to staff only under an active access grant.
 */
export async function evidenceIsIssued(tx: Prisma.TransactionClient, passportId: string) {
  return (await tx.publication.count({ where: { passportId, tokenId: { not: null } } })) > 0;
}

/** Admin download: always audited; after issuance only under an active grant
 * whose scope includes evidence. The audit is written before the URL is signed.
 */
export async function previewAdminEvidence(adminId: string, passportId: string, fileId: string, grantId: string | null) {
  const file = await getDb().$transaction(async tx => {
    const row = await tx.evidenceFile.findFirst({ where: { id: fileId, passportId, status: "READY" },
      select: { objectKey: true, filename: true, contentType: true, passport: { select: { version: true, status: true } } } });
    if (!row) throw new EvidenceError(404, "Evidence not found");
    let grant = null;
    if (await evidenceIsIssued(tx, passportId)) {
      grant = grantId ? await tx.evidenceAccessGrant.findFirst({ where: { id: grantId, passportId, revokedAt: null, expiresAt: { gt: new Date() },
        scope: { in: ["EVIDENCE", "EVIDENCE_AND_MAPPING"] } }, select: { id: true } }) : null;
      if (!grant) throw new EvidenceError(403, "This record is issued; an active evidence access grant is required");
    }
    await tx.auditLog.create({ data: { passportId, actorId: adminId, version: row.passport.version, action: "EVIDENCE_DOWNLOADED",
      fromStatus: row.passport.status, toStatus: row.passport.status, note: `File ${fileId}${grant ? ` under grant ${grant.id}` : ""}` } });
    return row;
  });
  return signPreview(file);
}

export async function listEvidenceAccess(passportId: string) {
  const db = getDb();
  if (!await db.passport.findUnique({ where: { id: passportId }, select: { id: true } })) throw new EvidenceError(404, "Passport not found");
  const [issued, grants, files] = await Promise.all([
    evidenceIsIssued(db, passportId),
    db.evidenceAccessGrant.findMany({ where: { passportId }, orderBy: { grantedAt: "desc" }, take: 50,
      include: { grantedBy: { select: { name: true, email: true } }, revokedBy: { select: { name: true, email: true } } } }),
    db.evidenceFile.findMany({ where: { passportId, status: "READY" }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, filename: true } }),
  ]);
  const now = Date.now();
  return { issued, files, grants: grants.map(row => ({ id: row.id, organization: row.organization, basis: row.basis, basisReference: row.basisReference,
    purpose: row.purpose, scope: row.scope, grantedBy: row.grantedBy.name || row.grantedBy.email, grantedAt: row.grantedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null,
    active: !row.revokedAt && row.expiresAt.getTime() > now }) ) };
}

/** Record who asked, on what basis and why, before staff release private data
 * for a claim. Staff deliver it outside the application; this is the record.
 */
export async function grantEvidenceAccess(adminId: string, passportId: string, input: unknown) {
  const parsed = evidenceGrantSchema.safeParse(input);
  if (!parsed.success) throw new EvidenceError(422, "Organization, legal basis, reference, purpose, scope, duration and acknowledgement are required");
  const data = parsed.data;
  return getDb().$transaction(async tx => {
    await requireMfaAdmin(tx, adminId);
    const passport = await tx.passport.findUnique({ where: { id: passportId }, select: { version: true, status: true } });
    if (!passport) throw new EvidenceError(404, "Passport not found");
    const now = new Date();
    const row = await tx.evidenceAccessGrant.create({ data: { passportId, organization: data.organization, basis: data.basis,
      basisReference: data.basisReference, purpose: data.purpose, scope: data.scope, grantedById: adminId, grantedAt: now,
      expiresAt: new Date(now.getTime() + data.days * 86_400_000) } });
    await tx.auditLog.create({ data: { passportId, actorId: adminId, version: passport.version, action: "EVIDENCE_ACCESS_GRANTED",
      fromStatus: passport.status, toStatus: passport.status, note: `Grant ${row.id}: ${data.organization} · ${data.basis} · ${data.scope}` } });
    return { id: row.id, expiresAt: row.expiresAt.toISOString() };
  });
}

export async function revokeEvidenceAccess(adminId: string, passportId: string, input: unknown) {
  const parsed = evidenceGrantRevokeSchema.safeParse(input);
  if (!parsed.success) throw new EvidenceError(422, "A grant ID is required");
  return getDb().$transaction(async tx => {
    await requireMfaAdmin(tx, adminId);
    const passport = await tx.passport.findUnique({ where: { id: passportId }, select: { version: true, status: true } });
    if (!passport) throw new EvidenceError(404, "Passport not found");
    const revoked = await tx.evidenceAccessGrant.updateMany({ where: { id: parsed.data.grantId, passportId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: adminId } });
    if (!revoked.count) throw new EvidenceError(409, "Grant is not active for this passport");
    await tx.auditLog.create({ data: { passportId, actorId: adminId, version: passport.version, action: "EVIDENCE_ACCESS_REVOKED",
      fromStatus: passport.status, toStatus: passport.status, note: `Grant ${parsed.data.grantId}` } });
    return { id: parsed.data.grantId, revoked: true as const };
  });
}
