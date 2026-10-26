import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse, unexpectedFailure } from "@/lib/drafts/http";
import { EvidenceError } from "@/lib/evidence/service";
import { evidenceGrantRevokeSchema, evidenceGrantSchema, grantEvidenceAccess, listEvidenceAccess, revokeEvidenceAccess } from "@/lib/evidence/access";
import { reviewActor, reviewBody } from "@/lib/review/http";

type Context = { params: Promise<{ id: string }> };
const failure = (error: unknown) => {
  if (error instanceof EvidenceError) return draftResponse({ error: error.message }, error.status);
  return unexpectedFailure(error);
};
async function passportId(context: Context) {
  const { id } = await context.params;
  return z.uuid().safeParse(id).success ? id : null;
}

export async function GET(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, false, true);
  if (actor instanceof NextResponse) return actor;
  const id = await passportId(context);
  if (!id) return draftResponse({ error: "Invalid passport ID" }, 400);
  try { return draftResponse(await listEvidenceAccess(id)); } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const id = await passportId(context);
  if (!id) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, evidenceGrantSchema);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ grant: await grantEvidenceAccess(actor.id, id, body) }, 201); } catch (error) { return failure(error); }
}

export async function DELETE(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const id = await passportId(context);
  if (!id) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, evidenceGrantRevokeSchema);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ grant: await revokeEvidenceAccess(actor.id, id, body) }); } catch (error) { return failure(error); }
}
