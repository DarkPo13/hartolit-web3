import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

// Jiti's test transform uses classic JSX even when the app build uses Next's automatic runtime.
globalThis.React = React;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/") }, jsx: { runtime: "automatic" } });
const { PublicSnapshotView } = await jiti.import("../components/public-snapshot/PublicSnapshotView.tsx");
const { publicSnapshotSchema } = await jiti.import("../lib/public-snapshot/schema.ts");
const { uk } = await jiti.import("../lib/i18n/translations/uk.ts");

test("readable preview displays every public scalar in addition to the exact JSON", () => {
  const snapshot = publicSnapshotSchema.parse({
    schemaName: "hartolit.field-passport.public", schemaVersion: "2.0.0",
    certificateId: "f837b2a1-9401-4fd8-860c-aa02d7d3fe49", snapshotAt: "2026-10-02T12:31:40.000Z", issuer: "Hartolit",
    farm: { label: "Fictional Farm X" },
    field: { reference: "e84b1ab9-daf4-49c8-bb08-9952451a6763", areaHectares: 12.5, crop: "sunflower" },
    treatment: { category: "herbicide", date: "2026-09-01", localTime: "09:30", timeZone: "Europe/Kyiv", treatedAreaHectares: 10.25, droneModel: "Fictional Drone X" },
    weather: { temperatureCelsius: 22.5, humidityPercent: 61, windSpeedMps: 2.75, rainfallMm: 0.125, measuredAt: "2026-09-01T08:20:00.000Z" },
    chemical: { product: "Fictional Product X", activeSubstance: "Fictional Active X", dosePerHa: 1.25, doseUnit: "L_PER_HA", workingVolumeLitersPerHa: 25, manufacturer: "Fictional Maker X", registrationNumber: "FICTIONAL-REG-X" },
    evidence: { weatherSha256: "a".repeat(64), chemicalSha256: "b".repeat(64) },
  });
  const preview = { snapshot, canonicalJson: JSON.stringify(snapshot), sha256: "c".repeat(64), passportVersion: 4, approvedVersion: 2 };
  const html = renderToStaticMarkup(React.createElement(PublicSnapshotView, { preview }));
  const readable = html.split("<details")[0];
  for (const expected of [
    snapshot.schemaName, snapshot.schemaVersion, snapshot.certificateId, snapshot.snapshotAt, snapshot.issuer,
    snapshot.farm.label, snapshot.field.reference, String(snapshot.field.areaHectares), "Соняшник",
    "Гербіцидна обробка", snapshot.treatment.date, snapshot.treatment.localTime, snapshot.treatment.timeZone,
    String(snapshot.treatment.treatedAreaHectares), snapshot.treatment.droneModel,
    String(snapshot.weather.temperatureCelsius), String(snapshot.weather.humidityPercent), String(snapshot.weather.windSpeedMps),
    String(snapshot.weather.rainfallMm), snapshot.weather.measuredAt, snapshot.chemical.product,
    snapshot.chemical.activeSubstance, String(snapshot.chemical.dosePerHa), "L/ha", String(snapshot.chemical.workingVolumeLitersPerHa),
    snapshot.chemical.manufacturer, snapshot.chemical.registrationNumber, snapshot.evidence.weatherSha256, snapshot.evidence.chemicalSha256,
    preview.sha256,
  ]) assert.ok(readable.includes(expected), `missing readable public value: ${expected}`);
  const confirmed = renderToStaticMarkup(React.createElement(PublicSnapshotView, { preview, confirmed: true }));
  assert.ok(confirmed.includes(uk.review.publicPreview.confirmedRecord), "saved snapshot must state that it is unpublished and unissued");
  assert.ok(!confirmed.includes(uk.review.publicPreview.temporary), "saved snapshot must not be labeled temporary");
});
