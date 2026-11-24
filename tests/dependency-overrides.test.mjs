// The npm override of `effect` is temporary (D85). Prisma 7.10 pins effect 3.20.0, which has
// GHSA-7589-6fvf-x4pw (ReDoS in Schema.TemplateLiteral, fixed in 3.22.1). This test keeps the
// override honest and fails once Prisma ships a fixed pin, so the override is then removed.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const parse = (version) => version.split(".").map(Number);
const atLeast = (version, minimum) => {
  const [a, b] = [parse(version), parse(minimum)];
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};
const FIRST_PATCHED = "3.22.1";
const pkg = read("package.json");

test("effect is overridden to an exact patched 3.x release", () => {
  const override = pkg.overrides?.effect;
  assert.match(override ?? "", /^3\.\d+\.\d+$/, "an exact 3.x version, not a range");
  assert.ok(atLeast(override, FIRST_PATCHED), `override ${override} is older than ${FIRST_PATCHED}`);
  assert.equal(read("node_modules/effect/package.json").version, override, "the installed effect differs from the override");
});

test("Prisma stays on major 7; the advisory is not fixed by downgrading", () => {
  for (const name of ["prisma", "@prisma/client", "@prisma/adapter-pg"]) {
    const version = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    assert.match(version ?? "", /^7\./, `${name} must stay on 7.x`);
  }
});

test("the override is still needed: Prisma's own effect pin is still vulnerable", () => {
  const pinned = read("node_modules/@prisma/config/package.json").dependencies?.effect ?? "";
  assert.match(pinned, /^\d+\.\d+\.\d+$/, `@prisma/config now declares effect as "${pinned}"; review the override (D85)`);
  assert.ok(!atLeast(pinned, FIRST_PATCHED), `@prisma/config pins effect ${pinned}, which is patched: remove the effect override and this test (D85)`);
});

test("the audit gate is not weakened", () => {
  const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /npm audit --omit=dev --audit-level=high/);
  assert.ok(!fs.existsSync(".nsprc") && !fs.existsSync("audit-ci.json") && !fs.existsSync("audit-ci.jsonc"), "no audit exception files");
  assert.ok(!("auditConfig" in pkg), "no audit exceptions in package.json");
});
