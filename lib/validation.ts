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

interface WizardLikeState {
  farmer: Partial<FarmerBlockData>;
  treatment: Partial<TreatmentBlockData>;
  meteo: Partial<MeteoBlockData>;
  chemical: Partial<ChemicalBlockData>;
}

export interface Step1Status {
  complete: boolean;
  missing: string[];
}

export function isStep1Complete(state: WizardLikeState): Step1Status {
  const missing: string[] = [];

  if (!farmerSchema.safeParse(state.farmer).success) missing.push("дані фермера");
  if (!treatmentSchema.safeParse(state.treatment).success) missing.push("обробка");
  if (
    !state.meteo.meteoFile ||
    !meteoDataSchema.safeParse(state.meteo.meteoData).success
  )
    missing.push("метео-файл та дані");
  if (!state.meteo.pilotSignature) missing.push("КЕП пілота");
  if (!chemicalSchema.safeParse(state.chemical).success) missing.push("хімія");
  if (!state.chemical.chemFile) missing.push("документ закупівлі");
  if (!state.chemical.supplierSignature) missing.push("КЕП постачальника");

  return { complete: missing.length === 0, missing };
}

/**
 * Build the final, validated payload that will be hashed + pinned + minted.
 * Throws if any required field is missing.
 */
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
