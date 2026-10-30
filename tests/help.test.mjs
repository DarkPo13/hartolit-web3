import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { operatorHelp } = await jiti.import("../lib/help/operator.ts");
const { adminHelp } = await jiti.import("../lib/help/admin.ts");

const kind = block => Object.keys(block).find(key => key !== "tone" && key !== "lines");
const shape = block => {
  const k = kind(block);
  if (k === "ul" || k === "ol" || k === "qa") return `${k}:${block[k].length}`;
  if (k === "table") return `table:${block.table.head.length}x${block.table.rows.length}:${block.table.rows.every(row => row.length === block.table.head.length)}`;
  if (k === "note") return `note:${block.tone}`;
  if (k === "example") return `example:${block.lines.length}`;
  return k;
};
const texts = value => typeof value === "string" ? [value] : Object.values(value).flatMap(texts);
// Routes of every app/**/page.tsx; a "(group)" folder is not part of the URL.
const routes = new Set(readdirSync(new URL("../app", import.meta.url), { recursive: true })
  .map(file => file.replaceAll("\\", "/")).filter(file => file === "page.tsx" || file.endsWith("/page.tsx"))
  .map(file => `/${file.split("/").slice(0, -1).filter(part => !/^\(.+\)$/.test(part)).join("/")}`));

for (const [name, docs] of [["operator", operatorHelp], ["admin", adminHelp]]) {
  test(`${name} guide has the same structure in uk and en`, () => {
    const outline = doc => doc.parts.map(part => part.sections.map(section => `${section.id}[${section.blocks.map(shape).join(",")}]`));
    assert.deepEqual(outline(docs.en), outline(docs.uk));
    const ids = docs.uk.parts.flatMap(part => part.sections.map(section => section.id));
    assert.equal(new Set(ids).size, ids.length, "section ids are unique");
    for (const id of ids) assert.match(id, /^[a-z][a-z-]*$/);
  });

  test(`${name} guide links point at real pages and sections`, () => {
    for (const locale of ["uk", "en"]) {
      const ids = new Set(docs[locale].parts.flatMap(part => part.sections.map(section => section.id)));
      for (const text of texts(docs[locale])) {
        for (const [, href] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
          if (href.startsWith("#")) assert.ok(ids.has(href.slice(1)), `${locale}: unknown section ${href}`);
          else if (href.startsWith("/")) assert.ok(routes.has(href), `${locale}: no page for ${href}`);
          else assert.match(href, /^https:\/\//, `${locale}: ${href}`);
        }
        assert.equal((text.match(/\*\*/g) ?? []).length % 2, 0, `${locale}: unbalanced bold in ${text.slice(0, 60)}`);
        assert.equal((text.match(/`/g) ?? []).length % 2, 0, `${locale}: unbalanced code in ${text.slice(0, 60)}`);
      }
    }
  });
}
