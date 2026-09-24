"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/lib/i18n/context";

export function ResetRequestForm({ available }: { available: boolean }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);
  const t = useT();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !available) return;
    setPending(true);
    setError(false);
    try {
      const result = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (result.error) throw new Error("Request failed");
      setSent(true);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>{t.account.resetRequestTitle}</CardTitle><CardDescription>{t.account.resetRequestDescription}</CardDescription></CardHeader>
        <CardContent>
          {!available ? <p role="status" className="text-sm text-ink-muted">{t.account.resetUnavailable}</p> : sent ? (
            <p role="status" className="text-sm text-ink">{t.account.resetRequestSuccess}</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <Input type="email" label={t.account.email} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required disabled={pending} />
              <Button type="submit" loading={pending}>{t.account.resetRequestSubmit}</Button>
              {error && <p role="alert" className="text-sm text-danger">{t.account.resetError}</p>}
            </form>
          )}
          <Link href="/login" className="mt-4 inline-block text-sm text-brand-700 underline">{t.account.backToLogin}</Link>
        </CardContent>
      </Card>
    </main>
  );
}
