import { z } from "zod";
import { isSupportedTimeZone } from "@/lib/time-zone";

const optionalText = (max: number) => z.string().trim().max(max);
const numeric = (min: number, max: number) => z.union([
  z.number().finite().min(min).max(max),
  z.null(),
]);
const treatedArea = z.union([
  z.number().finite().min(0).max(99_999_999.9999).refine((value) => {
    const printed = String(value);
    return !printed.includes("e") && (printed.split(".")[1]?.length ?? 0) <= 4;
  }, "Use at most four decimal places"),
  z.null(),
]);

export const draftDataSchema = z.strictObject({
  farmer: z.strictObject({
    farmerName: optionalText(200),
    publicFarmLabel: optionalText(200),
    farmerId: optionalText(32),
    fieldArea: numeric(0, 100_000_000),
    gpsCoords: optionalText(80),
    cadastralNumber: optionalText(40),
    crop: optionalText(100),
  }),
  treatment: z.strictObject({
    treatmentType: optionalText(100),
    treatmentDate: z.union([z.iso.date(), z.literal("")]),
    treatmentTime: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal("")]),
    timeZone: z.string().trim().max(64).refine((value) => value === "" || isSupportedTimeZone(value)),
    treatedAreaHectares: treatedArea,
    droneModel: optionalText(200),
    droneSerial: optionalText(200),
    operator: optionalText(200),
    pilotCert: optionalText(200),
    notes: optionalText(2000),
  }),
  meteo: z.strictObject({
    temperatureCelsius: numeric(-100, 100),
    humidityPercent: numeric(0, 100),
    windSpeedMps: numeric(0, 200),
    rainfallMm: numeric(0, 100_000),
    measuredAt: z.union([z.iso.datetime({ offset: true }), z.null()]),
  }),
  chemical: z.strictObject({
    chemical: optionalText(200),
    chemicalActive: optionalText(200),
    dose: numeric(0, 100_000_000),
    doseUnit: z.enum(["L_PER_HA", "KG_PER_HA", ""]),
    workingVolume: numeric(0, 100_000_000),
    manufacturer: optionalText(200),
    regNumber: optionalText(100),
    supplierName: optionalText(200),
    supplierEdrpou: optionalText(32),
  }),
});

export const draftSaveSchema = z.strictObject({
  version: z.number().int().positive(),
  data: draftDataSchema,
});

export type DraftData = z.infer<typeof draftDataSchema>;
export type DraftSave = z.infer<typeof draftSaveSchema>;

export type DraftRecord = {
  id: string;
  publicFieldReference: string;
  status: "DRAFT";
  version: number;
  updatedAt: string;
  reviewNote: string | null;
  data: DraftData;
};

export type DraftListItem = Pick<DraftRecord, "id" | "status" | "version" | "updatedAt"> & {
  farmerName: string;
  crop: string;
};
