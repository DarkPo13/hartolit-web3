"use client";

import { useState } from "react";
import { Thermometer, Droplets, Wind, CloudRain } from "lucide-react";
import { BlockCard } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { FileUpload } from "@/components/ui/FileUpload";
import { DiiaBlock } from "@/components/diia/DiiaBlock";
import { useWizardStore } from "@/lib/store";
import { parseMeteoFile } from "@/lib/meteo-parser";
import type { FileRef, MeteoData, DiiaSignatureRef } from "@/types/passport";
import { toast } from "sonner";

export function MeteoBlock() {
  const meteo = useWizardStore((s) => s.meteo);
  const setMeteo = useWizardStore((s) => s.setMeteo);
  const treatment = useWizardStore((s) => s.treatment);

  const [parsing, setParsing] = useState(false);
  const fileRef = meteo.meteoFile;
  const data = meteo.meteoData;
  const signature = meteo.pilotSignature;

  async function handleRawFile(file: File) {
    setParsing(true);
    try {
      const res = await parseMeteoFile(file);
      if (res.ok && res.data) {
        setMeteo({ meteoData: res.data });
        toast.success("Метео-дані розпізнано", {
          description: `T:${res.data.temperatureCelsius}°C · H:${res.data.humidityPercent}% · W:${res.data.windSpeedMps} м/с`,
        });
      } else {
        toast.warning("Не вдалося розпізнати дані", {
          description: res.error ?? "Введіть значення вручну",
        });
      }
    } finally {
      setParsing(false);
    }
  }

  function handleFileChange(file: FileRef | null) {
    setMeteo({ meteoFile: file ?? undefined, pilotSignature: undefined });
  }

  function updateField(key: keyof MeteoData, value: number) {
    const merged: MeteoData = {
      temperatureCelsius: data?.temperatureCelsius ?? 0,
      humidityPercent: data?.humidityPercent ?? 0,
      windSpeedMps: data?.windSpeedMps ?? 0,
      rainfallMm: data?.rainfallMm ?? 0,
      measuredAt: data?.measuredAt ?? new Date().toISOString(),
      [key]: value,
    };
    setMeteo({ meteoData: merged });
  }

  return (
    <BlockCard
      number="03"
      title="Метео-дані"
      hint="Файл метеостанції + КЕП-підпис пілота"
    >
      <div className="space-y-4">
        <FileUpload
          label="Файл метеостанції"
          hint="JSON / CSV / TXT — автоматично розпізнаємо. PDF/XML — введіть вручну."
          accept=".json,.csv,.txt,.pdf,.xml"
          value={fileRef}
          onChange={handleFileChange}
          onRawFile={handleRawFile}
        />

        {parsing && <p className="text-xs text-ink-muted">Парсимо файл…</p>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input
            label="Темп., °C"
            type="number"
            step="0.1"
            value={data?.temperatureCelsius ?? ""}
            onChange={(e) => updateField("temperatureCelsius", parseFloat(e.target.value))}
            leadingIcon={<Thermometer className="h-4 w-4" />}
          />
          <Input
            label="Вологість, %"
            type="number"
            step="0.1"
            value={data?.humidityPercent ?? ""}
            onChange={(e) => updateField("humidityPercent", parseFloat(e.target.value))}
            leadingIcon={<Droplets className="h-4 w-4" />}
          />
          <Input
            label="Вітер, м/с"
            type="number"
            step="0.1"
            value={data?.windSpeedMps ?? ""}
            onChange={(e) => updateField("windSpeedMps", parseFloat(e.target.value))}
            leadingIcon={<Wind className="h-4 w-4" />}
          />
          <Input
            label="Опади, мм"
            type="number"
            step="0.1"
            value={data?.rainfallMm ?? ""}
            onChange={(e) => updateField("rainfallMm", parseFloat(e.target.value))}
            leadingIcon={<CloudRain className="h-4 w-4" />}
          />
        </div>

        <DiiaBlock
          role="pilot"
          documentFilename={fileRef?.filename ?? "метео-дані"}
          documentSha256={fileRef?.sha256 ?? ""}
          signerName={treatment.operator ?? "Пілот"}
          signature={signature}
          onSigned={(sig: DiiaSignatureRef) => setMeteo({ pilotSignature: sig })}
          disabled={!fileRef}
          disabledReason={!fileRef ? "Спочатку завантажте файл метео-даних" : undefined}
        />
      </div>
    </BlockCard>
  );
}
