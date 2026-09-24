import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { getActor, type Actor } from "@/lib/auth-guard";
import { DraftError } from "./service";

export function draftResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function draftActor(request: NextRequest, write: boolean): Promise<Actor | NextResponse> {
  const actor = await getActor(request.headers);
  if (!actor) return draftResponse({ error: "Authentication required" }, 401);
  if (actor.role === "admin" && !actor.twoFactorEnabled) {
    return draftResponse({ error: "Admin access requires two-factor authentication" }, 403);
  }
  if (write) {
    const origin = request.headers.get("origin");
    const expected = process.env.BETTER_AUTH_URL ?? request.nextUrl.origin;
    if (!origin || !sameOrigin(origin, expected)) {
      return draftResponse({ error: "Request origin is not allowed" }, 403);
    }
  }
  return actor;
}

function sameOrigin(origin: string, expected: string) {
  try { return new URL(origin).origin === new URL(expected).origin; }
  catch { return false; }
}

export function draftFailure(error: unknown): NextResponse {
  if (error instanceof DraftError) return draftResponse({ error: error.message }, error.status);
  throw error;
}

export async function readLimitedJson(request: NextRequest): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new SyntaxError("JSON required");
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("JSON required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32_768) throw new RangeError("Draft body too large");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
