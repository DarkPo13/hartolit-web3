// The Better Auth CLI runs outside Next.js and cannot import `server-only` modules.
import { prismaAdapter } from "better-auth/adapters/prisma";
import { betterAuth } from "better-auth";
import { authOptions } from "./lib/auth-options";
import { getDb } from "./lib/db-core";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");

export const auth = betterAuth({
  ...authOptions,
  secret,
  database: prismaAdapter(getDb(), { provider: "postgresql" }),
});
