import "server-only";

import type { Prisma } from "@/generated/prisma/client";

/** Publication marks for record lists (D64): the issued token, the token a
 * correction replaces, and whether a correction of this record is open.
 * Token IDs are public chain identifiers.
 */
export const passportMarksSelect = {
  publications: { where: { status: "PUBLISHED", tokenId: { not: null } }, select: { tokenId: true }, take: 1 },
  correctionOf: { select: { supersededPublication: { select: { tokenId: true } } }, take: 1 },
  supersededBy: { select: { id: true }, take: 1 },
} satisfies Prisma.PassportSelect;

type MarksRow = Prisma.PassportGetPayload<{ select: typeof passportMarksSelect }>;
export type PassportMarks = { issuedTokenId: string | null; correctsTokenId: string | null; correctionOpened: boolean };

export function passportMarks(row: MarksRow): PassportMarks {
  return {
    issuedTokenId: row.publications[0]?.tokenId ?? null,
    correctsTokenId: row.correctionOf[0]?.supersededPublication.tokenId ?? null,
    correctionOpened: row.supersededBy.length > 0,
  };
}
