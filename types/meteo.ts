import type { MeteoData } from "./passport";

export interface MeteoParseResult {
  ok: boolean;
  data?: MeteoData;
  error?: string;
  rawPreview?: string;
}

export type SupportedMeteoFormat = "json" | "csv" | "pdf" | "xml" | "txt";
