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
  | "pilotSignature"
  | "chemical"
  | "chemFile"
  | "supplierSignature";

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
  return (
    !!meteo.meteoFile &&
    meteoDataSchema.safeParse(meteo.meteoData).success &&
    !!meteo.pilotSignature
  );
}

export function isChemicalComplete(chemical: Partial<ChemicalBlockData>): boolean {
  return (
    chemicalSchema.safeParse(chemical).success &&
    !!chemical.chemFile &&
    !!chemical.supplierSignature
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
  if (!state.meteo.pilotSignature) missing.push("pilotSignature");
  if (!chemicalSchema.safeParse(state.chemical).success) missing.push("chemical");
  if (!state.chemical.chemFile) missing.push("chemFile");
  if (!state.chemical.supplierSignature) missing.push("supplierSignature");

  return { complete: missing.length === 0, missing };
}

export function buildPayload(state: WizardLikeState): FieldPassportPayload {
  const farmer = farmerSchema.parse(state.farmer);
  const treatment = treatmentSchema.parse(state.treatment);
  const meteoData = meteoDataSchema.parse(state.meteo.meteoData);
  const chemical = chemicalSchema.parse(state.chemical);

  if (!state.meteo.meteoFile) throw new Error("Meteo file missing");
  if (!state.meteo.pilotSignature) throw new Error("Pilot KEP signature missing");
  if (!state.chemical.chemFile) throw new Error("Chemical document missing");
  if (!state.chemical.supplierSignature) throw new Error("Supplier KEP signature missing");

  return {
    ...farmer,
    ...treatment,
    meteoFile: state.meteo.meteoFile,
    meteoData,
    pilotSignature: state.meteo.pilotSignature,
    ...chemical,
    chemFile: state.chemical.chemFile,
    supplierSignature: state.chemical.supplierSignature,
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  };
}
