"use client";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plane, Calendar, Clock, ShieldCheck } from "lucide-react";
import { BlockCard } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { treatmentSchema, TREATMENT_TYPE_OPTIONS, type TreatmentFormValues } from "@/lib/schemas";
import { useWizardStore } from "@/lib/store";
import { useT } from "@/lib/i18n/context";

interface TreatmentBlockProps {
  open?: boolean;
  onToggle?: () => void;
  done?: boolean;
  summary?: string;
  editLabel?: string;
}

export function TreatmentBlock({ open, onToggle, done, summary, editLabel }: TreatmentBlockProps = {}) {
  const treatment = useWizardStore((s) => s.treatment);
  const setTreatment = useWizardStore((s) => s.setTreatment);
  const t = useT();

  const treatmentTypeOptions = TREATMENT_TYPE_OPTIONS.map((opt) => ({
    value: opt.value,
    label: t.treatmentTypes[opt.value as keyof typeof t.treatmentTypes] ?? opt.label,
  }));

  const {
    register,
    control,
    formState: { errors },
    watch,
  } = useForm<TreatmentFormValues>({
    resolver: zodResolver(treatmentSchema),
    mode: "onBlur",
    defaultValues: {
      treatmentType: treatment.treatmentType ?? "",
      treatmentDate: treatment.treatmentDate ?? "",
      treatmentTime: treatment.treatmentTime ?? "",
      droneModel: treatment.droneModel ?? "DJI Agras T40",
      droneSerial: treatment.droneSerial ?? "",
      operator: treatment.operator ?? "",
      pilotCert: treatment.pilotCert ?? "",
      notes: treatment.notes ?? "",
    },
  });

  useEffect(() => {
    const sub = watch((values) => {
      setTreatment(values as Partial<TreatmentFormValues>);
    });
    return () => sub.unsubscribe();
  }, [watch, setTreatment]);

  return (
    <BlockCard
      number="02"
      title={t.treatment.blockTitle}
      hint={t.treatment.blockHint}
      open={open}
      onToggle={onToggle}
      done={done}
      summary={summary}
      editLabel={editLabel}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <Controller
            control={control}
            name="treatmentType"
            render={({ field }) => (
              <Select
                label={t.treatment.typeLabel}
                placeholder={t.treatment.typePlaceholder}
                value={field.value}
                onValueChange={field.onChange}
                options={treatmentTypeOptions}
                error={errors.treatmentType?.message}
              />
            )}
          />
        </div>
        <Input
          label={t.treatment.dateLabel}
          type="date"
          leadingIcon={<Calendar className="h-4 w-4" />}
          error={errors.treatmentDate?.message}
          {...register("treatmentDate")}
        />
        <Input
          label={t.treatment.timeLabel}
          type="time"
          leadingIcon={<Clock className="h-4 w-4" />}
          error={errors.treatmentTime?.message}
          {...register("treatmentTime")}
        />
        <Input
          label={t.treatment.modelLabel}
          placeholder={t.treatment.modelPlaceholder}
          leadingIcon={<Plane className="h-4 w-4" />}
          error={errors.droneModel?.message}
          {...register("droneModel")}
        />
        <Input
          label={t.treatment.serialLabel}
          placeholder={t.treatment.serialPlaceholder}
          error={errors.droneSerial?.message}
          {...register("droneSerial")}
        />
        <Input
          label={t.treatment.operatorLabel}
          placeholder={t.treatment.operatorPlaceholder}
          error={errors.operator?.message}
          {...register("operator")}
        />
        <Input
          label={t.treatment.certLabel}
          placeholder={t.treatment.certPlaceholder}
          leadingIcon={<ShieldCheck className="h-4 w-4" />}
          error={errors.pilotCert?.message}
          hint={t.treatment.certHint}
          {...register("pilotCert")}
        />
        <div className="md:col-span-2">
          <Textarea
            label={t.treatment.notesLabel}
            placeholder={t.treatment.notesPlaceholder}
            error={errors.notes?.message}
            {...register("notes")}
          />
        </div>
      </div>
    </BlockCard>
  );
}
