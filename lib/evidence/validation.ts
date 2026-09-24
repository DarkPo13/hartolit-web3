import { createHash } from "node:crypto";
import { z } from "zod";

export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const allowed = {
  ".pdf": ["application/pdf"],
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".json": ["application/json"],
  ".csv": ["text/csv", "application/vnd.ms-excel"],
  ".txt": ["text/plain"],
  ".xml": ["application/xml", "text/xml"],
} as const;

export const reserveSchema = z.strictObject({
  kind: z.enum(["METEO", "CHEMICAL", "OTHER"]),
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().max(255),
  sizeBytes: z.number().int().min(1).max(MAX_EVIDENCE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export function validFileDeclaration(filename: string, contentType: string): boolean {
  if (/[\\/\x00-\x1f\x7f]/.test(filename)) return false;
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase() as keyof typeof allowed;
  return Object.hasOwn(allowed, ext) && (allowed[ext] as readonly string[]).includes(contentType);
}

export function validFileContent(bytes: Uint8Array, filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (ext === ".pdf") return Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from("%PDF-"));
  if (ext === ".png") return Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (ext === ".jpg" || ext === ".jpeg") return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  let value: string;
  try { value = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return false; }
  if (value.includes("\0")) return false;
  if (ext === ".json") { try { JSON.parse(value); return true; } catch { return false; } }
  if (ext === ".xml") return /^\s*(<\?xml\b[^>]*>\s*)?<[^!?][\s\S]*>\s*$/.test(value);
  return true;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
