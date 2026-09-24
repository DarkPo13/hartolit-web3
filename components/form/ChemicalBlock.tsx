"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FlaskConical, Building2, Hash } from "lucide-react";
import { BlockCard } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { FileUpload } from "@/components/ui/FileUpload";
import { useWizardStore } from "@/lib/store";
import { useT } from "@/lib/i18n/context";
import { chemicalSchema, type ChemicalFormInput, type ChemicalFormValues } from "@/lib/schemas";
import type { FileRef } from "@/types/passport";

interface ChemicalBlockProps {
  open?: boolean;
  onToggle?: () => void;
  done?: boolean;
  summary?: string;
  editLabel?: string;
  allowUpload?: boolean;
}

export function ChemicalBlock({ open, onToggle, done, summary, editLabel, allowUpload = true }: ChemicalBlockProps = {}) {
  const chemical = useWizardStore((s) => s.chemical);
  const setChemical = useWizardStore((s) => s.setChemical);
  const t = useT();

  const {
    register,
    formState: { errors },
    watch,
  } = useForm<ChemicalFormInput, unknown, ChemicalFormValues>({
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

  return (
    <BlockCard
      number="04"
      title={t.chemical.blockTitle}
      hint={allowUpload ? t.chemical.blockHint : t.drafts.chemicalHint}
      open={open}
      onToggle={onToggle}
      done={done}
      summary={summary}
      editLabel={editLabel}
    >
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
        {allowUpload ? <FileUpload
          label={t.chemical.docLabel}
          hint={t.chemical.docHint}
          accept=".pdf,.jpg,.jpeg,.png"
          value={fileRef}
          onChange={(f: FileRef | null) => setChemical({ chemFile: f ?? undefined })}
        /> : <p className="text-xs text-ink-muted">{t.drafts.evidenceLater}</p>}
      </div>
    </BlockCard>
  );
}
