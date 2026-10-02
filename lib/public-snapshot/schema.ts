import { z } from "zod";
import { isSupportedTimeZone } from "../time-zone";

export const PUBLIC_SNAPSHOT_NAME = "hartolit.field-passport.public";
export const PUBLIC_SNAPSHOT_VERSION = "2.0.0";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).nullable();
const amount = z.number().finite().nonnegative();
const positiveAmount = amount.positive();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
export const publicCropSchema = z.enum(["wheat", "barley", "corn", "sunflower", "soy", "rapeseed", "sugar_beet", "other"]);
export const publicTreatmentCategorySchema = z.enum(["herbicide", "fungicide", "insecticide", "fertilizer", "desiccation", "other"]);

/** This is the complete, versioned public boundary. Unknown keys always fail. */
export const publicSnapshotSchema = z.strictObject({
  schemaName: z.literal(PUBLIC_SNAPSHOT_NAME),
  schemaVersion: z.literal(PUBLIC_SNAPSHOT_VERSION),
  certificateId: z.uuid(),
  snapshotAt: z.iso.datetime({ offset: true }),
  issuer: z.literal("Hartolit"),
  farm: z.strictObject({ label: text(200) }),
  field: z.strictObject({ reference: z.uuid(), areaHectares: positiveAmount, crop: publicCropSchema }),
  treatment: z.strictObject({
    category: publicTreatmentCategorySchema,
    date: z.iso.date(),
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timeZone: z.string().max(64).refine(isSupportedTimeZone),
    treatedAreaHectares: positiveAmount,
    droneModel: text(200),
  }),
  weather: z.strictObject({
    temperatureCelsius: z.number().finite(),
    humidityPercent: z.number().finite().min(0).max(100),
    windSpeedMps: amount,
    rainfallMm: amount.nullable(),
    measuredAt: z.iso.datetime({ offset: true }),
  }),
  chemical: z.strictObject({
    product: text(200),
    activeSubstance: optionalText(200),
    dosePerHa: positiveAmount,
    doseUnit: z.enum(["L_PER_HA", "KG_PER_HA"]),
    workingVolumeLitersPerHa: positiveAmount,
    manufacturer: optionalText(200),
    registrationNumber: optionalText(100),
  }),
  evidence: z.strictObject({ weatherSha256: digest, chemicalSha256: digest }),
}).refine((value) => value.treatment.treatedAreaHectares <= value.field.areaHectares, {
  path: ["treatment", "treatedAreaHectares"],
  message: "Treated area exceeds field area",
});

export type PublicSnapshot = z.infer<typeof publicSnapshotSchema>;
