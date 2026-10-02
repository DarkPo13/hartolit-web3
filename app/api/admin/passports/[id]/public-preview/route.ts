import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewFailure } from "@/lib/review/http";
import { previewPublicSnapshot } from "@/lib/public-snapshot/service";

type Context = { params: Promise<{ id: string }> };
const querySchema = z.strictObject({ weatherFileId: z.uuid(), chemicalFileId: z.uuid() });

export async function GET(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, false, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success || request.nextUrl.searchParams.size !== 2) return draftResponse({ error: "Select two verified source files" }, 400);
  try { return draftResponse({ preview: await previewPublicSnapshot(id, query.data.weatherFileId, query.data.chemicalFileId) }); }
  catch (error) { return reviewFailure(error); }
}
