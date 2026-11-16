import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { publicationCancellationSchema } from "@/lib/publication/schema";
import { cancelPreparedPinAttempt } from "@/lib/publication/pinning";

// Cancel a prepared, never-dispatched pin attempt. POST, not DELETE with a body:
// CloudFront's OAC signer hashes only POST/PUT/PATCH bodies, so a DELETE body would be refused (D80).
type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, publicationCancellationSchema);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ attempt: await cancelPreparedPinAttempt(actor.id, id, body.publicationId, body.attemptId) }); }
  catch (error) { return reviewFailure(error); }
}
