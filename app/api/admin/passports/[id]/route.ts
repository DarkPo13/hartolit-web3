import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewFailure } from "@/lib/review/http";
import { adminDetail } from "@/lib/review/service";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, false, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  try { return draftResponse({ passport: await adminDetail(id) }); }
  catch (error) { return reviewFailure(error); }
}
