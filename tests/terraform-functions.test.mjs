// Runs the code Terraform deploys to CloudFront and Lambda, with the platform replaced by
// small stand-ins: no AWS. Real CloudFront, Lambda@Edge and SSM remain staging checks.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { CLOUDFRONT_CLIENT_IP_INJECTION } = await jiti.import("../lib/client-ip.ts");
// scripts/terraform-mutations.mjs points this at a copy with one protection removed.
const FUNCTIONS = process.env.HARTOLIT_TF_FUNCTIONS ?? "infra/terraform/modules/opennext-site/functions";
const viewerSource = fs.readFileSync(`${FUNCTIONS}/viewer-request.js`, "utf8");
const context = vm.createContext({ require: (name) => { assert.equal(name, "crypto"); return crypto; }, encodeURIComponent });
vm.runInContext(viewerSource, context);
const viewer = (event) => JSON.parse(JSON.stringify(context.handler(event)));
const { handler: signer } = await import(pathToFileURL(path.resolve(`${FUNCTIONS}/edge-signer/index.mjs`)));
const { handler: placeholder } = await import(pathToFileURL(path.resolve(`${FUNCTIONS}/placeholder.mjs`)));
const { loadSecretParameters } = await import(pathToFileURL(path.resolve(`${FUNCTIONS}/server-entry/hartolit-secrets.mjs`)));

const viewerEvent = (headers = {}, extra = {}) => ({
  viewer: { ip: "203.0.113.9" },
  request: { method: "GET", uri: "/", querystring: {}, cookies: {}, headers: { host: { value: "dfictional.cloudfront.net" }, ...headers }, ...extra },
});
const edgeEvent = (request) => ({ Records: [{ cf: { request: { headers: {}, ...request } } }] });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("the viewer function carries the exact client IP line from lib/client-ip.ts and fits CloudFront's limit", () => {
  assert.ok(viewerSource.includes(CLOUDFRONT_CLIENT_IP_INJECTION));
  assert.ok(Buffer.byteLength(viewerSource) < 10240);
});

test("a viewer cannot choose its client IP, even with a duplicate header", () => {
  const result = viewer(viewerEvent({ "x-hartolit-client-ip": { value: "198.51.100.1", multiValue: [{ value: "198.51.100.1" }, { value: "198.51.100.2" }] } }));
  assert.deepEqual(result.headers["x-hartolit-client-ip"], { value: "203.0.113.9", multiValue: [{ value: "203.0.113.9" }] });
});

test("signature and location headers sent by a viewer are removed", () => {
  const names = ["x-amz-content-sha256", "x-amz-date", "x-amz-security-token", "x-open-next-city", "x-open-next-country", "x-open-next-region", "x-open-next-latitude", "x-open-next-longitude"];
  const result = viewer(viewerEvent(Object.fromEntries(names.map((name) => [name, { value: "forged" }]))));
  for (const name of names) assert.equal(result.headers[name], undefined, name);
});

test("forwarded host and cache key are written by CloudFront, not the viewer", () => {
  const result = viewer(viewerEvent({ "x-forwarded-host": { value: "evil.example.invalid" }, "x-open-next-cache-key": { value: "forged" }, rsc: { value: "1" } }));
  assert.deepEqual(result.headers["x-forwarded-host"], { value: "dfictional.cloudfront.net" });
  assert.equal(result.headers["x-open-next-cache-key"].value, createHash("md5").update("1").digest("hex"));
});

test("the image cache key depends only on Accept", () => {
  const event = (accept, rsc) => viewerEvent({ accept: { value: accept }, rsc: { value: rsc } }, { uri: "/_next/image" });
  assert.equal(viewer(event("image/webp", "1")).headers["x-open-next-cache-key"].value, viewer(event("image/webp", "2")).headers["x-open-next-cache-key"].value);
  assert.notEqual(viewer(event("image/webp", "1")).headers["x-open-next-cache-key"].value, viewer(event("image/avif", "1")).headers["x-open-next-cache-key"].value);
});

test("a query key with a slash is encoded", () => {
  const result = viewer(viewerEvent({}, { querystring: { "/action": { value: "1" } } }));
  assert.deepEqual(result.querystring, { "%2Faction": { value: "1" } });
});

test("oversized headers get an uncached 431 and normal ones pass", () => {
  const large = viewer(viewerEvent({}, { cookies: { session: { value: "x".repeat(10000) } } }));
  assert.equal(large.statusCode, 431);
  assert.equal(large.headers["cache-control"].value, "no-store");
  assert.equal(viewer(viewerEvent()).statusCode, undefined);
});

test("the signer hashes exact body bytes for POST, PUT and PATCH", async () => {
  const bytes = Buffer.from([0, 255, 1, 128, 10]);
  for (const method of ["POST", "PUT", "PATCH"]) {
    const result = await signer(edgeEvent({ method, body: { data: bytes.toString("base64"), encoding: "base64", inputTruncated: false } }));
    assert.deepEqual(result.headers["x-amz-content-sha256"], [{ key: "x-amz-content-sha256", value: sha256(bytes) }], method);
    assert.equal(result.body.data, bytes.toString("base64"), "the body is unchanged");
  }
});

test("the signer replaces a forged hash and hashes an empty body", async () => {
  const result = await signer(edgeEvent({ method: "POST", headers: { "x-amz-content-sha256": [{ key: "x-amz-content-sha256", value: "forged" }] }, body: { data: "", encoding: "base64", inputTruncated: false } }));
  assert.equal(result.headers["x-amz-content-sha256"][0].value, sha256(""));
});

test("the signer refuses a truncated body and an unknown encoding", async () => {
  const truncated = await signer(edgeEvent({ method: "POST", body: { data: "AAAA", encoding: "base64", inputTruncated: true } }));
  assert.equal(truncated.status, "413");
  assert.equal(truncated.headers["cache-control"][0].value, "no-store");
  assert.equal((await signer(edgeEvent({ method: "POST", body: { data: "AAAA", encoding: "gzip", inputTruncated: false } }))).status, "400");
});

test("the signer leaves requests without a body alone", async () => {
  for (const method of ["GET", "HEAD", "OPTIONS", "DELETE"]) {
    const result = await signer(edgeEvent({ method }));
    assert.equal(result.headers["x-amz-content-sha256"], undefined, method);
  }
});

test("the placeholder answers 503 on the web and fails queue events", async () => {
  const response = await placeholder({ requestContext: { http: { method: "GET" } } });
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers["cache-control"], "no-store");
  await assert.rejects(placeholder({ Records: [{ body: "{}" }] }), /not deployed/);
});

const SPEC = JSON.stringify({ DATABASE_URL: "/hartolit/staging/database-url", BETTER_AUTH_URL: "/hartolit/staging/site-url", NEXT_PUBLIC_APP_URL: "/hartolit/staging/site-url" });
const answer = { Parameters: [{ Name: "/hartolit/staging/database-url", Value: "fictional-database-value" }, { Name: "/hartolit/staging/site-url", Value: "https://dfictional.cloudfront.net" }], InvalidParameters: [] };

test("the entry loads every parameter once and removes its own setting", async () => {
  const env = { HARTOLIT_SECRET_PARAMETERS: SPEC };
  let asked;
  await loadSecretParameters(env, async (names) => { asked = names; return answer; });
  assert.deepEqual(asked, ["/hartolit/staging/database-url", "/hartolit/staging/site-url"]);
  assert.deepEqual(env, { DATABASE_URL: "fictional-database-value", BETTER_AUTH_URL: "https://dfictional.cloudfront.net", NEXT_PUBLIC_APP_URL: "https://dfictional.cloudfront.net" });
});

test("the entry stops on a missing, empty or invalid parameter without printing a value", async () => {
  const cases = [
    { ...answer, InvalidParameters: ["/hartolit/staging/site-url"] },
    { Parameters: [answer.Parameters[0]], InvalidParameters: [] },
    { Parameters: [{ ...answer.Parameters[0], Value: "" }, answer.Parameters[1]], InvalidParameters: [] },
  ];
  for (const result of cases) {
    const env = { HARTOLIT_SECRET_PARAMETERS: SPEC };
    await assert.rejects(loadSecretParameters(env, async () => result), (error) => !error.message.includes("fictional-database-value"));
    assert.equal(env.DATABASE_URL, undefined, "nothing is set after a failure");
  }
  for (const bad of [undefined, "not json", "[]", "{}"]) {
    await assert.rejects(loadSecretParameters({ HARTOLIT_SECRET_PARAMETERS: bad }, async () => answer));
  }
});

test("the entry refuses another application's parameter before calling SSM", async () => {
  let called = false;
  const env = { HARTOLIT_SECRET_PARAMETERS: JSON.stringify({ DATABASE_URL: "/other/app/secret" }) };
  const readEverything = async (names) => { called = true; return { Parameters: names.map((Name) => ({ Name, Value: "fictional-other-value" })), InvalidParameters: [] }; };
  await assert.rejects(loadSecretParameters(env, readEverything), /invalid entry for DATABASE_URL/);
  assert.equal(called, false);
  assert.equal(env.DATABASE_URL, undefined);
});

test("the entry loads secrets before the application module", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hartolit-entry-"));
  try {
    for (const file of ["hartolit-entry.mjs", "hartolit-secrets.mjs"]) fs.copyFileSync(`${FUNCTIONS}/server-entry/${file}`, path.join(dir, file));
    const sdk = path.join(dir, "node_modules/@aws-sdk/client-ssm");
    fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, "package.json"), JSON.stringify({ name: "@aws-sdk/client-ssm", type: "module", exports: "./index.js" }));
    fs.writeFileSync(path.join(sdk, "index.js"), `export class GetParametersCommand { constructor(input) { this.input = input; } }
export class SSMClient { async send(command) { if (command.input.WithDecryption !== true) throw new Error("decryption was not requested"); return { Parameters: [{ Name: "/hartolit/staging/database-url", Value: "fictional-database-value" }], InvalidParameters: [] }; } }`);
    fs.writeFileSync(path.join(dir, "index.mjs"), "export const seenAtImport = process.env.DATABASE_URL; export const handler = async () => seenAtImport;");
    const saved = { spec: process.env.HARTOLIT_SECRET_PARAMETERS, url: process.env.DATABASE_URL };
    process.env.HARTOLIT_SECRET_PARAMETERS = JSON.stringify({ DATABASE_URL: "/hartolit/staging/database-url" });
    delete process.env.DATABASE_URL;
    try {
      const entry = await import(pathToFileURL(path.join(dir, "hartolit-entry.mjs")));
      assert.equal(await entry.handler(), "fictional-database-value");
    } finally {
      if (saved.spec === undefined) delete process.env.HARTOLIT_SECRET_PARAMETERS; else process.env.HARTOLIT_SECRET_PARAMETERS = saved.spec;
      if (saved.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.url;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
