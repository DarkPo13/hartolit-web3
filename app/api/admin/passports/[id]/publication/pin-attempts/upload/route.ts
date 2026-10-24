import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { WorkflowError } from "@/lib/review/service";
import { publicationUploadSchema } from "@/lib/publication/schema";
import { configuredPinProvider } from "@/lib/publication/provider";
import { executePinUpload } from "@/lib/publication/upload";

type Context = { params: Promise<{ id: string }> };
export const maxDuration = 60;

// D67: the designated MFA publisher sends the exact prepared snapshot to the
// server-configured target. The command is single-use; a lost response stays UNKNOWN.
export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, publicationUploadSchema);
  if (body instanceof NextResponse) return body;
  try {
    const provider = await configuredPinProvider();
    if (provider.target.configurationSha256 !== body.expectedTargetSha256) throw new WorkflowError(409, "Publication target changed");
    return draftResponse({ result: await executePinUpload(actor.id, id, body.publicationId, body.attemptId, provider) });
  } catch (error) { return reviewFailure(error); }
}
