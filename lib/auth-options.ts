import { admin, twoFactor } from "better-auth/plugins";
import { loadEnvConfig } from "@next/env";
import { after } from "next/server";
import { sendPasswordResetEmail } from "./reset-email";

loadEnvConfig(process.cwd());

// Shared between the application and the Better Auth schema generator.
export const authOptions = {
  appName: "Hartolit Field Passport",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
      // Keep response timing independent of SMTP delivery while allowing the
      // platform to finish the send after the response is returned.
      after(async () => {
        try {
          await sendPasswordResetEmail(user.email, url);
        } catch (error) {
          console.error("Password reset email delivery failed", error instanceof Error ? error.name : "unknown");
        }
      });
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
    defaultCookieAttributes: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
    },
  },
  plugins: [admin(), twoFactor({ issuer: "Hartolit" })],
};
