import "server-only";

import { getDb } from "@/lib/db";
import { WorkflowError } from "@/lib/review/service";
import { createPublicationTarget, RAW_PIN_PROFILE } from "./target";

/** Description only. No upload factory, RPC, gateway read or dispatch is invoked here. */
export async function preparationTarget() {
  try {
    return await createPublicationTarget({
      key: process.env.HARTOLIT_PUBLICATION_TARGET_KEY ?? "",
      accountScope: process.env.HARTOLIT_PUBLICATION_TARGET_SCOPE ?? "",
      apiUrl: process.env.HARTOLIT_PUBLICATION_API_ORIGIN ?? "",
      gatewayUrl: process.env.HARTOLIT_PUBLICATION_GATEWAY_ORIGIN ?? "",
      kind: "kubo-raw-v1", storageProfile: RAW_PIN_PROFILE,
    });
  } catch { throw new WorkflowError(503, "Publication preparation target is not configured"); }
}

export async function publicationPreparationOverview(passportId: string) {
  let target = null;
  try {
    const configured = await preparationTarget();
    target = { key: configured.key, configurationSha256: configured.configurationSha256, storageProfile: configured.storageProfile };
  } catch (error) {
    if (!(error instanceof WorkflowError) || error.status !== 503) throw error;
  }
  const rows = await getDb().publicationPinAttempt.findMany({
    where: { publication: { passportId } }, orderBy: { createdAt: "desc" }, take: 50,
    select: {
      id: true, publicationId: true, requestId: true, status: true, createdAt: true, dispatchedAt: true, closedAt: true, verifiedAt: true,
      providerKey: true, providerConfigHash: true, storageProfile: true,
      publication: { select: { confirmationId: true, passportVersion: true, payloadHash: true } },
    },
  });
  return {
    target, dispatchEnabled: false as const,
    attempts: rows.map(({ publication, ...row }) => ({ ...row, ...publication,
      createdAt: row.createdAt.toISOString(), dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null, verifiedAt: row.verifiedAt?.toISOString() ?? null,
    })),
  };
}
