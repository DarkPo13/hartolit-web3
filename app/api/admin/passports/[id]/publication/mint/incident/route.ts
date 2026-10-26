import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { getMintIncident, resolveMintIncident } from "@/lib/publication/mint-incident";
import { configuredMintReader } from "@/lib/publication/mint-config";

type Context = { params: Promise<{ id: string }> };
export const maxDuration = 60;

// Review of a reverted open mint (D44) or a quarantined closed one (D43, D45, D49, D50).
export async function GET(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, false, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  const attemptId = request.nextUrl.searchParams.get("attemptId");
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(attemptId).success) return draftResponse({ error: "Invalid incident target" }, 400);
  try { return draftResponse({ incident: await getMintIncident(actor.id, id, attemptId!) }); }
  catch (error) { return reviewFailure(error); }
}

// One reviewed action with its own acknowledgement; never a send, resend or new nonce.
export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, z.looseObject({ attemptId: z.uuid(), action: z.string() }));
  if (body instanceof NextResponse) return body;
  const { attemptId, action, ...input } = body;
  try { return draftResponse({ resolution: await resolveMintIncident(actor.id, id, attemptId, action, input, configuredMintReader()) }); }
  catch (error) { return reviewFailure(error); }
}
