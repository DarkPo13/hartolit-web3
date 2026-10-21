import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { walletChallengeInputSchema } from "@/lib/publication/schema";
import { createWalletChallenge } from "@/lib/publication/wallet-proof";
import { WorkflowError } from "@/lib/review/service";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, walletChallengeInputSchema);
  if (body instanceof NextResponse) return body;
  try {
    const result = await createWalletChallenge(actor.id, id, body.publicationId);
    return draftResponse({ challenge: result.challenge }, result.created ? 201 : 200);
  } catch (error) {
    if (error instanceof WorkflowError) return reviewFailure(error);
    // Never log private challenge messages or database query arguments.
    return draftResponse({ error: "Unable to prepare wallet proof" }, 500);
  }
}
