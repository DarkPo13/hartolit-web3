"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useLocale, useT } from "@/lib/i18n/context";

export function FeedbackForm({ back }: { back: string }) {
  const t = useT().feedback;
  const { locale, setLocale } = useLocale();
  const [rating, setRating] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  const sending = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true; setBusy(true); setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: requestId.current, rating: Number(rating), comment: comment.trim() }) });
      if (!response.ok) { setError(response.status === 429 ? t.limit : response.status === 401 || response.status === 403 ? t.sessionError : t.error); return; }
      setSent(true);
    } catch { setError(t.error); }
    finally { sending.current = false; setBusy(false); }
  }

  return <main className="mx-auto max-w-xl px-4 py-8 sm:py-12">
    <nav className="mb-6 flex items-center justify-between text-sm" aria-label={t.navigation}>
      <Link href={back} className="font-medium text-brand-700 underline">{t.back}</Link>
      <button type="button" onClick={() => setLocale(locale === "uk" ? "en" : "uk")} className="font-medium text-brand-700 underline">{locale === "uk" ? "EN" : "УКР"}</button>
    </nav>
    <section className="rounded-2xl border border-border bg-surface p-6 shadow-soft sm:p-8">
      <MessageSquare className="mb-4 h-8 w-8 text-brand-700" aria-hidden />
      <h1 className="font-serif text-3xl font-semibold">{t.title}</h1>
      {sent ? <div role="status" className="mt-6 space-y-4">
        <CheckCircle2 className="h-10 w-10 text-brand-700" aria-hidden />
        <h2 className="text-xl font-semibold">{t.success}</h2>
        <p className="text-sm text-ink-muted">{t.successDescription}</p>
        <Button asChild><Link href={back}>{t.back}</Link></Button>
      </div> : <>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">{t.description}</p>
        <form onSubmit={submit} className="mt-6 space-y-6">
          <fieldset disabled={busy}>
            <legend className="text-sm font-semibold">{t.rating}</legend>
            <p id="feedback-rating-hint" className="mt-1 text-xs text-ink-muted">{t.ratingHint}</p>
            <div className="mt-3 flex gap-3">{[1, 2, 3, 4, 5].map(value => <label key={value} className={`flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border p-3 text-sm ${rating === String(value) ? "border-brand-600 bg-brand-50 text-brand-900" : "border-border"}`}>
              <input type="radio" name="rating" value={value} required checked={rating === String(value)} onChange={event => { setRating(event.target.value); requestId.current = null; }} aria-describedby="feedback-rating-hint" className="accent-brand-600" />{value}
            </label>)}</div>
          </fieldset>
          <div>
            <label htmlFor="feedback-comment" className="block text-sm font-semibold">{t.comment}</label>
            <p id="feedback-comment-hint" className="mt-1 text-xs text-ink-muted">{t.commentHint}</p>
            <textarea id="feedback-comment" required minLength={10} maxLength={2000} disabled={busy} value={comment} onChange={event => { setComment(event.target.value); requestId.current = null; }} aria-describedby="feedback-comment-hint" rows={5} className="mt-3 w-full resize-y rounded-lg border border-border bg-surface p-3 text-sm disabled:opacity-50" />
          </div>
          <p className="rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-ink-muted">{t.privacy}</p>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" loading={busy}>{busy ? t.sending : t.send}</Button>
        </form>
      </>}
    </section>
  </main>;
}
