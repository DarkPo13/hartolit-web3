import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { EvidenceError, previewReviewEvidence } from "@/lib/evidence/service";
import { reviewActor } from "@/lib/review/http";

type Context = { params: Promise<{ id: string; fileId: string }> };
export async function GET(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, false);
  if (actor instanceof NextResponse) return actor;
  const { id, fileId } = await context.params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(fileId).success) return draftResponse({ error: "Invalid evidence ID" }, 400);
  try { const { url } = await previewReviewEvidence(id, fileId, actor.id); return NextResponse.redirect(url, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } }); }
  catch (error) { if (error instanceof EvidenceError) return draftResponse({ error: error.message }, error.status); throw error; }
}
