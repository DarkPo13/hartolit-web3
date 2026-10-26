import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { uk } = await jiti.import("../lib/i18n/translations/uk.ts");
const { en } = await jiti.import("../lib/i18n/translations/en.ts");
const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

function prismaEnum(name) {
  const body = schema.match(new RegExp(`enum ${name} \\{([^}]*)\\}`))?.[1];
  assert.ok(body, `enum ${name} not found`);
  return body.split(/\s+/).filter(word => /^[A-Z_]+$/.test(word));
}

function assertLabels(map, codes, where) {
  for (const code of codes) assert.ok(typeof map[code] === "string" && map[code].trim(), `${where} has no label for ${code}`);
}

test("every stored code shown in the admin views has a label in both languages", async () => {
  const management = await readFile(new URL("../lib/review/management.ts", import.meta.url), "utf8");
  const adminActions = [...new Set([...management.matchAll(/"((?:RECORD|USER|SESSIONS)_[A-Z_]+)"/g)].map(match => match[1]))];
  assert.ok(adminActions.length >= 7, `admin actions found: ${adminActions}`);
  for (const [locale, t] of [["uk", uk], ["en", en]]) {
    assertLabels(t.codes.audit, prismaEnum("AuditAction"), `${locale}.codes.audit`);
    assertLabels(t.codes.publicationStatus, prismaEnum("PublicationStatus"), `${locale}.codes.publicationStatus`);
    assertLabels(t.codes.passportStatus, prismaEnum("PassportStatus"), `${locale}.codes.passportStatus`);
    assertLabels(t.codes.doseUnit, prismaEnum("DoseUnit"), `${locale}.codes.doseUnit`);
    assertLabels(t.codes.adminActions, adminActions, `${locale}.codes.adminActions`);
  }
});

test("both languages label the same codes", () => {
  for (const group of Object.keys(uk.codes).filter(key => typeof uk.codes[key] === "object")) {
    assert.deepEqual(Object.keys(uk.codes[group]).sort(), Object.keys(en.codes[group]).sort(), `codes.${group} differs between uk and en`);
  }
});
