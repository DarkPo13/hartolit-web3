import {
  farmerSchema,
  treatmentSchema,
  chemicalSchema,
  meteoDataSchema,
} from "./schemas";
import { z } from "zod";
import { publicCropSchema, publicTreatmentCategorySchema } from "./public-snapshot/schema";
import { isSupportedTimeZone } from "./time-zone";
import type {
  FarmerBlockData,
  TreatmentBlockData,
  MeteoBlockData,
  ChemicalBlockData,
  FieldPassportPayload,
} from "@/types/passport";

export type MissingKey =
  | "farmer"
  | "treatment"
  | "meteoData"
  | "chemical"
  | "chemFile";

interface WizardLikeState {
  farmer: Partial<FarmerBlockData>;
  treatment: Partial<TreatmentBlockData>;
  meteo: Partial<MeteoBlockData>;
  chemical: Partial<ChemicalBlockData>;
}

export interface Step1Status {
  complete: boolean;
  missing: MissingKey[];
}

export function isFarmerComplete(farmer: Partial<FarmerBlockData>): boolean {
  return farmerSchema.safeParse(farmer).success;
}

export function isTreatmentComplete(treatment: Partial<TreatmentBlockData>): boolean {
  return treatmentSchema.safeParse(treatment).success;
}

export function isMeteoComplete(meteo: Partial<MeteoBlockData>): boolean {
  return !!meteo.meteoFile && meteoDataSchema.safeParse(meteo.meteoData).success;
}

export function isChemicalComplete(chemical: Partial<ChemicalBlockData>): boolean {
  return (
    chemicalSchema.safeParse(chemical).success && !!chemical.chemFile
  );
}

// The signed-in capture form stores evidence separately and requires fewer
// private fields than the local demo wizard. These indicators cover form facts;
// the server remains authoritative for submission and verified evidence.
const hasText = (value: unknown) => typeof value === "string" && value.trim().length > 0;
function positiveNumber(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
const captureDate = z.iso.date();
const captureInstant = z.iso.datetime({ offset: true });

export function isCaptureFarmerComplete(farmer: Partial<FarmerBlockData>): boolean {
  return hasText(farmer.farmerName) && hasText(farmer.publicFarmLabel) &&
    positiveNumber(farmer.fieldArea) !== null && publicCropSchema.safeParse(farmer.crop).success;
}

export function isCaptureTreatmentComplete(treatment: Partial<TreatmentBlockData>, fieldArea: number | undefined): boolean {
  const treatedArea = positiveNumber(treatment.treatedAreaHectares);
  const totalArea = positiveNumber(fieldArea);
  return publicTreatmentCategorySchema.safeParse(treatment.treatmentType).success &&
    captureDate.safeParse(treatment.treatmentDate).success &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(treatment.treatmentTime ?? "") &&
    !!treatment.timeZone && isSupportedTimeZone(treatment.timeZone) &&
    treatedArea !== null && totalArea !== null && treatedArea <= totalArea &&
    hasText(treatment.droneModel) && hasText(treatment.operator);
}

export function isCaptureMeteoComplete(meteo: Partial<MeteoBlockData>): boolean {
  const data = meteo.meteoData;
  return !!data && Number.isFinite(data.temperatureCelsius) &&
    Number.isFinite(data.humidityPercent) && Number(data.humidityPercent) >= 0 && Number(data.humidityPercent) <= 100 &&
    Number.isFinite(data.windSpeedMps) && Number(data.windSpeedMps) >= 0 &&
    captureInstant.safeParse(data.measuredAt).success;
}

export function isCaptureChemicalComplete(chemical: Partial<ChemicalBlockData>): boolean {
  return hasText(chemical.chemical) && positiveNumber(chemical.dose) !== null &&
    (chemical.doseUnit === "L_PER_HA" || chemical.doseUnit === "KG_PER_HA") &&
    positiveNumber(chemical.workingVolume) !== null;
}

export function isStep1Complete(state: WizardLikeState): Step1Status {
  const missing: MissingKey[] = [];

  if (!farmerSchema.safeParse(state.farmer).success) missing.push("farmer");
  if (!treatmentSchema.safeParse(state.treatment).success) missing.push("treatment");
  if (
    !state.meteo.meteoFile ||
    !meteoDataSchema.safeParse(state.meteo.meteoData).success
  )
    missing.push("meteoData");
  if (!chemicalSchema.safeParse(state.chemical).success) missing.push("chemical");
  if (!state.chemical.chemFile) missing.push("chemFile");

  return { complete: missing.length === 0, missing };
}

export function buildPayload(state: WizardLikeState): FieldPassportPayload {
  const farmer = farmerSchema.omit({ publicFarmLabel: true }).parse(state.farmer);
  const treatment = treatmentSchema.omit({ timeZone: true, treatedAreaHectares: true }).parse(state.treatment);
  const meteoData = meteoDataSchema.parse(state.meteo.meteoData);
  const chemical = chemicalSchema.parse(state.chemical);

  if (!state.meteo.meteoFile) throw new Error("Meteo file missing");
  if (!state.chemical.chemFile) throw new Error("Chemical document missing");

  return {
    schema: "hartolit.field-passport.public",
    version: "1.0.0",
    issuedAt: new Date().toISOString(),
    farmer,
    treatment: {
      ...treatment,
    },
    meteo: {
      file: state.meteo.meteoFile,
      data: meteoData,
    },
    chemical: {
      product: chemical.chemical,
      activeSubstance: chemical.chemicalActive,
      dosePerHa: chemical.dose,
      workingVolumeLitresPerHa: chemical.workingVolume,
      manufacturer: chemical.manufacturer,
      registrationNumber: chemical.regNumber,
      supplierName: chemical.supplierName,
      supplierEdrpou: chemical.supplierEdrpou,
      file: state.chemical.chemFile,
    },
  };
}
