import { NextResponse, type NextRequest } from "next/server";
import { sha256Hex } from "@/lib/hash";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/json",
  "application/xml",
  "text/xml",
  "text/csv",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * Accepts a multipart upload, computes SHA-256, and returns a URL pointing to
 * the stored file. In production this would push to S3 / Supabase Storage and
 * return a signed URL. For now we return a deterministic data: URL placeholder
 * keyed by the hash so the client can still reference the file.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Field 'file' is required" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_FILE_SIZE} bytes)` },
        { status: 413 },
      );
    }

    const contentType = file.type || "application/octet-stream";
    if (contentType !== "application/octet-stream" && !ALLOWED_TYPES.has(contentType)) {
      return NextResponse.json({ error: `Disallowed content type: ${contentType}` }, { status: 415 });
    }

    const buf = await file.arrayBuffer();
    const sha256 = await sha256Hex(buf);

    const clientHash = formData.get("sha256");
    if (typeof clientHash === "string" && clientHash.toLowerCase() !== sha256) {
      return NextResponse.json(
        { error: "Hash mismatch between client and server" },
        { status: 400 },
      );
    }

    const url = await persistFile(buf, contentType, sha256, file.name);

    return NextResponse.json({
      url,
      sha256,
      size: file.size,
      filename: file.name,
      contentType,
    });
  } catch (e) {
    console.error("[upload] error:", e);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

async function persistFile(
  _buf: ArrayBuffer,
  _contentType: string,
  sha256: string,
  filename: string,
): Promise<string> {
  // TODO: replace with real S3 / Supabase Storage upload once credentials are wired.
  // For now we return a stable, hash-keyed virtual URL so the rest of the flow works.
  const safeName = encodeURIComponent(filename);
  return `internal://uploads/${sha256}/${safeName}`;
}
