import "server-only";
import { getDb } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { FeedbackInput } from "./schema";

export class FeedbackError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function saveFeedback(userId: string, input: FeedbackInput) {
  try {
    return await getDb().$transaction(async (tx) => {
      // Serialize the per-account quota and retries across app instances.
      await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;
      const previous = await tx.productFeedback.findUnique({ where: { id: input.id } });
      if (previous) {
        if (previous.userId !== userId || previous.rating !== input.rating || previous.comment !== input.comment) {
          throw new FeedbackError(409, "Feedback request changed");
        }
        return { id: previous.id, created: false };
      }
      const count = await tx.productFeedback.count({ where: { userId, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
      if (count >= 5) throw new FeedbackError(429, "Feedback limit reached");
      const saved = await tx.productFeedback.create({ data: { ...input, userId }, select: { id: true } });
      return { id: saved.id, created: true };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new FeedbackError(409, "Feedback request changed");
    }
    throw error;
  }
}

export async function latestFeedback() {
  return getDb().productFeedback.findMany({
    take: 50,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, rating: true, comment: true, createdAt: true },
  });
}
