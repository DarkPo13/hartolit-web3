import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { publicationCorrectionSchema } from "@/lib/publication/schema";
import { getPublicationCorrection, openPublicationCorrection } from "@/lib/publication/correction";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, false, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  try { return draftResponse(await getPublicationCorrection(id)); }
  catch (error) { return reviewFailure(error); }
}

export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, publicationCorrectionSchema);
  if (body instanceof NextResponse) return body;
  try {
    const result = await openPublicationCorrection(actor.id, id, body);
    return draftResponse({ correction: result }, result.status === "OPENED" ? 201 : 200);
  } catch (error) { return reviewFailure(error); }
}
