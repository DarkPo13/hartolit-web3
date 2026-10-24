import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { prepareMintIntent } from "@/lib/publication/mint-preparation";
import { configuredMintTarget } from "@/lib/publication/mint-config";

type Context = { params: Promise<{ id: string }> };

// D68: the designated publisher saves the exact reviewed mint intent (PREPARE_EXACT_MINT).
export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, z.unknown());
  if (body instanceof NextResponse) return body;
  try {
    const result = await prepareMintIntent(actor.id, id, body, configuredMintTarget());
    return draftResponse({ preparation: result.preparation }, result.created ? 201 : 200);
  } catch (error) { return reviewFailure(error); }
}
