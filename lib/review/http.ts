import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { draftActor, draftResponse, readLimitedJson } from "@/lib/drafts/http";
import { WorkflowError } from "./service";

export async function reviewActor(request: NextRequest, write: boolean, admin = false) {
  const actor = await draftActor(request, write);
  if (actor instanceof NextResponse) return actor;
  if (admin && actor.role !== "admin") return draftResponse({ error: "Administrator access required" }, 403);
  return actor;
}

export async function reviewBody<T extends z.ZodType>(request: NextRequest, schema: T): Promise<z.infer<T> | NextResponse> {
  let body: unknown;
  try { body = await readLimitedJson(request); }
  catch (error) { return draftResponse({ error: error instanceof RangeError ? "Request body too large" : "Invalid JSON body" }, error instanceof RangeError ? 413 : 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return draftResponse({ error: "Invalid review request", issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, 400);
  return parsed.data;
}

export function reviewFailure(error: unknown): NextResponse {
  if (error instanceof WorkflowError) return draftResponse({ error: error.message, ...(error.issues ? { issues: error.issues } : {}) }, error.status);
  throw error;
}
