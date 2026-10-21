import { z } from "zod";

export const feedbackSchema = z.strictObject({
  id: z.uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(10).max(2000),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;
