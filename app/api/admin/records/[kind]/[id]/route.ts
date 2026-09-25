import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse } from "@/lib/drafts/http";
import { reviewActor, reviewBody, reviewFailure } from "@/lib/review/http";
import { archiveEdit, archiveRecord, editRecord, farmerEdit, fieldEdit, recordDetail, recordKind } from "@/lib/review/management";

type Params = { params: Promise<{ kind: string; id: string }> };

async function target(context: Params) {
  const { kind, id } = await context.params;
  const parsed = recordKind.safeParse(kind);
  return parsed.success && z.uuid().safeParse(id).success ? { kind: parsed.data, id } : null;
}

export async function GET(request: NextRequest, context: Params) {
  const actor = await reviewActor(request, false, true);
  if (actor instanceof NextResponse) return actor;
  const item = await target(context);
  if (!item) return draftResponse({ error: "Record not found" }, 404);
  try { return draftResponse({ record: await recordDetail(item.kind, item.id) }); }
  catch (error) { return reviewFailure(error); }
}

export async function PATCH(request: NextRequest, context: Params) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const item = await target(context);
  if (!item) return draftResponse({ error: "Record not found" }, 404);
  const body = await reviewBody(request, item.kind === "farmers" ? farmerEdit : fieldEdit);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ record: await editRecord(actor.id, item.kind, item.id, body) }); }
  catch (error) { return reviewFailure(error); }
}

export async function POST(request: NextRequest, context: Params) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const item = await target(context);
  if (!item) return draftResponse({ error: "Record not found" }, 404);
  const body = await reviewBody(request, archiveEdit);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ record: await archiveRecord(actor.id, item.kind, item.id, body) }); }
  catch (error) { return reviewFailure(error); }
}
