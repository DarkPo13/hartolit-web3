import "server-only";

import { createPublicationTarget, RAW_PIN_PROFILE } from "./target";
import { kuboRawRead, kuboRawUpload } from "./kubo-raw";
import type { PublicationPinProvider } from "./upload";

/** Local protocol fixture, not the selected hosted provider. Use an isolated OFFLINE node.
 * No environment config or production route enables this factory. Non-loopback hosts
 * and production execution are rejected, even if supplied with an injected transport.
 */
export async function createLocalKuboProvider(config: { key: string; apiUrl: string; gatewayUrl: string }, request: typeof fetch = fetch): Promise<PublicationPinProvider> {
  if (process.env.NODE_ENV === "production") throw new Error("Local Kubo is unavailable in production");
  for (const value of [config.apiUrl, config.gatewayUrl]) {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname)) throw new Error("Local Kubo requires loopback endpoints");
  }
  const target = await createPublicationTarget({ ...config, kind: "kubo-raw-v1", accountScope: "isolated-offline-fixture", storageProfile: RAW_PIN_PROFILE });
  return Object.freeze<PublicationPinProvider>({ target, upload: kuboRawUpload(target, request), read: kuboRawRead(target, request) });
}
