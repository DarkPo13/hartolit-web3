"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { FileSearch } from "lucide-react";
import { useT } from "@/lib/i18n/context";

export default function NotFound() {
  const t = useT();
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <Card className="p-12 text-center">
        <FileSearch className="mx-auto h-12 w-12 text-ink-subtle" />
        <h1 className="mt-4 text-xl font-semibold">{t.notFound.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t.notFound.desc}</p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center text-sm text-brand-700 hover:underline"
        >
          {t.notFound.home}
        </Link>
      </Card>
    </main>
  );
}
