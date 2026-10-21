import { NextResponse, type NextRequest } from "next/server";
import { draftActor, draftResponse, readLimitedJson } from "@/lib/drafts/http";
import { feedbackSchema } from "@/lib/feedback/schema";
import { FeedbackError, saveFeedback } from "@/lib/feedback/service";

export async function POST(request: NextRequest) {
  const actor = await draftActor(request, true);
  if (actor instanceof NextResponse) return actor;
  let body: unknown;
  try { body = await readLimitedJson(request); }
  catch (error) { return draftResponse({ error: "Invalid feedback body" }, error instanceof RangeError ? 413 : 400); }
  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) return draftResponse({ error: "Invalid feedback" }, 400);
  try {
    const result = await saveFeedback(actor.id, parsed.data);
    return draftResponse({ id: result.id }, result.created ? 201 : 200);
  } catch (error) {
    if (error instanceof FeedbackError) return draftResponse({ error: error.message }, error.status);
    // Feedback is private free text; do not put database query arguments into logs.
    return draftResponse({ error: "Unable to save feedback" }, 500);
  }
}
