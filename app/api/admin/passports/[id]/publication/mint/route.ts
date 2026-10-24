import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewFailure } from "@/lib/review/http";
import { mintOverview } from "@/lib/publication/mint-actions";

type Context = { params: Promise<{ id: string }> };

// D68: read-only mint state for MFA admins. Actions are separate POST routes.
export async function GET(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, false, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  try { return draftResponse({ mint: await mintOverview(id) }); }
  catch (error) { return reviewFailure(error); }
}
