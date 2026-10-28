import type { Locale } from "@/lib/i18n/types";

/** Inline text may use **bold**, `code` and [label](/path or https://…) links. */
export type HelpBlock =
  | { p: string }
  | { h: string }
  | { ul: string[] }
  | { ol: string[] }
  | { table: { head: string[]; rows: string[][] } }
  | { note: string; tone: "info" | "warn" | "tip" }
  | { example: string; lines: string[] }
  | { qa: [question: string, answer: string][] };

export type HelpSection = { id: string; title: string; blocks: HelpBlock[] };
export type HelpPart = { title: string; sections: HelpSection[] };
export type HelpDoc = { title: string; lead: string; parts: HelpPart[] };
export type HelpDocs = Record<Locale, HelpDoc>;
