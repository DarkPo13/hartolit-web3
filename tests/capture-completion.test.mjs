import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/") } });
const {
  isCaptureFarmerComplete, isCaptureTreatmentComplete, isCaptureMeteoComplete,
  isCaptureChemicalComplete, isFarmerComplete, isMeteoComplete, isChemicalComplete,
} = await jiti.import("../lib/validation.ts");

test("signed-in capture cards match submission facts without demo-only private fields or files", () => {
  const farmer = { farmerName: "Fictional Farm", publicFarmLabel: "Fictional Public Farm", fieldArea: 12.5, crop: "sunflower" };
  const treatment = { treatmentType: "herbicide", treatmentDate: "2026-09-01", treatmentTime: "09:30", timeZone: "Europe/Kyiv", treatedAreaHectares: 10.25, droneModel: "Fictional Drone", operator: "Fictional Pilot" };
  const meteo = { meteoData: { temperatureCelsius: 22.5, humidityPercent: 60, windSpeedMps: 2.5, measuredAt: "2026-09-01T08:30:00.000Z" } };
  const chemical = { chemical: "Fictional Product", dose: 1.25, doseUnit: "L_PER_HA", workingVolume: 25 };

  assert.equal(isCaptureFarmerComplete(farmer), true);
  assert.equal(isCaptureTreatmentComplete(treatment, farmer.fieldArea), true);
  assert.equal(isCaptureMeteoComplete(meteo), true);
  assert.equal(isCaptureChemicalComplete(chemical), true);
  assert.equal(isCaptureFarmerComplete({ ...farmer, fieldArea: "12.5" }), true, "form values are strings before persistence");
  assert.equal(isCaptureTreatmentComplete({ ...treatment, treatedAreaHectares: "10.25" }, "12.5"), true);
  assert.equal(isCaptureChemicalComplete({ ...chemical, dose: "1.25", workingVolume: "25" }), true);
  assert.equal(isFarmerComplete(farmer), false, "demo still requires its original private fields");
  assert.equal(isMeteoComplete(meteo), false, "demo still requires its own file");
  assert.equal(isChemicalComplete(chemical), false, "demo still requires its own file and supplier fields");

  assert.equal(isCaptureFarmerComplete({ ...farmer, crop: "unknown" }), false);
  assert.equal(isCaptureTreatmentComplete({ ...treatment, timeZone: "Unknown/Zone" }, farmer.fieldArea), false);
  assert.equal(isCaptureTreatmentComplete({ ...treatment, treatmentDate: "2026-02-30" }, farmer.fieldArea), false);
  assert.equal(isCaptureTreatmentComplete({ ...treatment, treatedAreaHectares: 15 }, farmer.fieldArea), false);
  assert.equal(isCaptureMeteoComplete({ meteoData: { ...meteo.meteoData, measuredAt: undefined } }), false);
  assert.equal(isCaptureMeteoComplete({ meteoData: { ...meteo.meteoData, measuredAt: "yesterday" } }), false);
  assert.equal(isCaptureChemicalComplete({ ...chemical, doseUnit: "" }), false);
});
