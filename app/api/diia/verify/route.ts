import { NextResponse, type NextRequest } from "next/server";
import { verifyDiiaSignature } from "@/lib/diia";
import type { DiiaVerifyRequest } from "@/types/diia";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DiiaVerifyRequest;
    if (!body.sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }
    const result = await verifyDiiaSignature(body);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[diia/verify] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Diia verify failed" },
      { status: 500 },
    );
  }
}
