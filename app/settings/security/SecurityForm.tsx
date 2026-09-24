"use client";

import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/lib/i18n/context";

export function SecurityForm({ enabled, isAdmin }: { enabled: boolean; isAdmin: boolean }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [qr, setQr] = useState<string>();
  const [backupCodes, setBackupCodes] = useState<string[]>();
  const [active, setActive] = useState(enabled);
  const [newlyEnabled, setNewlyEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const t = useT();

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      const result = await authClient.twoFactor.enable({ password, method: "totp" });
      if (result.error || !result.data || result.data.method !== "totp") throw new Error("MFA setup failed");
      setQr(await QRCode.toDataURL(result.data.totpURI, { margin: 2, width: 220 }));
      setBackupCodes(result.data.backupCodes);
      setPassword("");
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      const result = await authClient.twoFactor.verifyTotp({ code });
      if (result.error) throw new Error("MFA verification failed");
      setCode("");
      setActive(true);
      setNewlyEnabled(true);
      setQr(undefined);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  async function revoke() {
    setPending(true);
    setError(false);
    const result = await authClient.revokeOtherSessions().catch(() => null);
    setRevoked(!!result && !result.error);
    setError(!result || !!result.error);
    setPending(false);
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>{t.account.securityTitle}</CardTitle>
          <CardDescription>{t.account.securityDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {active ? (
            <>
              <p role="status" className="text-sm text-ink">{newlyEnabled ? t.account.mfaComplete : t.account.mfaActive}</p>
              {backupCodes && <RecoveryCodes codes={backupCodes} />}
              {!newlyEnabled && <Button type="button" onClick={revoke} disabled={pending}>{t.account.revokeOthers}</Button>}
              {revoked && <p role="status" className="text-sm text-ink-muted">{t.account.revokeSuccess}</p>}
              <div><Link href={newlyEnabled ? "/login" : isAdmin ? "/admin" : "/"} className="text-sm text-brand-700 underline">{newlyEnabled ? t.account.backToLogin : isAdmin ? t.account.admin : t.header.title}</Link></div>
            </>
          ) : qr ? (
            <>
              <p className="text-sm text-ink-muted">{t.account.setupInstructions}</p>
              <Image src={qr} alt={t.account.authenticatorQrAlt} width={220} height={220} unoptimized />
              <form onSubmit={confirm} className="space-y-4">
                <Input label={t.account.code} value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required disabled={pending} />
                <Button type="submit" loading={pending}>{t.account.verify}</Button>
              </form>
            </>
          ) : (
            <form onSubmit={start} className="space-y-4">
              <Input type="password" label={t.account.setupPassword} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required disabled={pending} />
              <Button type="submit" loading={pending}>{t.account.setupStart}</Button>
            </form>
          )}
          {error && <p role="alert" className="text-sm text-danger">{t.account.setupError}</p>}
        </CardContent>
      </Card>
    </main>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const t = useT();
  return (
    <section aria-label={t.account.backupCodes} className="rounded-lg border border-border p-4">
      <h2 className="font-medium text-ink">{t.account.backupCodes}</h2>
      <p className="mt-1 text-sm text-ink-muted">{t.account.backupWarning}</p>
      <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm" aria-label={t.account.backupCodes}>
        {codes.map((code) => <li key={code}>{code}</li>)}
      </ul>
    </section>
  );
}
