import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { publicationPreparationSchema } from "@/lib/publication/schema";
import { preparePinAttempt } from "@/lib/publication/pinning";
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

// Cancellation is POST .../pin-attempts/cancel (D80); DELETE answers 405.
