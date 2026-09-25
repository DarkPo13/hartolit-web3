import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getActor } from "@/lib/auth-guard";
import { isResetEmailConfigured } from "@/lib/reset-email";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

const handler = toNextJsHandler(auth);

async function guardAdminRoute(request: NextRequest): Promise<NextResponse | null> {
  if (request.nextUrl.pathname === "/api/auth/request-password-reset" && !isResetEmailConfigured()) {
    return NextResponse.json({ error: "Password reset is not configured" }, { status: 503 });
  }
  if (!request.nextUrl.pathname.startsWith("/api/auth/admin/")) return null;
  const allowed = new Set([
    "GET /api/auth/admin/list-users",
  ]);
  if (!allowed.has(`${request.method} ${request.nextUrl.pathname}`)) {
    return NextResponse.json({ error: "This admin operation is not available yet" }, { status: 404 });
  }
  const actor = await getActor(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "admin" || !actor.twoFactorEnabled) {
    return NextResponse.json({ error: "Admin access requires two-factor authentication" }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  return (await guardAdminRoute(request)) ?? handler.GET(request);
}

export async function POST(request: NextRequest) {
  const denied = await guardAdminRoute(request);
  if (denied) return denied;
  const enrollment = request.nextUrl.pathname === "/api/auth/two-factor/verify-totp"
    ? await getActor(request.headers)
    : null;
  const response = await handler.POST(request);
  if (enrollment && !enrollment.twoFactorEnabled && response.status === 200) {
    const user = await getDb().user.findUnique({ where: { id: enrollment.id }, select: { twoFactorEnabled: true } });
    if (user?.twoFactorEnabled) {
      // Enrollment rotates the current cookie. Expire every earlier session,
      // including that new cookie, so the next login proves both factors.
      await getDb().session.deleteMany({ where: { userId: enrollment.id } });
    }
  }
  return response;
}
