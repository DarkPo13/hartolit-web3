import { betterAuth } from "better-auth";
import { authOptions } from "./lib/auth-options";

// Schema-generation entrypoint. Runtime database configuration lives in lib/auth.ts.
export const auth = betterAuth(authOptions);
