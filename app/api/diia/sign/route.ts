import { NextResponse, type NextRequest } from "next/server";
import { signWithDiia } from "@/lib/diia";
import type { DiiaSignRequest } from "@/types/diia";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DiiaSignRequest;
    if (!body.role || !body.documentSha256 || !body.documentFilename || !body.signerName) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    const session = await signWithDiia(body);
    return NextResponse.json(session);
  } catch (e) {
    console.error("[diia/sign] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Diia sign failed" },
      { status: 500 },
    );
  }
}
