import { NextResponse, type NextRequest } from "next/server";
import { pinJson } from "@/lib/ipfs";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
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
