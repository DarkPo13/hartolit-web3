import { admin, twoFactor } from "better-auth/plugins";
import { loadEnvConfig } from "@next/env";
import { clientIpAddressOptions } from "./client-ip";
import { afterPasswordResetRequest, enqueuePasswordResetEmail, RESET_LINK_SECONDS } from "./password-reset-outbox";
import { refuseReusedTotp } from "./totp-replay";

loadEnvConfig(process.cwd());

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

// Shared between the application and the Better Auth schema generator.
export const authOptions = {
  appName: "Hartolit Field Passport",
  baseURL,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: RESET_LINK_SECONDS,
    // Only a durable outbox row while the client waits; the email is sent outside this
    // request, and an unknown address writes the same kind of row (D81).
    sendResetPassword: async ({ user, url }: { user: { id: string }; url: string }, request?: Request) => {
      await enqueuePasswordResetEmail(user.id, url, request);
    },
  },
  session: {
    expiresIn: 8 * 60 * 60,
    updateAge: 60 * 60,
  },
  rateLimit: {
    enabled: true,
    storage: "database" as const,
    window: 60,
    max: 30,
    customRules: {
      "/sign-in/email": { window: 15 * 60, max: 5 },
      "/request-password-reset": { window: 15 * 60, max: 3 },
      "/two-factor/verify-totp": { window: 15 * 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 15 * 60, max: 5 },
    },
  },
  advanced: {
    // The address the rate limits above count by (D78).
    ipAddress: clientIpAddressOptions(baseURL),
    defaultCookieAttributes: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
    },
  },
  hooks: { before: refuseReusedTotp, after: afterPasswordResetRequest },
  plugins: [admin(), twoFactor({ issuer: "Hartolit" })],
};
