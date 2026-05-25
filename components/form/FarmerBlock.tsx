"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Sprout, MapPin, Hash, Wheat } from "lucide-react";
import { BlockCard } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { farmerSchema, CROP_OPTIONS, type FarmerFormValues } from "@/lib/schemas";
import { useWizardStore } from "@/lib/store";
import { useEffect } from "react";

export function FarmerBlock() {
  const farmer = useWizardStore((s) => s.farmer);
  const setFarmer = useWizardStore((s) => s.setFarmer);

  const {
    register,
    control,
    formState: { errors },
    watch,
  } = useForm<FarmerFormValues>({
    resolver: zodResolver(farmerSchema),
    mode: "onBlur",
    defaultValues: {
      farmerName: farmer.farmerName ?? "",
      farmerId: farmer.farmerId ?? "",
      fieldArea: farmer.fieldArea ?? undefined,
      gpsCoords: farmer.gpsCoords ?? "",
      cadastralNumber: farmer.cadastralNumber ?? "",
      crop: farmer.crop ?? "",
    },
  });

  // Persist values to the store as they change (debounced via React)
  useEffect(() => {
    const subscription = watch((values) => {
      setFarmer(values as Partial<FarmerFormValues>);
    });
    return () => subscription.unsubscribe();
  }, [watch, setFarmer]);

  return (
    <BlockCard number="01" title="Фермер та поле" hint="Хто, де, що вирощує">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <Input
            label="Назва ФГ або ПІБ фермера"
            placeholder="ТОВ «Степ-Агро»"
            leadingIcon={<Sprout className="h-4 w-4" />}
            error={errors.farmerName?.message}
            {...register("farmerName")}
          />
        </div>
        <Input
          label="ЄДРПОУ / ІПН"
          placeholder="12345678"
          leadingIcon={<Hash className="h-4 w-4" />}
          error={errors.farmerId?.message}
          {...register("farmerId")}
        />
        <Input
          label="Площа поля (га)"
          type="number"
          step="0.01"
          placeholder="56.2"
          error={errors.fieldArea?.message}
          {...register("fieldArea")}
        />
        <Input
          label="GPS координати"
          placeholder="49.5826, 34.5544"
          leadingIcon={<MapPin className="h-4 w-4" />}
          error={errors.gpsCoords?.message}
          hint="Центроїд поля у форматі lat, lng"
          {...register("gpsCoords")}
        />
        <Input
          label="Кадастровий номер"
          placeholder="5322487800:01:001:0042"
          error={errors.cadastralNumber?.message}
          hint="Опційно"
          {...register("cadastralNumber")}
        />
        <div className="md:col-span-2">
          <Controller
            control={control}
            name="crop"
            render={({ field }) => (
              <Select
                label="Культура"
                placeholder="Виберіть культуру"
                value={field.value}
                onValueChange={field.onChange}
                options={[...CROP_OPTIONS]}
                error={errors.crop?.message}
              />
            )}
          />
        </div>
      </div>
    </BlockCard>
  );
}
