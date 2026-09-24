import { NextResponse, type NextRequest } from "next/server";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor } from "@/lib/review/http";
import { queueQuerySchema } from "@/lib/review/schema";
import { adminQueue } from "@/lib/review/service";

export async function GET(request: NextRequest) {
  const actor = await reviewActor(request, false, true);
  if (actor instanceof NextResponse) return actor;
  const parsed = queueQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return draftResponse({ error: "Invalid queue filter" }, 400);
  return draftResponse(await adminQueue(parsed.data.status, parsed.data.page, parsed.data.search));
}
