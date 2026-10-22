import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { publicationCancellationSchema, publicationPreparationSchema } from "@/lib/publication/schema";
import { cancelPreparedPinAttempt, preparePinAttempt } from "@/lib/publication/pinning";
import { preparationTarget } from "@/lib/publication/preparation";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, publicationPreparationSchema);
  if (body instanceof NextResponse) return body;
  try {
    const result = await preparePinAttempt(actor.id, id, body, await preparationTarget());
    return draftResponse({ attempt: result.attempt }, result.created ? 201 : 200);
  } catch (error) { return reviewFailure(error); }
}

export async function DELETE(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, publicationCancellationSchema);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ attempt: await cancelPreparedPinAttempt(actor.id, id, body.publicationId, body.attemptId) }); }
  catch (error) { return reviewFailure(error); }
}
