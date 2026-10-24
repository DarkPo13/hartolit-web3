import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { beginMintDispatch } from "@/lib/publication/mint-dispatch";
import { configuredMintReader, configuredMintTarget } from "@/lib/publication/mint-config";

type Context = { params: Promise<{ id: string }> };
export const maxDuration = 60;

// D68: one fixed-nonce send permission (SEND_EXACT_MINT). The server never signs;
// the publisher's browser wallet sends the returned exact request.
export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, z.unknown());
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ command: await beginMintDispatch(actor.id, id, body, configuredMintTarget(), configuredMintReader()) }, 201); }
  catch (error) { return reviewFailure(error); }
}
