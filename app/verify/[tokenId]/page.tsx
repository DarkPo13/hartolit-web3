import { notFound } from "next/navigation";
import { createPublicClient, http } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { ShieldCheck, AlertTriangle, ExternalLink, Leaf } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { HARTOLIT_PASSPORT_ABI } from "@/lib/contract";
import { fetchJsonFromIpfs } from "@/lib/ipfs";
import { canonicalize, sha256Hex } from "@/lib/hash";
import {
  bscscanAddressUrl,
  bscscanTokenUrl,
  ipfsToHttp,
  shortHash,
  formatDateTime,
} from "@/lib/utils";
import type { FieldPassportPayload } from "@/types/passport";

interface PageProps {
  params: Promise<{ tokenId: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadPassport(tokenIdStr: string) {
  let tokenId: bigint;
  try {
    tokenId = BigInt(tokenIdStr);
  } catch {
    return null;
  }

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97);
  const chain = chainId === 56 ? bsc : bscTestnet;
  const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as
    | `0x${string}`
    | undefined;

  if (!contractAddress) {
    return { error: "Contract address not configured" };
  }

  const client = createPublicClient({
    chain,
    transport: http(
      chainId === 56
        ? process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com"
        : process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com",
    ),
  });

  try {
    const [owner, tokenURI, payloadHash, farmerId] = await Promise.all([
      client.readContract({
        address: contractAddress,
        abi: HARTOLIT_PASSPORT_ABI,
        functionName: "ownerOf",
        args: [tokenId],
      }),
      client.readContract({
        address: contractAddress,
        abi: HARTOLIT_PASSPORT_ABI,
        functionName: "tokenURI",
        args: [tokenId],
      }),
      client.readContract({
        address: contractAddress,
        abi: HARTOLIT_PASSPORT_ABI,
        functionName: "payloadHash",
        args: [tokenId],
      }),
      client.readContract({
        address: contractAddress,
        abi: HARTOLIT_PASSPORT_ABI,
        functionName: "farmerId",
        args: [tokenId],
      }),
    ]);

    let payload: FieldPassportPayload | null = null;
    let computedHash: string | null = null;
    let hashesMatch = false;
    try {
      payload = await fetchJsonFromIpfs<FieldPassportPayload>(tokenURI as string);
      computedHash = `0x${await sha256Hex(canonicalize(payload))}`;
      hashesMatch = computedHash.toLowerCase() === (payloadHash as string).toLowerCase();
    } catch (e) {
      console.warn("[verify] IPFS fetch failed:", e);
    }

    return {
      tokenId: tokenIdStr,
      owner: owner as `0x${string}`,
      tokenURI: tokenURI as string,
      payloadHash: payloadHash as `0x${string}`,
      farmerId: farmerId as string,
      chainId,
      contractAddress,
      payload,
      computedHash,
      hashesMatch,
    };
  } catch (e) {
    console.error("[verify] read error:", e);
    return null;
  }
}

export default async function VerifyPage({ params }: PageProps) {
  const { tokenId } = await params;
  const data = await loadPassport(tokenId);

  if (!data) notFound();
  if ("error" in data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <Card className="p-8">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-amber-600 flex-shrink-0" />
            <div>
              <h1 className="text-lg font-semibold">Верифікація недоступна</h1>
              <p className="text-sm text-ink-muted mt-1">{data.error}</p>
            </div>
          </div>
        </Card>
      </main>
    );
  }

  const { payload, hashesMatch, payloadHash, computedHash } = data;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:py-12">
      <header className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-soft">
          <Leaf className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Hartolit · Field Passport</h1>
          <p className="text-xs text-ink-muted">Публічна верифікація токена #{data.tokenId}</p>
        </div>
      </header>

      <Card
        tone={hashesMatch ? "brand" : "default"}
        className="overflow-hidden"
      >
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                {hashesMatch ? (
                  <>
                    <ShieldCheck className="h-5 w-5 text-brand-700" />
                    Підлинність підтверджена
                  </>
                ) : payload ? (
                  <>
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                    Розбіжність хешу
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-5 w-5 text-brand-700" />
                    Запис існує
                  </>
                )}
              </CardTitle>
              <CardDescription>
                {hashesMatch
                  ? "SHA-256 IPFS-документа збігається з хешем у блокчейні."
                  : payload
                    ? "IPFS-документ не збігається з on-chain хешем. Документ міг бути змінено."
                    : "Не вдалося завантажити IPFS-документ для повної перевірки."}
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
              label="Власник"
              value={shortHash(data.owner, 8, 8)}
              mono
              href={bscscanAddressUrl(data.chainId, data.owner)}
            />
            <KV
              label="Контракт"
              value={shortHash(data.contractAddress, 8, 8)}
              mono
              href={bscscanTokenUrl(data.chainId, data.contractAddress, data.tokenId)}
            />
            <KV label="Farmer ID" value={data.farmerId} mono />
            <KV
              label="On-chain SHA-256"
              value={shortHash(payloadHash, 10, 10)}
              mono
              full
            />
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
            <CardTitle>Дані обробки</CardTitle>
            <CardDescription>
              Випущено {formatDateTime(payload.timestamp)} · версія {payload.version}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-sm">
              <Section title="Фермер">
                <Row label="Назва" value={payload.farmerName} />
                <Row label="ЄДРПОУ/ІПН" value={payload.farmerId} mono />
                <Row label="Культура" value={payload.crop} />
                <Row label="Площа" value={`${payload.fieldArea} га`} />
                <Row label="GPS" value={payload.gpsCoords} mono />
              </Section>
              <Section title="Обробка">
                <Row label="Тип" value={payload.treatmentType} />
                <Row label="Дата" value={`${payload.treatmentDate} ${payload.treatmentTime}`} />
                <Row label="Дрон" value={`${payload.droneModel} · ${payload.droneSerial}`} mono />
                <Row label="Оператор" value={payload.operator} />
              </Section>
              <Section title="Метео">
                <Row label="T" value={`${payload.meteoData.temperatureCelsius} °C`} />
                <Row label="H" value={`${payload.meteoData.humidityPercent} %`} />
                <Row label="Wind" value={`${payload.meteoData.windSpeedMps} m/s`} />
                <Row label="Rain" value={`${payload.meteoData.rainfallMm} mm`} />
                <Row
                  label="КЕП пілота"
                  value={`${payload.pilotSignature.keyId} · ${shortHash(payload.pilotSignature.sha256, 6, 6)}`}
                  mono
                />
              </Section>
              <Section title="Хімія">
                <Row label="Препарат" value={payload.chemical} />
                <Row label="Доза" value={`${payload.dose}`} />
                <Row label="Постачальник" value={payload.supplierName} />
                <Row
                  label="КЕП постачальника"
                  value={`${payload.supplierSignature.keyId} · ${shortHash(payload.supplierSignature.sha256, 6, 6)}`}
                  mono
                />
              </Section>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="mt-6 text-xs text-ink-subtle text-center">
        Документ закріплений у блокчейні BNB · Chain {data.chainId}. Зміна будь-якого поля
        призведе до зміни SHA-256 і зробить підпис недійсним.{" "}
        <a
          href={bscscanTokenUrl(data.chainId, data.contractAddress, data.tokenId)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-700 hover:underline inline-flex items-center"
        >
          Переглянути в BSCScan <ExternalLink className="h-3 w-3 ml-0.5" />
        </a>
      </p>
    </main>
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
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-700 hover:underline"
        >
          {text}
        </a>
      ) : (
        <span className="text-ink">{text}</span>
      )}
    </div>
  );
}
