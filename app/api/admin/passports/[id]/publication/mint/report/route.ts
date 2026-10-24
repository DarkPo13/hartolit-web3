import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { observeMintAttempt } from "@/lib/publication/mint-observation";
import { configuredMintReader } from "@/lib/publication/mint-config";

type Context = { params: Promise<{ id: string }> };
const reportSchema = z.strictObject({ attemptId: z.uuid(), transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/) });

// D68: record the hash the wallet returned. It is only a historical report; the
// exact call and nonce must match on chain before it becomes a transaction record.
export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, reportSchema);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ observation: await observeMintAttempt(id, body.attemptId, { transactionHash: body.transactionHash }, configuredMintReader()) }); }
  catch (error) { return reviewFailure(error); }
}
