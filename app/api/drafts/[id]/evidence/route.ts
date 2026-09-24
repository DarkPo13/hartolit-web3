import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftActor, draftResponse, readLimitedJson } from "@/lib/drafts/http";
import { EvidenceError, listEvidence, reserveEvidence } from "@/lib/evidence/service";
import { reserveSchema, validFileDeclaration } from "@/lib/evidence/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const actor = await draftActor(request, false);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid draft ID" }, 400);
  try { return draftResponse({ files: await listEvidence(actor.id, id) }); }
  catch (error) { return failure(error); }
}

export async function POST(request: NextRequest, context: Context) {
  const actor = await draftActor(request, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid draft ID" }, 400);
  let body: unknown;
  try { body = await readLimitedJson(request); }
  catch { return draftResponse({ error: "Invalid JSON body" }, 400); }
  const parsed = reserveSchema.safeParse(body);
  if (!parsed.success || !validFileDeclaration(parsed.data.filename, parsed.data.contentType)) return draftResponse({ error: "Invalid evidence file declaration" }, 400);
  try { return draftResponse(await reserveEvidence(actor.id, id, parsed.data), 201); }
  catch (error) { return failure(error); }
}

function failure(error: unknown) {
  if (error instanceof EvidenceError) return draftResponse({ error: error.message }, error.status);
  throw error;
}
