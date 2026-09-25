import { NextResponse, type NextRequest } from "next/server";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { inviteInput, inviteOperator } from "@/lib/review/management";

export async function POST(request: NextRequest) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const body = await reviewBody(request, inviteInput);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ user: await inviteOperator(actor.id, body) }, 201); }
  catch (error) { return reviewFailure(error); }
}
