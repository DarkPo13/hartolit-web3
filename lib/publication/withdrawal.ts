import "server-only";

import { getDb } from "@/lib/db";
import { WorkflowError } from "@/lib/review/service";
import { publicationWithdrawalSchema } from "./schema";
import { publicationPublisherAccess } from "./service";

/** Stop a pinned publication that never received mint permission, so the
 * reviewer can recall the passport. No token can reference the document after
 * this; the pinned IPFS bytes may remain retrievable and are not claimed removed.
 * A publication with any mint attempt needs the published-record correction path.
 */
export async function withdrawUnmintedPublication(adminId: string, passportId: string, input: unknown) {
  const parsed = publicationWithdrawalSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "Exact withdrawal review, reason and acknowledgement are required");
  const data = parsed.data;
  return getDb().$transaction(async tx => {
    const access = publicationPublisherAccess(adminId);
    if (!access.configured || !access.canProve ||
      !await tx.user.findFirst({ where: { id: adminId, role: "admin", banned: false, twoFactorEnabled: true }, select: { id: true } })) {
      throw new WorkflowError(403, "Withdrawal requires the current designated MFA publisher");
    }
    // Same passport lock as mint permission, preparation and recall.
    const locked = await tx.passport.updateMany({ where: { id: passportId }, data: { updatedAt: new Date() } });
    if (!locked.count) throw new WorkflowError(404, "Passport not found");
    const publication = await tx.publication.findFirst({ where: { id: data.publicationId, passportId } });
    if (!publication) throw new WorkflowError(404, "Publication not found");
    if (publication.status !== "PINNED" || publication.cancelledAt || publication.payloadHash !== data.expectedSha256 ||
      publication.contractAddress || publication.transactionHash || publication.tokenId) {
      throw new WorkflowError(409, "Only a pinned publication that was never minted can be withdrawn");
    }
    if (await tx.publicationMintAttempt.count({ where: { preparation: { publicationId: publication.id } } })) {
      throw new WorkflowError(409, "Mint permission was issued; use the published-record correction process");
    }
    if (await tx.publicationPinAttempt.count({ where: { publicationId: publication.id, status: { in: ["PREPARED", "DISPATCHING", "UNKNOWN"] } } })) {
      throw new WorkflowError(409, "A pin attempt is still open; resolve it before withdrawal");
    }
    const withdrawnAt = new Date();
    await tx.publication.update({ where: { id: publication.id }, data: { status: "CANCELLED", cancelledAt: withdrawnAt, walletVerifiedAt: null } });
    await tx.publicationWalletChallenge.updateMany({ where: { publicationId: publication.id, invalidatedAt: null }, data: { invalidatedAt: withdrawnAt } });
    // The reason is private staff context; it never reaches a public surface.
    await tx.auditLog.create({ data: { passportId, publicationId: publication.id, actorId: adminId, version: publication.passportVersion,
      action: "PUBLICATION_WITHDRAWN", fromStatus: "APPROVED", toStatus: "APPROVED", note: data.reason } });
    return { status: "WITHDRAWN" as const, publicationId: publication.id, cid: publication.ipfsCid, withdrawnAt: withdrawnAt.toISOString(),
      ipfsBytesMayRemain: true as const, issued: false as const, canResend: false as const };
  });
}
