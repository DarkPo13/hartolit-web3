// Test-only CLI. No app feature flag or external provider is activated.
import { openOfflineKuboTunnels } from "./local-kubo-tunnel.mjs";

const close = await openOfflineKuboTunnels();
try {
  process.env.PUBLICATION_LOCAL_KUBO = "1";
  await import("./smoke-publication.mjs");
} finally { await close(); }
