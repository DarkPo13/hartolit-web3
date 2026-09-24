"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/lib/i18n/context";

export function TwoFactorForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const t = useT();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(false);
    try {
      const result = await authClient.twoFactor.verifyTotp({ code });
      if (result.error) {
        setError(true);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>{t.account.twoFactorTitle}</CardTitle><CardDescription>{t.account.twoFactorDescription}</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <Input label={t.account.code} value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus disabled={pending} />
            {error && <p role="alert" className="text-sm text-danger">{t.account.codeError}</p>}
            <Button type="submit" loading={pending} className="w-full">{t.account.verify}</Button>
          </form>
          <Link href="/login" className="mt-4 inline-block text-sm text-ink-muted hover:text-ink">{t.account.backToLogin}</Link>
        </CardContent>
      </Card>
    </main>
  );
}
