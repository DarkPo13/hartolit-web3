import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { canonicalize, sha256Hex } from "@/lib/hash";
import { WorkflowError } from "@/lib/review/service";
import { PUBLIC_SNAPSHOT_NAME, PUBLIC_SNAPSHOT_VERSION, publicSnapshotSchema } from "./schema";

const previewSelect = {
  status: true, version: true, approvedVersion: true, submittedVersion: true, publicFarmLabel: true,
  field: { select: { publicReference: true, areaHectares: true, crop: true } },
  treatment: { select: { treatmentType: true, treatmentDate: true, treatmentTime: true, timeZone: true, treatedAreaHectares: true, droneModel: true } },
  meteo: { select: { temperatureCelsius: true, humidityPercent: true, windSpeedMps: true, rainfallMm: true, measuredAt: true } },
  chemical: { select: { product: true, activeSubstance: true, dosePerHa: true, doseUnit: true, workingVolume: true, manufacturer: true, registrationNo: true } },
  evidence: { select: { id: true, kind: true, status: true, sha256: true, rejectionCode: true, objectPurgedAt: true } },
  publication: { select: { id: true } },
} satisfies Prisma.PassportSelect;

function amount(value: Prisma.Decimal | null | undefined) { return value?.toNumber() ?? null; }
function optional(value: string | null | undefined) { return value?.trim() || null; }

export async function buildPublicSnapshot(
  db: Prisma.TransactionClient,
  id: string,
  weatherFileId: string,
  chemicalFileId: string,
  metadata: { certificateId: string; snapshotAt: string },
) {
  const row = await db.passport.findUnique({ where: { id }, select: previewSelect });
  if (!row) throw new WorkflowError(404, "Passport not found");
  if (row.status !== "APPROVED" || row.approvedVersion === null || row.approvedVersion !== row.submittedVersion || row.publication) {
    throw new WorkflowError(409, "Only an approved, unpublished passport can be previewed");
  }
  const weatherFile = row.evidence.find((file) => file.id === weatherFileId && file.kind === "METEO" && file.status === "READY" && file.rejectionCode === null && file.objectPurgedAt === null);
  const chemicalFile = row.evidence.find((file) => file.id === chemicalFileId && file.kind === "CHEMICAL" && file.status === "READY" && file.rejectionCode === null && file.objectPurgedAt === null);
  if (!weatherFile || !chemicalFile) throw new WorkflowError(422, "Select one verified weather file and one verified chemical file");

  // Construct each approved public field by name. Never serialize a private Prisma row.
  const candidate = {
    schemaName: PUBLIC_SNAPSHOT_NAME,
    schemaVersion: PUBLIC_SNAPSHOT_VERSION,
    certificateId: metadata.certificateId,
    snapshotAt: metadata.snapshotAt,
    issuer: "Hartolit",
    farm: { label: row.publicFarmLabel },
    field: { reference: row.field.publicReference, areaHectares: amount(row.field.areaHectares), crop: row.field.crop },
    treatment: {
      category: row.treatment?.treatmentType,
      date: row.treatment?.treatmentDate,
      localTime: row.treatment?.treatmentTime,
      timeZone: row.treatment?.timeZone,
      treatedAreaHectares: amount(row.treatment?.treatedAreaHectares),
      droneModel: row.treatment?.droneModel,
    },
    weather: {
      temperatureCelsius: amount(row.meteo?.temperatureCelsius),
      humidityPercent: amount(row.meteo?.humidityPercent),
      windSpeedMps: amount(row.meteo?.windSpeedMps),
      rainfallMm: amount(row.meteo?.rainfallMm),
      measuredAt: row.meteo?.measuredAt?.toISOString(),
    },
    chemical: {
      product: row.chemical?.product,
      activeSubstance: optional(row.chemical?.activeSubstance),
      dosePerHa: amount(row.chemical?.dosePerHa),
      doseUnit: row.chemical?.doseUnit,
      workingVolumeLitersPerHa: amount(row.chemical?.workingVolume),
      manufacturer: optional(row.chemical?.manufacturer),
      registrationNumber: optional(row.chemical?.registrationNo),
    },
    evidence: { weatherSha256: weatherFile.sha256, chemicalSha256: chemicalFile.sha256 },
  };
  const parsed = publicSnapshotSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new WorkflowError(422, "Approved passport lacks valid public facts", parsed.error.issues.map((issue) => issue.path.join(".")));
  }
  const snapshot = parsed.data;
  const canonicalJson = canonicalize(snapshot);
  return { snapshot, canonicalJson, sha256: await sha256Hex(canonicalJson), passportVersion: row.version, approvedVersion: row.approvedVersion };
}

export async function previewPublicSnapshot(id: string, weatherFileId: string, chemicalFileId: string) {
  return buildPublicSnapshot(getDb(), id, weatherFileId, chemicalFileId, {
    certificateId: randomUUID(), snapshotAt: new Date().toISOString(),
  });
}
