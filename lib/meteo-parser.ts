import Papa from "papaparse";
import type { MeteoData } from "@/types/passport";
import type { MeteoParseResult } from "@/types/meteo";

/**
 * Best-effort parser for meteo data files uploaded by the pilot.
 * Supports JSON (preferred), CSV, and plain text with key=value lines.
 * For PDF/XML it returns ok:false and asks the user to enter values manually.
 */
export async function parseMeteoFile(file: File): Promise<MeteoParseResult> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  try {
    if (ext === "json") return parseJson(await file.text());
    if (ext === "csv") return parseCsv(await file.text());
    if (ext === "txt") return parseTxt(await file.text());
    return {
      ok: false,
      error: `Формат .${ext} не підтримується для автоматичного парсингу. Введіть значення вручну.`,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Помилка читання файлу",
    };
  }
}

function parseJson(text: string): MeteoParseResult {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const data: MeteoData = {
    temperatureCelsius: num(raw.temp ?? raw.temperature ?? raw.temperatureCelsius),
    humidityPercent: num(raw.humidity ?? raw.humidityPercent),
    windSpeedMps: num(raw.wind ?? raw.windSpeed ?? raw.windSpeedMps),
    rainfallMm: num(raw.rain ?? raw.rainfall ?? raw.rainfallMm) ?? 0,
    measuredAt:
      (typeof raw.timestamp === "string" && raw.timestamp) ||
      (typeof raw.measuredAt === "string" && raw.measuredAt) ||
      new Date().toISOString(),
  };
  return { ok: true, data, rawPreview: text.slice(0, 200) };
}

function parseCsv(text: string): MeteoParseResult {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  const row = result.data[0];
  if (!row) return { ok: false, error: "CSV не містить даних" };
  const data: MeteoData = {
    temperatureCelsius: num(row.temp ?? row.temperature),
    humidityPercent: num(row.humidity),
    windSpeedMps: num(row.wind ?? row.windSpeed),
    rainfallMm: num(row.rain ?? row.rainfall) ?? 0,
    measuredAt: row.timestamp ?? row.measuredAt ?? new Date().toISOString(),
  };
  return { ok: true, data, rawPreview: text.slice(0, 200) };
}

function parseTxt(text: string): MeteoParseResult {
  const pairs: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_]+)\s*[:=]\s*(.+)\s*$/);
    if (m && m[1] && m[2]) pairs[m[1].toLowerCase()] = m[2].trim();
  }
  const data: MeteoData = {
    temperatureCelsius: num(pairs.temp ?? pairs.temperature),
    humidityPercent: num(pairs.humidity),
    windSpeedMps: num(pairs.wind ?? pairs.windspeed),
    rainfallMm: num(pairs.rain ?? pairs.rainfall) ?? 0,
    measuredAt: pairs.timestamp ?? new Date().toISOString(),
  };
  return { ok: true, data, rawPreview: text.slice(0, 200) };
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(",", "."));
    if (!Number.isNaN(n)) return n;
  }
  return Number.NaN;
}
