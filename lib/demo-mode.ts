/** Prototype writes and simulated integrations are opt-in and local-only. */
export function isDemoMode(): boolean {
  return process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

export const DEMO_WRITE_UNAVAILABLE =
  "Prototype writes are disabled. Authenticated production issuance is not configured.";
