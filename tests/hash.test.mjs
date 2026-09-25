import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const { canonicalize, sha256Json } = await createJiti(import.meta.url).import("../lib/hash.ts");

test("canonical JSON and its hash survive a JSON transport round-trip", async () => {
  const payload = {
    version: "1.0.0",
    optional: undefined,
    evidence: [{ filename: "weather.json", note: undefined }, undefined],
    issuedAt: new Date("2026-09-24T00:00:00.000Z"),
  };
  const received = JSON.parse(JSON.stringify(payload));

  assert.equal(canonicalize(payload), '{"evidence":[{"filename":"weather.json"},null],"issuedAt":"2026-09-24T00:00:00.000Z","version":"1.0.0"}');
  assert.equal(canonicalize(payload), canonicalize(received));
  assert.equal(await sha256Json(payload), await sha256Json(received));
});

test("a top-level value that JSON cannot encode is rejected", () => {
  assert.throws(() => canonicalize(undefined), /JSON/);
});
