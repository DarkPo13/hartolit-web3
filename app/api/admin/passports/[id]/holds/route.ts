import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { listHolds, placeHold, placeHoldSchema, releaseHold, releaseHoldSchema } from "@/lib/retention/holds";

type Context = { params: Promise<{ id: string }> };
async function passportId(context: Context) {
  const { id } = await context.params;
  return z.uuid().safeParse(id).success ? id : null;
}

export async function GET(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, false, true);
  if (actor instanceof NextResponse) return actor;
  const id = await passportId(context);
  if (!id) return draftResponse({ error: "Invalid passport ID" }, 400);
  try { return draftResponse({ holds: await listHolds(id) }); } catch (error) { return reviewFailure(error); }
}

export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const id = await passportId(context);
  if (!id) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, placeHoldSchema);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ hold: await placeHold(actor.id, id, body) }, 201); } catch (error) { return reviewFailure(error); }
}

export async function DELETE(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const id = await passportId(context);
  if (!id) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, releaseHoldSchema);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ hold: await releaseHold(actor.id, id, body) }); } catch (error) { return reviewFailure(error); }
}
