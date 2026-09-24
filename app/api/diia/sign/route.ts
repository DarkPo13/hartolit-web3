import { NextResponse, type NextRequest } from "next/server";
import { requireWriteAccess } from "@/lib/auth-guard";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = await requireWriteAccess(request);
  if (denied) return denied;

  return NextResponse.json(
    { error: "Diia signing is deferred until after the core MVP infrastructure is released" },
    { status: 501 },
  );
}
