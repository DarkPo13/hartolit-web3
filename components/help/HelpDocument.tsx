"use client";

import { Fragment, useDeferredValue, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, BookOpen, Info, Lightbulb, Search } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n/context";
import type { HelpBlock, HelpDocs, HelpSection } from "@/lib/help/types";

/** Renders an operator or admin guide in the chosen language. The server page
 * passes only the guide it authorized, so admin content never reaches operators.
 */
export function HelpDocument({ docs, kind, isAdmin }: { docs: HelpDocs; kind: "operator" | "admin"; isAdmin: boolean }) {
  const t = useT().help;
  const { locale, setLocale } = useLocale();
  const doc = docs[locale];
  const [query, setQuery] = useState("");
  const needle = useDeferredValue(query.trim().toLocaleLowerCase(locale));
  const parts = doc.parts
    .map(part => ({ ...part, sections: needle ? part.sections.filter(section => sectionText(section).toLocaleLowerCase(locale).includes(needle)) : part.sections }))
    .filter(part => part.sections.length);
  const found = parts.reduce((sum, part) => sum + part.sections.length, 0);

  const contents = <ol className="space-y-4 text-sm">
    {parts.map(part => <li key={part.title}>
      <p className="font-semibold text-ink">{part.title}</p>
      <ol className="mt-1.5 space-y-1 border-l border-border pl-3">
        {part.sections.map(section => <li key={section.id}><a href={`#${section.id}`} className="text-ink-muted underline-offset-2 hover:text-brand-700 hover:underline">{section.title}</a></li>)}
      </ol>
    </li>)}
  </ol>;

  // The admin guide sits inside the admin console, which already provides the
  // page landmark, the way back and the language switch.
  const embedded = kind === "admin";
  const Wrapper = embedded ? "div" : "main";
  return <Wrapper className={embedded ? "" : "mx-auto max-w-6xl px-4 py-6 sm:py-10"}>
    {embedded ? <nav className="mb-4 flex justify-end text-sm" aria-label={t.navigation}><Link href="/help" className="font-medium text-brand-700 underline">{t.operatorGuide}</Link></nav>
      : <nav className="mb-6 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label={t.navigation}>
      <Link href="/" className="font-medium text-brand-700 underline">{t.backToApp}</Link>
      <div className="flex flex-wrap items-center gap-4">
        {isAdmin && <Link href="/admin/help" className="font-medium text-brand-700 underline">{t.adminGuide}</Link>}
        <button type="button" onClick={() => setLocale(locale === "uk" ? "en" : "uk")} aria-label={locale === "uk" ? "EN, switch to English" : "УКР, перейти на українську"} lang={locale === "uk" ? "en" : "uk"} className="font-medium text-brand-700 underline">{locale === "uk" ? "EN" : "УКР"}</button>
      </div>
    </nav>}

    <header className="rounded-2xl border border-border bg-gradient-to-br from-brand-50 via-surface to-surface p-6 sm:p-8">
      <BookOpen className="mb-3 h-8 w-8 text-brand-700" aria-hidden />
      <h1 className="font-serif text-3xl font-semibold text-ink">{doc.title}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-muted sm:text-base">{inline(doc.lead)}</p>
      <div className="mt-5 max-w-md">
        <label htmlFor="help-search" className="block text-sm font-semibold text-ink">{t.search}</label>
        <div className="relative mt-1.5">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
          <input id="help-search" type="search" value={query} onChange={event => setQuery(event.target.value)} aria-describedby="help-search-result" className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm" />
        </div>
        <p id="help-search-result" role="status" className="mt-1.5 text-xs text-ink-muted">{needle ? (found ? t.found.replace("{n}", String(found)) : t.noResults) : ""}</p>
      </div>
    </header>

    <div className="mt-8 grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div id="contents" className={embedded ? "scroll-mt-20" : "scroll-mt-4"}>
        <details className="rounded-2xl border border-border bg-surface p-4 lg:hidden">
          <summary className="cursor-pointer font-semibold text-ink">{t.contents}</summary>
          <nav aria-label={t.contents} className="mt-4">{contents}</nav>
        </details>
        <nav aria-label={t.contents} className={`hidden lg:sticky lg:block lg:overflow-y-auto lg:pr-2 ${embedded ? "lg:top-24 lg:max-h-[calc(100dvh-7rem)]" : "lg:top-6 lg:max-h-[calc(100dvh-3rem)]"}`}>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.contents}</h2>
          {contents}
        </nav>
      </div>

      <div className="min-w-0 space-y-10">
        {parts.map(part => <div key={part.title} className="space-y-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{part.title}</p>
          {part.sections.map(section => <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className={`${embedded ? "scroll-mt-20" : "scroll-mt-4"} rounded-2xl border border-border bg-surface p-5 sm:p-7`}>
            <h2 id={`${section.id}-title`} className="text-xl font-semibold text-ink sm:text-2xl">{section.title}</h2>
            <div className="mt-4 space-y-4 text-sm leading-relaxed text-ink sm:text-[0.95rem]">
              {section.blocks.map((block, index) => <Fragment key={index}>{renderBlock(block, t)}</Fragment>)}
            </div>
            <a href="#contents" className="mt-6 inline-block text-xs font-medium text-brand-700 underline lg:hidden">{t.toContents}</a>
          </section>)}
        </div>)}
      </div>
    </div>
  </Wrapper>;
}

type Chrome = ReturnType<typeof useT>["help"];

function renderBlock(block: HelpBlock, t: Chrome): ReactNode {
  if ("p" in block) return <p>{inline(block.p)}</p>;
  if ("h" in block) return <h3 className="pt-2 text-base font-semibold text-ink">{inline(block.h)}</h3>;
  if ("ul" in block) return <ul className="list-disc space-y-1.5 pl-5 marker:text-brand-600">{block.ul.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>;
  if ("ol" in block) return <ol className="list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-brand-700">{block.ol.map((item, i) => <li key={i}>{inline(item)}</li>)}</ol>;
  if ("table" in block) return <table className="w-full border-collapse text-left text-sm">
    <thead><tr>{block.table.head.map((cell, i) => <th key={i} scope="col" className="border-b-2 border-border bg-surface-2 px-2.5 py-2 align-bottom font-semibold [overflow-wrap:anywhere]">{inline(cell)}</th>)}</tr></thead>
    <tbody>{block.table.rows.map((row, r) => <tr key={r} className="align-top">{row.map((cell, i) => <td key={i} className="border-b border-border px-2.5 py-2 [overflow-wrap:anywhere]">{inline(cell)}</td>)}</tr>)}</tbody>
  </table>;
  if ("note" in block) {
    const Icon = block.tone === "warn" ? AlertTriangle : block.tone === "tip" ? Lightbulb : Info;
    const tone = block.tone === "warn" ? "border-amber-300 bg-amber-50" : block.tone === "tip" ? "border-brand-200 bg-brand-50" : "border-sky-200 bg-sky-50";
    return <div className={`flex gap-3 rounded-xl border p-4 ${tone}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-ink" aria-hidden />
      <p><strong>{t.notes[block.tone]}.</strong> {inline(block.note)}</p>
    </div>;
  }
  if ("example" in block) return <div className="rounded-xl border border-dashed border-brand-400 bg-canvas p-4">
    <p className="font-semibold text-brand-800">{t.example}: {inline(block.example)}</p>
    <ul className="mt-2 space-y-1">{block.lines.map((line, i) => <li key={i}>{inline(line)}</li>)}</ul>
  </div>;
  return <div className="divide-y divide-border rounded-xl border border-border">
    {block.qa.map(([question, answer], i) => <details key={i} className="group p-4">
      <summary className="cursor-pointer font-medium text-ink">{inline(question)}</summary>
      <p className="mt-2 text-ink-muted">{inline(answer)}</p>
    </details>)}
  </div>;
}

const token = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string): ReactNode {
  return text.split(token).map((piece, i) => {
    if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4) return <strong key={i}>{piece.slice(2, -2)}</strong>;
    if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 2) return <code key={i} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] [overflow-wrap:anywhere]">{piece.slice(1, -1)}</code>;
    const link = piece.match(/^\[(?<label>[^\]]+)\]\((?<href>[^)\s]+)\)$/)?.groups;
    if (link?.label && link.href) {
      const { label, href } = link;
      if (href.startsWith("/")) return <Link key={i} href={href} className="font-medium text-brand-700 underline">{label}</Link>;
      if (href.startsWith("#")) return <a key={i} href={href} className="font-medium text-brand-700 underline">{label}</a>;
      return <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 underline">{label}</a>;
    }
    return piece;
  });
}

function sectionText(section: HelpSection) {
  return [section.title, ...section.blocks.flatMap(block =>
    "p" in block ? [block.p] : "h" in block ? [block.h] : "ul" in block ? block.ul : "ol" in block ? block.ol
      : "table" in block ? [...block.table.head, ...block.table.rows.flat()] : "note" in block ? [block.note]
        : "example" in block ? [block.example, ...block.lines] : block.qa.flat())].join(" ");
}
