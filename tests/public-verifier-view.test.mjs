import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

// Jiti's test transform uses classic JSX even when the app build uses Next's automatic runtime.
globalThis.React = React;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/") }, jsx: { runtime: "automatic" } });
const { PublicVerificationView } = await jiti.import("../components/public-verifier/PublicVerificationView.tsx");
const { uk } = await jiti.import("../lib/i18n/translations/uk.ts");
const { en } = await jiti.import("../lib/i18n/translations/en.ts");
const t = uk.publicVerifier;

const snapshot = {
  schemaName: "hartolit.field-passport.public", schemaVersion: "2.0.0",
  certificateId: "f837b2a1-9401-4fd8-860c-aa02d7d3fe49", snapshotAt: "2026-10-02T12:31:40.000Z", issuer: "Hartolit",
  farm: { label: "Fictional Farm X" },
  field: { reference: "e84b1ab9-daf4-49c8-bb08-9952451a6763", areaHectares: 12.5, crop: "sunflower" },
  treatment: { category: "herbicide", date: "2026-09-01", localTime: "09:30", timeZone: "Europe/Kyiv", treatedAreaHectares: 10.25, droneModel: "Fictional Drone X" },
  weather: { temperatureCelsius: 22.5, humidityPercent: 61, windSpeedMps: 2.75, rainfallMm: 0.125, measuredAt: "2026-09-01T08:20:00.000Z" },
  chemical: { product: "Fictional Product X", activeSubstance: "Fictional Active X", dosePerHa: 1.25, doseUnit: "L_PER_HA", workingVolumeLitersPerHa: 25,
    manufacturer: "Fictional Maker X", registrationNumber: "FICTIONAL-REG-X" },
  evidence: { weatherSha256: "a".repeat(64), chemicalSha256: "b".repeat(64) },
};
const valid = { status: "VALID", tokenId: "7", chainId: 97, contractAddress: `0x${"1".repeat(40)}`, owner: `0x${"2".repeat(40)}`,
  payloadHash: "c".repeat(64), cid: "bafkreifictionalcid", checkedBlockNumber: "88", checkedBlockHash: `0x${"d".repeat(64)}`, confirmations: "3",
  snapshot, canonicalJson: JSON.stringify(snapshot) };
const render = (result, share) => renderToStaticMarkup(React.createElement(PublicVerificationView, { result, share }));

test("a VALID public page shows every public scalar, the chain facts and what the match does not prove", () => {
  const html = render(valid), readable = html.split("<details")[0];
  for (const expected of [snapshot.schemaName, snapshot.schemaVersion, snapshot.certificateId, snapshot.snapshotAt, snapshot.issuer, snapshot.farm.label,
    snapshot.field.reference, String(snapshot.field.areaHectares), "Соняшник", "Гербіцидна обробка", snapshot.treatment.date, snapshot.treatment.localTime,
    snapshot.treatment.timeZone, String(snapshot.treatment.treatedAreaHectares), snapshot.treatment.droneModel, String(snapshot.weather.temperatureCelsius),
    String(snapshot.weather.humidityPercent), String(snapshot.weather.windSpeedMps), String(snapshot.weather.rainfallMm), snapshot.weather.measuredAt,
    snapshot.chemical.product, snapshot.chemical.activeSubstance, String(snapshot.chemical.dosePerHa), "L/ha", String(snapshot.chemical.workingVolumeLitersPerHa),
    snapshot.chemical.manufacturer, snapshot.chemical.registrationNumber, snapshot.evidence.weatherSha256, snapshot.evidence.chemicalSha256,
    valid.tokenId, valid.contractAddress, valid.owner, valid.cid, valid.payloadHash, valid.checkedBlockNumber, valid.checkedBlockHash]) {
    assert.ok(readable.includes(expected), `missing readable value: ${expected}`);
  }
  for (const text of [t.validBadge, t.validTitle, t.limits, t.testnet, t.publishedRecord]) assert.ok(html.includes(text), text);
  for (const text of [uk.review.confirmedViews.unpublished, uk.review.publicPreview.temporary, uk.review.publicPreview.confirmedRecord, t.checkAgain]) {
    assert.ok(!html.includes(text), `VALID must not show: ${text}`);
  }
});

test("a VALID record offers its share link, QR, print and exact JSON download; other states never do", () => {
  const share = { url: "https://dapp.example.invalid/passports/7", qrDataUrl: "data:image/png;base64,ZmljdGlvbmFs" };
  const html = render(valid, share);
  for (const text of [t.shareTitle, t.qrAlt, share.url, share.qrDataUrl, t.copyLink, t.downloadQr, t.print, t.downloadJson, t.downloadJsonHint]) {
    assert.ok(html.includes(text), `share section missing ${text}`);
  }
  assert.ok(html.includes('download="hartolit-passport-7-qr.png"'));
  // Found in the browser print pass: the share card and fact groups must not split
  // across pages, and the collapsed JSON toggle is meaningless on paper.
  assert.match(html, /aria-labelledby="public-share-title" class="[^"]*print:break-inside-avoid/);
  assert.match(html, /<section class="[^"]*print:break-inside-avoid"><h4/);
  assert.match(html, /<details class="[^"]*print:hidden"/);
  assert.ok(!render(valid).includes(t.shareTitle), "no share section without a trusted share URL");
  for (const status of ["PENDING", "UNAVAILABLE", "MISMATCH", "UNSUPPORTED"]) {
    assert.ok(!render({ status, reason: "CHAIN", tokenId: "7" }, share).includes(t.shareTitle), `${status} must not be shared`);
  }
});

test("issuer-record notes annotate VALID without replacing it; mismatching records are alerts", () => {
  for (const [issuer, text, alert] of [["MATCH", t.issuerMatch, false], ["UNAVAILABLE", t.issuerUnavailable, false], ["SUSPENDED", t.issuerSuspended, true],
    ["DISAGREES", t.issuerDisagrees, true], ["NO_RECORD", t.issuerNoRecord, true]]) {
    const html = renderToStaticMarkup(React.createElement(PublicVerificationView, { result: valid, issuer }));
    assert.ok(html.includes(text) && html.includes(t.issuerTitle) && html.includes(t.validBadge), issuer);
    assert.equal(html.includes('role="alert"'), alert, `${issuer} alert role`);
  }
  assert.ok(!render({ status: "PENDING", reason: "CONFIRMING", tokenId: "7" }).includes(t.issuerTitle));
});

test("every other result has its own state, no treatment facts and a way to check again", () => {
  const cases = [
    [{ status: "PENDING", reason: "CONFIRMING" }, [t.pendingBadge, t.pendingTitle, t.pendingDescription]],
    [{ status: "UNAVAILABLE", reason: "CHAIN" }, [t.unavailableBadge, t.unavailableTitle, t.unavailableDescription]],
    [{ status: "UNAVAILABLE", reason: "NOT_CONFIGURED" }, [t.unavailableBadge, t.notConfigured]],
    [{ status: "MISMATCH", reason: "BYTES" }, [t.mismatchBadge, t.mismatchTitle, t.mismatchBytes]],
    [{ status: "MISMATCH", reason: "URI" }, [t.mismatchUri]], [{ status: "MISMATCH", reason: "CHAIN_STATE" }, [t.mismatchChainState]],
    [{ status: "UNSUPPORTED", reason: "SCHEMA" }, [t.unsupportedBadge, t.unsupportedTitle, t.unsupportedDescription]],
  ];
  for (const [result, texts] of cases) {
    const html = render({ ...result, tokenId: "7" });
    for (const text of [...texts, t.limits, t.checkAgain]) assert.ok(html.includes(text), `${result.status}/${result.reason}: ${text}`);
    assert.ok(html.includes('href="/passports/7"'));
    for (const value of [snapshot.farm.label, snapshot.chemical.product, t.validBadge]) assert.ok(!html.includes(value), `${result.status} must not show ${value}`);
  }
});

test("both languages define every public verifier string", () => {
  assert.deepEqual(Object.keys(en.publicVerifier).sort(), Object.keys(uk.publicVerifier).sort());
  for (const [key, value] of Object.entries({ ...en.publicVerifier, ...uk.publicVerifier })) assert.ok(value.trim(), key);
});
