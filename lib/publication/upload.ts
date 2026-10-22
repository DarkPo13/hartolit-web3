import "server-only";

import { WorkflowError } from "@/lib/review/service";
import { beginPinDispatch, recordUnknownPinOutcome } from "./pinning";
import { reconcilePinAttempt } from "./reconciliation";
import type { PublicationTarget } from "./target";
import type { PinReader } from "./ipfs-reader";

export type PinUploadCommand = Awaited<ReturnType<typeof beginPinDispatch>>;
export type PublicationPinProvider = Readonly<{
  target: PublicationTarget;
  upload: (command: PinUploadCommand) => Promise<void>;
  read: PinReader;
}>;

/** Trusted internal driver. No HTTP/Action/worker or configured production uploader calls it.
 * Injected providers must come from server construction, never request JSON.
 * A committed dispatch command is consumed once, including when its response is lost.
 */
export async function executePinUpload(adminId: string, passportId: string, publicationId: string, attemptId: string, provider: PublicationPinProvider) {
  const { target, upload, read } = provider;
  const command = await beginPinDispatch(adminId, passportId, publicationId, attemptId, target);
  try { await upload(command); }
  catch {
    // A timeout or even an HTTP rejection can follow a provider write. Never reopen dispatch.
    try { await recordUnknownPinOutcome(passportId, publicationId, attemptId); }
    catch (error) { if (!(error instanceof WorkflowError) || error.status !== 409) throw error; }
    // Readback may discover a successful write whose acknowledgement was lost.
  }
  // Upload acknowledgement alone cannot create a receipt or issue a certificate.
  return reconcilePinAttempt(passportId, publicationId, attemptId, target, read);
}
