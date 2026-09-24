import "server-only";

import { getDb } from "@/lib/db";

export type RecordView = "farmers" | "fields" | "users" | "publications" | "audit";

export async function adminRecords(view: RecordView, page: number) {
  const db = getDb();
  const skip = page * 20;
  if (view === "farmers") {
    const [rows, total] = await Promise.all([
      db.farmer.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: 20, select: { id: true, legalName: true, registrationId: true, createdAt: true, archivedAt: true, owner: { select: { email: true } }, _count: { select: { fields: true, passports: true } } } }),
      db.farmer.count(),
    ]);
    return { total, items: rows.map((row) => ({ id: row.id, title: row.legalName, detail: [row.registrationId, row.owner.email, `${row._count.fields} fields`, `${row._count.passports} passports`].filter(Boolean).join(" · "), status: row.archivedAt ? "ARCHIVED" : "ACTIVE", createdAt: row.createdAt.toISOString(), passportId: null })) };
  }
  if (view === "fields") {
    const [rows, total] = await Promise.all([
      db.field.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: 20, select: { id: true, label: true, crop: true, areaHectares: true, cadastralNumber: true, createdAt: true, archivedAt: true, farmer: { select: { legalName: true } }, _count: { select: { passports: true } } } }),
      db.field.count(),
    ]);
    return { total, items: rows.map((row) => ({ id: row.id, title: row.label || row.farmer.legalName || row.crop, detail: [row.crop, row.areaHectares?.toString(), row.cadastralNumber, `${row._count.passports} passports`].filter(Boolean).join(" · "), status: row.archivedAt ? "ARCHIVED" : "ACTIVE", createdAt: row.createdAt.toISOString(), passportId: null })) };
  }
  if (view === "users") {
    const [rows, total] = await Promise.all([
      db.user.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: 20, select: { id: true, name: true, email: true, role: true, banned: true, twoFactorEnabled: true, createdAt: true } }),
      db.user.count(),
    ]);
    return { total, items: rows.map((row) => ({ id: row.id, title: row.name || row.email, detail: `${row.email} · ${row.role ?? "user"} · MFA ${row.twoFactorEnabled ? "on" : "off"}`, status: row.banned ? "BANNED" : "ACTIVE", createdAt: row.createdAt.toISOString(), passportId: null })) };
  }
  if (view === "publications") {
    const [rows, total] = await Promise.all([
      db.publication.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: 20, select: { id: true, status: true, createdAt: true, passportId: true, ipfsCid: true, chainId: true, transactionHash: true, passport: { select: { farmer: { select: { legalName: true } } } } } }),
      db.publication.count(),
    ]);
    return { total, items: rows.map((row) => ({ id: row.id, title: row.passport.farmer.legalName, detail: [row.ipfsCid, row.chainId, row.transactionHash].filter(Boolean).join(" · "), status: row.status, createdAt: row.createdAt.toISOString(), passportId: row.passportId })) };
  }
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: 20, select: { id: true, action: true, createdAt: true, passportId: true, note: true, actorId: true } }),
    db.auditLog.count(),
  ]);
  const actors = await db.user.findMany({ where: { id: { in: rows.map((row) => row.actorId) } }, select: { id: true, name: true, email: true } });
  const names = new Map(actors.map((person) => [person.id, person.name || person.email]));
  return { total, items: rows.map((row) => ({ id: row.id, title: row.action.replaceAll("_", " "), detail: [names.get(row.actorId) ?? row.actorId, row.note].filter(Boolean).join(" · "), status: null, createdAt: row.createdAt.toISOString(), passportId: row.passportId })) };
}
