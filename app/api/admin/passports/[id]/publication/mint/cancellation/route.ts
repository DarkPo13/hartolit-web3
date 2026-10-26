import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { closeCancelledMint, getMintCancellationReview } from "@/lib/publication/mint-cancellation-closure";
import { configuredMintReader } from "@/lib/publication/mint-config";

type Context = { params: Promise<{ id: string }> };
const target = z.strictObject({ attemptId: z.uuid(), discoveryId: z.uuid() });
export const maxDuration = 60;

// D48 review: the exact conflict, nonce and bindings the publisher consents to. Never a send command.
export async function GET(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, false, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  const query = target.safeParse({ attemptId: request.nextUrl.searchParams.get("attemptId"), discoveryId: request.nextUrl.searchParams.get("discoveryId") });
  if (!z.uuid().safeParse(id).success || !query.success) return draftResponse({ error: "Invalid cancellation target" }, 400);
  try { return draftResponse({ review: await getMintCancellationReview(actor.id, id, query.data.attemptId, query.data.discoveryId) }); }
  catch (error) { return reviewFailure(error); }
}

// D48 closure (CLOSE_CANCELLED_MINT): after a fresh canonical proof of the same-nonce
// self-send at the configured depth, release only this wallet slot. The record stays unissued.
export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, z.looseObject({ attemptId: z.uuid() }));
  if (body instanceof NextResponse) return body;
  const { attemptId, ...input } = body;
  try { return draftResponse({ cancellation: await closeCancelledMint(actor.id, id, attemptId, input, configuredMintReader()) }); }
  catch (error) { return reviewFailure(error); }
}
