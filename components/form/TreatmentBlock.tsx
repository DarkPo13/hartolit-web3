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

export function TreatmentBlock() {
  const treatment = useWizardStore((s) => s.treatment);
  const setTreatment = useWizardStore((s) => s.setTreatment);

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
    <BlockCard number="02" title="Обробка та дрон" hint="Що, коли і чим оброблено">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <Controller
            control={control}
            name="treatmentType"
            render={({ field }) => (
              <Select
                label="Тип обробки"
                placeholder="Виберіть тип"
                value={field.value}
                onValueChange={field.onChange}
                options={[...TREATMENT_TYPE_OPTIONS]}
                error={errors.treatmentType?.message}
              />
            )}
          />
        </div>
        <Input
          label="Дата обробки"
          type="date"
          leadingIcon={<Calendar className="h-4 w-4" />}
          error={errors.treatmentDate?.message}
          {...register("treatmentDate")}
        />
        <Input
          label="Час початку"
          type="time"
          leadingIcon={<Clock className="h-4 w-4" />}
          error={errors.treatmentTime?.message}
          {...register("treatmentTime")}
        />
        <Input
          label="Модель дрона"
          placeholder="DJI Agras T40"
          leadingIcon={<Plane className="h-4 w-4" />}
          error={errors.droneModel?.message}
          {...register("droneModel")}
        />
        <Input
          label="Серійний номер"
          placeholder="1ZNDH4G00BA00P"
          error={errors.droneSerial?.message}
          {...register("droneSerial")}
        />
        <Input
          label="Оператор (ПІБ)"
          placeholder="Петренко Іван Олегович"
          error={errors.operator?.message}
          {...register("operator")}
        />
        <Input
          label="Ліцензія DARS"
          placeholder="A2-UA-2024-001234"
          leadingIcon={<ShieldCheck className="h-4 w-4" />}
          error={errors.pilotCert?.message}
          hint="Категорія A2/A3"
          {...register("pilotCert")}
        />
        <div className="md:col-span-2">
          <Textarea
            label="Примітки оператора"
            placeholder="Опційно: умови польоту, особливості ділянки…"
            error={errors.notes?.message}
            {...register("notes")}
          />
        </div>
      </div>
    </BlockCard>
  );
}
