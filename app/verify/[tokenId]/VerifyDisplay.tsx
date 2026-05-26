"use client";

import { ShieldCheck, AlertTriangle, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { useT } from "@/lib/i18n/context";
import {
  bscscanAddressUrl,
  bscscanTokenUrl,
  ipfsToHttp,
  shortHash,
  formatDateTime,
} from "@/lib/utils";
import type { FieldPassportPayload } from "@/types/passport";

interface PassportData {
  tokenId: string;
  owner: `0x${string}`;
  tokenURI: string;
  payloadHash: `0x${string}`;
  farmerId: string;
  chainId: number;
  contractAddress: `0x${string}`;
  payload: FieldPassportPayload | null;
  computedHash: string | null;
  hashesMatch: boolean;
}

export function VerifyDisplay({ data }: { data: PassportData }) {
  const t = useT();
  const { payload, hashesMatch, payloadHash, computedHash } = data;

  return (
    <>
      <Card tone={hashesMatch ? "brand" : "default"} className="overflow-hidden">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                {hashesMatch ? (
                  <>
                    <ShieldCheck className="h-5 w-5 text-brand-700" />
                    {t.verify.verifiedTitle}
                  </>
                ) : payload ? (
                  <>
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                    {t.verify.tamperedTitle}
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-5 w-5 text-brand-700" />
                    {t.verify.partialTitle}
                  </>
                )}
              </CardTitle>
              <CardDescription>
                {hashesMatch
                  ? t.verify.verifiedDesc
                  : payload
                    ? t.verify.tamperedDesc
                    : t.verify.partialDesc}
              </CardDescription>
            </div>
            <Badge tone={hashesMatch ? "success" : payload ? "danger" : "warning"}>
              {hashesMatch ? "VERIFIED" : payload ? "TAMPERED" : "PARTIAL"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <KV label="Token ID" value={`#${data.tokenId}`} mono />
            <KV
              label={t.verify.ownerLabel}
              value={shortHash(data.owner, 8, 8)}
              mono
              href={bscscanAddressUrl(data.chainId, data.owner)}
            />
            <KV
              label={t.verify.contractLabel}
              value={shortHash(data.contractAddress, 8, 8)}
              mono
              href={bscscanTokenUrl(data.chainId, data.contractAddress, data.tokenId)}
            />
            <KV label={t.verify.farmerIdLabel} value={data.farmerId} mono />
            <KV label="On-chain SHA-256" value={shortHash(payloadHash, 10, 10)} mono full />
            {computedHash && (
              <KV
                label="IPFS SHA-256 (re-computed)"
                value={shortHash(computedHash, 10, 10)}
                mono
                full
              />
            )}
            <KV label="IPFS URI" value={data.tokenURI} mono href={ipfsToHttp(data.tokenURI)} full />
          </dl>
        </CardContent>
      </Card>

      {payload && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t.verify.treatmentTitle}</CardTitle>
            <CardDescription>
              {t.verify.issued} {formatDateTime(payload.timestamp)} · {t.verify.version}{" "}
              {payload.version}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-sm">
              <Section title={t.verify.sectionFarmer}>
                <Row label={t.verify.lName} value={payload.farmerName} />
                <Row label={t.verify.lId} value={payload.farmerId} mono />
                <Row label={t.verify.lCrop} value={payload.crop} />
                <Row label={t.verify.lArea} value={`${payload.fieldArea} ha`} />
                <Row label={t.verify.lGps} value={payload.gpsCoords} mono />
              </Section>
              <Section title={t.verify.sectionTreatment}>
                <Row label={t.verify.lType} value={payload.treatmentType} />
                <Row label={t.verify.lDate} value={`${payload.treatmentDate} ${payload.treatmentTime}`} />
                <Row label={t.verify.lDrone} value={`${payload.droneModel} · ${payload.droneSerial}`} mono />
                <Row label={t.verify.lOperator} value={payload.operator} />
              </Section>
              <Section title={t.verify.sectionMeteo}>
                <Row label="T" value={`${payload.meteoData.temperatureCelsius} °C`} />
                <Row label="H" value={`${payload.meteoData.humidityPercent} %`} />
                <Row label="Wind" value={`${payload.meteoData.windSpeedMps} m/s`} />
                <Row label="Rain" value={`${payload.meteoData.rainfallMm} mm`} />
                <Row
                  label={t.verify.lPilotKep}
                  value={`${payload.pilotSignature.keyId} · ${shortHash(payload.pilotSignature.sha256, 6, 6)}`}
                  mono
                />
              </Section>
              <Section title={t.verify.sectionChemical}>
                <Row label={t.verify.lChemical} value={payload.chemical} />
                <Row label={t.verify.lDose} value={`${payload.dose}`} />
                <Row label={t.verify.lSupplier} value={payload.supplierName} />
                <Row
                  label={t.verify.lSupplierKep}
                  value={`${payload.supplierSignature.keyId} · ${shortHash(payload.supplierSignature.sha256, 6, 6)}`}
                  mono
                />
              </Section>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="mt-6 text-xs text-ink-subtle text-center">
        {t.verify.chainNote.replace("{chainId}", String(data.chainId))}{" "}
        <a
          href={bscscanTokenUrl(data.chainId, data.contractAddress, data.tokenId)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-700 hover:underline inline-flex items-center"
        >
          {t.verify.bscscanLink} <ExternalLink className="h-3 w-3 ml-0.5" />
        </a>
      </p>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-ink-muted border-b border-border pb-2 mb-2">
        {title}
      </h3>
      <dl className="space-y-1">{children}</dl>
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 items-baseline text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={mono ? "hash-mono text-ink" : "text-ink"}>{value}</dd>
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
