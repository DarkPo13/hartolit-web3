import { draftDataSchema, type DraftData } from "./schema";
import type { FarmerBlockData, TreatmentBlockData, MeteoBlockData, ChemicalBlockData } from "@/types/passport";

export type DraftWizardData = {
  farmer: Partial<FarmerBlockData>;
  treatment: Partial<TreatmentBlockData>;
  meteo: Partial<MeteoBlockData>;
  chemical: Partial<ChemicalBlockData>;
};

function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function number(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function toDraftData(state: DraftWizardData): DraftData | null {
  const result = draftDataSchema.safeParse({
    farmer: {
      farmerName: text(state.farmer.farmerName),
      farmerId: text(state.farmer.farmerId),
      fieldArea: number(state.farmer.fieldArea),
      gpsCoords: text(state.farmer.gpsCoords),
      cadastralNumber: text(state.farmer.cadastralNumber),
      crop: text(state.farmer.crop),
    },
    treatment: {
      treatmentType: text(state.treatment.treatmentType),
      treatmentDate: text(state.treatment.treatmentDate),
      treatmentTime: text(state.treatment.treatmentTime),
      droneModel: text(state.treatment.droneModel),
      droneSerial: text(state.treatment.droneSerial),
      operator: text(state.treatment.operator),
      pilotCert: text(state.treatment.pilotCert),
      notes: text(state.treatment.notes),
    },
    meteo: {
      temperatureCelsius: number(state.meteo.meteoData?.temperatureCelsius),
      humidityPercent: number(state.meteo.meteoData?.humidityPercent),
      windSpeedMps: number(state.meteo.meteoData?.windSpeedMps),
      rainfallMm: number(state.meteo.meteoData?.rainfallMm),
      measuredAt: state.meteo.meteoData?.measuredAt ?? null,
    },
    chemical: {
      chemical: text(state.chemical.chemical),
      chemicalActive: text(state.chemical.chemicalActive),
      dose: number(state.chemical.dose),
      workingVolume: number(state.chemical.workingVolume),
      manufacturer: text(state.chemical.manufacturer),
      regNumber: text(state.chemical.regNumber),
      supplierName: text(state.chemical.supplierName),
      supplierEdrpou: text(state.chemical.supplierEdrpou),
    },
  });
  return result.success ? result.data : null;
}

export function fromDraftData(data: DraftData): DraftWizardData {
  const meteoData = {
    ...(data.meteo.temperatureCelsius !== null ? { temperatureCelsius: data.meteo.temperatureCelsius } : {}),
    ...(data.meteo.humidityPercent !== null ? { humidityPercent: data.meteo.humidityPercent } : {}),
    ...(data.meteo.windSpeedMps !== null ? { windSpeedMps: data.meteo.windSpeedMps } : {}),
    ...(data.meteo.rainfallMm !== null ? { rainfallMm: data.meteo.rainfallMm } : {}),
    ...(data.meteo.measuredAt !== null ? { measuredAt: data.meteo.measuredAt } : {}),
  };
  return {
    farmer: { ...data.farmer, fieldArea: data.farmer.fieldArea ?? undefined },
    treatment: { ...data.treatment },
    meteo: Object.keys(meteoData).length ? { meteoData } : {},
    chemical: { ...data.chemical, dose: data.chemical.dose ?? undefined, workingVolume: data.chemical.workingVolume ?? undefined },
  };
}
