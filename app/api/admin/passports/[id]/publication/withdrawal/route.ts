import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { publicationWithdrawalSchema } from "@/lib/publication/schema";
import { withdrawUnmintedPublication } from "@/lib/publication/withdrawal";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, publicationWithdrawalSchema);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ withdrawal: await withdrawUnmintedPublication(actor.id, id, body) }); }
  catch (error) { return reviewFailure(error); }
}
