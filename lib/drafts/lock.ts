import "server-only";

import type { Prisma } from "@/generated/prisma/client";

// The passport row is the serialization point for edits, evidence changes, and submission.
export async function touchEditablePassport(tx: Prisma.TransactionClient, ownerId: string, passportId: string): Promise<boolean> {
  const changed = await tx.passport.updateMany({
    where: { id: passportId, ownerId, status: "DRAFT" },
    data: { updatedAt: new Date() },
  });
  return changed.count === 1;
}
