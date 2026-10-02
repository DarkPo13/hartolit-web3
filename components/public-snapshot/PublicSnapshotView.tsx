"use client";

import { useT } from "@/lib/i18n/context";
import type { PublicSnapshot } from "@/lib/public-snapshot/schema";

export type PublicPreview = {
  snapshot: PublicSnapshot;
  canonicalJson: string;
  sha256: string;
  passportVersion: number;
  approvedVersion: number;
};

type Fact = [string, string | number | null];

function Facts({ title, facts }: { title: string; facts: Fact[] }) {
  return <section className="mt-5"><h4 className="font-semibold">{title}</h4><dl className="mt-2 grid gap-3 sm:grid-cols-2">{facts.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-ink-muted">{label}</dt><dd className="break-all text-sm">{value === null ? "—" : value}</dd></div>)}</dl></section>;
}

/** Shared readable rendering boundary for the future certificate and verifier. */
export function PublicSnapshotView({ preview }: { preview: PublicPreview }) {
  const translations = useT();
  const t = translations.review.publicPreview;
  const s = preview.snapshot;
  return <div className="mt-4 rounded-xl border border-border bg-surface p-4">
    <p className="text-sm text-ink-muted">{t.temporary}</p>
    <Facts title={t.certificate} facts={[[t.schemaName, s.schemaName], [t.schemaVersion, s.schemaVersion], [t.certificateId, s.certificateId], [t.snapshotAt, s.snapshotAt], [t.issuer, s.issuer]]} />
    <Facts title={t.farm} facts={[[t.farmLabel, s.farm.label]]} />
    <Facts title={t.field} facts={[[t.fieldReference, s.field.reference], [t.fieldArea, s.field.areaHectares], [t.crop, translations.crops[s.field.crop]]]} />
    <Facts title={t.treatment} facts={[[t.category, translations.treatmentTypes[s.treatment.category]], [t.date, s.treatment.date], [t.localTime, s.treatment.localTime], [t.timeZone, s.treatment.timeZone], [t.treatedArea, s.treatment.treatedAreaHectares], [t.droneModel, s.treatment.droneModel]]} />
    <Facts title={t.weather} facts={[[t.temperature, s.weather.temperatureCelsius], [t.humidity, s.weather.humidityPercent], [t.wind, s.weather.windSpeedMps], [t.rainfall, s.weather.rainfallMm], [t.measuredAt, s.weather.measuredAt]]} />
    <Facts title={t.chemical} facts={[[t.product, s.chemical.product], [t.activeSubstance, s.chemical.activeSubstance], [t.dose, s.chemical.dosePerHa], [t.doseUnit, s.chemical.doseUnit === "L_PER_HA" ? "L/ha" : "kg/ha"], [t.workingVolume, s.chemical.workingVolumeLitersPerHa], [t.manufacturer, s.chemical.manufacturer], [t.registrationNumber, s.chemical.registrationNumber]]} />
    <Facts title={t.verification} facts={[[t.weatherDigest, s.evidence.weatherSha256], [t.chemicalDigest, s.evidence.chemicalSha256], [t.snapshotDigest, preview.sha256]]} />
    <details className="mt-5"><summary className="cursor-pointer text-sm font-medium text-brand-700">{t.exactJson}</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-3 text-xs">{preview.canonicalJson}</pre></details>
  </div>;
}
