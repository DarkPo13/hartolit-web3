import "server-only";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isResetEmailConfigured } from "@/lib/reset-email";
import { WorkflowError } from "./service";

const text = (max: number) => z.string().trim().max(max);
const date = z.iso.datetime({ offset: true });
export const recordKind = z.enum(["farmers", "fields"]);
export const farmerEdit = z.strictObject({
  updatedAt: date,
  data: z.strictObject({
    legalName: text(200), registrationId: text(32), contactName: text(200),
    contactEmail: z.union([z.email().max(320), z.literal("")]), contactPhone: text(40),
  }),
});
export const fieldEdit = z.strictObject({
  updatedAt: date,
  data: z.strictObject({
    label: text(200), areaHectares: z.number().finite().min(0).max(99_999_999.9999).nullable(),
    gpsCoords: text(80), cadastralNumber: text(40), crop: text(100),
  }),
});
export const archiveEdit = z.strictObject({ updatedAt: date, archived: z.boolean() });
export const inviteInput = z.strictObject({ name: text(200).min(1), email: z.email().max(320) });
export const userAction = z.strictObject({ action: z.enum(["disable", "enable", "revokeSessions"]) });

type Kind = z.infer<typeof recordKind>;

export async function recordDetail(kind: Kind, id: string) {
  const db = getDb();
  if (kind === "farmers") {
    const row = await db.farmer.findUnique({ where: { id }, include: { owner: { select: { name: true, email: true } }, passports: { select: { id: true, status: true } } } });
    if (!row) throw new WorkflowError(404, "Farmer not found");
    const duplicates = row.registrationId ? await db.farmer.count({ where: { registrationId: row.registrationId, id: { not: id } } }) : 0;
    return { id, kind, updatedAt: row.updatedAt.toISOString(), archivedAt: row.archivedAt?.toISOString() ?? null, owner: row.owner,
      data: { legalName: row.legalName ?? "", registrationId: row.registrationId ?? "", contactName: row.contactName ?? "", contactEmail: row.contactEmail ?? "", contactPhone: row.contactPhone ?? "" },
      passports: row.passports, duplicateCount: duplicates };
  }
  const row = await db.field.findUnique({ where: { id }, include: { owner: { select: { name: true, email: true } }, farmer: { select: { legalName: true } }, passports: { select: { id: true, status: true } } } });
  if (!row) throw new WorkflowError(404, "Field not found");
  const duplicates = row.cadastralNumber ? await db.field.count({ where: { cadastralNumber: row.cadastralNumber, id: { not: id } } }) : 0;
  return { id, kind, updatedAt: row.updatedAt.toISOString(), archivedAt: row.archivedAt?.toISOString() ?? null, owner: row.owner, farmerName: row.farmer.legalName,
    data: { label: row.label ?? "", areaHectares: row.areaHectares?.toNumber() ?? null, gpsCoords: row.gpsCoords ?? "", cadastralNumber: row.cadastralNumber ?? "", crop: row.crop ?? "" },
    passports: row.passports, duplicateCount: duplicates };
}

export async function editRecord(actorId: string, kind: Kind, id: string, input: z.infer<typeof farmerEdit> | z.infer<typeof fieldEdit>) {
  await getDb().$transaction(async (tx) => {
    const row = kind === "farmers"
      ? await tx.farmer.findUnique({ where: { id }, select: { updatedAt: true, archivedAt: true } })
      : await tx.field.findUnique({ where: { id }, select: { updatedAt: true, archivedAt: true } });
    if (!row) throw new WorkflowError(404, "Record not found");
    if (row.archivedAt) throw new WorkflowError(409, "Restore the record before editing");
    if (row.updatedAt.toISOString() !== input.updatedAt) throw new WorkflowError(409, "Record changed; reload before saving");
    const passports = await tx.passport.findMany({ where: kind === "farmers" ? { farmerId: id } : { fieldId: id }, orderBy: { id: "asc" }, select: { id: true, status: true, version: true } });
    if (passports.some((passport) => passport.status !== "DRAFT")) throw new WorkflowError(409, "Submitted or reviewed passport data cannot be edited");
    for (const passport of passports) {
      const changed = await tx.passport.updateMany({ where: { id: passport.id, status: "DRAFT", version: passport.version }, data: { version: { increment: 1 } } });
      if (!changed.count) throw new WorkflowError(409, "Passport changed; reload before saving");
    }
    const expected = new Date(input.updatedAt);
    const changed = kind === "farmers"
      ? await tx.farmer.updateMany({ where: { id, updatedAt: expected, archivedAt: null }, data: (input as z.infer<typeof farmerEdit>).data })
      : await tx.field.updateMany({ where: { id, updatedAt: expected, archivedAt: null }, data: (input as z.infer<typeof fieldEdit>).data });
    if (!changed.count) throw new WorkflowError(409, "Record changed; reload before saving");
    for (const passport of passports) await tx.auditLog.create({ data: { passportId: passport.id, actorId, action: "ADMIN_RECORD_UPDATED", version: passport.version + 1, fromStatus: "DRAFT", toStatus: "DRAFT" } });
    await tx.adminAction.create({ data: { actorId, action: "RECORD_UPDATED", entity: kind, entityId: id } });
  });
  return recordDetail(kind, id);
}

export async function archiveRecord(actorId: string, kind: Kind, id: string, input: z.infer<typeof archiveEdit>) {
  await getDb().$transaction(async (tx) => {
    const row = kind === "farmers" ? await tx.farmer.findUnique({ where: { id }, select: { updatedAt: true, archivedAt: true } }) : await tx.field.findUnique({ where: { id }, select: { updatedAt: true, archivedAt: true } });
    if (!row) throw new WorkflowError(404, "Record not found");
    if (row.updatedAt.toISOString() !== input.updatedAt) throw new WorkflowError(409, "Record changed; reload before saving");
    if (Boolean(row.archivedAt) === input.archived) throw new WorkflowError(409, "Record already has this state");
    const passports = await tx.passport.findMany({ where: kind === "farmers" ? { farmerId: id } : { fieldId: id }, orderBy: { id: "asc" }, select: { id: true, version: true, status: true } });
    for (const passport of passports) {
      const locked = await tx.passport.updateMany({ where: { id: passport.id, version: passport.version, status: passport.status }, data: { updatedAt: new Date() } });
      if (!locked.count) throw new WorkflowError(409, "Passport changed; reload before archiving");
    }
    if (passports.some((passport) => passport.status === "DRAFT" || passport.status === "SUBMITTED")) throw new WorkflowError(409, "Draft and submitted passports must be completed before archiving");
    const changed = kind === "farmers"
      ? await tx.farmer.updateMany({ where: { id, updatedAt: new Date(input.updatedAt) }, data: { archivedAt: input.archived ? new Date() : null } })
      : await tx.field.updateMany({ where: { id, updatedAt: new Date(input.updatedAt) }, data: { archivedAt: input.archived ? new Date() : null } });
    if (!changed.count) throw new WorkflowError(409, "Record changed; reload before saving");
    await tx.adminAction.create({ data: { actorId, action: input.archived ? "RECORD_ARCHIVED" : "RECORD_RESTORED", entity: kind, entityId: id } });
  });
  return recordDetail(kind, id);
}

export async function inviteOperator(actorId: string, input: z.infer<typeof inviteInput>) {
  if (!isResetEmailConfigured()) throw new WorkflowError(422, "Configure password reset email before inviting operators");
  const email = input.email.trim().toLowerCase();
  if (await getDb().user.findUnique({ where: { email }, select: { id: true } })) throw new WorkflowError(409, "An account with this email already exists");
  // Nobody receives this credential. The invited person creates their own password using the emailed reset link.
  const password = `${randomBytes(48).toString("base64url")}aA1!`;
  let created;
  try { created = await auth.api.createUser({ body: { name: input.name, email, password, role: "user" } }); }
  catch (error) {
    if (await getDb().user.findUnique({ where: { email }, select: { id: true } })) throw new WorkflowError(409, "An account with this email already exists");
    throw error;
  }
  if (!created?.user?.id) throw new Error("Account creation returned no user");
  try {
    await getDb().adminAction.create({ data: { actorId, action: "USER_INVITED", entity: "users", entityId: created.user.id } });
  } catch (error) {
    await getDb().user.deleteMany({ where: { id: created.user.id } });
    throw error;
  }
  const resetPage = new URL("/reset-password", process.env.BETTER_AUTH_URL ?? "http://localhost:3000").toString();
  try {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: resetPage } });
    return { id: created.user.id, email, emailRequested: true };
  } catch (error) {
    console.error("Invitation password setup request failed", error instanceof Error ? error.name : "unknown");
    return { id: created.user.id, email, emailRequested: false };
  }
}

export async function manageUser(actorId: string, id: string, action: z.infer<typeof userAction>["action"]) {
  if (id === actorId) throw new WorkflowError(403, "Administrators cannot change their own access here");
  return getDb().$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id }, select: { id: true, role: true, banned: true } });
    if (!user) throw new WorkflowError(404, "User not found");
    if (user.role === "admin") throw new WorkflowError(403, "Administrator access is managed outside this console");
    if (action === "disable" || action === "enable") {
      if (Boolean(user.banned) === (action === "disable")) throw new WorkflowError(409, "User already has this state");
      const changed = await tx.user.updateMany({ where: { id, AND: [{ OR: [{ role: "user" }, { role: null }] }, action === "disable" ? { OR: [{ banned: false }, { banned: null }] } : { banned: true }] }, data: { banned: action === "disable", banReason: action === "disable" ? "Disabled by administrator" : null, banExpires: null } });
      if (!changed.count) throw new WorkflowError(409, "User access changed; reload before saving");
    }
    if (action === "revokeSessions") {
      const locked = await tx.user.updateMany({ where: { id, OR: [{ role: "user" }, { role: null }] }, data: { updatedAt: new Date() } });
      if (!locked.count) throw new WorkflowError(409, "User access changed; reload before revoking sessions");
    }
    if (action === "disable" || action === "revokeSessions") await tx.session.deleteMany({ where: { userId: id } });
    await tx.adminAction.create({ data: { actorId, action: action === "disable" ? "USER_DISABLED" : action === "enable" ? "USER_ENABLED" : "SESSIONS_REVOKED", entity: "users", entityId: id } });
    return { id, banned: action === "disable" ? true : action === "enable" ? false : Boolean(user.banned) };
  });
}
