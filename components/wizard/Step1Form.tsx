"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FarmerBlock } from "@/components/form/FarmerBlock";
import { TreatmentBlock } from "@/components/form/TreatmentBlock";
import { MeteoBlock } from "@/components/form/MeteoBlock";
import { ChemicalBlock } from "@/components/form/ChemicalBlock";
import { SignatureSummary } from "@/components/form/SignatureSummary";
import { useWizardStore } from "@/lib/store";
import { isStep1Complete } from "@/lib/validation";
import { useT } from "@/lib/i18n/context";

export function Step1Form() {
  const state = useWizardStore();
  const next = useWizardStore((s) => s.next);
  const { complete, missing } = isStep1Complete(state);
  const t = useT();

  return (
    <div className="space-y-5 fade-in">
      <FarmerBlock />
      <TreatmentBlock />
      <MeteoBlock />
      <ChemicalBlock />

      <SignatureSummary
        pilotSigned={!!state.meteo.pilotSignature}
        supplierSigned={!!state.chemical.supplierSignature}
      />

      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-xl border border-border bg-surface/95 backdrop-blur p-4 shadow-lifted">
        <div className="text-xs text-ink-muted">
          {complete ? (
            <span className="text-brand-700 font-medium">{t.step1.allFilled}</span>
          ) : (
            <span>
              {t.step1.notFilled} {missing.map((k) => t.missing[k]).join(", ")}
            </span>
          )}
        </div>
        <Button
          onClick={() => complete && next()}
          disabled={!complete}
          size="lg"
          trailingIcon={<ArrowRight className="h-4 w-4" />}
        >
          {t.step1.toBlockchain}
        </Button>
      </div>
    </div>
  );
}
