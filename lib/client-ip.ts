// Where Better Auth reads the client IP that its rate limits (sign-in, TOTP, recovery
// codes, password reset) count by (D78). Resolved once at startup. A setting that would
// trust a header the client can write on a hosted server stops the server instead.
// No imports, so the infrastructure configuration can reuse the constants below.

/** Request header that the CloudFront viewer-request function sets for the origin. */
export const CLOUDFRONT_CLIENT_IP_HEADER = "x-hartolit-client-ip";

/**
 * CloudFront Function code for SST `edge.viewerRequest.injection`. `event.viewer.ip` is
 * the address of whoever opened the connection to CloudFront. CloudFront Functions keep
 * a viewer's duplicate headers unless the function changes the `multiValue` array, so
 * the code sets both: the origin receives exactly one value, CloudFront's. Should a
 * duplicate still arrive, the origin sees two values, which Better Auth does not accept
 * as an IP (the shared bucket below), so a viewer still cannot choose its own address.
 * Trusting the header also needs the Lambda origin to refuse requests that did not come
 * through this distribution (SST `protection: "oac-with-edge-signing"`).
 */
export const CLOUDFRONT_CLIENT_IP_INJECTION =
  `event.request.headers["${CLOUDFRONT_CLIENT_IP_HEADER}"] = { value: event.viewer.ip, multiValue: [{ value: event.viewer.ip }] };`;

export type ClientIpAddressOptions = { ipAddressHeaders: string[]; ipv6Subnet: number };

// One IPv6 customer usually gets a whole /64, so it counts as one client (Better Auth's default).
const IPV6_SUBNET = 64;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * `HARTOLIT_CLIENT_IP_SOURCE`:
 * - `cloudfront`: only the header above. Anything else (X-Forwarded-For included) is
 *   ignored; a missing or malformed value gives no IP, and Better Auth then counts those
 *   requests in one shared bucket per path, so they are still limited.
 * - `forwarded-for`: a single-value X-Forwarded-For, for a server behind a proxy that
 *   overwrites that header with the address it saw. Never on AWS Lambda.
 * - unset: the same as `forwarded-for`, allowed only when the app's URL is loopback
 *   (local development, CI, smokes). Next.js keeps an X-Forwarded-For sent by the client,
 *   so a server reachable from other machines must not use it.
 */
export function clientIpAddressOptions(baseURL: string, env: Record<string, string | undefined> = process.env): ClientIpAddressOptions {
  const source = env.HARTOLIT_CLIENT_IP_SOURCE?.trim() ?? "";
  if (source === "cloudfront") return { ipAddressHeaders: [CLOUDFRONT_CLIENT_IP_HEADER], ipv6Subnet: IPV6_SUBNET };
  if (source && source !== "forwarded-for") throw new Error('HARTOLIT_CLIENT_IP_SOURCE must be "cloudfront", "forwarded-for" or unset');
  if (env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error("On AWS Lambda set HARTOLIT_CLIENT_IP_SOURCE=cloudfront; X-Forwarded-For is not a trusted client IP there");
  }
  if (!source && !isLoopback(baseURL)) {
    throw new Error("Set HARTOLIT_CLIENT_IP_SOURCE for a server reachable from other machines; X-Forwarded-For alone can be written by any client");
  }
  return { ipAddressHeaders: ["x-forwarded-for"], ipv6Subnet: IPV6_SUBNET };
}

function isLoopback(baseURL: string): boolean {
  try { return LOOPBACK_HOSTS.has(new URL(baseURL).hostname); } catch { return false; }
}
