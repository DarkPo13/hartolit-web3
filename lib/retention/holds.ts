import "server-only";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { WorkflowError } from "@/lib/review/service";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const placeHoldSchema = z.strictObject({ reference: text(2, 200), reason: text(3, 500), acknowledgement: z.literal("PLACE_PRESERVATION_HOLD") });
export const releaseHoldSchema = z.strictObject({ holdId: z.uuid(), note: text(3, 500), acknowledgement: z.literal("RELEASE_PRESERVATION_HOLD") });

/** True while any hold on the passport is unreleased. Deletion paths must check
 * it (the database triggers are the backstop, not the user-facing error).
 */
export async function hasActiveHold(tx: Prisma.TransactionClient, passportId: string) {
  return (await tx.preservationHold.count({ where: { passportId, releasedAt: null } })) > 0;
}

async function lockedPassport(tx: Prisma.TransactionClient, adminId: string, passportId: string) {
  if (!await tx.user.findFirst({ where: { id: adminId, role: "admin", banned: false, twoFactorEnabled: true }, select: { id: true } })) {
    throw new WorkflowError(403, "An active MFA administrator is required");
  }
  if (!(await tx.passport.updateMany({ where: { id: passportId }, data: { updatedAt: new Date() } })).count) throw new WorkflowError(404, "Passport not found");
  return tx.passport.findUniqueOrThrow({ where: { id: passportId }, select: { version: true, status: true } });
}

export async function listHolds(passportId: string) {
  const db = getDb();
  if (!await db.passport.findUnique({ where: { id: passportId }, select: { id: true } })) throw new WorkflowError(404, "Passport not found");
  const rows = await db.preservationHold.findMany({ where: { passportId }, orderBy: { placedAt: "desc" }, take: 50,
    include: { placedBy: { select: { name: true, email: true } }, releasedBy: { select: { name: true, email: true } } } });
  return rows.map(row => ({ id: row.id, reference: row.reference, reason: row.reason, placedBy: row.placedBy.name || row.placedBy.email,
    placedAt: row.placedAt.toISOString(), releasedAt: row.releasedAt?.toISOString() ?? null,
    releasedBy: row.releasedBy ? row.releasedBy.name || row.releasedBy.email : null, releaseNote: row.releaseNote, active: !row.releasedAt }));
}

/** Preserve a record, its farm/field linkage and its evidence for a claim or
 * dispute. Ordinary retention resumes only after release.
 */
export async function placeHold(adminId: string, passportId: string, input: unknown) {
  const parsed = placeHoldSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "A reference, reason and acknowledgement are required");
  return getDb().$transaction(async tx => {
    const passport = await lockedPassport(tx, adminId, passportId);
    const row = await tx.preservationHold.create({ data: { passportId, reference: parsed.data.reference, reason: parsed.data.reason, placedById: adminId } });
    await tx.auditLog.create({ data: { passportId, actorId: adminId, version: passport.version, action: "PRESERVATION_HOLD_PLACED",
      fromStatus: passport.status, toStatus: passport.status, note: `Hold ${row.id}: ${parsed.data.reference}` } });
    return { id: row.id, placedAt: row.placedAt.toISOString() };
  });
}

export async function releaseHold(adminId: string, passportId: string, input: unknown) {
  const parsed = releaseHoldSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "A hold ID, release note and acknowledgement are required");
  return getDb().$transaction(async tx => {
    const passport = await lockedPassport(tx, adminId, passportId);
    const released = await tx.preservationHold.updateMany({ where: { id: parsed.data.holdId, passportId, releasedAt: null },
      data: { releasedAt: new Date(), releasedById: adminId, releaseNote: parsed.data.note } });
    if (!released.count) throw new WorkflowError(409, "Hold is not active for this passport");
    await tx.auditLog.create({ data: { passportId, actorId: adminId, version: passport.version, action: "PRESERVATION_HOLD_RELEASED",
      fromStatus: passport.status, toStatus: passport.status, note: `Hold ${parsed.data.holdId}` } });
    return { id: parsed.data.holdId, released: true as const, stillHeld: await hasActiveHold(tx, passportId) };
  });
}
