"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Sprout, MapPin, Hash, Wheat } from "lucide-react";
import { BlockCard } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { farmerSchema, CROP_OPTIONS, type FarmerFormValues } from "@/lib/schemas";
import { useWizardStore } from "@/lib/store";
import { useT } from "@/lib/i18n/context";
import { useEffect } from "react";

export function FarmerBlock() {
  const farmer = useWizardStore((s) => s.farmer);
  const setFarmer = useWizardStore((s) => s.setFarmer);
  const t = useT();

  const cropOptions = CROP_OPTIONS.map((opt) => ({
    value: opt.value,
    label: t.crops[opt.value as keyof typeof t.crops] ?? opt.label,
  }));

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

  useEffect(() => {
    const subscription = watch((values) => {
      setFarmer(values as Partial<FarmerFormValues>);
    });
    return () => subscription.unsubscribe();
  }, [watch, setFarmer]);

  return (
    <BlockCard number="01" title={t.farmer.blockTitle} hint={t.farmer.blockHint}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <Input
            label={t.farmer.nameLabel}
            placeholder={t.farmer.namePlaceholder}
            leadingIcon={<Sprout className="h-4 w-4" />}
            error={errors.farmerName?.message}
            {...register("farmerName")}
          />
        </div>
        <Input
          label={t.farmer.idLabel}
          placeholder="12345678"
          leadingIcon={<Hash className="h-4 w-4" />}
          error={errors.farmerId?.message}
          {...register("farmerId")}
        />
        <Input
          label={t.farmer.areaLabel}
          type="number"
          step="0.01"
          placeholder={t.farmer.areaPlaceholder}
          error={errors.fieldArea?.message}
          {...register("fieldArea")}
        />
        <Input
          label={t.farmer.gpsLabel}
          placeholder="49.5826, 34.5544"
          leadingIcon={<MapPin className="h-4 w-4" />}
          error={errors.gpsCoords?.message}
          hint={t.farmer.gpsHint}
          {...register("gpsCoords")}
        />
        <Input
          label={t.farmer.cadastralLabel}
          placeholder="5322487800:01:001:0042"
          error={errors.cadastralNumber?.message}
          hint={t.farmer.cadastralHint}
          {...register("cadastralNumber")}
        />
        <div className="md:col-span-2">
          <Controller
            control={control}
            name="crop"
            render={({ field }) => (
              <Select
                label={t.farmer.cropLabel}
                placeholder={t.farmer.cropPlaceholder}
                value={field.value}
                onValueChange={field.onChange}
                options={cropOptions}
                error={errors.crop?.message}
              />
            )}
          />
        </div>
      </div>
    </BlockCard>
  );
}
