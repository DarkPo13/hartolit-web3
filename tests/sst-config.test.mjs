// Checks what sst.config.ts asks SST for (D79), with SST's globals replaced by recorders:
// no SST CLI, no `.sst/platform`, no AWS. What SST then builds from these arguments was
// read from the SST 4.17.2 platform source and is listed in PROGRESS (2026-11-16).
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/") } });
const { CLOUDFRONT_CLIENT_IP_INJECTION } = await jiti.import("../lib/client-ip.ts");

const { isPasswordResetAvailable } = await jiti.import("../lib/reset-email.ts");

let created;
globalThis.$config = (config) => config;
// Every `sst.aws.<Component>` the config touches is recorded, so a VPC, an Aurora cluster, a
// container service or anything else added later shows up here. Pulumi's raw `aws` global is
// not defined at all: a config that reached for `aws.ec2` or `aws.rds` would throw.
globalThis.sst = {
  Secret: class { constructor(name) { this.value = `<secret ${name}>`; } },
  aws: new Proxy({}, { get: (_, type) => class { constructor(name, args) { created.push({ type, name, args }); this.url = "https://d0000000000000.cloudfront.net"; } } }),
};
const config = (await jiti.import("../sst.config.ts")).default;

async function runIn(stage, files = [], env = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hartolit-sst-"));
  for (const file of files) fs.writeFileSync(path.join(root, file), "FICTIONAL=1\n");
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (key.startsWith("NEXT_PUBLIC_")) delete process.env[key];
  Object.assign(process.env, env);
  globalThis.$app = { stage }; globalThis.$cli = { paths: { root } }; created = [];
  try { return { output: await config.run(), created }; }
  finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("the app is pinned to SST 4.17.2 and the AWS provider 7.20.0 in eu-central-1", () => {
  const app = config.app({ stage: "staging" });
  assert.equal(app.name, "hartolit-field-passport");
  assert.equal(app.home, "aws");
  assert.equal(app.version, "4.17.2");
  assert.equal(app.removal, "remove");
  assert.equal(app.protect, false);
  assert.deepEqual(Object.keys(app.providers), ["aws"]);
  assert.equal(app.providers.aws.version, "7.20.0");
  assert.equal(app.providers.aws.region, "eu-central-1");
  assert.deepEqual(app.providers.aws.defaultTags, { tags: { Project: "hartolit-field-passport", Stage: "staging" } });
});

test("staging is one Next.js site with OAC, the CloudFront client IP and nothing that runs while idle", async () => {
  const { output, created } = await runIn("staging");
  assert.deepEqual(created.map(item => item.type), ["Nextjs"], "the only component is the Next.js site: no VPC, Aurora, cluster or service");
  const { name, args } = created[0];
  assert.equal(name, "Web");
  assert.deepEqual(output, { url: "https://d0000000000000.cloudfront.net" });
  assert.equal(args.openNextVersion, "4.1.16");
  assert.deepEqual(args.regions, ["eu-central-1"]);
  assert.equal(args.warm, 0);
  assert.equal(args.protection, "oac-with-edge-signing");
  assert.deepEqual(args.edge, { viewerRequest: { injection: CLOUDFRONT_CLIENT_IP_INJECTION } });
  assert.deepEqual(args.server, { runtime: "nodejs24.x", architecture: "arm64", memory: "1024 MB", timeout: "60 seconds" });
  assert.deepEqual(args.imageOptimization, { memory: "512 MB" });
  assert.deepEqual(args.invalidation, { paths: "all", wait: false });
  // No VPC (so no NAT gateway), no shared Router, no custom domain, no linked resources.
  for (const absent of ["vpc", "router", "route", "domain", "link", "permissions", "cachePolicy", "dev", "buildCommand"]) assert.equal(args[absent], undefined, absent);
  for (const fn of ["server", "revalidationEventsSubscriber", "revalidationSeeder"]) assert.deepEqual(args.transform[fn], { logging: { retention: "1 week" } }, fn);
  const cdnArgs = { transform: {} }; args.transform.cdn(cdnArgs);
  const distribution = {}; cdnArgs.transform.distribution(distribution);
  assert.deepEqual(distribution, { priceClass: "PriceClass_100" });
});

test("variables: the client IP source for build and runtime, secrets only from SST, no stray public values", async () => {
  const { created: [{ args }] } = await runIn("staging");
  assert.deepEqual(args.environment, {
    HARTOLIT_CLIENT_IP_SOURCE: "cloudfront",
    DATABASE_URL: "<secret DatabaseUrl>",
    DATABASE_POOL_MAX: "3",
    BETTER_AUTH_SECRET: "<secret BetterAuthSecret>",
    BETTER_AUTH_URL: "<secret SiteUrl>",
    NEXT_PUBLIC_APP_URL: "<secret SiteUrl>",
    NEXT_PUBLIC_CHAIN_ID: "97",
    NEXT_PUBLIC_CONTRACT_ADDRESS: "",
    NEXT_PUBLIC_DEMO_MODE: "false",
    NEXT_TELEMETRY_DISABLED: "1",
  });
  // No mail on staging: with these values on Lambda, password reset and invitations answer 503 (D81).
  assert.ok(!Object.keys(args.environment).some(key => key.startsWith("SMTP_") || key === "HARTOLIT_PASSWORD_RESET_WORKER"), "no mail settings");
  assert.equal(isPasswordResetAvailable({ ...args.environment, AWS_LAMBDA_FUNCTION_NAME: "fictional-server" }), false, "reset stays off on the staging Lambda");
  const source = fs.readFileSync("sst.config.ts", "utf8");
  assert.doesNotMatch(source, /postgres(ql)?:\/\/|AKIA[0-9A-Z]{12,}|-----BEGIN/, "no connection string, access key or private key in the config");
});

test("the config refuses other stages, local env files and public variables from the deploying shell", async () => {
  for (const stage of ["production", "dev", "personal", ""]) await assert.rejects(runIn(stage), /Only the "staging" stage/, stage);
  for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) await assert.rejects(runIn("staging", [file]), /clean checkout/, file);
  await runIn("staging", [".env.local.example", ".env.db.local"]); // not read by next build
  await assert.rejects(runIn("staging", [], { NEXT_PUBLIC_BSC_TESTNET_RPC: "https://rpc.example.invalid" }), /Unset NEXT_PUBLIC_BSC_TESTNET_RPC/);
  await runIn("staging", [], { NEXT_PUBLIC_CHAIN_ID: "97" }); // set by the config anyway
});
