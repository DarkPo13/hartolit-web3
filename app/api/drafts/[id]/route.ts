import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDraft, saveDraft } from "@/lib/drafts/service";
import { draftActor, draftFailure, draftResponse, readLimitedJson } from "@/lib/drafts/http";
import { draftSaveSchema } from "@/lib/drafts/schema";

const idSchema = z.uuid();
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const actor = await draftActor(request, false);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return draftResponse({ error: "Invalid draft ID" }, 400);
  try { return draftResponse({ draft: await getDraft(actor.id, id) }); }
  catch (error) { return draftFailure(error); }
}

export async function PATCH(request: NextRequest, context: Context) {
  const actor = await draftActor(request, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return draftResponse({ error: "Invalid draft ID" }, 400);
  let body: unknown;
  try { body = await readLimitedJson(request); }
  catch (error) {
    return draftResponse({ error: error instanceof RangeError ? "Draft body too large" : "Invalid JSON body" }, error instanceof RangeError ? 413 : 400);
  }
  const parsed = draftSaveSchema.safeParse(body);
  if (!parsed.success) return draftResponse({ error: "Invalid draft data", issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, 400);
  try { return draftResponse({ draft: await saveDraft(actor.id, id, parsed.data) }); }
  catch (error) { return draftFailure(error); }
}
