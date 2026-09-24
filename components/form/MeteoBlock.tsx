"use client";

import { useState } from "react";
import { Thermometer, Droplets, Wind, CloudRain } from "lucide-react";
import { BlockCard } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { FileUpload } from "@/components/ui/FileUpload";
import { useWizardStore } from "@/lib/store";
import { useT } from "@/lib/i18n/context";
import { parseMeteoFile } from "@/lib/meteo-parser";
import type { FileRef, MeteoData } from "@/types/passport";
import { toast } from "sonner";

interface MeteoBlockProps {
  open?: boolean;
  onToggle?: () => void;
  done?: boolean;
  summary?: string;
  editLabel?: string;
  allowUpload?: boolean;
}

export function MeteoBlock({ open, onToggle, done, summary, editLabel, allowUpload = true }: MeteoBlockProps = {}) {
  const meteo = useWizardStore((s) => s.meteo);
  const setMeteo = useWizardStore((s) => s.setMeteo);
  const t = useT();

  const [parsing, setParsing] = useState(false);
  const fileRef = meteo.meteoFile;
  const data = meteo.meteoData;

  async function handleRawFile(file: File) {
    setParsing(true);
    try {
      const res = await parseMeteoFile(file);
      if (res.ok && res.data) {
        setMeteo({ meteoData: res.data });
        toast.success(t.meteo.fileLabel, {
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
    setMeteo({ meteoFile: file ?? undefined });
  }

  function updateField(key: keyof MeteoData, value: number) {
    const merged: Partial<MeteoData> = {
      ...data,
      measuredAt: data?.measuredAt ?? (allowUpload ? new Date().toISOString() : undefined),
      [key]: Number.isFinite(value) ? value : undefined,
    };
    setMeteo({ meteoData: merged });
  }

  return (
    <BlockCard
      number="03"
      title={t.meteo.blockTitle}
      hint={allowUpload ? t.meteo.blockHint : t.drafts.meteoHint}
      open={open}
      onToggle={onToggle}
      done={done}
      summary={summary}
      editLabel={editLabel}
    >
      <div className="space-y-4">
        {allowUpload ? <FileUpload
          label={t.meteo.fileLabel}
          hint={t.meteo.fileHint}
          accept=".json,.csv,.txt,.pdf,.xml"
          value={fileRef}
          onChange={handleFileChange}
          onRawFile={handleRawFile}
        /> : <p className="text-xs text-ink-muted">{t.drafts.evidenceLater}</p>}

        {parsing && <p className="text-xs text-ink-muted">{t.meteo.parsing}</p>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input
            label={t.meteo.tempLabel}
            type="number"
            step="0.1"
            value={data?.temperatureCelsius ?? ""}
            onChange={(e) => updateField("temperatureCelsius", parseFloat(e.target.value))}
            leadingIcon={<Thermometer className="h-4 w-4" />}
          />
          <Input
            label={t.meteo.humidityLabel}
            type="number"
            step="0.1"
            value={data?.humidityPercent ?? ""}
            onChange={(e) => updateField("humidityPercent", parseFloat(e.target.value))}
            leadingIcon={<Droplets className="h-4 w-4" />}
          />
          <Input
            label={t.meteo.windLabel}
            type="number"
            step="0.1"
            value={data?.windSpeedMps ?? ""}
            onChange={(e) => updateField("windSpeedMps", parseFloat(e.target.value))}
            leadingIcon={<Wind className="h-4 w-4" />}
          />
          <Input
            label={t.meteo.rainLabel}
            type="number"
            step="0.1"
            value={data?.rainfallMm ?? ""}
            onChange={(e) => updateField("rainfallMm", parseFloat(e.target.value))}
            leadingIcon={<CloudRain className="h-4 w-4" />}
          />
        </div>
      </div>
    </BlockCard>
  );
}
