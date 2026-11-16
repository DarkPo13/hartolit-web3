import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftResponse, unexpectedFailure } from "@/lib/drafts/http";
import { EvidenceError } from "@/lib/evidence/service";
import { evidenceGrantRevokeSchema, revokeEvidenceAccess } from "@/lib/evidence/access";
import { reviewActor, reviewBody } from "@/lib/review/http";

// Revoke an evidence access grant. POST, not DELETE with a body: CloudFront's OAC
// signer hashes only POST/PUT/PATCH bodies, so a DELETE body would be refused (D80).
type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const actor = await reviewActor(request, true, true);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftResponse({ error: "Invalid passport ID" }, 400);
  const body = await reviewBody(request, evidenceGrantRevokeSchema);
  if (body instanceof NextResponse) return body;
  try { return draftResponse({ grant: await revokeEvidenceAccess(actor.id, id, body) }); }
  catch (error) {
    if (error instanceof EvidenceError) return draftResponse({ error: error.message }, error.status);
    return unexpectedFailure(error);
  }
}
