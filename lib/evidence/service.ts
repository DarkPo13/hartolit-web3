import "server-only";

import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getDb } from "@/lib/db";
import { touchEditablePassport } from "@/lib/drafts/lock";
import { evidenceStorage } from "./storage";
import { MAX_EVIDENCE_BYTES, sha256, validFileContent, type reserveSchema } from "./validation";
import { scanEvidence } from "./scan";
import type { z } from "zod";

const POST_SECONDS = 300;
const PREVIEW_SECONDS = 60;
type Declaration = z.infer<typeof reserveSchema>;

export class EvidenceError extends Error {
  constructor(public readonly status: 400 | 404 | 409 | 413 | 503, message: string) { super(message); }
}

function publicFile(file: { id: string; kind: string; filename: string; contentType: string; sizeBytes: number; sha256: string; status: string; createdAt: Date; rejectionCode: string | null }) {
  return { id: file.id, kind: file.kind, filename: file.filename, contentType: file.contentType, sizeBytes: file.sizeBytes, sha256: file.sha256, status: file.status, rejectionCode: file.rejectionCode, createdAt: file.createdAt.toISOString() };
}

export async function listEvidence(ownerId: string, passportId: string) {
  const draft = await getDb().passport.findFirst({ where: { id: passportId, ownerId, status: "DRAFT" }, select: { id: true } });
  if (!draft) throw new EvidenceError(404, "Draft not found");
  const files = await getDb().evidenceFile.findMany({
    where: { passportId, ownerId, OR: [{ rejectionCode: null }, { rejectionCode: { not: "REMOVED" } }] }, orderBy: { createdAt: "desc" }, take: 100,
    select: { id: true, kind: true, filename: true, contentType: true, sizeBytes: true, sha256: true, status: true, createdAt: true, rejectionCode: true },
  });
  return files.map(publicFile);
}

export async function reserveEvidence(ownerId: string, passportId: string, input: Declaration) {
  const { client, bucket } = evidenceStorage();
  const id = randomUUID();
  const objectKey = `quarantine/${id}`;
  const uploadExpiresAt = new Date(Date.now() + POST_SECONDS * 1000);
  const file = await getDb().$transaction(async (tx) => {
    if (!await touchEditablePassport(tx, ownerId, passportId)) throw new EvidenceError(404, "Draft not found");
    const draft = await tx.passport.findFirst({ where: { id: passportId, ownerId, status: "DRAFT" }, select: { version: true } });
    if (!draft) throw new EvidenceError(404, "Draft not found");
    const count = await tx.evidenceFile.count({ where: { passportId, ownerId, status: { in: ["PENDING", "SCANNING", "QUARANTINED", "READY"] } } });
    if (count >= 20) throw new EvidenceError(409, "Draft evidence limit reached");
    const created = await tx.evidenceFile.create({ data: { id, ownerId, passportId, objectKey, uploadExpiresAt, ...input } });
    await tx.auditLog.create({ data: { passportId, actorId: ownerId, action: "EVIDENCE_RESERVED", version: draft.version } });
    return created;
  });
  try {
    const upload = await createPresignedPost(client, {
      Bucket: bucket,
      Key: objectKey,
      Expires: POST_SECONDS,
      Fields: { "Content-Type": input.contentType },
      Conditions: [["content-length-range", 1, MAX_EVIDENCE_BYTES + 20_000], ["eq", "$Content-Type", input.contentType], ["eq", "$key", objectKey]],
    });
    return { file: publicFile(file), upload, uploadExpiresAt: uploadExpiresAt.toISOString() };
  } catch (error) {
    await getDb().evidenceFile.update({ where: { id }, data: { status: "REJECTED", rejectionCode: "SIGNING_FAILED" } });
    throw error;
  }
}

async function readBoundedObject(key: string): Promise<{ bytes: Buffer; contentType: string | undefined }> {
  const { client, bucket } = evidenceStorage();
  let response;
  try { response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key })); }
  catch (error) {
    if (error instanceof Error && (error.name === "NoSuchKey" || error.name === "NotFound")) throw new EvidenceError(409, "Upload has not reached storage");
    throw error;
  }
  if (!response.Body) throw new EvidenceError(409, "Upload has not reached storage");
  if (response.ContentLength && response.ContentLength > MAX_EVIDENCE_BYTES) throw new EvidenceError(413, "Evidence file is too large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > MAX_EVIDENCE_BYTES) {
      throw new EvidenceError(413, "Evidence file is too large");
    }
    chunks.push(Buffer.from(chunk));
  }
  return { bytes: Buffer.concat(chunks, size), contentType: response.ContentType };
}

export async function completeEvidence(ownerId: string, passportId: string, id: string) {
  const db = getDb();
  const file = await db.evidenceFile.findFirst({ where: { id, ownerId, passportId }, include: { passport: { select: { status: true, version: true } } } });
  if (!file || file.passport.status !== "DRAFT") throw new EvidenceError(404, "Evidence not found");
  if (file.status === "READY") return publicFile(file);
  if (file.status === "REJECTED") throw new EvidenceError(409, "Evidence was rejected");
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 5 * 60_000);
  const claim = await db.evidenceFile.updateMany({
    where: { id, ownerId, passportId, OR: [
      { status: { in: ["PENDING", "QUARANTINED"] } },
      { status: "SCANNING", scanLeaseUntil: { lt: now } },
    ] },
    data: { status: "SCANNING", scanLeaseUntil: leaseUntil },
  });
  if (!claim.count) throw new EvidenceError(409, "Evidence verification is already running");
  const { client, bucket } = evidenceStorage();
  const finalKey = `evidence/${id}/${randomUUID()}`;
  let finalWritten = false;
  let finalized = false;
  try {
    const { bytes, contentType } = await readBoundedObject(file.objectKey);
    if (bytes.length !== file.sizeBytes || sha256(bytes) !== file.sha256 || contentType !== file.contentType || !validFileContent(bytes, file.filename)) {
      await db.$transaction(async (tx) => {
        const changed = await tx.evidenceFile.updateMany({ where: { id, status: "SCANNING", scanLeaseUntil: leaseUntil }, data: { status: "REJECTED", scanLeaseUntil: null, rejectionCode: "INVALID_FILE" } });
        if (!changed.count) throw new EvidenceError(409, "Evidence verification was superseded");
        await tx.auditLog.create({ data: { passportId, actorId: ownerId, action: "EVIDENCE_REJECTED", version: file.passport.version } });
      });
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: file.objectKey })).catch(() => undefined);
      throw new EvidenceError(409, "Evidence content does not match its declaration");
    }
    const verdict = await scanEvidence(bytes);
    if (verdict === "infected") {
      await db.$transaction(async (tx) => {
        const changed = await tx.evidenceFile.updateMany({ where: { id, status: "SCANNING", scanLeaseUntil: leaseUntil }, data: { status: "REJECTED", scanLeaseUntil: null, rejectionCode: "MALWARE" } });
        if (!changed.count) throw new EvidenceError(409, "Evidence verification was superseded");
        await tx.auditLog.create({ data: { passportId, actorId: ownerId, action: "EVIDENCE_REJECTED", version: file.passport.version } });
      });
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: file.objectKey })).catch(() => undefined);
      throw new EvidenceError(409, "Evidence failed the security scan");
    }
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: finalKey, Body: bytes, ContentType: file.contentType, Metadata: { sha256: file.sha256 }, ServerSideEncryption: process.env.EVIDENCE_S3_SSE === "AES256" ? "AES256" : undefined }));
    finalWritten = true;
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: finalKey }));
    if (head.ContentLength !== file.sizeBytes || head.ContentType !== file.contentType || head.Metadata?.sha256 !== file.sha256) throw new Error("Final evidence object metadata mismatch");
    const ready = await db.$transaction(async (tx) => {
      if (!await touchEditablePassport(tx, ownerId, passportId)) throw new EvidenceError(409, "Draft is no longer editable");
      const changed = await tx.evidenceFile.updateMany({ where: { id, status: "SCANNING", scanLeaseUntil: leaseUntil }, data: { objectKey: finalKey, status: "READY", scanLeaseUntil: null } });
      if (!changed.count) throw new EvidenceError(409, "Evidence verification was superseded");
      await tx.auditLog.create({ data: { passportId, actorId: ownerId, action: "EVIDENCE_READY", version: file.passport.version } });
      return tx.evidenceFile.findUniqueOrThrow({ where: { id } });
    });
    finalized = true;
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: file.objectKey })).catch(() => undefined);
    return publicFile(ready);
  } catch (error) {
    if (finalWritten && !finalized) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: finalKey })).catch(() => undefined);
    await db.evidenceFile.updateMany({ where: { id, status: "SCANNING", scanLeaseUntil: leaseUntil }, data: { status: "QUARANTINED", scanLeaseUntil: null } });
    if (error instanceof EvidenceError) throw error;
    throw new EvidenceError(503, "Evidence verification is temporarily unavailable; retry later");
  }
}

export async function previewEvidence(ownerId: string, passportId: string, id: string) {
  const file = await getDb().evidenceFile.findFirst({ where: { id, passportId, ownerId, status: "READY" }, select: { objectKey: true, filename: true, contentType: true, passport: { select: { status: true } } } });
  if (!file || file.passport.status !== "DRAFT") throw new EvidenceError(404, "Evidence not found");
  return signPreview(file);
}

async function signPreview(file: { objectKey: string; filename: string; contentType: string }) {
  const { client, bucket } = evidenceStorage();
  const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: file.objectKey, ResponseContentDisposition: `attachment; filename="${safeName}"`, ResponseContentType: file.contentType }), { expiresIn: PREVIEW_SECONDS });
  return { url, expiresIn: PREVIEW_SECONDS };
}

export async function previewReviewEvidence(passportId: string, id: string, ownerId?: string) {
  const file = await getDb().evidenceFile.findFirst({
    where: { id, passportId, status: "READY", ...(ownerId ? { ownerId } : {}) },
    select: { objectKey: true, filename: true, contentType: true },
  });
  if (!file) throw new EvidenceError(404, "Evidence not found");
  return signPreview(file);
}

export async function removeEvidence(ownerId: string, passportId: string, id: string) {
  const db = getDb();
  const file = await db.evidenceFile.findFirst({ where: { id, ownerId, passportId }, include: { passport: { select: { status: true, version: true } } } });
  if (!file || file.passport.status !== "DRAFT" || file.rejectionCode === "REMOVED") throw new EvidenceError(404, "Evidence not found");
  if (file.status === "SCANNING" && (!file.scanLeaseUntil || file.scanLeaseUntil > new Date())) throw new EvidenceError(409, "Evidence verification is running");
  await db.$transaction(async (tx) => {
    if (!await touchEditablePassport(tx, ownerId, passportId)) throw new EvidenceError(404, "Draft not found");
    const changed = await tx.evidenceFile.updateMany({ where: { id, ownerId, passportId, status: file.status, ...(file.status === "SCANNING" ? { scanLeaseUntil: file.scanLeaseUntil } : {}), OR: [{ rejectionCode: null }, { rejectionCode: { not: "REMOVED" } }] }, data: { status: "REJECTED", rejectionCode: "REMOVED", scanLeaseUntil: null } });
    if (!changed.count) throw new EvidenceError(409, "Evidence changed; refresh and try again");
    await tx.auditLog.create({ data: { passportId, actorId: ownerId, action: "EVIDENCE_REMOVED", version: file.passport.version } });
  });
  const { client, bucket } = evidenceStorage();
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: file.objectKey }));
    if (file.status === "READY") await db.evidenceFile.update({ where: { id }, data: { objectPurgedAt: new Date() } });
  } catch { /* The daily prune retries deletion after every upload grant has expired. */ }
}
