"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { authClient } from "@/lib/auth-client";
import { useLocale, useT } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/types";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const { locale, setLocale } = useLocale();
  const t = useT();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      const result = await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        setError(true);
        setPassword("");
        return;
      }
      if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) {
        router.replace("/two-factor");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError(true);
      setPassword("");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <Card className="w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-surface-2/60 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Hartolit" width={32} height={32} className="rounded-lg" />
            <span className="text-sm font-semibold text-ink">Hartolit</span>
          </div>
          <div className="flex gap-1 text-xs">
            {(["uk", "en"] as Locale[]).map((item) => (
              <button key={item} type="button" onClick={() => setLocale(item)} aria-pressed={locale === item} className={locale === item ? "rounded bg-brand-600 px-2 py-1 text-white" : "rounded px-2 py-1 text-ink-muted"}>{item.toUpperCase()}</button>
            ))}
          </div>
        </div>
        <CardHeader>
          <CardTitle>{t.account.loginTitle}</CardTitle>
          <CardDescription>{t.account.loginDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <Input type="email" label={t.account.email} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required autoFocus disabled={pending} />
            <Input type="password" label={t.account.password} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required disabled={pending} />
            {error && <p role="alert" className="text-sm text-danger">{t.account.loginError}</p>}
            <Button type="submit" loading={pending} className="w-full">{t.account.signIn}</Button>
          </form>
          <Link href="/forgot-password" className="mt-4 inline-block text-sm text-brand-700 underline">{t.account.forgotPassword}</Link>
        </CardContent>
      </Card>
    </main>
  );
}
