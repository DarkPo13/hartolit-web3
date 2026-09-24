import "server-only";

import { prismaAdapter } from "better-auth/adapters/prisma";
import { betterAuth } from "better-auth";
import { authOptions } from "@/lib/auth-options";
import { getDb } from "@/lib/db";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
}

if (process.env.NODE_ENV === "production" && !process.env.BETTER_AUTH_URL) {
  throw new Error("BETTER_AUTH_URL is required in production");
}

export const auth = betterAuth({
  ...authOptions,
  secret,
  database: prismaAdapter(getDb(), { provider: "postgresql" }),
});
