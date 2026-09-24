import {
  farmerSchema,
  treatmentSchema,
  chemicalSchema,
  meteoDataSchema,
} from "./schemas";
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
  const farmer = farmerSchema.parse(state.farmer);
  const treatment = treatmentSchema.parse(state.treatment);
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
