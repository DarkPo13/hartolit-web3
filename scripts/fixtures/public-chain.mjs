export function fictionalChainSnapshot(certificateId) {
  return {
    schemaName: "hartolit.field-passport.public", schemaVersion: "2.0.0", issuer: "Hartolit", certificateId, snapshotAt: "2026-10-22T08:00:00.000Z",
    farm: { label: "Fictional Chain Farm" }, field: { reference: "e84b1ab9-daf4-49c8-bb08-9952451a6763", areaHectares: 12.5, crop: "sunflower" },
    treatment: { category: "herbicide", date: "2026-09-01", localTime: "09:30", timeZone: "Europe/Kyiv", treatedAreaHectares: 10.25, droneModel: "Fictional Drone" },
    weather: { temperatureCelsius: 22.5, humidityPercent: 61, windSpeedMps: 2.75, rainfallMm: 0, measuredAt: "2026-09-01T08:20:00.000Z" },
    chemical: { product: "Fictional Product", activeSubstance: null, dosePerHa: 1.25, doseUnit: "L_PER_HA", workingVolumeLitersPerHa: 25, manufacturer: null, registrationNumber: null },
    evidence: { weatherSha256: "a".repeat(64), chemicalSha256: "b".repeat(64) },
  };
}
