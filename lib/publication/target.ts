import { z } from "zod";
import { canonicalize, sha256Hex } from "@/lib/hash";

export const RAW_PIN_PROFILE = "raw-cidv1-sha256-64k-v1";
const endpoint = z.url().refine((value) => {
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  return (url.protocol === "https:" || (local && url.protocol === "http:")) &&
    !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
}).transform((value) => new URL(value).origin);
const descriptionSchema = z.strictObject({
  key: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  kind: z.literal("kubo-raw-v1"), accountScope: z.string().trim().min(1).max(128),
  apiUrl: endpoint, gatewayUrl: endpoint, storageProfile: z.literal(RAW_PIN_PROFILE),
});
const targetSchema = descriptionSchema.extend({ configurationSha256: z.string().regex(/^[a-f0-9]{64}$/) });
export type PublicationTarget = Readonly<z.infer<typeof targetSchema>>;

/** Non-secret server-owned description. Never accept an upload URL/target from a browser. */
export async function createPublicationTarget(input: z.input<typeof descriptionSchema>): Promise<PublicationTarget> {
  const description = descriptionSchema.parse(input);
  return Object.freeze({ ...description, configurationSha256: await sha256Hex(canonicalize(description)) });
}

export async function validatePublicationTarget(input: unknown): Promise<PublicationTarget> {
  const target = targetSchema.parse(input);
  const { configurationSha256, ...description } = target;
  if (await sha256Hex(canonicalize(description)) !== configurationSha256) throw new Error("Publication target changed");
  return Object.freeze(target);
}
