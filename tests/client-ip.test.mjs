import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createJiti } from "jiti";

// Better Auth answers 127.0.0.1 for an unknown address in development and test; production
// answers null (one shared bucket per path). It reads NODE_ENV when its module loads.
process.env.NODE_ENV = "production";
delete process.env.TEST;
const { getIP } = await import("@better-auth/core/utils/ip");
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { clientIpAddressOptions, CLOUDFRONT_CLIENT_IP_HEADER, CLOUDFRONT_CLIENT_IP_INJECTION } = await jiti.import("../lib/client-ip.ts");

const loopback = "http://127.0.0.1:3000", hosted = "https://staging.example.invalid";
const cloudfront = { advanced: { ipAddress: clientIpAddressOptions(hosted, { HARTOLIT_CLIENT_IP_SOURCE: "cloudfront" }) } };
const local = { advanced: { ipAddress: clientIpAddressOptions(loopback, {}) } };
const ipOf = (options, headers) => getIP(new Request("https://staging.example.invalid/api/auth/sign-in/email", { method: "POST", headers }), options);
const viaCloudFront = (ip, extra = {}) => ipOf(cloudfront, { [CLOUDFRONT_CLIENT_IP_HEADER]: ip, ...extra });

test("the source setting fails closed on hosted servers and AWS Lambda", () => {
  assert.deepEqual(clientIpAddressOptions(hosted, { HARTOLIT_CLIENT_IP_SOURCE: "cloudfront" }), { ipAddressHeaders: ["x-hartolit-client-ip"], ipv6Subnet: 64 });
  assert.deepEqual(clientIpAddressOptions(hosted, { HARTOLIT_CLIENT_IP_SOURCE: " cloudfront ", AWS_LAMBDA_FUNCTION_NAME: "server" }).ipAddressHeaders, ["x-hartolit-client-ip"]);
  for (const base of [loopback, "http://localhost:3000", "http://[::1]:3000", "https://localhost:3443"]) {
    assert.deepEqual(clientIpAddressOptions(base, {}), { ipAddressHeaders: ["x-forwarded-for"], ipv6Subnet: 64 }, base);
    assert.deepEqual(clientIpAddressOptions(base, { HARTOLIT_CLIENT_IP_SOURCE: "" }).ipAddressHeaders, ["x-forwarded-for"], `${base}, blank`);
  }
  assert.deepEqual(clientIpAddressOptions(hosted, { HARTOLIT_CLIENT_IP_SOURCE: "forwarded-for" }).ipAddressHeaders, ["x-forwarded-for"], "explicit proxy that overwrites the header");
  for (const base of [hosted, "http://192.0.2.20:3000", "http://localhost.example.invalid", "not a url"]) {
    assert.throws(() => clientIpAddressOptions(base, {}), /HARTOLIT_CLIENT_IP_SOURCE/, `${base} without a source`);
  }
  for (const source of ["forwarded-for", ""]) {
    assert.throws(() => clientIpAddressOptions(loopback, { HARTOLIT_CLIENT_IP_SOURCE: source, AWS_LAMBDA_FUNCTION_NAME: "server" }), /AWS Lambda/, `Lambda with "${source}"`);
  }
  for (const source of ["CloudFront", "x-hartolit-client-ip", "x-forwarded-for", "true", "none"]) {
    assert.throws(() => clientIpAddressOptions(loopback, { HARTOLIT_CLIENT_IP_SOURCE: source }), /must be/, source);
  }
});

test("behind CloudFront each client address is its own key and forwarded headers cannot choose it", () => {
  assert.equal(viaCloudFront("198.51.100.7"), "198.51.100.7");
  assert.notEqual(viaCloudFront("198.51.100.7"), viaCloudFront("198.51.100.8"), "different clients, independent limits");
  // A client can send any X-Forwarded-For and any other IP header; only CloudFront's header counts.
  for (const spoof of ["203.0.113.9", "203.0.113.9, 198.51.100.7", "127.0.0.1"]) {
    assert.equal(viaCloudFront("198.51.100.7", { "x-forwarded-for": spoof, "x-real-ip": spoof, "cf-connecting-ip": spoof }), "198.51.100.7", spoof);
    assert.equal(ipOf(cloudfront, { "x-forwarded-for": spoof, "x-real-ip": spoof }), null, `${spoof} without CloudFront's header`);
  }
  // Values CloudFront never writes give no address; Better Auth then uses its one shared bucket.
  for (const bad of ["", " ", "198.51.100.7, 203.0.113.9", "198.51.100.7:443", "[2001:db8::1]", "not-an-ip", "198.51.100.300", "unknown"]) {
    assert.equal(viaCloudFront(bad), null, JSON.stringify(bad));
  }
  assert.equal(viaCloudFront("::ffff:198.51.100.7"), "198.51.100.7", "IPv4-mapped IPv6 is the same IPv4 client");
});

test("IPv6 clients are counted per /64, so rotating inside one allocation does not reset the limit", () => {
  const a = viaCloudFront("2001:db8:aa:1::1"), sameNetwork = viaCloudFront("2001:DB8:AA:1:ffff:ffff:ffff:ffff"), other = viaCloudFront("2001:db8:aa:2::1");
  assert.equal(a, "2001:0db8:00aa:0001:0000:0000:0000:0000");
  assert.equal(sameNetwork, a);
  assert.notEqual(other, a);
});

test("the local mode keeps today's single-value X-Forwarded-For for loopback development", () => {
  assert.equal(ipOf(local, { "x-forwarded-for": "198.18.0.5" }), "198.18.0.5");
  assert.equal(ipOf(local, { "x-forwarded-for": "198.18.0.5, 198.18.0.6" }), null);
  assert.equal(ipOf(local, { [CLOUDFRONT_CLIENT_IP_HEADER]: "198.18.0.5" }), null, "CloudFront's header means nothing outside the cloudfront source");
});

test("the CloudFront Function injection overwrites whatever the viewer sent", () => {
  assert.equal(CLOUDFRONT_CLIENT_IP_INJECTION, 'event.request.headers["x-hartolit-client-ip"] = { value: event.viewer.ip };');
  const run = new Function("event", CLOUDFRONT_CLIENT_IP_INJECTION);
  for (const sent of [undefined, { value: "203.0.113.9" }, { value: "203.0.113.9", multiValue: [{ value: "203.0.113.9" }, { value: "203.0.113.10" }] }]) {
    const event = { viewer: { ip: "2001:db8::7" }, request: { headers: { host: { value: "staging.example.invalid" }, ...(sent ? { [CLOUDFRONT_CLIENT_IP_HEADER]: sent } : {}) } } };
    run(event);
    assert.deepEqual(event.request.headers[CLOUDFRONT_CLIENT_IP_HEADER], { value: "2001:db8::7" }, JSON.stringify(sent));
    assert.deepEqual(event.request.headers.host, { value: "staging.example.invalid" });
  }
});
