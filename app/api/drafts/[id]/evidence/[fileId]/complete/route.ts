import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftActor, draftResponse } from "@/lib/drafts/http";
import { completeEvidence, EvidenceError } from "@/lib/evidence/service";

type Context = { params: Promise<{ id: string; fileId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const actor = await draftActor(request, true);
  if (actor instanceof NextResponse) return actor;
  const { id, fileId } = await context.params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(fileId).success) return draftResponse({ error: "Invalid evidence ID" }, 400);
  try { return draftResponse({ file: await completeEvidence(actor.id, id, fileId) }); }
  catch (error) {
    if (error instanceof EvidenceError) return draftResponse({ error: error.message }, error.status);
    throw error;
  }
}
