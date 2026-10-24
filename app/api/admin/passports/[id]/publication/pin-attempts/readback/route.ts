import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { publicationReadbackSchema } from "@/lib/publication/schema";
import { configuredPinProvider } from "@/lib/publication/provider";
import { reconcilePinAttempt } from "@/lib/publication/reconciliation";

type Context = { params: Promise<{ id: string }> };

// D67: re-read an uploaded or unknown attempt from the configured target. Read-only:
// it never sends again and records success only after the exact bytes match.
export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, publicationReadbackSchema);
  if (body instanceof NextResponse) return body;
  try {
    const provider = await configuredPinProvider();
    return draftResponse({ result: await reconcilePinAttempt(id, body.publicationId, body.attemptId, provider.target, provider.read) });
  } catch (error) { return reviewFailure(error); }
}
