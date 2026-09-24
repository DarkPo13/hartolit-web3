import { z } from "zod";

export const submitSchema = z.strictObject({ version: z.number().int().positive() });
export const assignSchema = z.strictObject({ version: z.number().int().positive(), reviewerId: z.string().min(1).max(128).nullable() });
export const decisionSchema = z.strictObject({
  version: z.number().int().positive(),
  decision: z.enum(["APPROVED", "REJECTED", "CORRECTION_REQUIRED"]),
  note: z.string().trim().max(1000).default(""),
});
export const queueQuerySchema = z.strictObject({
  status: z.enum(["ALL", "SUBMITTED", "APPROVED", "REJECTED", "CORRECTION_REQUIRED"]).default("SUBMITTED"),
  page: z.coerce.number().int().min(0).max(500).default(0),
  search: z.string().trim().max(100).default(""),
});

export type ReviewDecision = z.infer<typeof decisionSchema>;
