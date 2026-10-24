"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/context";

export default function NotFound() {
  const t = useT();
  return <main className="mx-auto max-w-3xl px-4 py-16 text-center">
    <h1 className="text-xl font-semibold">{t.notFound.pageTitle}</h1>
    <p className="mt-2 text-sm text-ink-muted">{t.notFound.pageDesc}</p>
    <Link href="/" className="mt-4 inline-block text-sm text-brand-700 underline">{t.notFound.home}</Link>
  </main>;
}
