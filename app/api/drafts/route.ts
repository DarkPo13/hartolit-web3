import { NextResponse, type NextRequest } from "next/server";
import { createDraft, listDrafts } from "@/lib/drafts/service";
import { draftActor, draftResponse } from "@/lib/drafts/http";

export async function GET(request: NextRequest) {
  const actor = await draftActor(request, false);
  if (actor instanceof NextResponse) return actor;
  return draftResponse({ drafts: await listDrafts(actor.id) });
}

export async function POST(request: NextRequest) {
  const actor = await draftActor(request, true);
  if (actor instanceof NextResponse) return actor;
  return draftResponse({ draft: await createDraft(actor.id) }, 201);
}
