// The repository is public, so every Actions log and artifact is public too. These rules keep
// Terraform state, plans and secrets out of them and AWS tokens away from untrusted triggers.
// A workflow that needs an exception must change this test in the same reviewed commit.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const DIR = process.env.HARTOLIT_WORKFLOWS_DIR ?? ".github/workflows";
// Only these may request a GitHub OIDC token for AWS.
const OIDC_ALLOWED = new Set(["aws-oidc-smoke.yml"]);
const UNTRUSTED_TRIGGERS = /^\s*(pull_request|pull_request_target|workflow_run|issue_comment|discussion_comment)\s*:/m;

const workflows = fs.readdirSync(DIR).filter((name) => /\.ya?ml$/.test(name)).map((name) => {
  const text = fs.readFileSync(path.join(DIR, name), "utf8");
  const code = text.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
  return { name, text, code };
});

test("there are workflows to check", () => {
  assert.ok(workflows.length > 0, `no workflow files in ${DIR}`);
});

test("no workflow uploads artifacts or caches Terraform files", () => {
  for (const { name, code } of workflows) {
    assert.doesNotMatch(code, /actions\/upload-artifact/, `${name}: artifacts of a public repository are public`);
    assert.doesNotMatch(code, /(tfstate|tfplan|\.tfvars|\.terraform\/)/, `${name}: Terraform state, plans and variable files must not be referenced`);
  }
});

test("no workflow prints Terraform state, outputs or debug logs", () => {
  for (const { name, code } of workflows) {
    assert.doesNotMatch(code, /\bterraform\s+(show|output|state|console|apply|destroy|import|plan|init)\b/, `${name}: Terraform runs only through the offline npm checks until a reviewed plan workflow exists`);
    assert.doesNotMatch(code, /\bTF_LOG\b|\bset\s+-x\b|\bprintenv\b|--debug\b/, `${name}: debug output can print credentials`);
  }
});

test("no workflow reads repository secrets", () => {
  for (const { name, code } of workflows) assert.doesNotMatch(code, /\$\{\{\s*secrets\./, `${name}: AWS access goes through OIDC roles, not stored secrets`);
});

test("only allowed workflows request an OIDC token, and never on untrusted triggers", () => {
  for (const { name, code } of workflows) {
    const requestsToken = /id-token:\s*write/.test(code);
    if (!requestsToken) continue;
    assert.ok(OIDC_ALLOWED.has(name), `${name}: requests an OIDC token but is not on the reviewed list`);
    assert.doesNotMatch(code, UNTRUSTED_TRIGGERS, `${name}: an OIDC token must never be available to pull requests or chained runs`);
  }
});

test("the CI workflow keeps its default permissions read-only", () => {
  const ci = workflows.find((workflow) => workflow.name === "ci.yml");
  assert.ok(ci, "ci.yml is missing");
  assert.match(ci.code, /^permissions:\s*\n\s+contents:\s*read\s*$/m);
  assert.doesNotMatch(ci.code, /id-token:\s*write/);
});
