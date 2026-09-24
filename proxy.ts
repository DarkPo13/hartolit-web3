import { NextResponse } from "next/server";

// Route handlers and server pages perform the authoritative database checks.
export function proxy() {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export const config = {
  matcher: ["/", "/admin/:path*", "/settings/:path*", "/login", "/two-factor", "/forgot-password", "/reset-password"],
};
