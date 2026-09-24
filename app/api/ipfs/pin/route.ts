import { NextResponse, type NextRequest } from "next/server";
import { pinJson } from "@/lib/ipfs";
import { DEMO_WRITE_UNAVAILABLE, isDemoMode } from "@/lib/demo-mode";
import { requireWriteAccess } from "@/lib/auth-guard";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const denied = await requireWriteAccess(req);
  if (denied) return denied;

  if (!isDemoMode()) {
    return NextResponse.json({ error: DEMO_WRITE_UNAVAILABLE }, { status: 503 });
  }

  try {
    const { value, name } = (await req.json()) as { value: unknown; name?: string };
    if (value === undefined || value === null) {
      return NextResponse.json({ error: "Field 'value' is required" }, { status: 400 });
    }
    const result = await pinJson(value, name ?? `hartolit-${Date.now()}`);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[ipfs/pin] error:", e);
    const msg = e instanceof Error ? e.message : "IPFS pin failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
