import "server-only";

import { AuditAction } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

export type RecordView = "farmers" | "fields" | "users" | "publications" | "audit" | "adminActions";

export async function adminRecords(view: RecordView, page: number, search: string, from: string, to: string) {
  const db = getDb();
  const skip = page * 20;
  const contains = { contains: search, mode: "insensitive" as const };
  const period = from || to ? { createdAt: { ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}), ...(to ? { lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}) } } : {};
  if (view === "farmers") {
    const where = search ? { OR: [{ legalName: contains }, { registrationId: contains }, { owner: { email: contains } }] } : {};
    const [rows, total] = await Promise.all([
      db.farmer.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: 20, select: { id: true, legalName: true, registrationId: true, createdAt: true, archivedAt: true, owner: { select: { email: true } }, _count: { select: { fields: true, passports: true } } } }),
      db.farmer.count({ where }),
    ]);
    return { total, items: rows.map((row) => ({ id: row.id, title: row.legalName, detail: [row.registrationId, row.owner.email, `${row._count.fields} fields`, `${row._count.passports} passports`].filter(Boolean).join(" · "), status: row.archivedAt ? "ARCHIVED" : "ACTIVE", createdAt: row.createdAt.toISOString(), passportId: null, role: null })) };
  }
  if (view === "fields") {
    const where = search ? { OR: [{ label: contains }, { cadastralNumber: contains }, { farmer: { legalName: contains } }] } : {};
    const [rows, total] = await Promise.all([
      db.field.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: 20, select: { id: true, label: true, crop: true, areaHectares: true, cadastralNumber: true, createdAt: true, archivedAt: true, farmer: { select: { legalName: true } }, _count: { select: { passports: true } } } }),
      db.field.count({ where }),
    ]);
    return { total, items: rows.map((row) => ({ id: row.id, title: row.label || row.farmer.legalName || row.crop, detail: [row.crop, row.areaHectares?.toString(), row.cadastralNumber, `${row._count.passports} passports`].filter(Boolean).join(" · "), status: row.archivedAt ? "ARCHIVED" : "ACTIVE", createdAt: row.createdAt.toISOString(), passportId: null, role: null })) };
  }
  if (view === "users") {
    const where = search ? { OR: [{ name: contains }, { email: contains }] } : {};
    const [rows, total] = await Promise.all([
      db.user.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: 20, select: { id: true, name: true, email: true, role: true, banned: true, twoFactorEnabled: true, createdAt: true } }),
      db.user.count({ where }),
    ]);
    return { total, items: rows.map((row) => ({ id: row.id, title: row.name || row.email, detail: `${row.email} · ${row.role ?? "user"} · MFA ${row.twoFactorEnabled ? "on" : "off"}`, status: row.banned ? "BANNED" : "ACTIVE", role: row.role, createdAt: row.createdAt.toISOString(), passportId: null })) };
  }
  if (view === "publications") {
    const where = search ? { OR: [{ ipfsCid: contains }, { transactionHash: contains }, { passport: { farmer: { legalName: contains } } }] } : {};
    const [rows, total] = await Promise.all([
      db.publication.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: 20, select: { id: true, status: true, createdAt: true, passportId: true, ipfsCid: true, chainId: true, transactionHash: true, passport: { select: { farmer: { select: { legalName: true } } } } } }),
      db.publication.count({ where }),
    ]);
    return { total, items: rows.map((row) => ({ id: row.id, title: row.passport.farmer.legalName, detail: [row.ipfsCid, row.chainId, row.transactionHash].filter(Boolean).join(" · "), status: row.status, createdAt: row.createdAt.toISOString(), passportId: row.passportId, role: null })) };
  }
  if (view === "adminActions") {
    const where = { ...period, ...(search ? { OR: [{ action: contains }, { entity: contains }, { actor: { email: contains } }] } : {}) };
    const [rows, total] = await Promise.all([
      db.adminAction.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: 20, select: { id: true, action: true, entity: true, entityId: true, createdAt: true, actor: { select: { email: true } } } }),
      db.adminAction.count({ where }),
    ]);
    return { total, items: rows.map((row) => ({ id: row.id, title: row.action.replaceAll("_", " "), detail: `${row.actor.email} · ${row.entity} · ${row.entityId}`, status: null, createdAt: row.createdAt.toISOString(), passportId: null, role: null })) };
  }
  const userIds = search ? (await db.user.findMany({ where: { email: contains }, select: { id: true } })).map((user) => user.id) : [];
  const actions = search ? Object.values(AuditAction).filter((action) => action.toLowerCase().includes(search.toLowerCase())) : [];
  const where = { ...period, ...(search ? { OR: [{ note: contains }, { actorId: { in: userIds } }, { action: { in: actions } }] } : {}) };
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: 20, select: { id: true, action: true, createdAt: true, passportId: true, note: true, actorId: true } }),
    db.auditLog.count({ where }),
  ]);
  const actors = await db.user.findMany({ where: { id: { in: rows.map((row) => row.actorId) } }, select: { id: true, name: true, email: true } });
  const names = new Map(actors.map((person) => [person.id, person.name || person.email]));
  return { total, items: rows.map((row) => ({ id: row.id, title: row.action.replaceAll("_", " "), detail: [names.get(row.actorId) ?? row.actorId, row.note].filter(Boolean).join(" · "), status: null, createdAt: row.createdAt.toISOString(), passportId: row.passportId, role: null })) };
}
