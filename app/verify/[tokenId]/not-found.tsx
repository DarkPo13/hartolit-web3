import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { FileSearch } from "lucide-react";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <Card className="p-12 text-center">
        <FileSearch className="mx-auto h-12 w-12 text-ink-subtle" />
        <h1 className="mt-4 text-xl font-semibold">Паспорт не знайдено</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Токен з таким ID не існує у контракті Hartolit Field Passport.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center text-sm text-brand-700 hover:underline"
        >
          На головну →
        </Link>
      </Card>
    </main>
  );
}
