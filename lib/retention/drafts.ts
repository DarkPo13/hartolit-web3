import "server-only";

import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { evidenceStorage } from "@/lib/evidence/storage";
import { sendDraftRetentionEmail } from "./notice-email";

const DAY = 86_400_000, INACTIVE_DAYS = 90, NOTICE_DAYS = 30;
type Candidate = { id: string; ownerId: string; createdAt: Date; updatedAt: Date };

/** Never-submitted drafts inactive for 90 days, excluding held records, correction
 * drafts and anything with a publication. Engineering default (D25, D60).
 */
function eligible(now: Date, only?: string[]): Prisma.PassportWhereInput {
  return { ...(only ? { id: { in: only } } : {}), status: "DRAFT", submittedAt: null, updatedAt: { lt: new Date(now.getTime() - INACTIVE_DAYS * DAY) },
    preservationHolds: { none: { releasedAt: null } }, correctionOf: { none: {} }, publications: { none: {} } };
}

/** A notice counts only if it was sent and the draft has not changed since. */
async function validNotice(tx: Prisma.TransactionClient, candidate: Candidate) {
  return tx.draftRetentionNotice.findFirst({ where: { passportId: candidate.id, deletedAt: null, emailStatus: "SENT",
    draftUpdatedAt: { gte: candidate.updatedAt } }, orderBy: { noticedAt: "desc" } });
}

/** `only` narrows the run to given drafts (tests); operations omit it. */
export async function draftRetentionPlan(now = new Date(), only?: string[]) {
  const db = getDb();
  const candidates = await db.passport.findMany({ where: eligible(now, only), orderBy: { id: "asc" }, take: 500,
    select: { id: true, ownerId: true, createdAt: true, updatedAt: true } });
  const plan = { needsNotice: [] as Candidate[], waiting: [] as Candidate[], deletable: [] as Candidate[] };
  for (const candidate of candidates) {
    const notice = await validNotice(db, candidate);
    (!notice ? plan.needsNotice : notice.deleteAfter > now ? plan.waiting : plan.deletable).push(candidate);
  }
  return plan;
}

/** Record a notice per eligible draft. Only a SENT notice starts the period. */
export async function sendDraftNotices(now = new Date(), send = sendDraftRetentionEmail, only?: string[]) {
  const db = getDb();
  const result = { sent: 0, failed: 0 };
  for (const candidate of (await draftRetentionPlan(now, only)).needsNotice) {
    const owner = await db.user.findUnique({ where: { id: candidate.ownerId }, select: { email: true } });
    const deleteAfter = new Date(now.getTime() + NOTICE_DAYS * DAY);
    let status: "SENT" | "FAILED" = "FAILED";
    try { if (owner?.email) { await send(owner.email, candidate.createdAt, deleteAfter); status = "SENT"; } } catch { status = "FAILED"; }
    await db.draftRetentionNotice.create({ data: { passportId: candidate.id, ownerId: candidate.ownerId, noticedAt: now, deleteAfter,
      draftUpdatedAt: candidate.updatedAt, emailStatus: status } });
    result[status === "SENT" ? "sent" : "failed"]++;
  }
  return result;
}

/** Delete drafts whose sent notice period has passed, rechecking every condition
 * under a row lock that does not touch updatedAt. Objects are deleted before rows;
 * a storage failure skips the draft (rolled back) for a later run. The notice
 * row stays as a tombstone without private data.
 */
export async function deleteNoticedDrafts(now = new Date(), only?: string[]) {
  const db = getDb();
  const result = { deleted: 0, skipped: 0 };
  for (const candidate of (await draftRetentionPlan(now, only)).deletable) {
    try {
      await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Passport" WHERE "id" = ${candidate.id}::uuid FOR UPDATE`;
        const current = await tx.passport.findFirst({ where: { ...eligible(now), id: candidate.id }, select: { id: true, ownerId: true, createdAt: true, updatedAt: true, farmerId: true, fieldId: true } });
        const notice = current ? await validNotice(tx, current) : null;
        if (!current || !notice || notice.deleteAfter > now) throw new Error("no longer deletable");
        const files = await tx.evidenceFile.findMany({ where: { passportId: current.id, objectPurgedAt: null }, select: { objectKey: true } });
        if (files.length) {
          const { client, bucket } = evidenceStorage();
          for (const file of files) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: file.objectKey }));
        }
        await tx.evidenceFile.deleteMany({ where: { passportId: current.id } });
        for (const model of ["chemicalApplication", "meteoMeasurement", "treatment"] as const) {
          await (tx[model] as unknown as { deleteMany(args: unknown): Promise<unknown> }).deleteMany({ where: { passportId: current.id } });
        }
        await tx.auditLog.deleteMany({ where: { passportId: current.id } });
        await tx.passport.delete({ where: { id: current.id } });
        // Each draft owns its farm/field rows; keep them if anything else still uses them.
        if (!await tx.passport.count({ where: { fieldId: current.fieldId } })) await tx.field.delete({ where: { id: current.fieldId } });
        if (!await tx.passport.count({ where: { farmerId: current.farmerId } }) && !await tx.field.count({ where: { farmerId: current.farmerId } })) {
          await tx.farmer.delete({ where: { id: current.farmerId } });
        }
        await tx.draftRetentionNotice.update({ where: { id: notice.id }, data: { deletedAt: now } });
      }, { timeout: 60_000 });
      result.deleted++;
    } catch { result.skipped++; }
  }
  return result;
}
