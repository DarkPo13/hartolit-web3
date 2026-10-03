import "server-only";

import { z } from "zod";
import type { PublicSnapshotConfirmation } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { canonicalize, sha256Hex } from "@/lib/hash";
import { WorkflowError } from "@/lib/review/service";
import { publicSnapshotSchema } from "./schema";
import { buildPublicSnapshot } from "./service";

export const confirmationInputSchema = z.strictObject({
  passportVersion: z.number().int().positive(),
  weatherFileId: z.uuid(),
  chemicalFileId: z.uuid(),
  certificateId: z.uuid(),
  snapshotAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine((value) => !Number.isNaN(Date.parse(value))),
  expectedSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type ConfirmationInput = z.infer<typeof confirmationInputSchema>;

async function confirmedResponse(row: PublicSnapshotConfirmation) {
  let parsed: ReturnType<typeof publicSnapshotSchema.safeParse>;
  try { parsed = publicSnapshotSchema.safeParse(JSON.parse(row.canonicalJson)); }
  catch { throw new WorkflowError(409, "Stored public confirmation is invalid"); }
  if (!parsed.success || canonicalize(parsed.data) !== row.canonicalJson || await sha256Hex(row.canonicalJson) !== row.payloadHash || parsed.data.certificateId !== row.certificateId) {
    throw new WorkflowError(409, "Stored public confirmation is invalid");
  }
  return {
    id: row.id,
    confirmedAt: row.confirmedAt.toISOString(),
    preview: {
      snapshot: parsed.data,
      canonicalJson: row.canonicalJson,
      sha256: row.payloadHash,
      passportVersion: row.passportVersion,
      approvedVersion: row.approvedVersion,
    },
  };
}

export async function activePublicConfirmation(passportId: string) {
  const row = await getDb().passport.findUnique({
    where: { id: passportId },
    select: {
      status: true, version: true, approvedVersion: true,
      confirmedSnapshots: { where: { invalidatedAt: null }, orderBy: { confirmedAt: "desc" }, take: 1 },
    },
  });
  if (!row) throw new WorkflowError(404, "Passport not found");
  const confirmation = row.confirmedSnapshots[0];
  if (row.status !== "APPROVED" || !confirmation || row.version !== confirmation.passportVersion || row.approvedVersion !== confirmation.approvedVersion) return null;
  return confirmedResponse(confirmation);
}

export async function confirmPublicSnapshot(adminId: string, passportId: string, input: ConfirmationInput) {
  return getDb().$transaction(async (tx) => {
    // Lock the passport row so a recall or another confirmation cannot pass between the checks and insert.
    const locked = await tx.passport.updateMany({
      where: { id: passportId, status: "APPROVED", version: input.passportVersion },
      data: { updatedAt: new Date() },
    });
    if (!locked.count) {
      const exists = await tx.passport.findUnique({ where: { id: passportId }, select: { id: true } });
      throw new WorkflowError(exists ? 409 : 404, exists ? "Approved passport changed; refresh the preview" : "Passport not found");
    }
    const passport = await tx.passport.findUniqueOrThrow({
      where: { id: passportId },
      select: { version: true, approvedVersion: true, submittedVersion: true, reviewerId: true, reviewedById: true },
    });
    if (passport.approvedVersion === null || passport.approvedVersion !== passport.submittedVersion) {
      throw new WorkflowError(409, "Approved passport changed; refresh the preview");
    }
    if (passport.reviewerId !== adminId || passport.reviewedById !== adminId) {
      throw new WorkflowError(403, "Only the approving reviewer can confirm this snapshot");
    }

    const existing = await tx.publicSnapshotConfirmation.findUnique({
      where: { passportId_approvedVersion: { passportId, approvedVersion: passport.approvedVersion } },
    });
    if (existing) {
      if (existing.invalidatedAt || existing.passportVersion !== input.passportVersion || existing.certificateId !== input.certificateId || existing.weatherFileId !== input.weatherFileId || existing.chemicalFileId !== input.chemicalFileId || existing.payloadHash !== input.expectedSha256) {
        throw new WorkflowError(409, "A different public snapshot was already confirmed for this approval");
      }
      return { confirmation: await confirmedResponse(existing), created: false };
    }

    const previewTime = Date.parse(input.snapshotAt);
    const now = Date.now();
    if (previewTime > now + 60_000 || now - previewTime > 15 * 60_000) {
      throw new WorkflowError(409, "Public preview expired; generate it again");
    }
    const preview = await buildPublicSnapshot(tx, passportId, input.weatherFileId, input.chemicalFileId, {
      certificateId: input.certificateId, snapshotAt: input.snapshotAt,
    });
    if (preview.passportVersion !== input.passportVersion || preview.approvedVersion !== passport.approvedVersion || preview.sha256 !== input.expectedSha256) {
      throw new WorkflowError(409, "Public facts changed; generate a new preview");
    }
    const confirmation = await tx.publicSnapshotConfirmation.create({ data: {
      passportId,
      approvedVersion: passport.approvedVersion,
      passportVersion: passport.version,
      certificateId: input.certificateId,
      canonicalJson: preview.canonicalJson,
      payloadHash: preview.sha256,
      weatherFileId: input.weatherFileId,
      chemicalFileId: input.chemicalFileId,
      confirmedById: adminId,
    } });
    await tx.auditLog.create({ data: {
      passportId, actorId: adminId, action: "PUBLIC_SNAPSHOT_CONFIRMED", version: passport.version,
      fromStatus: "APPROVED", toStatus: "APPROVED",
    } });
    return { confirmation: await confirmedResponse(confirmation), created: true };
  });
}
