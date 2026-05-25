"use client";

import { useEffect, useState, useRef } from "react";
import {
  ArrowLeft,
  Download,
  Printer,
  RotateCcw,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useWizardStore } from "@/lib/store";
import {
  bscscanTokenUrl,
  bscscanTxUrl,
  formatDateTime,
  ipfsToHttp,
  shortHash,
} from "@/lib/utils";
import { TARGET_CHAIN_ID } from "@/lib/wagmi";

export function Step3Certificate() {
  const state = useWizardStore();
  const prev = useWizardStore((s) => s.prev);
  const reset = useWizardStore((s) => s.reset);
  const result = state.mintResult;

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const certRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!result) return;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
    const verifyUrl = `${baseUrl}/verify/${result.tokenId}`;
    QRCode.toDataURL(verifyUrl, {
      margin: 1,
      width: 320,
      color: { dark: "#064e3b", light: "#fafaf7" },
    }).then(setQrDataUrl);
  }, [result]);

  if (!result) {
    return (
      <div className="space-y-4 fade-in">
        <Card className="p-8 text-center">
          <p className="text-ink-muted">Сертифікат буде доступний після випуску NFT.</p>
          <Button variant="ghost" className="mt-4" onClick={prev}>
            Повернутися до мінту
          </Button>
        </Card>
      </div>
    );
  }

  const issuedAt = formatDateTime(result.mintedAt);

  return (
    <div className="space-y-5 fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <h2 className="text-lg font-semibold text-ink">Цифровий паспорт</h2>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.print()}
            leadingIcon={<Printer className="h-4 w-4" />}
          >
            Друк
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => downloadHtmlCertificate(certRef.current)}
            leadingIcon={<Download className="h-4 w-4" />}
          >
            HTML
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm("Очистити форму і створити новий паспорт?")) {
                reset();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
            leadingIcon={<RotateCcw className="h-4 w-4" />}
          >
            Новий
          </Button>
        </div>
      </div>

      <Card ref={certRef} className="overflow-hidden">
        {/* Certificate header — formal */}
        <div className="bg-gradient-to-br from-brand-800 via-brand-700 to-brand-900 p-8 text-white">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="pulse-dot" />
                <span className="hash-mono text-xs uppercase tracking-widest text-brand-200">
                  Hartolit · BNB Chain · Chain {result.chainId}
                </span>
              </div>
              <h1
                className="mt-3 text-3xl font-semibold leading-tight"
                style={{ fontFamily: "var(--font-crimson)" }}
              >
                Hartolit Digital Field Passport
              </h1>
              <p className="mt-1 text-sm text-brand-100">
                Сертифікат № <span className="hash-mono font-semibold">HFP-{result.tokenId}</span>{" "}
                · виданий {issuedAt}
              </p>
            </div>
            <div className="rounded-lg bg-white/10 p-2 backdrop-blur-sm">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="Verification QR" className="h-28 w-28 rounded" />
              ) : (
                <div className="h-28 w-28 rounded bg-white/20" />
              )}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-8">
          <Section title="Фермер та поле">
            <Row label="Фермер" value={state.farmer.farmerName} />
            <Row label="ЄДРПОУ/ІПН" value={state.farmer.farmerId} mono />
            <Row label="Культура" value={state.farmer.crop} />
            <Row label="Площа" value={`${state.farmer.fieldArea ?? "—"} га`} />
            <Row label="GPS" value={state.farmer.gpsCoords} mono />
            {state.farmer.cadastralNumber && (
              <Row label="Кадастр" value={state.farmer.cadastralNumber} mono />
            )}
          </Section>

          <Section title="Обробка">
            <Row label="Тип" value={state.treatment.treatmentType} />
            <Row
              label="Дата і час"
              value={`${state.treatment.treatmentDate} ${state.treatment.treatmentTime}`}
            />
            <Row
              label="Дрон"
              value={`${state.treatment.droneModel} · ${state.treatment.droneSerial}`}
              mono
            />
            <Row label="Оператор" value={state.treatment.operator} />
            <Row label="Ліцензія DARS" value={state.treatment.pilotCert} mono />
          </Section>

          <Section title="Метео">
            <Row label="Температура" value={`${state.meteo.meteoData?.temperatureCelsius ?? "—"} °C`} />
            <Row label="Вологість" value={`${state.meteo.meteoData?.humidityPercent ?? "—"} %`} />
            <Row label="Вітер" value={`${state.meteo.meteoData?.windSpeedMps ?? "—"} м/с`} />
            <Row label="Опади" value={`${state.meteo.meteoData?.rainfallMm ?? "—"} мм`} />
            {state.meteo.pilotSignature && (
              <Row
                label="КЕП пілота"
                value={`${state.meteo.pilotSignature.keyId} · ${shortHash(state.meteo.pilotSignature.sha256, 6, 6)}`}
                mono
                badge="success"
              />
            )}
          </Section>

          <Section title="Хімія">
            <Row label="Препарат" value={state.chemical.chemical} />
            <Row label="Діюча речовина" value={state.chemical.chemicalActive} />
            <Row label="Доза" value={`${state.chemical.dose} (на га)`} />
            <Row label="Робочий об'єм" value={`${state.chemical.workingVolume} л/га`} />
            <Row label="Виробник" value={state.chemical.manufacturer} />
            <Row label="№ реєстрації" value={state.chemical.regNumber} mono />
            <Row
              label="Постачальник"
              value={`${state.chemical.supplierName} (ЄДРПОУ ${state.chemical.supplierEdrpou})`}
            />
            {state.chemical.supplierSignature && (
              <Row
                label="КЕП постачальника"
                value={`${state.chemical.supplierSignature.keyId} · ${shortHash(state.chemical.supplierSignature.sha256, 6, 6)}`}
                mono
                badge="success"
              />
            )}
          </Section>
        </div>

        {/* Blockchain footer */}
        <div className="border-t border-border bg-surface-2/40 p-8">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-muted mb-3">
            On-chain proof
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <KV label="Token ID" value={`#${result.tokenId}`} mono />
            <KV
              label="Tx hash"
              value={shortHash(result.txHash, 10, 10)}
              mono
              href={bscscanTxUrl(result.chainId, result.txHash)}
            />
            <KV label="Block" value={String(result.blockNumber)} mono />
            <KV
              label="Контракт"
              value={shortHash(result.contractAddress, 8, 8)}
              mono
              href={bscscanTokenUrl(result.chainId, result.contractAddress, result.tokenId)}
            />
            <KV
              label="Payload SHA-256"
              value={shortHash(result.payloadHash, 12, 12)}
              mono
              full
            />
            <KV
              label="IPFS URI"
              value={result.ipfsUri}
              mono
              href={ipfsToHttp(result.ipfsUri)}
              full
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <ShieldCheck className="h-4 w-4 text-brand-700" />
            Документ підписано двома КЕП-сертифікатами через Дія та закріплено на BNB Chain.
            Будь-яка зміна даних змінить SHA-256 та зробить підпис недійсним.
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-4 no-print">
        <Button variant="ghost" leadingIcon={<ArrowLeft className="h-4 w-4" />} onClick={prev}>
          Назад
        </Button>
        <Badge tone="brand">Готово</Badge>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-ink-muted border-b border-border pb-2 mb-3">
        {title}
      </h3>
      <dl className="space-y-1.5">{children}</dl>
    </section>
  );
}

function Row({
  label,
  value,
  mono,
  badge,
}: {
  label: string;
  value?: string | number | null;
  mono?: boolean;
  badge?: "success" | "warning";
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 text-sm items-baseline">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="flex items-center gap-2">
        <span className={mono ? "hash-mono text-ink" : "text-ink"}>{value ?? "—"}</span>
        {badge && <Badge tone={badge}>verified</Badge>}
      </dd>
    </div>
  );
}

function KV({
  label,
  value,
  mono,
  href,
  full,
}: {
  label: string;
  value: string;
  mono?: boolean;
  href?: string;
  full?: boolean;
}) {
  const text = (
    <span className={mono ? "hash-mono" : ""}>
      {value}
      {href && <ExternalLink className="inline h-3 w-3 ml-1" />}
    </span>
  );
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <span className="text-xs text-ink-muted">{label}:&nbsp;</span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
          {text}
        </a>
      ) : (
        <span className="text-ink">{text}</span>
      )}
    </div>
  );
}

function downloadHtmlCertificate(node: HTMLDivElement | null) {
  if (!node) return;
  const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>Hartolit Field Passport</title>
<style>
body{font-family: ui-sans-serif, system-ui, sans-serif; background:#fafaf7; padding:32px; color:#0a0a09;}
.hash-mono{font-family: ui-monospace, monospace; letter-spacing:-0.01em;}
.card{max-width:960px; margin:0 auto; background:white; border:1px solid #e7e5e4; border-radius:16px; overflow:hidden;}
</style></head><body><div class="card">${node.innerHTML}</div></body></html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hartolit-passport-${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
