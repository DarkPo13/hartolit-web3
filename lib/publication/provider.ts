import "server-only";

import { WorkflowError } from "@/lib/review/service";
import { kuboRawRead, kuboRawUpload } from "./kubo-raw";
import { preparationTarget } from "./preparation";
import type { PublicationPinProvider } from "./upload";

const loopback = (origin: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);

/** The server-configured uploader for the reviewed `kubo-raw-v1` target (D67).
 * A loopback target is a node on this machine and may run without a credential;
 * any other target is HTTPS (target schema) and requires the server-only RPC token.
 * Upload and pin readback use the target's own RPC; bytes come from its gateway
 * and are hash-checked before anything is recorded.
 */
export async function configuredPinProvider(request: typeof fetch = fetch): Promise<PublicationPinProvider> {
  const target = await preparationTarget();
  const token = process.env.HARTOLIT_PUBLICATION_API_TOKEN?.trim() || undefined;
  if (token && /[\r\n]/.test(token)) throw new WorkflowError(503, "Publication upload credential is invalid");
  if (!token && !(loopback(target.apiUrl) && loopback(target.gatewayUrl))) {
    throw new WorkflowError(503, "Publication upload credential is not configured");
  }
  return Object.freeze<PublicationPinProvider>({ target, upload: kuboRawUpload(target, request, token), read: kuboRawRead(target, request, token) });
}

export async function pinUploadConfigured() {
  try { await configuredPinProvider(); return true; }
  catch (error) { if (error instanceof WorkflowError && error.status === 503) return false; throw error; }
}
