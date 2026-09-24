import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import type { DraftData, DraftListItem, DraftRecord, DraftSave } from "./schema";

const draftInclude = {
  farmer: true,
  field: true,
  treatment: true,
  meteo: true,
  chemical: true,
} satisfies Prisma.PassportInclude;

type DraftRow = Prisma.PassportGetPayload<{ include: typeof draftInclude }>;

export class DraftError extends Error {
  constructor(public readonly status: 404 | 409, message: string) {
    super(message);
  }
}

function str(value: string | null): string { return value ?? ""; }
function num(value: Prisma.Decimal | null): number | null { return value?.toNumber() ?? null; }

function toRecord(row: DraftRow): DraftRecord {
  if (row.status !== "DRAFT") throw new DraftError(409, "Draft is no longer editable");
  return {
    id: row.id,
    status: "DRAFT",
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    reviewNote: row.reviewNote,
    data: {
      farmer: {
        farmerName: str(row.farmer.legalName),
        farmerId: str(row.farmer.registrationId),
        fieldArea: num(row.field.areaHectares),
        gpsCoords: str(row.field.gpsCoords),
        cadastralNumber: str(row.field.cadastralNumber),
        crop: str(row.field.crop),
      },
      treatment: {
        treatmentType: str(row.treatment?.treatmentType ?? null),
        treatmentDate: str(row.treatment?.treatmentDate ?? null),
        treatmentTime: str(row.treatment?.treatmentTime ?? null),
        droneModel: str(row.treatment?.droneModel ?? null),
        droneSerial: str(row.treatment?.droneSerial ?? null),
        operator: str(row.treatment?.operator ?? null),
        pilotCert: str(row.treatment?.pilotCert ?? null),
        notes: str(row.treatment?.notes ?? null),
      },
      meteo: {
        temperatureCelsius: num(row.meteo?.temperatureCelsius ?? null),
        humidityPercent: num(row.meteo?.humidityPercent ?? null),
        windSpeedMps: num(row.meteo?.windSpeedMps ?? null),
        rainfallMm: num(row.meteo?.rainfallMm ?? null),
        measuredAt: row.meteo?.measuredAt?.toISOString() ?? null,
      },
      chemical: {
        chemical: str(row.chemical?.product ?? null),
        chemicalActive: str(row.chemical?.activeSubstance ?? null),
        dose: num(row.chemical?.dosePerHa ?? null),
        workingVolume: num(row.chemical?.workingVolume ?? null),
        manufacturer: str(row.chemical?.manufacturer ?? null),
        regNumber: str(row.chemical?.registrationNo ?? null),
        supplierName: str(row.chemical?.supplierName ?? null),
        supplierEdrpou: str(row.chemical?.supplierEdrpou ?? null),
      },
    },
  };
}

export async function listDrafts(ownerId: string): Promise<DraftListItem[]> {
  const rows = await getDb().passport.findMany({
    where: { ownerId, status: "DRAFT" },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 50,
    select: {
      id: true, status: true, version: true, updatedAt: true,
      farmer: { select: { legalName: true } },
      field: { select: { crop: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    status: "DRAFT",
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    farmerName: str(row.farmer.legalName),
    crop: str(row.field.crop),
  }));
}

export async function getDraft(ownerId: string, id: string): Promise<DraftRecord> {
  const row = await getDb().passport.findFirst({ where: { id, ownerId }, include: draftInclude });
  if (!row) throw new DraftError(404, "Draft not found");
  return toRecord(row);
}

export async function createDraft(ownerId: string): Promise<DraftRecord> {
  return getDb().$transaction(async (tx) => {
    const farmer = await tx.farmer.create({ data: { ownerId } });
    const field = await tx.field.create({ data: { ownerId, farmerId: farmer.id } });
    const passport = await tx.passport.create({
      data: {
        ownerId, farmerId: farmer.id, fieldId: field.id,
        treatment: { create: {} }, meteo: { create: {} }, chemical: { create: {} },
      },
      include: draftInclude,
    });
    await tx.auditLog.create({
      data: { passportId: passport.id, actorId: ownerId, action: "DRAFT_CREATED", version: 1 },
    });
    return toRecord(passport);
  });
}

export async function saveDraft(ownerId: string, id: string, input: DraftSave): Promise<DraftRecord> {
  const { data, version } = input;
  return getDb().$transaction(async (tx) => {
    const current = await tx.passport.findFirst({
      where: { id, ownerId },
      select: { id: true, farmerId: true, fieldId: true, status: true },
    });
    if (!current) throw new DraftError(404, "Draft not found");
    if (current.status !== "DRAFT") throw new DraftError(409, "Draft is no longer editable");

    const updated = await tx.passport.updateMany({
      where: { id, ownerId, status: "DRAFT", version },
      data: { version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new DraftError(409, "Draft changed in another session");

    await tx.farmer.update({
      where: { id_ownerId: { id: current.farmerId, ownerId } },
      data: { legalName: data.farmer.farmerName || null, registrationId: data.farmer.farmerId || null },
    });
    await tx.field.update({
      where: { id_ownerId: { id: current.fieldId, ownerId } },
      data: {
        areaHectares: data.farmer.fieldArea,
        gpsCoords: data.farmer.gpsCoords || null,
        cadastralNumber: data.farmer.cadastralNumber || null,
        crop: data.farmer.crop || null,
      },
    });
    await tx.treatment.update({
      where: { passportId: id },
      data: nullStrings(data.treatment),
    });
    await tx.meteoMeasurement.update({
      where: { passportId: id },
      data: {
        temperatureCelsius: data.meteo.temperatureCelsius,
        humidityPercent: data.meteo.humidityPercent,
        windSpeedMps: data.meteo.windSpeedMps,
        rainfallMm: data.meteo.rainfallMm,
        measuredAt: data.meteo.measuredAt ? new Date(data.meteo.measuredAt) : null,
      },
    });
    await tx.chemicalApplication.update({
      where: { passportId: id },
      data: {
        product: data.chemical.chemical || null,
        activeSubstance: data.chemical.chemicalActive || null,
        dosePerHa: data.chemical.dose,
        workingVolume: data.chemical.workingVolume,
        manufacturer: data.chemical.manufacturer || null,
        registrationNo: data.chemical.regNumber || null,
        supplierName: data.chemical.supplierName || null,
        supplierEdrpou: data.chemical.supplierEdrpou || null,
      },
    });
    await tx.auditLog.create({
      data: { passportId: id, actorId: ownerId, action: "DRAFT_UPDATED", version: version + 1 },
    });
    const row = await tx.passport.findFirst({ where: { id, ownerId }, include: draftInclude });
    if (!row) throw new DraftError(404, "Draft not found");
    return toRecord(row);
  });
}

function nullStrings(value: DraftData["treatment"]) {
  return {
    treatmentType: value.treatmentType || null,
    treatmentDate: value.treatmentDate || null,
    treatmentTime: value.treatmentTime || null,
    droneModel: value.droneModel || null,
    droneSerial: value.droneSerial || null,
    operator: value.operator || null,
    pilotCert: value.pilotCert || null,
    notes: value.notes || null,
  };
}
