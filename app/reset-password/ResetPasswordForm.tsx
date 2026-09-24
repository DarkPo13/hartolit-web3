"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/lib/i18n/context";

export function ResetPasswordForm({ token, invalid }: { token?: string; invalid: boolean }) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(false);
  const t = useT();

  useEffect(() => {
    if (token) window.history.replaceState({}, "", "/reset-password");
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || pending) return;
    setPending(true);
    setError(false);
    try {
      const result = await authClient.resetPassword({ token, newPassword: password });
      if (result.error) throw new Error("Reset failed");
      setSuccess(true);
      setPassword("");
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>{t.account.resetTitle}</CardTitle></CardHeader>
        <CardContent>
          {success ? <p role="status" className="text-sm text-ink">{t.account.resetSuccess}</p> : !token || invalid ? (
            <p role="alert" className="text-sm text-danger">{t.account.resetInvalid}</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <Input type="password" label={t.account.newPassword} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required disabled={pending} />
              <Button type="submit" loading={pending}>{t.account.resetSubmit}</Button>
              {error && <p role="alert" className="text-sm text-danger">{t.account.resetError}</p>}
            </form>
          )}
          <Link href={success ? "/login" : "/forgot-password"} className="mt-4 inline-block text-sm text-brand-700 underline">{success ? t.account.backToLogin : t.account.resetRequestTitle}</Link>
        </CardContent>
      </Card>
    </main>
  );
}
