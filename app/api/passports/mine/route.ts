import { NextResponse, type NextRequest } from "next/server";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor } from "@/lib/review/http";
import { mine } from "@/lib/review/service";

export async function GET(request: NextRequest) {
  const actor = await reviewActor(request, false);
  if (actor instanceof NextResponse) return actor;
  return draftResponse({ passports: await mine(actor.id) });
}
