import "server-only";

import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export type Actor = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  twoFactorEnabled: boolean;
};

export async function getActor(requestHeaders?: Headers): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers: requestHeaders ?? (await headers()) });
  if (!session?.user?.id) return null;

  // Always use current database state so a ban or role removal applies immediately.
  const user = await getDb().user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, banned: true, twoFactorEnabled: true },
  });
  if (!user || user.banned) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role === "admin" ? "admin" : "user",
    twoFactorEnabled: user.twoFactorEnabled === true,
  };
}

export async function requireWriteAccess(
  request: NextRequest,
  role: "user" | "admin" = "user",
): Promise<NextResponse | null> {
  const actor = await getActor(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (role === "admin" && (actor.role !== "admin" || !actor.twoFactorEnabled)) {
    return NextResponse.json({ error: "Admin access requires two-factor authentication" }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  }
  return null;
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const expected = process.env.BETTER_AUTH_URL ?? request.nextUrl.origin;
    return new URL(origin).origin === new URL(expected).origin;
  } catch {
    return false;
  }
}
