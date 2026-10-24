import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { monitorMintAttempt } from "@/lib/publication/mint-monitor";
import { configuredMintReaderFor } from "@/lib/publication/mint-config";

type Context = { params: Promise<{ id: string }> };
const checkSchema = z.strictObject({ attemptId: z.uuid() });
export const maxDuration = 60;

// D68: one bounded monitoring tick for this attempt (D42 lease and due time).
// It finalizes only after fresh verification at the configured depth.
export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, checkSchema);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ check: await monitorMintAttempt(id, body.attemptId, configuredMintReaderFor) }); }
  catch (error) { return reviewFailure(error); }
}
