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

export function Step1Form() {
  const state = useWizardStore();
  const next = useWizardStore((s) => s.next);
  const { complete, missing } = isStep1Complete(state);

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
            <span className="text-brand-700 font-medium">Усе заповнено — можна переходити до мінту</span>
          ) : (
            <span>Не заповнено: {missing.join(", ")}</span>
          )}
        </div>
        <Button
          onClick={() => complete && next()}
          disabled={!complete}
          size="lg"
          trailingIcon={<ArrowRight className="h-4 w-4" />}
        >
          Перейти до блокчейну
        </Button>
      </div>
    </div>
  );
}
