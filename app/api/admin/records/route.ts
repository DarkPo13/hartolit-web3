import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor } from "@/lib/review/http";
import { adminRecords } from "@/lib/review/records";

const query = z.strictObject({ view: z.enum(["farmers", "fields", "users", "publications", "audit", "adminActions"]), page: z.coerce.number().int().min(0).max(500).default(0), search: z.string().trim().max(100).default(""), from: z.union([z.iso.date(), z.literal("")]).default(""), to: z.union([z.iso.date(), z.literal("")]).default("") }).refine((value) => !value.from || !value.to || value.from <= value.to);

export async function GET(request: NextRequest) {
  const actor = await reviewActor(request, false, true);
  if (actor instanceof NextResponse) return actor;
  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return draftResponse({ error: "Invalid records view" }, 400);
  return draftResponse(await adminRecords(parsed.data.view, parsed.data.page, parsed.data.search, parsed.data.from, parsed.data.to));
}
