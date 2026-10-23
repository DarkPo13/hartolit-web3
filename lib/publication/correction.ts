import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { WorkflowError } from "@/lib/review/service";
import { publicationCorrectionSchema } from "./schema";
import { publicationPublisherAccess } from "./service";

async function requirePublisher(tx: Prisma.TransactionClient, adminId: string) {
  const access = publicationPublisherAccess(adminId);
  if (!access.configured || !access.canProve ||
    !await tx.user.findFirst({ where: { id: adminId, role: "admin", banned: false, twoFactorEnabled: true }, select: { id: true } })) {
    throw new WorkflowError(403, "Opening a correction requires the current designated MFA publisher");
  }
}

/** Private admin view of a published record's correction, if any. */
export async function getPublicationCorrection(passportId: string) {
  const db = getDb();
  if (!await db.passport.findUnique({ where: { id: passportId }, select: { id: true } })) throw new WorkflowError(404, "Passport not found");
  const published = await db.publication.findFirst({ where: { passportId, status: "PUBLISHED" }, select: { id: true, tokenId: true, payloadHash: true } });
  const correction = published ? await db.publicationCorrection.findUnique({ where: { supersededPublicationId: published.id },
    select: { id: true, correctionPassportId: true, openedAt: true, correctionPassport: { select: { status: true } } } }) : null;
  const replacement = correction ? await db.publication.findFirst({ where: { passportId: correction.correctionPassportId, status: "PUBLISHED" }, select: { tokenId: true } }) : null;
  return {
    published,
    correction: correction ? { id: correction.id, correctionPassportId: correction.correctionPassportId, correctionStatus: correction.correctionPassport.status,
      openedAt: correction.openedAt.toISOString(), replacementTokenId: replacement?.tokenId ?? null } : null,
  };
}

/** Open a correction for a PUBLISHED record. The record, its token and document
 * are never changed. A new DRAFT copy of the facts is created for the same owner
 * (with its own farm/field rows, so editing it cannot alter the original's
 * private data, and without evidence) and linked; once that passport is reviewed
 * and published, the public page of this record shows it is superseded.
 */
export async function openPublicationCorrection(adminId: string, passportId: string, input: unknown) {
  const parsed = publicationCorrectionSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "Exact correction review, reason and acknowledgement are required");
  const data = parsed.data;
  return getDb().$transaction(async tx => {
    await requirePublisher(tx, adminId);
    if (!(await tx.passport.updateMany({ where: { id: passportId }, data: { updatedAt: new Date() } })).count) throw new WorkflowError(404, "Passport not found");
    const superseded = await tx.publication.findFirst({ where: { id: data.publicationId, passportId, status: "PUBLISHED" } });
    if (!superseded || superseded.payloadHash !== data.expectedSha256) throw new WorkflowError(409, "Only the reviewed published record can be corrected");
    const existing = await tx.publicationCorrection.findUnique({ where: { supersededPublicationId: superseded.id } });
    if (existing) return { status: "RECORDED" as const, correctionId: existing.id, correctionPassportId: existing.correctionPassportId, openedAt: existing.openedAt.toISOString() };
    const original = await tx.passport.findUniqueOrThrow({ where: { id: passportId }, include: { farmer: true, field: true, treatment: true, meteo: true, chemical: true } });
    const { farmer, field, treatment, meteo, chemical } = original;
    const copiedFarmer = await tx.farmer.create({ data: { ownerId: original.ownerId, legalName: farmer.legalName, registrationId: farmer.registrationId,
      contactName: farmer.contactName, contactEmail: farmer.contactEmail, contactPhone: farmer.contactPhone } });
    const copiedField = await tx.field.create({ data: { ownerId: original.ownerId, farmerId: copiedFarmer.id, label: field.label, areaHectares: field.areaHectares,
      gpsCoords: field.gpsCoords, cadastralNumber: field.cadastralNumber, crop: field.crop } });
    // Evidence and its source-file links are not copied: files belong to one passport.
    const draft = await tx.passport.create({ data: { ownerId: original.ownerId, farmerId: copiedFarmer.id, fieldId: copiedField.id, publicFarmLabel: original.publicFarmLabel,
      treatment: { create: treatment ? { treatmentType: treatment.treatmentType, treatmentDate: treatment.treatmentDate, treatmentTime: treatment.treatmentTime,
        timeZone: treatment.timeZone, treatedAreaHectares: treatment.treatedAreaHectares, droneModel: treatment.droneModel, droneSerial: treatment.droneSerial,
        operator: treatment.operator, pilotCert: treatment.pilotCert, notes: treatment.notes } : {} },
      meteo: { create: meteo ? { temperatureCelsius: meteo.temperatureCelsius, humidityPercent: meteo.humidityPercent, windSpeedMps: meteo.windSpeedMps,
        rainfallMm: meteo.rainfallMm, measuredAt: meteo.measuredAt } : {} },
      chemical: { create: chemical ? { product: chemical.product, activeSubstance: chemical.activeSubstance, dosePerHa: chemical.dosePerHa, doseUnit: chemical.doseUnit,
        workingVolume: chemical.workingVolume, manufacturer: chemical.manufacturer, registrationNo: chemical.registrationNo, supplierName: chemical.supplierName,
        supplierEdrpou: chemical.supplierEdrpou } : {} } } });
    const row = await tx.publicationCorrection.create({ data: { supersededPublicationId: superseded.id, supersededPassportId: passportId,
      ownerId: original.ownerId, correctionPassportId: draft.id, actorId: adminId, reason: data.reason } });
    await tx.auditLog.create({ data: { passportId: draft.id, actorId: adminId, action: "DRAFT_CREATED", version: 1, note: `Correction draft for ${row.id}` } });
    for (const [id, version, status, publicationId] of [[passportId, original.version, original.status, superseded.id], [draft.id, 1, draft.status, null]] as const) {
      await tx.auditLog.create({ data: { passportId: id, publicationId, actorId: adminId, version, action: "PUBLICATION_CORRECTION_OPENED",
        fromStatus: status, toStatus: status, note: `Correction ${row.id}: ${data.reason}` } });
    }
    return { status: "OPENED" as const, correctionId: row.id, correctionPassportId: draft.id, openedAt: row.openedAt.toISOString() };
  });
}
