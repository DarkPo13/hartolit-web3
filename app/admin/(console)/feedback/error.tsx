"use client";

import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n/context";

export default function FeedbackInboxError({ reset }: { reset: () => void }) {
  const t = useT();
  return <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
    <h1 className="font-serif text-3xl font-semibold">{t.feedback.inbox}</h1>
    <p role="alert" className="text-sm text-danger">{t.review.loadError}</p>
    <Button type="button" onClick={reset}>{t.drafts.retry}</Button>
  </main>;
}
