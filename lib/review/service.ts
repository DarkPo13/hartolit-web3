import "server-only";

import { Prisma, type PassportStatus } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { touchEditablePassport } from "@/lib/drafts/lock";
import type { ReviewDecision } from "./schema";

export class WorkflowError extends Error {
  constructor(public readonly status: 403 | 404 | 409 | 422, message: string, public readonly issues?: string[]) { super(message); }
}

const detailInclude = {
  owner: { select: { id: true, name: true, email: true } },
  reviewer: { select: { id: true, name: true, email: true } },
  reviewedBy: { select: { id: true, name: true, email: true } },
  farmer: true,
  field: true,
  treatment: true,
  meteo: true,
  chemical: true,
  evidence: { orderBy: { createdAt: "desc" as const }, select: { id: true, kind: true, status: true, filename: true, sizeBytes: true, sha256: true, rejectionCode: true, createdAt: true } },
  audit: { orderBy: { createdAt: "desc" as const }, take: 100, select: { id: true, actorId: true, action: true, version: true, fromStatus: true, toStatus: true, note: true, targetUserId: true, createdAt: true } },
} satisfies Prisma.PassportInclude;

type DetailRow = Prisma.PassportGetPayload<{ include: typeof detailInclude }>;

function decimal(value: Prisma.Decimal | null | undefined) { return value?.toNumber() ?? null; }
function privateDetail(row: DetailRow) {
  return {
    id: row.id, status: row.status, version: row.version,
    owner: row.owner, reviewer: row.reviewer, reviewedBy: row.reviewedBy,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    submittedVersion: row.submittedVersion,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    approvedVersion: row.approvedVersion,
    reviewNote: row.reviewNote,
    farmer: { id: row.farmer.id, legalName: row.farmer.legalName, registrationId: row.farmer.registrationId, contactName: row.farmer.contactName, contactEmail: row.farmer.contactEmail, contactPhone: row.farmer.contactPhone },
    field: { id: row.field.id, label: row.field.label, areaHectares: decimal(row.field.areaHectares), gpsCoords: row.field.gpsCoords, cadastralNumber: row.field.cadastralNumber, crop: row.field.crop },
    treatment: row.treatment && { treatmentType: row.treatment.treatmentType, treatmentDate: row.treatment.treatmentDate, treatmentTime: row.treatment.treatmentTime, droneModel: row.treatment.droneModel, droneSerial: row.treatment.droneSerial, operator: row.treatment.operator, pilotCert: row.treatment.pilotCert, notes: row.treatment.notes },
    meteo: row.meteo && { temperatureCelsius: decimal(row.meteo.temperatureCelsius), humidityPercent: decimal(row.meteo.humidityPercent), windSpeedMps: decimal(row.meteo.windSpeedMps), rainfallMm: decimal(row.meteo.rainfallMm), measuredAt: row.meteo.measuredAt?.toISOString() ?? null },
    chemical: row.chemical && { product: row.chemical.product, activeSubstance: row.chemical.activeSubstance, dosePerHa: decimal(row.chemical.dosePerHa), workingVolume: decimal(row.chemical.workingVolume), manufacturer: row.chemical.manufacturer, registrationNo: row.chemical.registrationNo, supplierName: row.chemical.supplierName, supplierEdrpou: row.chemical.supplierEdrpou },
    evidence: row.evidence.filter((file) => file.rejectionCode !== "REMOVED").map((file) => ({ ...file, createdAt: file.createdAt.toISOString() })),
    audit: row.audit.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  };
}

function missingForSubmission(row: DetailRow): string[] {
  const missing: string[] = [];
  if (!row.farmer.legalName?.trim()) missing.push("farmerName");
  if (!row.field.crop?.trim()) missing.push("crop");
  if (!row.field.areaHectares || row.field.areaHectares.lte(0)) missing.push("fieldArea");
  if (!row.treatment?.treatmentType?.trim()) missing.push("treatmentType");
  if (!row.treatment?.treatmentDate) missing.push("treatmentDate");
  if (!row.treatment?.treatmentTime) missing.push("treatmentTime");
  if (!row.treatment?.droneModel?.trim()) missing.push("droneModel");
  if (!row.treatment?.operator?.trim()) missing.push("operator");
  if (row.meteo?.temperatureCelsius == null || row.meteo.humidityPercent == null || row.meteo.windSpeedMps == null) missing.push("meteoMeasurements");
  if (!row.chemical?.product?.trim()) missing.push("chemicalProduct");
  if (!row.chemical?.dosePerHa || row.chemical.dosePerHa.lte(0)) missing.push("chemicalDose");
  if (!row.chemical?.workingVolume || row.chemical.workingVolume.lte(0)) missing.push("workingVolume");
  if (!row.evidence.some((file) => file.kind === "METEO" && file.status === "READY")) missing.push("meteoEvidence");
  if (!row.evidence.some((file) => file.kind === "CHEMICAL" && file.status === "READY")) missing.push("chemicalEvidence");
  if (row.evidence.some((file) => ["PENDING", "SCANNING", "QUARANTINED"].includes(file.status) && file.rejectionCode !== "REMOVED")) missing.push("unfinishedEvidence");
  return missing;
}

export async function submitPassport(ownerId: string, id: string, version: number) {
  return getDb().$transaction(async (tx) => {
    if (!await touchEditablePassport(tx, ownerId, id)) {
      const row = await tx.passport.findFirst({ where: { id, ownerId }, select: { status: true } });
      throw new WorkflowError(row ? 409 : 404, row ? "Passport is not an editable draft" : "Passport not found");
    }
    const row = await tx.passport.findFirst({ where: { id, ownerId }, include: detailInclude });
    if (!row) throw new WorkflowError(404, "Passport not found");
    if (row.version !== version) throw new WorkflowError(409, "Draft changed; reload before submitting");
    const issues = missingForSubmission(row);
    if (issues.length) throw new WorkflowError(422, "Complete the required fields and verified evidence", issues);
    const changed = await tx.passport.updateMany({ where: { id, ownerId, status: "DRAFT", version }, data: { status: "SUBMITTED", version: { increment: 1 }, submittedAt: new Date(), submittedVersion: version, reviewedById: null, reviewedAt: null, approvedVersion: null, reviewNote: null } });
    if (!changed.count) throw new WorkflowError(409, "Draft changed; reload before submitting");
    await tx.auditLog.create({ data: { passportId: id, actorId: ownerId, action: "PASSPORT_SUBMITTED", version: version + 1, fromStatus: "DRAFT", toStatus: "SUBMITTED" } });
    return { id, status: "SUBMITTED" as const, version: version + 1 };
  });
}

export async function reopenPassport(ownerId: string, id: string, version: number) {
  return getDb().$transaction(async (tx) => {
    const row = await tx.passport.findFirst({ where: { id, ownerId }, select: { status: true } });
    if (!row) throw new WorkflowError(404, "Passport not found");
    if (row.status !== "REJECTED" && row.status !== "CORRECTION_REQUIRED") throw new WorkflowError(409, "Passport cannot be reopened");
    const changed = await tx.passport.updateMany({ where: { id, ownerId, status: row.status, version }, data: { status: "DRAFT", version: { increment: 1 }, approvedVersion: null } });
    if (!changed.count) throw new WorkflowError(409, "Passport changed; reload before reopening");
    await tx.auditLog.create({ data: { passportId: id, actorId: ownerId, action: "PASSPORT_REOPENED", version: version + 1, fromStatus: row.status, toStatus: "DRAFT" } });
    return { id, status: "DRAFT" as const, version: version + 1 };
  });
}

export async function assignReview(adminId: string, id: string, version: number, reviewerId: string | null) {
  return getDb().$transaction(async (tx) => {
    const row = await tx.passport.findUnique({ where: { id }, select: { status: true } });
    if (!row) throw new WorkflowError(404, "Passport not found");
    if (row.status !== "SUBMITTED") throw new WorkflowError(409, "Only submitted passports can be assigned");
    if (reviewerId) {
      const reviewer = await tx.user.findFirst({ where: { id: reviewerId, role: "admin", banned: false, twoFactorEnabled: true }, select: { id: true } });
      if (!reviewer) throw new WorkflowError(422, "Reviewer must be an active administrator with MFA");
    }
    const changed = await tx.passport.updateMany({ where: { id, status: "SUBMITTED", version }, data: { reviewerId, assignedAt: reviewerId ? new Date() : null, version: { increment: 1 } } });
    if (!changed.count) throw new WorkflowError(409, "Passport changed; reload before assigning");
    await tx.auditLog.create({ data: { passportId: id, actorId: adminId, action: "REVIEW_ASSIGNED", version: version + 1, fromStatus: "SUBMITTED", toStatus: "SUBMITTED", targetUserId: reviewerId } });
    return { id, status: "SUBMITTED" as const, version: version + 1, reviewerId };
  });
}

export async function decideReview(adminId: string, id: string, input: ReviewDecision) {
  const { version, decision, note } = input;
  if (decision !== "APPROVED" && !note) throw new WorkflowError(422, "A reason is required");
  return getDb().$transaction(async (tx) => {
    const row = await tx.passport.findUnique({ where: { id }, include: detailInclude });
    if (!row) throw new WorkflowError(404, "Passport not found");
    if (row.status !== "SUBMITTED" && !(row.status === "APPROVED" && decision === "CORRECTION_REQUIRED")) throw new WorkflowError(409, "Passport is not awaiting this decision");
    if (row.reviewerId !== adminId) throw new WorkflowError(403, "This passport is assigned to another reviewer");
    if (decision === "APPROVED") {
      const issues = missingForSubmission(row);
      if (issues.length) throw new WorkflowError(422, "Passport is incomplete", issues);
    }
    const fromStatus = row.status;
    const changed = await tx.passport.updateMany({ where: { id, status: fromStatus, version, reviewerId: adminId }, data: { status: decision, version: { increment: 1 }, reviewedById: adminId, reviewedAt: new Date(), reviewNote: note || null, approvedVersion: decision === "APPROVED" ? row.submittedVersion : null } });
    if (!changed.count) throw new WorkflowError(409, "Passport changed; reload before deciding");
    const action = decision === "APPROVED" ? "REVIEW_APPROVED" : decision === "REJECTED" ? "REVIEW_REJECTED" : "CORRECTION_REQUESTED";
    await tx.auditLog.create({ data: { passportId: id, actorId: adminId, action, version: version + 1, fromStatus, toStatus: decision, note: note || null } });
    return { id, status: decision, version: version + 1 };
  });
}

export async function mine(ownerId: string) {
  const rows = await getDb().passport.findMany({ where: { ownerId, status: { not: "DRAFT" } }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, status: true, version: true, submittedAt: true, reviewedAt: true, reviewNote: true, farmer: { select: { legalName: true } }, field: { select: { crop: true } }, reviewer: { select: { name: true } } } });
  return rows.map((row) => ({ id: row.id, status: row.status, version: row.version, submittedAt: row.submittedAt?.toISOString() ?? null, reviewedAt: row.reviewedAt?.toISOString() ?? null, reviewNote: row.reviewNote, farmerName: row.farmer.legalName ?? "", crop: row.field.crop ?? "", reviewerName: row.reviewer?.name ?? null }));
}

export async function adminQueue(status: "ALL" | PassportStatus, page: number, search: string) {
  const where: Prisma.PassportWhereInput = { status: status === "ALL" ? { not: "DRAFT" } : status, ...(search ? { OR: [{ farmer: { legalName: { contains: search, mode: "insensitive" } } }, { owner: { email: { contains: search, mode: "insensitive" } } }] } : {}) };
  const [rows, total] = await Promise.all([
    getDb().passport.findMany({ where, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], skip: page * 20, take: 20, select: { id: true, status: true, version: true, submittedAt: true, reviewedAt: true, owner: { select: { name: true, email: true } }, reviewer: { select: { name: true } }, farmer: { select: { legalName: true } }, field: { select: { crop: true } } } }),
    getDb().passport.count({ where }),
  ]);
  return { total, page, items: rows.map((row) => ({ ...row, submittedAt: row.submittedAt?.toISOString() ?? null, reviewedAt: row.reviewedAt?.toISOString() ?? null })) };
}

export async function adminDetail(id: string) {
  const row = await getDb().passport.findUnique({ where: { id }, include: detailInclude });
  if (!row) throw new WorkflowError(404, "Passport not found");
  const actors = await getDb().user.findMany({ where: { id: { in: row.audit.map((event) => event.actorId) } }, select: { id: true, name: true, email: true } });
  const names = new Map(actors.map((actor) => [actor.id, actor.name || actor.email]));
  const detail = privateDetail(row);
  return { ...detail, audit: detail.audit.map((event) => ({ ...event, actorName: names.get(event.actorId) ?? event.actorId })) };
}

export async function adminOverview() {
  const [counts, activity, reviewers] = await Promise.all([
    getDb().passport.groupBy({ by: ["status"], _count: { id: true } }),
    getDb().auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10, select: { id: true, passportId: true, actorId: true, action: true, createdAt: true } }),
    getDb().user.findMany({ where: { role: "admin", banned: false, twoFactorEnabled: true }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } }),
  ]);
  return { counts: Object.fromEntries(counts.map((row) => [row.status, row._count.id])), activity: activity.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })), reviewers };
}
