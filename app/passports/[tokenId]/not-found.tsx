"use client";

import { useT } from "@/lib/i18n/context";

export default function PassportNotFound() {
  const t = useT();
  return <main className="mx-auto max-w-3xl px-4 py-16 text-center">
    <h1 className="text-xl font-semibold">{t.notFound.title}</h1>
    <p className="mt-2 text-sm text-ink-muted">{t.notFound.desc}</p>
  </main>;
}
