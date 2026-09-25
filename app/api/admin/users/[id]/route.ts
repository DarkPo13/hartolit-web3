import { NextResponse, type NextRequest } from "next/server";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { manageUser, userAction } from "@/lib/review/management";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!id || id.length > 191) return draftResponse({ error: "User not found" }, 404);
  const body = await reviewBody(request, userAction);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ user: await manageUser(actor.id, id, body.action) }); }
  catch (error) { return reviewFailure(error); }
}
