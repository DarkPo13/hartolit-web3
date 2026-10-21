import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { walletProofInputSchema } from "@/lib/publication/schema";
import { verifyWalletProof } from "@/lib/publication/wallet-proof";
import { WorkflowError } from "@/lib/review/service";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, walletProofInputSchema);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ proof: await verifyWalletProof(actor.id, id, body) }); }
  catch (error) {
    if (error instanceof WorkflowError) return reviewFailure(error);
    return draftResponse({ error: "Unable to verify wallet proof" }, 500);
  }
}
