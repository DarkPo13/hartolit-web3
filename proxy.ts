import { NextResponse, type NextRequest } from "next/server";

// The browser may also reach private evidence storage (direct presigned uploads)
// and the BSC Testnet RPC used by the publisher wallet session.
function connectSources() {
  const sources = new Set<string>(["'self'"]);
  const add = (value: string | undefined) => { try { if (value) sources.add(new URL(value).origin); } catch { /* not a URL: nothing allowed */ } };
  const endpoint = process.env.EVIDENCE_S3_ENDPOINT;
  if (endpoint) add(endpoint);
  else if (process.env.EVIDENCE_S3_BUCKET && process.env.EVIDENCE_S3_REGION) add(`https://${process.env.EVIDENCE_S3_BUCKET}.s3.${process.env.EVIDENCE_S3_REGION}.amazonaws.com`);
  add(process.env.NEXT_PUBLIC_BSC_TESTNET_RPC || "https://data-seed-prebsc-1-s1.bnbchain.org:8545");
  return [...sources].join(" ");
}

/** Production only: development needs eval and the hot-reload socket, and the demo runs only there. */
function contentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // UI libraries (Radix scroll locking) insert style elements at runtime without a nonce.
    // Styles cannot run code; scripts stay nonce-only.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connectSources()}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(process.env.BETTER_AUTH_URL?.startsWith("https://") ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

// Route handlers and server pages perform the authoritative database checks.
export function proxy(request: NextRequest) {
  const production = process.env.NODE_ENV === "production";
  const nonce = production ? Buffer.from(crypto.randomUUID()).toString("base64") : null;
  const policy = nonce ? contentSecurityPolicy(nonce) : null;
  const requestHeaders = new Headers(request.headers);
  // Next.js applies the policy nonce to its own scripts (set on request and response, as its CSP guide does).
  if (policy && nonce) { requestHeaders.set("x-nonce", nonce); requestHeaders.set("Content-Security-Policy", policy); }
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (policy) response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export const config = {
  // Every page (API routes and build assets excluded).
  matcher: ["/((?!api/|_next/static/|_next/image|favicon.ico|logo.png|.*\\.(?:png|svg|ico|webmanifest|txt)$).*)"],
};
