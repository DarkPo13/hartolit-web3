import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { assignSchema } from "@/lib/review/schema";
import { assignReview } from "@/lib/review/service";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, assignSchema);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ passport: await assignReview(actor.id, id, body.version, body.reviewerId) }); }
  catch (error) { return reviewFailure(error); }
}
