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
import { useT } from "@/lib/i18n/context";
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
  const t = useT();

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
          <p className="text-ink-muted">{t.step3.noResult}</p>
          <Button variant="ghost" className="mt-4" onClick={prev}>
            {t.step3.backToMint}
          </Button>
        </Card>
      </div>
    );
  }

  const issuedAt = formatDateTime(result.mintedAt);

  return (
    <div className="space-y-5 fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <h2 className="text-lg font-semibold text-ink">{t.step3.title}</h2>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.print()}
            leadingIcon={<Printer className="h-4 w-4" />}
          >
            {t.step3.print}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => downloadHtmlCertificate(certRef.current)}
            leadingIcon={<Download className="h-4 w-4" />}
          >
            {t.step3.html}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm(t.step3.confirmReset)) {
                reset();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
            leadingIcon={<RotateCcw className="h-4 w-4" />}
          >
            {t.step3.newPassport}
          </Button>
        </div>
      </div>

      <Card ref={certRef} className="overflow-hidden">
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
                {t.step3.certNumber}{" "}
                <span className="hash-mono font-semibold">HFP-{result.tokenId}</span>{" "}
                · {t.step3.issuedAt} {issuedAt}
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-8">
          <Section title={t.step3.sectionFarmer}>
            <Row label={t.step3.lFarmer} value={state.farmer.farmerName} />
            <Row label={t.step3.lId} value={state.farmer.farmerId} mono />
            <Row label={t.step3.lCrop} value={state.farmer.crop} />
            <Row label={t.step3.lArea} value={`${state.farmer.fieldArea ?? "—"} ha`} />
            <Row label={t.step3.lGps} value={state.farmer.gpsCoords} mono />
            {state.farmer.cadastralNumber && (
              <Row label={t.step3.lCadastral} value={state.farmer.cadastralNumber} mono />
            )}
          </Section>

          <Section title={t.step3.sectionTreatment}>
            <Row label={t.step3.lType} value={state.treatment.treatmentType} />
            <Row
              label={t.step3.lDateTime}
              value={`${state.treatment.treatmentDate} ${state.treatment.treatmentTime}`}
            />
            <Row
              label={t.step3.lDrone}
              value={`${state.treatment.droneModel} · ${state.treatment.droneSerial}`}
              mono
            />
            <Row label={t.step3.lOperator} value={state.treatment.operator} />
            <Row label={t.step3.lDarsCert} value={state.treatment.pilotCert} mono />
          </Section>

          <Section title={t.step3.sectionMeteo}>
            <Row label={t.step3.lTemp} value={`${state.meteo.meteoData?.temperatureCelsius ?? "—"} °C`} />
            <Row label={t.step3.lHumidity} value={`${state.meteo.meteoData?.humidityPercent ?? "—"} %`} />
            <Row label={t.step3.lWind} value={`${state.meteo.meteoData?.windSpeedMps ?? "—"} m/s`} />
            <Row label={t.step3.lRain} value={`${state.meteo.meteoData?.rainfallMm ?? "—"} mm`} />
            {state.meteo.pilotSignature && (
              <Row
                label={t.step3.lPilotKep}
                value={`${state.meteo.pilotSignature.keyId} · ${shortHash(state.meteo.pilotSignature.sha256, 6, 6)}`}
                mono
                badge="success"
              />
            )}
          </Section>

          <Section title={t.step3.sectionChemical}>
            <Row label={t.step3.lChemical} value={state.chemical.chemical} />
            <Row label={t.step3.lActive} value={state.chemical.chemicalActive} />
            <Row label={t.step3.lDose} value={`${state.chemical.dose} (ha)`} />
            <Row label={t.step3.lWorkingVol} value={`${state.chemical.workingVolume} L/ha`} />
            <Row label={t.step3.lManufacturer} value={state.chemical.manufacturer} />
            <Row label={t.step3.lRegNumber} value={state.chemical.regNumber} mono />
            <Row
              label={t.step3.lSupplier}
              value={`${state.chemical.supplierName} (EDRPOU ${state.chemical.supplierEdrpou})`}
            />
            {state.chemical.supplierSignature && (
              <Row
                label={t.step3.lSupplierKep}
                value={`${state.chemical.supplierSignature.keyId} · ${shortHash(state.chemical.supplierSignature.sha256, 6, 6)}`}
                mono
                badge="success"
              />
            )}
          </Section>
        </div>

        <div className="border-t border-border bg-surface-2/40 p-8">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-muted mb-3">
            {t.step3.chainProof}
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
              label={t.step3.lManufacturer}
              value={shortHash(result.contractAddress, 8, 8)}
              mono
              href={bscscanTokenUrl(result.chainId, result.contractAddress, result.tokenId)}
            />
            <KV label="Payload SHA-256" value={shortHash(result.payloadHash, 12, 12)} mono full />
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
            {t.step3.disclaimer}
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-4 no-print">
        <Button variant="ghost" leadingIcon={<ArrowLeft className="h-4 w-4" />} onClick={prev}>
          {t.step3.back}
        </Button>
        <Badge tone="brand">{t.step3.done}</Badge>
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
