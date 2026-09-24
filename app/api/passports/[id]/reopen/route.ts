import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { submitSchema } from "@/lib/review/schema";
import { reopenPassport } from "@/lib/review/service";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, submitSchema);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ passport: await reopenPassport(actor.id, id, body.version) }); }
  catch (error) { return reviewFailure(error); }
}
