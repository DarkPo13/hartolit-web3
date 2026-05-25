"use client";

import { useEffect, useState, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from "lucide-react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useWizardStore } from "@/lib/store";
import { buildPayload } from "@/lib/validation";
import { TARGET_CHAIN_ID } from "@/lib/wagmi";
import { bscscanTxUrl, cn, shortHash, ipfsToHttp } from "@/lib/utils";
import type { MintResult } from "@/types/passport";
import { toast } from "sonner";

type Phase = "idle" | "running" | "done" | "error";

interface StepStatus {
  key: string;
  label: string;
  state: "pending" | "active" | "done" | "error";
}

const STEPS_TEMPLATE: Omit<StepStatus, "state">[] = [
  { key: "validate", label: "Валідація даних паспорта" },
  { key: "hash", label: "Обчислення SHA-256 payload-у" },
  { key: "duplicate", label: "Перевірка унікальності" },
  { key: "ipfs", label: "Пінінг JSON у IPFS (Pinata)" },
  { key: "tx-prepare", label: "Підготовка транзакції" },
  { key: "tx-broadcast", label: "Відправка в BNB Chain" },
  { key: "tx-confirmed", label: "Підтвердження блоку" },
];

export function Step2Blockchain() {
  const state = useWizardStore();
  const prev = useWizardStore((s) => s.prev);
  const next = useWizardStore((s) => s.next);
  const setMintResult = useWizardStore((s) => s.setMintResult);
  const existingResult = useWizardStore((s) => s.mintResult);
  const { address } = useAccount();

  const [phase, setPhase] = useState<Phase>(existingResult ? "done" : "idle");
  const [steps, setSteps] = useState<StepStatus[]>(
    STEPS_TEMPLATE.map((s) => ({ ...s, state: existingResult ? "done" : "pending" })),
  );
  const [result, setResult] = useState<MintResult | null>(existingResult);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const startedRef = useRef(false);

  function updateStep(key: string, s: StepStatus["state"]) {
    setSteps((prevSteps) => prevSteps.map((st) => (st.key === key ? { ...st, state: s } : st)));
  }

  async function runMint() {
    if (startedRef.current) return;
    startedRef.current = true;
    setPhase("running");
    setErrorMsg(null);
    setSteps(STEPS_TEMPLATE.map((s, i) => ({ ...s, state: i === 0 ? "active" : "pending" })));

    try {
      updateStep("validate", "active");
      const payload = buildPayload(state);
      await delay(400);
      updateStep("validate", "done");

      updateStep("hash", "active");
      const res = await fetch("/api/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload,
          recipient: address ?? null,
        }),
      });

      // Simulate progressive UI even though /api/mint is one round-trip
      await delay(300);
      updateStep("hash", "done");
      updateStep("duplicate", "active");
      await delay(300);
      updateStep("duplicate", "done");
      updateStep("ipfs", "active");
      await delay(400);
      updateStep("ipfs", "done");
      updateStep("tx-prepare", "active");
      await delay(300);
      updateStep("tx-prepare", "done");
      updateStep("tx-broadcast", "active");

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Mint failed: ${res.status}`);
      }

      const mint = (await res.json()) as MintResult;
      updateStep("tx-broadcast", "done");
      updateStep("tx-confirmed", "active");
      await delay(400);
      updateStep("tx-confirmed", "done");

      setResult(mint);
      setMintResult(mint);
      setPhase("done");
      toast.success("Паспорт випущено", {
        description: `Token #${mint.tokenId} мінтнуто в блоці ${mint.blockNumber}`,
      });
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Помилка мінту";
      setErrorMsg(msg);
      setPhase("error");
      setSteps((prevSteps) =>
        prevSteps.map((st) => (st.state === "active" ? { ...st, state: "error" } : st)),
      );
      toast.error("Не вдалося випустити паспорт", { description: msg });
      startedRef.current = false;
    }
  }

  useEffect(() => {
    if (!existingResult && phase === "idle") {
      runMint();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5 fade-in">
      <Card>
        <CardHeader>
          <CardTitle>Запис паспорта в блокчейн</CardTitle>
          <CardDescription>
            Дані хешуються (SHA-256), JSON пінінгується в IPFS, і випускається ERC-721 NFT у BNB Chain.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {steps.map((s) => (
              <li
                key={s.key}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                  s.state === "done" && "border-brand-200 bg-brand-50/60",
                  s.state === "active" && "border-brand-400 bg-brand-50 shadow-soft",
                  s.state === "error" && "border-rose-300 bg-rose-50",
                  s.state === "pending" && "border-border bg-surface-2/40",
                )}
              >
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full">
                  {s.state === "done" ? (
                    <CheckCircle2 className="h-6 w-6 text-brand-600" />
                  ) : s.state === "active" ? (
                    <Loader2 className="h-5 w-5 text-brand-600 animate-spin" />
                  ) : s.state === "error" ? (
                    <XCircle className="h-6 w-6 text-rose-600" />
                  ) : (
                    <span className="h-5 w-5 rounded-full border-2 border-border" />
                  )}
                </span>
                <span
                  className={cn(
                    "text-sm",
                    s.state === "active" && "text-ink font-medium",
                    s.state === "done" && "text-ink",
                    s.state === "error" && "text-rose-800",
                    s.state === "pending" && "text-ink-muted",
                  )}
                >
                  {s.label}
                </span>
              </li>
            ))}
          </ol>

          {phase === "error" && errorMsg && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4">
              <p className="text-sm font-medium text-rose-900">Помилка мінту</p>
              <p className="text-xs text-rose-800 mt-1 break-all">{errorMsg}</p>
              <Button variant="danger" size="sm" className="mt-3" onClick={runMint}>
                Спробувати ще раз
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card tone="brand" className="fade-in">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-brand-700" />
              Паспорт випущено
            </CardTitle>
            <CardDescription>Запис закріплено на BNB Chain · необоротно</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <Field label="Token ID" value={`#${result.tokenId}`} mono />
              <Field
                label="Tx Hash"
                value={shortHash(result.txHash, 8, 8)}
                mono
                href={bscscanTxUrl(result.chainId ?? TARGET_CHAIN_ID, result.txHash)}
              />
              <Field label="Block" value={String(result.blockNumber)} mono />
              <Field label="Gas used" value={result.gasUsed} mono />
              <Field
                label="Payload SHA-256"
                value={shortHash(result.payloadHash, 8, 8)}
                mono
                full
              />
              <Field
                label="IPFS URI"
                value={result.ipfsUri}
                mono
                href={ipfsToHttp(result.ipfsUri)}
                full
              />
            </dl>
            <div className="mt-4">
              <Badge tone="success">Chain {result.chainId ?? TARGET_CHAIN_ID}</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between gap-4">
        <Button variant="ghost" leadingIcon={<ArrowLeft className="h-4 w-4" />} onClick={prev}>
          Назад
        </Button>
        <Button
          disabled={phase !== "done"}
          onClick={next}
          size="lg"
          trailingIcon={<ArrowRight className="h-4 w-4" />}
        >
          Переглянути сертифікат
        </Button>
      </div>
    </div>
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Field({
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
  const inner = (
    <span className={cn("truncate", mono && "hash-mono")}>
      {value}
      {href && <ExternalLink className="inline h-3 w-3 ml-1" />}
    </span>
  );
  return (
    <div className={cn(full && "md:col-span-2")}>
      <dt className="text-xs uppercase tracking-wider text-ink-muted mb-0.5">{label}</dt>
      <dd className="text-sm text-ink">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-700 hover:underline inline-flex items-center"
          >
            {inner}
          </a>
        ) : (
          inner
        )}
      </dd>
    </div>
  );
}
