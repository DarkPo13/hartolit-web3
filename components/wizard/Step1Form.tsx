"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FarmerBlock } from "@/components/form/FarmerBlock";
import { TreatmentBlock } from "@/components/form/TreatmentBlock";
import { MeteoBlock } from "@/components/form/MeteoBlock";
import { ChemicalBlock } from "@/components/form/ChemicalBlock";
import { SignatureSummary } from "@/components/form/SignatureSummary";
import { useWizardStore } from "@/lib/store";
import {
  isStep1Complete,
  isFarmerComplete,
  isTreatmentComplete,
  isMeteoComplete,
  isChemicalComplete,
} from "@/lib/validation";
import { useT } from "@/lib/i18n/context";

export function Step1Form() {
  const state = useWizardStore();
  const next = useWizardStore((s) => s.next);
  const farmer = useWizardStore((s) => s.farmer);
  const treatment = useWizardStore((s) => s.treatment);
  const meteo = useWizardStore((s) => s.meteo);
  const chemical = useWizardStore((s) => s.chemical);

  const t = useT();
  const { complete, missing } = isStep1Complete(state);

  const farmerDone = useMemo(() => isFarmerComplete(farmer), [farmer]);
  const treatmentDone = useMemo(() => isTreatmentComplete(treatment), [treatment]);
  const meteoDone = useMemo(() => isMeteoComplete(meteo), [meteo]);
  const chemicalDone = useMemo(() => isChemicalComplete(chemical), [chemical]);

  const [openBlock, setOpenBlock] = useState<number>(1);
  const toggle = (n: number) => setOpenBlock((prev) => (prev === n ? 0 : n));

  // Auto-advance: when the active block completes, open the next one.
  // Refs track previous state so we only advance on the false→true transition.
  const prevFarmer = useRef(farmerDone);
  const prevTreatment = useRef(treatmentDone);
  const prevMeteo = useRef(meteoDone);

  useEffect(() => {
    if (farmerDone && !prevFarmer.current && openBlock === 1) setOpenBlock(2);
    prevFarmer.current = farmerDone;
  }, [farmerDone, openBlock]);

  useEffect(() => {
    if (treatmentDone && !prevTreatment.current && openBlock === 2) setOpenBlock(3);
    prevTreatment.current = treatmentDone;
  }, [treatmentDone, openBlock]);

  useEffect(() => {
    if (meteoDone && !prevMeteo.current && openBlock === 3) setOpenBlock(4);
    prevMeteo.current = meteoDone;
  }, [meteoDone, openBlock]);

  // Summary lines shown in collapsed headers
  const farmerSummary = useMemo(
    () =>
      [
        farmer.farmerName,
        farmer.fieldArea != null ? `${farmer.fieldArea} ha` : null,
        farmer.crop
          ? (t.crops[farmer.crop as keyof typeof t.crops] ?? farmer.crop)
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    [farmer, t],
  );

  const treatmentSummary = useMemo(
    () =>
      [
        treatment.treatmentDate,
        treatment.treatmentTime,
        treatment.treatmentType
          ? (t.treatmentTypes[treatment.treatmentType as keyof typeof t.treatmentTypes] ??
              treatment.treatmentType)
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    [treatment, t],
  );

  const meteoSummary = useMemo(() => {
    if (!meteo.meteoData) return "";
    const parts = [
      `${meteo.meteoData.temperatureCelsius}°C`,
      `${meteo.meteoData.windSpeedMps} m/s`,
      meteo.pilotSignature ? "KEP ✓" : null,
    ].filter(Boolean);
    return parts.join(" · ");
  }, [meteo]);

  const chemicalSummary = useMemo(
    () => [chemical.chemical, chemical.supplierName].filter(Boolean).join(" · "),
    [chemical],
  );

  const editLabel = t.step1.blockEdit;

  return (
    <div className="space-y-3 fade-in">
      <FarmerBlock
        open={openBlock === 1}
        onToggle={() => toggle(1)}
        done={farmerDone}
        summary={farmerSummary}
        editLabel={editLabel}
      />

      <TreatmentBlock
        open={openBlock === 2}
        onToggle={() => toggle(2)}
        done={treatmentDone}
        summary={treatmentSummary}
        editLabel={editLabel}
      />

      <MeteoBlock
        open={openBlock === 3}
        onToggle={() => toggle(3)}
        done={meteoDone}
        summary={meteoSummary}
        editLabel={editLabel}
      />

      <ChemicalBlock
        open={openBlock === 4}
        onToggle={() => toggle(4)}
        done={chemicalDone}
        summary={chemicalSummary}
        editLabel={editLabel}
      />

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
