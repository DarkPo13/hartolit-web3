// `npm run test:terraform`: fmt, validate and `terraform test` for every root, then a real
// provider plan of staging with fictional credentials in a container without a network.
// Exits 1 on the first failed stage. It never runs apply and cannot reach AWS.
import fs from "node:fs";
import path from "node:path";
import { copyWorkspace, docker, ensureProviders, initRoot, ROOTS, startContainer, stopContainer, terraform, TF } from "./terraform-lib.mjs";

const ACCOUNT = "111122223333";
const SECRET_MARKER = "fictional-marker-that-must-never-appear-in-a-plan";
const OFFLINE_OVERRIDE = `terraform {
  backend "local" {}
}
provider "aws" {
  region                      = "eu-central-1"
  access_key                  = "fictional"
  secret_key                  = "fictional"
  allowed_account_ids         = null
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
}
`;

function fail(message, output = "") {
  console.error(`FAIL ${message}`);
  if (output) console.error(output);
  process.exitCode = 1;
  throw new Error("stop");
}

function pass(message) {
  console.log(`PASS ${message}`);
}

const glob = (pattern, value) => new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(value);
const list = (value) => (Array.isArray(value) ? value : [value]);

function offlinePlan(container, root, variables) {
  const write = docker(["exec", "-i", "-w", `${TF}/${root}`, container, "sh", "-c", "cat > offline_override.tf"], { input: OFFLINE_OVERRIDE });
  if (write.status !== 0) fail(`override in ${root}`, write.output);
  const env = Object.fromEntries(Object.entries(variables).map(([key, value]) => [`TF_VAR_${key}`, value]));
  const init = terraform(container, root, ["init", "-reconfigure", "-input=false", "-no-color", "-lockfile=readonly", "-plugin-dir=/plugins"]);
  if (init.status !== 0) fail(`offline init in ${root}`, init.output);
  const plan = terraform(container, root, ["plan", "-refresh=false", "-input=false", "-no-color", "-out=offline.tfplan"], env);
  if (plan.status !== 0) fail(`offline plan in ${root}`, plan.output);
  const shown = terraform(container, root, ["show", "-json", "offline.tfplan"]);
  if (shown.status !== 0) fail(`plan JSON in ${root}`, shown.output);
  // A saved plan is a zip, so its entries must be unpacked before they can be searched.
  const rawPlan = docker(["exec", "-w", `${TF}/${root}`, container, "sh", "-c", "rm -rf .plan-files && mkdir .plan-files && unzip -q offline.tfplan -d .plan-files && cat .plan-files/* .plan-files/*/* 2>/dev/null; rm -rf .plan-files"], { encoding: "latin1" });
  if (rawPlan.stdout.length === 0) fail(`could not unpack the saved plan in ${root}`, rawPlan.output);
  return { json: JSON.parse(shown.stdout), text: `${plan.output}\n${shown.stdout}`, binary: rawPlan.stdout };
}

function plannedResources(plan) {
  return plan.json.resource_changes.filter((change) => change.mode === "managed" && change.change.actions.includes("create"));
}

function checkBoundaryCovers(site, bootstrap) {
  const boundary = JSON.parse(plannedResources(bootstrap).find((change) => change.address === "aws_iam_policy.lambda_boundary").change.after.policy);
  const allows = boundary.Statement.filter((statement) => statement.Effect === "Allow");
  const policies = plannedResources(site).filter((change) => change.type === "aws_iam_role_policy");
  if (policies.length !== 5) fail(`expected 5 execution role policies, found ${policies.length}`);
  let pairs = 0;
  for (const policy of policies) {
    for (const statement of JSON.parse(policy.change.after.policy).Statement) {
      for (const action of list(statement.Action)) for (const resource of list(statement.Resource)) {
        pairs += 1;
        const covered = allows.some((allow) => list(allow.Action).includes(action) && list(allow.Resource).some((pattern) => glob(pattern, resource) || pattern === resource));
        if (!covered) fail(`the boundary does not admit ${action} on ${resource} (${policy.address})`);
      }
    }
  }
  pass(`boundary admits all ${pairs} action/resource pairs of the 5 execution roles`);
}

function checkPlans(container) {
  const site = offlinePlan(container, "envs/staging/site", { account_id: ACCOUNT });
  const created = plannedResources(site);
  const forbidden = ["aws_nat_gateway", "aws_vpc", "aws_lb", "aws_instance", "aws_db_instance", "aws_rds_cluster", "aws_lambda_provisioned_concurrency_config", "aws_kms_key", "aws_wafv2_web_acl", "aws_cloudfront_key_value_store"];
  const idle = created.filter((change) => forbidden.includes(change.type));
  if (idle.length) fail(`resources billed while idle: ${idle.map((change) => change.address).join(", ")}`);
  const roles = created.filter((change) => change.type === "aws_iam_role");
  if (roles.length !== 5 || roles.some((role) => role.change.after.permissions_boundary !== `arn:aws:iam::${ACCOUNT}:policy/hartolit-staging-tf-lambda-boundary`)) fail("every planned role must carry the boundary");
  pass(`real provider plan of staging site: ${created.length} resources, 5 bounded roles, nothing billed while idle`);

  const bootstrap = offlinePlan(container, "bootstrap", { stage: "staging", account_id: ACCOUNT, github_repository: "example-owner/example-repo" });
  pass(`real provider plan of bootstrap: ${plannedResources(bootstrap).length} resources, no apply role`);
  if (plannedResources(bootstrap).some((change) => change.address.includes('github["apply"]'))) fail("bootstrap planned an apply role by default");
  checkBoundaryCovers(site, bootstrap);

  const secrets = offlinePlan(container, "envs/staging/secrets", { account_id: ACCOUNT, database_url: SECRET_MARKER, better_auth_secret: `${SECRET_MARKER}-auth` });
  if (secrets.text.includes(SECRET_MARKER) || secrets.binary.includes(SECRET_MARKER)) fail("a secret reached the plan");
  const parameters = plannedResources(secrets).filter((change) => change.type === "aws_ssm_parameter");
  if (parameters.length !== 2 || parameters.some((change) => change.change.after.type !== "SecureString" || change.change.after.value != null || change.change.after.value_wo != null)) fail("secrets must be write-only SecureString parameters");
  pass("secret values are absent from plan output, plan JSON and the saved plan file");

  const schema = terraform(container, "envs/staging/secrets", ["providers", "schema", "-json"]);
  const attribute = JSON.parse(schema.stdout).provider_schemas["registry.terraform.io/hashicorp/aws"].resource_schemas.aws_ssm_parameter.block.attributes.value_wo;
  if (attribute?.write_only !== true) fail("the provider does not mark value_wo as write-only");
  pass("provider 6.73.0 marks value_wo as write-only (never stored in state)");

  for (const root of ["envs/production/site"]) {
    docker(["exec", "-i", "-w", `${TF}/${root}`, container, "sh", "-c", "cat > offline_override.tf"], { input: OFFLINE_OVERRIDE });
    terraform(container, root, ["init", "-reconfigure", "-input=false", "-no-color", "-lockfile=readonly", "-plugin-dir=/plugins"]);
    const refused = terraform(container, root, ["plan", "-refresh=false", "-input=false", "-no-color"], { TF_VAR_account_id: "444455556666" });
    if (refused.status === 0 || !refused.output.includes("Production is not approved")) fail(`${root} must refuse to plan`, refused.output);
    pass(`${root} refuses to plan without approval`);
  }
}

const workspace = copyWorkspace();
let container;
try {
  ensureProviders(workspace);
  container = startContainer(workspace);
  const fmt = docker(["exec", "-w", TF, container, "terraform", "fmt", "-check", "-recursive", "-no-color"]);
  if (fmt.status !== 0) fail("terraform fmt", fmt.output);
  pass("terraform fmt");

  let runs = 0;
  for (const root of ROOTS) {
    initRoot(container, root);
    const validate = terraform(container, root, ["validate", "-no-color"]);
    if (validate.status !== 0 || /Warning:/.test(validate.output)) fail(`terraform validate in ${root}`, validate.output);
    const tested = terraform(container, root, ["test", "-no-color"]);
    if (tested.status !== 0) fail(`terraform test in ${root}`, tested.output);
    const summary = tested.output.match(/Success! (\d+) passed, 0 failed/);
    if (!summary) fail(`no test summary in ${root}`, tested.output);
    runs += Number(summary[1]);
    pass(`${root}: validate, ${summary[1]} test runs`);
  }
  pass(`terraform test: ${runs} runs in ${ROOTS.length} roots`);
  checkPlans(container);
  console.log("All Terraform checks passed. Nothing was applied and no network was available.");
} catch (error) {
  if (error.message !== "stop") { console.error(error); process.exitCode = 1; }
} finally {
  if (container) stopContainer(container);
  fs.rmSync(path.resolve(workspace), { recursive: true, force: true });
}
