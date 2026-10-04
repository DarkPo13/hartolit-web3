import assert from "node:assert/strict";

const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const [api, page] = await Promise.all([
  fetch(new URL("/api/passport/1", origin)),
  fetch(new URL("/verify/1", origin)),
]);

assert.equal(api.status, 503, "the legacy public payload API must be unavailable in production");
assert.equal(page.status, 404, "the legacy public verifier must be unavailable in production");
process.stdout.write("Public boundary passed: legacy payload and verifier are unavailable in production.\n");
