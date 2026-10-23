"use client";

import { useT } from "@/lib/i18n/context";

export type PassportMarks = { issuedTokenId: string | null; correctsTokenId: string | null; correctionOpened: boolean };

/** Publication marks in record lists (D64). Token IDs are public; the issued
 * mark links to the anonymous public page.
 */
export function PassportMarkList({ marks }: { marks: PassportMarks }) {
  const t = useT().review;
  if (!marks.issuedTokenId && !marks.correctsTokenId && !marks.correctionOpened) return null;
  const badge = "rounded-full border px-2 py-0.5 text-xs font-medium";
  return <p className="mt-1 flex flex-wrap gap-2">
    {marks.issuedTokenId && <a href={`/passports/${encodeURIComponent(marks.issuedTokenId)}`} target="_blank" rel="noopener noreferrer"
      className={`${badge} border-brand-200 bg-brand-50 text-brand-800 underline`}>{t.issuedBadge} #{marks.issuedTokenId}</a>}
    {marks.correctsTokenId && <span className={`${badge} border-amber-300 bg-amber-50 text-ink`}>{t.correctsBadge} #{marks.correctsTokenId}</span>}
    {marks.correctionOpened && <span className={`${badge} border-amber-300 bg-amber-50 text-ink`}>{t.correctionOpenBadge}</span>}
  </p>;
}
