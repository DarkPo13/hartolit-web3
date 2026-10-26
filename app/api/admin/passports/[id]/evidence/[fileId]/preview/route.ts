import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse, unexpectedFailure } from "@/lib/drafts/http";
import { EvidenceError } from "@/lib/evidence/service";
import { previewAdminEvidence } from "@/lib/evidence/access";
import { reviewActor } from "@/lib/review/http";

type Context = { params: Promise<{ id: string; fileId: string }> };
export async function GET(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, false, true);
  if (actor instanceof NextResponse) return actor;
  const { id, fileId } = await context.params;
  const grantId = request.nextUrl.searchParams.get("grantId");
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(fileId).success || (grantId !== null && !z.uuid().safeParse(grantId).success)) {
    return draftResponse({ error: "Invalid evidence ID" }, 400);
  }
  try { const { url } = await previewAdminEvidence(actor.id, id, fileId, grantId); return NextResponse.redirect(url, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } }); }
  catch (error) { if (error instanceof EvidenceError) return draftResponse({ error: error.message }, error.status); return unexpectedFailure(error); }
}
