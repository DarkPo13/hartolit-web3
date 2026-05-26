"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FlaskConical, Building2, Hash } from "lucide-react";
import { BlockCard } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { FileUpload } from "@/components/ui/FileUpload";
import { DiiaBlock } from "@/components/diia/DiiaBlock";
import { useWizardStore } from "@/lib/store";
import { useT } from "@/lib/i18n/context";
import { chemicalSchema, type ChemicalFormValues } from "@/lib/schemas";
import type { FileRef, DiiaSignatureRef } from "@/types/passport";

export function ChemicalBlock() {
  const chemical = useWizardStore((s) => s.chemical);
  const setChemical = useWizardStore((s) => s.setChemical);
  const t = useT();

  const {
    register,
    formState: { errors },
    watch,
  } = useForm<ChemicalFormValues>({
    resolver: zodResolver(chemicalSchema),
    mode: "onBlur",
    defaultValues: {
      chemical: chemical.chemical ?? "",
      chemicalActive: chemical.chemicalActive ?? "",
      dose: chemical.dose ?? undefined,
      workingVolume: chemical.workingVolume ?? undefined,
      manufacturer: chemical.manufacturer ?? "",
      regNumber: chemical.regNumber ?? "",
      supplierName: chemical.supplierName ?? "",
      supplierEdrpou: chemical.supplierEdrpou ?? "",
    },
  });

  useEffect(() => {
    const sub = watch((values) => {
      setChemical(values as Partial<ChemicalFormValues>);
    });
    return () => sub.unsubscribe();
  }, [watch, setChemical]);

  const fileRef = chemical.chemFile;
  const signature = chemical.supplierSignature;

  return (
    <BlockCard number="04" title={t.chemical.blockTitle} hint={t.chemical.blockHint}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label={t.chemical.nameLabel}
          placeholder={t.chemical.namePlaceholder}
          leadingIcon={<FlaskConical className="h-4 w-4" />}
          error={errors.chemical?.message}
          {...register("chemical")}
        />
        <Input
          label={t.chemical.activeLabel}
          placeholder={t.chemical.activePlaceholder}
          error={errors.chemicalActive?.message}
          {...register("chemicalActive")}
        />
        <Input
          label={t.chemical.doseLabel}
          type="number"
          step="0.01"
          placeholder={t.chemical.dosePlaceholder}
          error={errors.dose?.message}
          {...register("dose")}
        />
        <Input
          label={t.chemical.volumeLabel}
          type="number"
          step="0.01"
          placeholder={t.chemical.volumePlaceholder}
          error={errors.workingVolume?.message}
          {...register("workingVolume")}
        />
        <Input
          label={t.chemical.manufacturerLabel}
          placeholder={t.chemical.manufacturerPlaceholder}
          leadingIcon={<Building2 className="h-4 w-4" />}
          error={errors.manufacturer?.message}
          {...register("manufacturer")}
        />
        <Input
          label={t.chemical.regLabel}
          placeholder={t.chemical.regPlaceholder}
          leadingIcon={<Hash className="h-4 w-4" />}
          error={errors.regNumber?.message}
          {...register("regNumber")}
        />
        <Input
          label={t.chemical.supplierLabel}
          placeholder={t.chemical.supplierPlaceholder}
          error={errors.supplierName?.message}
          {...register("supplierName")}
        />
        <Input
          label={t.chemical.supplierEdrpouLabel}
          placeholder={t.chemical.supplierEdrpouPlaceholder}
          error={errors.supplierEdrpou?.message}
          {...register("supplierEdrpou")}
        />
      </div>

      <div className="mt-5 space-y-4">
        <FileUpload
          label={t.chemical.docLabel}
          hint={t.chemical.docHint}
          accept=".pdf,.jpg,.jpeg,.png"
          value={fileRef}
          onChange={(f: FileRef | null) =>
            setChemical({ chemFile: f ?? undefined, supplierSignature: undefined })
          }
        />

        <DiiaBlock
          role="supplier"
          documentFilename={fileRef?.filename ?? "документ закупівлі"}
          documentSha256={fileRef?.sha256 ?? ""}
          signerName={chemical.supplierName ?? "Постачальник"}
          signerEdrpou={chemical.supplierEdrpou}
          signature={signature}
          onSigned={(sig: DiiaSignatureRef) => setChemical({ supplierSignature: sig })}
          disabled={!fileRef}
          disabledReason={!fileRef ? t.diia.supplierPending : undefined}
        />
      </div>
    </BlockCard>
  );
}
