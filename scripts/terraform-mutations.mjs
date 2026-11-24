// `npm run test:terraform:mutations`: removes one protection at a time from a private copy and
// requires the test that guards it to fail. A mutation that survives exits 1. The repository
// is not touched, the container has no network, and nothing is applied.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyWorkspace, docker, ensureProviders, initRoot, ROOTS, startContainer, stopContainer, terraform, TF } from "./terraform-lib.mjs";

const SITE = "modules/opennext-site";
const ROLES = "modules/github-oidc-roles";
const BOOT = "bootstrap";

const site = (name, file, from, to, run) => ({ name, root: SITE, file: `${SITE}/${file}`, from, to, run });
const roles = (name, from, to, run) => ({ name, root: ROLES, file: `${ROLES}/main.tf`, from, to, run });
const boot = (name, from, to, run) => ({ name, root: BOOT, file: `${BOOT}/main.tf`, from, to, run });

const OAC = "oac_signs_every_origin";
const URLS = "lambda_urls_refuse_direct_calls";
const EDGE = "edge_signer_hashes_request_bodies";
const IP = "client_ip_comes_only_from_cloudfront";
const CSP = "csp_nonce_and_errors_are_never_shared";
const ROUTES = "routes_match_the_opennext_output";
const S3 = "assets_bucket_is_private";
const ISR = "isr_matches_opennext";
const BOUNDARY = "every_role_has_the_boundary";
const LEAST = "roles_are_least_privilege";
const SECRETS = "secrets_stay_out_of_lambda_settings";
const IDLE = "nothing_is_billed_while_idle";
const NO_IAM = "deploy_role_cannot_change_iam";
const APPLY_BOUNDARY = "apply_role_cannot_leave_the_boundary";
const APPLY_OPEN = "apply_role_cannot_open_lambda_or_read_secrets";
const PLAN_ONLY = "plan_role_cannot_write_infrastructure_or_read_secrets";

const MUTATIONS = [
  site("Lambda OAC stops signing", "cloudfront.tf", 'origin_type = "lambda"\n  signing_behavior                  = "always"', 'origin_type = "lambda"\n  signing_behavior                  = "never"', OAC),
  site("S3 OAC stops signing", "cloudfront.tf", 'origin_type = "s3"\n  signing_behavior                  = "always"', 'origin_type = "s3"\n  signing_behavior                  = "never"', OAC),
  site("server origin loses OAC", "cloudfront.tf", '    domain_name              = split("/", aws_lambda_function_url.server.function_url)[2]\n    origin_access_control_id = aws_cloudfront_origin_access_control.lambda.id\n', '    domain_name              = split("/", aws_lambda_function_url.server.function_url)[2]\n', OAC),
  site("origin allows plain HTTP", "cloudfront.tf", 'origin_protocol_policy = "https-only"', 'origin_protocol_policy = "http-only"', OAC),
  site("server URL becomes public", "main.tf", 'function_name      = aws_lambda_function.this["server"].function_name\n  authorization_type = "AWS_IAM"', 'function_name      = aws_lambda_function.this["server"].function_name\n  authorization_type = "NONE"', URLS),
  site("image URL becomes public", "main.tf", 'function_name      = aws_lambda_function.this["image"].function_name\n  authorization_type = "AWS_IAM"', 'function_name      = aws_lambda_function.this["image"].function_name\n  authorization_type = "NONE"', URLS),
  site("URL permission opens to everyone", "main.tf", 'action        = "lambda:InvokeFunctionUrl"\n  function_name = aws_lambda_function.this[each.key].function_name\n  principal     = "cloudfront.amazonaws.com"', 'action        = "lambda:InvokeFunctionUrl"\n  function_name = aws_lambda_function.this[each.key].function_name\n  principal     = "*"', URLS),
  site("invoke permission loses its distribution", "main.tf", '  principal                = "cloudfront.amazonaws.com"\n  source_arn               = aws_cloudfront_distribution.this.arn\n', '  principal                = "cloudfront.amazonaws.com"\n', URLS),
  site("invoke permission works outside the URL", "main.tf", "  invoked_via_function_url = true\n", "", URLS),
  site("default route stops sending the body", "cloudfront.tf", 'lambda_arn   = aws_lambda_function.edge_signer.qualified_arn\n      include_body = true\n    }\n  }\n\n  dynamic "ordered_cache_behavior"', 'lambda_arn   = aws_lambda_function.edge_signer.qualified_arn\n      include_body = false\n    }\n  }\n\n  dynamic "ordered_cache_behavior"', EDGE),
  site("_next/data loses the signer", "cloudfront.tf", 'origin = "server", methods = local.all_methods, signer = true', 'origin = "server", methods = local.all_methods, signer = false', EDGE),
  site("signer moves out of us-east-1", "edge.tf", 'region = "us-east-1"', 'region = "eu-central-1"', EDGE),
  site("signer stops publishing versions", "edge.tf", "publish          = true", "publish          = false", EDGE),
  site("signer role loses Lambda@Edge", "edge.tf", '["lambda.amazonaws.com", "edgelambda.amazonaws.com"]', '["lambda.amazonaws.com"]', EDGE),
  site("signer stops hashing PATCH", "functions/edge-signer/index.mjs", '["POST", "PUT", "PATCH"]', '["POST", "PUT"]', EDGE),
  site("viewer function stops writing the client IP", "functions/viewer-request.js", 'event.request.headers["x-hartolit-client-ip"] = { value: event.viewer.ip, multiValue: [{ value: event.viewer.ip }] };', "", IP),
  site("dynamic routes lose the viewer function", "cloudfront.tf", '      origin_request_policy_id = local.all_viewer_except_host_policy_id\n\n      function_association {\n        event_type   = "viewer-request"\n        function_arn = aws_cloudfront_function.viewer_request.arn\n      }\n', "      origin_request_policy_id = local.all_viewer_except_host_policy_id\n", IP),
  site("server trusts X-Forwarded-For", "main.tf", 'HARTOLIT_CLIENT_IP_SOURCE = "cloudfront"', 'HARTOLIT_CLIENT_IP_SOURCE = "forwarded-for"', IP),
  site("pages are cached for a minute", "cloudfront.tf", 'comment     = "Server responses; honours Cache-Control"\n  min_ttl     = 0', 'comment     = "Server responses; honours Cache-Control"\n  min_ttl     = 60', CSP),
  site("a response policy overrides the CSP", "cloudfront.tf", '    target_origin_id         = "server"\n', '    target_origin_id         = "server"\n    response_headers_policy_id = "67f7725c-6f97-4210-82d7-5512b31e9d03"\n', CSP),
  site("errors are cached", "cloudfront.tf", "error_caching_min_ttl = 0", "error_caching_min_ttl = 300", CSP),
  site("session cookies enter the cache key", "cloudfront.tf", 'cookie_behavior = "none"', 'cookie_behavior = "all"', CSP),
  site("_next/* captures the dynamic routes", "cloudfront.tf", 'static_behaviors = concat(["_next/*", "BUILD_ID"], var.public_path_patterns)', 'static_behaviors = concat(["BUILD_ID"], var.public_path_patterns)', ROUTES),
  site("static route accepts POST", "cloudfront.tf", "allowed_methods        = local.read_methods", "allowed_methods        = local.all_methods", EDGE),
  site("CloudFront can read the page cache", "cloudfront.tf", 'origin_path              = "/_assets"', 'origin_path              = ""', ROUTES),
  site("public bucket policy allowed", "storage.tf", "block_public_policy     = true", "block_public_policy     = false", S3),
  site("any distribution can read the bucket", "storage.tf", '        Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.this.arn } }\n', "", S3),
  site("CloudFront can read the whole bucket", "storage.tf", 'Action    = "s3:GetObject"\n        Resource  = "${local.names.bucket_arn}/_assets/*"', 'Action    = "s3:GetObject"\n        Resource  = "${local.names.bucket_arn}/*"', S3),
  site("bucket accepts plain HTTP", "storage.tf", '"aws:SecureTransport" = "false"', '"aws:SecureTransport" = "true"', S3),
  site("queue is no longer FIFO", "storage.tf", "fifo_queue                  = true", "fifo_queue                  = false", ISR),
  site("subscriber batch changes", "main.tf", "batch_size       = 5", "batch_size       = 10", ISR),
  site("point-in-time recovery is off", "storage.tf", "point_in_time_recovery {\n    enabled = true", "point_in_time_recovery {\n    enabled = false", ISR),
  site("function role loses the boundary", "main.tf", "  permissions_boundary = var.permissions_boundary_arn\n", "", BOUNDARY),
  site("signer role loses the boundary", "edge.tf", "  permissions_boundary = var.permissions_boundary_arn\n", "", BOUNDARY),
  site("server may touch any S3 object", "main.tf", 'Resource = "${local.names.bucket_arn}/_cache/*"', 'Resource = "*"', LEAST),
  site("image function gets the secrets", "main.tf", 'Sid      = "ReadPublicAssets"\n        Effect   = "Allow"\n        Action   = "s3:GetObject"', 'Sid      = "ReadPublicAssets"\n        Effect   = "Allow"\n        Action   = ["s3:GetObject", "ssm:GetParameters"]', LEAST),
  site("KMS decrypt loses its SSM condition", "main.tf", '"kms:ViaService"                      = "ssm.${var.region}.amazonaws.com"\n', "", LEAST),
  site("database URL put in Lambda settings", "main.tf", 'CACHE_BUCKET_KEY_PREFIX   = "_cache"', 'CACHE_BUCKET_KEY_PREFIX   = "_cache"\n    DATABASE_URL = "fictional"', SECRETS),
  site("server skips the secrets entry", "main.tf", 'handler      = "hartolit-entry.handler"', 'handler      = "index.handler"', SECRETS),
  site("demo mode switched on", "main.tf", 'NEXT_PUBLIC_DEMO_MODE     = "false"', 'NEXT_PUBLIC_DEMO_MODE     = "true"', SECRETS),
  site("function placed in a VPC", "main.tf", '  publish          = false\n', '  publish          = false\n  vpc_config {\n    subnet_ids         = ["subnet-00000000000000000"]\n    security_group_ids = ["sg-00000000000000000"]\n  }\n', IDLE),
  site("secret names allowed in Lambda settings", "variables.tf", '!can(regex("(?i)(SECRET|PASSWORD|PASSPHRASE|PRIVATE|TOKEN|CREDENTIAL|DATABASE_URL|API_KEY|ACCESS_KEY)", key))', "true", "refuses_a_database_url_in_lambda_settings"),
  site("connection strings allowed in values", "variables.tf", '!can(regex("(?i)postgres(ql)?://|AKIA[0-9A-Z]{12,}|-----BEGIN", value))', "true", "refuses_a_connection_string_under_another_name"),
  site("any boundary accepted", "variables.tf", 'can(regex("^arn:aws:iam::[0-9]{12}:policy/hartolit-(staging|production)-tf-lambda-boundary$", var.permissions_boundary_arn))', 'var.permissions_boundary_arn != ""', "refuses_a_foreign_boundary"),
  site("production bucket can be force-destroyed", "variables.tf", '!var.force_destroy_assets || var.stage != "production"', "var.force_destroy_assets || !var.force_destroy_assets", "refuses_force_destroy_in_production"),

  roles("master trust widened to any branch", 'master_subject     = "repo:${var.github_repository}:ref:refs/heads/master"', 'master_subject     = "repo:${var.github_repository}:ref:refs/heads/*"', "plan_role_is_bound_to_master"),
  roles("trust loses the audience", '            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"\n', "", "plan_role_is_bound_to_master"),
  roles("apply role exists without protection", 'if(key != "apply" || var.apply_environment_protected)', "if true", "only_the_plan_role_exists_by_default"),
  roles("deploy role exists without protection", '(key != "deploy" || var.deploy_environment_protected)', "true", "only_the_plan_role_exists_by_default"),
  roles("deploy role trusts master instead of its environment", "deploy = local.deploy_subject", "deploy = local.master_subject", "deploy_role_exists_only_behind_its_environment"),
  roles("apply may delete the state file", 'Action   = ["s3:GetObject", "s3:PutObject"]\n        Resource = local.state_key_arn', 'Action   = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"]\n        Resource = local.state_key_arn', "apply_state_access_is_minimal"),
  roles("apply cannot release its lock", 'Action   = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"]\n        Resource = "${local.state_key_arn}.tflock"', 'Action   = ["s3:GetObject", "s3:PutObject"]\n        Resource = "${local.state_key_arn}.tflock"', "apply_state_access_is_minimal"),
  roles("deploy role can pass roles", 'Action   = ["lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:UpdateFunctionCode"]', 'Action   = ["iam:PassRole", "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:UpdateFunctionCode"]', NO_IAM),
  roles("deploy role loses its Deny", '"iam:*", "kms:*", "ssm:*", "sts:AssumeRole",', '"kms:*", "sts:AssumeRole",', NO_IAM),
  roles("deploy role can replace the signer", "Resource = local.deployed_functions", "Resource = concat(local.deployed_functions, local.edge_arns)", NO_IAM),
  roles("plan role can change a function", '"lambda:ListTags", "lambda:ListVersionsByFunction",\n        ]', '"lambda:ListTags", "lambda:ListVersionsByFunction", "lambda:UpdateFunctionCode",\n        ]', PLAN_ONLY),
  roles("secret parameters no longer denied", 'Action   = ["ssm:GetParameter*", "ssm:PutParameter", "ssm:DeleteParameter*", "ssm:LabelParameterVersion"]', 'Action   = ["ssm:LabelParameterVersion"]', PLAN_ONLY),
  roles("path reads no longer denied", 'Action   = "ssm:GetParametersByPath"\n      Resource = "*"', 'Action   = "ssm:GetParametersByPath"\n      Resource = "arn:aws:ssm:eu-central-1:111122223333:parameter/none"', PLAN_ONLY),
  roles("apply role trusts a branch instead of its environment", 'apply_subject      = "repo:${var.github_repository}:environment:${local.apply_environment}"', 'apply_subject      = "repo:${var.github_repository}:ref:refs/heads/master"', "apply_role_exists_only_behind_its_environment"),
  roles("guardrails not attached", "functions  = jsonencode(local.apply_functions_policy)\n    web        = jsonencode(local.apply_web_policy)\n    guardrails = jsonencode(local.apply_guardrails_policy)", "functions  = jsonencode(local.apply_functions_policy)\n    web        = jsonencode(local.apply_web_policy)", "apply_role_exists_only_behind_its_environment"),
  roles("apply may create roles outside the boundary", 'Sid       = "DenyRolePowersOutsideBoundary"', 'Sid       = "DenyRolePowersDisabled"', APPLY_BOUNDARY),
  roles("apply Allow loses the boundary", 'Action    = ["iam:CreateRole", "iam:DeleteRolePolicy", "iam:PutRolePolicy"]\n        Resource  = local.role_pattern\n        Condition = { StringEquals = { "iam:PermissionsBoundary" = var.lambda_boundary_arn } }', 'Action    = ["iam:CreateRole", "iam:DeleteRolePolicy", "iam:PutRolePolicy"]\n        Resource  = local.role_pattern\n        Condition = { StringEquals = { "aws:RequestedRegion" = "us-east-1" } }', APPLY_BOUNDARY),
  roles("apply may remove a boundary", 'Action   = "iam:DeleteRolePermissionsBoundary"', 'Action   = "iam:GetRole"', APPLY_BOUNDARY),
  roles("apply may edit its own roles", '"arn:aws:iam::${var.account_id}:role/hartolit-${var.stage}-*",\n', "", APPLY_BOUNDARY),
  roles("apply may rewrite a trust policy", '"iam:UpdateAssumeRolePolicy", ', "", APPLY_BOUNDARY),
  roles("apply may pass roles anywhere", 'Condition = { StringEquals = { "iam:PassedToService" = ["edgelambda.amazonaws.com", "lambda.amazonaws.com"] } }', 'Condition = { StringEquals = { "iam:PassedToService" = ["ec2.amazonaws.com", "lambda.amazonaws.com"] } }', APPLY_BOUNDARY),
  roles("apply may create a public URL", 'Sid       = "DenyPublicFunctionUrls"', 'Sid       = "DenyPublicUrlsDisabled"', APPLY_OPEN),
  roles("apply may grant invoke to anyone", 'Sid       = "DenyInvokeGrantsToOthers"', 'Sid       = "DenyInvokeDisabled"', APPLY_OPEN),
  roles("apply may use other regions", '{ StringNotEquals = { "aws:RequestedRegion" = ["eu-central-1", "us-east-1"] } }', '{ StringNotEquals = { "aws:RequestedRegion" = ["eu-central-1", "us-east-1", "eu-west-1"] } }', APPLY_OPEN),
  roles("apply gets a whole-service Allow", 'Sid    = "LambdaFunctions"\n        Effect = "Allow"\n        Action = [\n', 'Sid    = "LambdaFunctions"\n        Effect = "Allow"\n        Action = [\n          "lambda:*",\n', APPLY_OPEN),
  { name: "wildcard repository accepted", root: ROLES, file: `${ROLES}/variables.tf`, from: 'can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))', to: 'var.github_repository != ""', run: "refuses_a_wildcard_repository" },

  boot("state versioning off", 'status = "Enabled"\n  }\n}\n\nresource "aws_s3_bucket_server', 'status = "Suspended"\n  }\n}\n\nresource "aws_s3_bucket_server', "state_bucket_is_protected"),
  boot("state bucket can be public", "restrict_public_buckets = true", "restrict_public_buckets = false", "state_bucket_is_protected"),
  boot("state bucket can be deleted", 'Action    = ["s3:DeleteBucket", "s3:DeleteObjectVersion"]', 'Action    = ["s3:DeleteObjectVersion"]', "state_history_is_kept_and_locks_release"),
  boot("state history can be erased", 'Action    = ["s3:DeleteBucket", "s3:DeleteObjectVersion"]', 'Action    = ["s3:DeleteBucket"]', "state_history_is_kept_and_locks_release"),
  boot("lock release denied", 'Action    = ["s3:DeleteBucket", "s3:DeleteObjectVersion"]', 'Action    = ["s3:DeleteBucket", "s3:DeleteObjectVersion", "s3:DeleteObject"]', "state_history_is_kept_and_locks_release"),
  boot("lock markers kept forever", "expired_object_delete_marker = true", "expired_object_delete_marker = false", "state_history_is_kept_and_locks_release"),
  boot("state accepts plain HTTP", '"aws:SecureTransport" = "false"', '"aws:SecureTransport" = "true"', "state_bucket_is_protected"),
  boot("boundary allows all of S3", 'Sid      = "ReadAssetsAndPageCache"\n        Effect   = "Allow"\n        Action   = "s3:GetObject"', 'Sid      = "ReadAssetsAndPageCache"\n        Effect   = "Allow"\n        Action   = "s3:*"', "boundary_is_narrow"),
  boot("boundary allows IAM", 'Action   = "ssm:GetParameters"', 'Action   = ["ssm:GetParameters", "iam:PassRole"]', "boundary_is_narrow"),
  boot("boundary reads parameters by path", 'Action   = "ssm:GetParameters"', 'Action   = ["ssm:GetParameters", "ssm:GetParametersByPath"]', "boundary_is_narrow"),
  boot("production bootstrap guard removed", 'condition     = var.stage != "production" || var.production_bootstrap_approved', 'condition     = var.stage != ""', "production_bootstrap_is_refused"),

  { name: "secret stored as plain String", root: "envs/staging/secrets", file: "envs/staging/secrets/main.tf", from: 'type             = "SecureString"', to: 'type             = "String"', run: "secrets_are_write_only" },
  { name: "secret version removed", root: "envs/staging/secrets", file: "envs/staging/secrets/main.tf", from: "value_wo_version = var.secrets_version", to: "value_wo_version = 2", run: "secrets_are_write_only" },
  { name: "production site guard removed", root: "envs/production/site", file: "envs/production/site/main.tf", from: "condition     = var.production_apply_approved", to: "condition     = var.production_apply_approved || true", run: "production_is_refused_by_default" },
  { name: "production secrets guard removed", root: "envs/production/secrets", file: "envs/production/secrets/main.tf", from: "condition     = var.production_apply_approved", to: "condition     = var.production_apply_approved || true", run: "production_secrets_are_refused_by_default" },
];

// Behaviour of the deployed JavaScript, guarded by tests/terraform-functions.test.mjs.
const CODE_MUTATIONS = [
  ["signer hashes a truncated body", "edge-signer/index.mjs", 'if (body?.inputTruncated) return refuse("413", "Payload Too Large", "Request body exceeds the 1 MB limit.");', ""],
  ["signer hashes base64 text instead of bytes", "edge-signer/index.mjs", 'bytes = Buffer.from(body.data, "base64")', 'bytes = Buffer.from(body.data, "utf8")'],
  ["signer accepts an unknown encoding", "edge-signer/index.mjs", 'else return refuse("400", "Bad Request", "Unsupported request body encoding.");', ""],
  ["signer keeps a forged hash", "edge-signer/index.mjs", 'request.headers["x-amz-content-sha256"] = [{', 'request.headers["x-amz-content-sha256"] ??= [{'],
  ["viewer keeps a duplicate client IP", "viewer-request.js", "{ value: event.viewer.ip, multiValue: [{ value: event.viewer.ip }] }", "{ value: event.viewer.ip, multiValue: (request.headers['x-hartolit-client-ip'] || {}).multiValue }"],
  ["viewer keeps signature headers", "viewer-request.js", "for (i = 0; i < SIGNATURE_HEADERS.length; i++) delete request.headers[SIGNATURE_HEADERS[i]];", ""],
  ["viewer keeps location headers", "viewer-request.js", "for (i = 0; i < LOCATION_HEADERS.length; i++) delete request.headers[LOCATION_HEADERS[i]];", ""],
  ["viewer keeps a forged forwarded host", "viewer-request.js", 'request.headers["x-forwarded-host"] = { value: request.headers.host.value };', ""],
  ["viewer keeps a forged cache key", "viewer-request.js", 'request.headers["x-open-next-cache-key"] = { value: cacheKey(request) };', 'request.headers["x-open-next-cache-key"] = request.headers["x-open-next-cache-key"] || { value: cacheKey(request) };'],
  ["viewer passes oversized headers", "viewer-request.js", "headerBytes(request) > SAFE_HEADER_BYTES", "false"],
  ["placeholder answers 200", "placeholder.mjs", "statusCode: 503", "statusCode: 200"],
  ["placeholder acknowledges queue events", "placeholder.mjs", 'if (!event?.requestContext?.http) throw new Error("The application package is not deployed");', ""],
  ["entry ignores missing parameters", "server-entry/hartolit-secrets.mjs", 'if (result?.InvalidParameters?.length) throw new Error("A required SSM parameter is missing");', ""],
  ["entry accepts an empty value", "server-entry/hartolit-secrets.mjs", 'if (typeof value !== "string" || value.length === 0) throw new Error(`No value for ${envName}`);', ""],
  ["entry reads parameters of another application", "server-entry/hartolit-secrets.mjs", "|| !PARAMETER_NAME.test(parameter)", ""],
  ["entry loads the app before its secrets", "server-entry/hartolit-entry.mjs", 'const { handler: openNextHandler } = await import("./index.mjs");\nexport const handler = openNextHandler;', 'export { handler } from "./index.mjs";'],
];

function replaceOnce(text, from, to, name) {
  const index = text.indexOf(from);
  if (index < 0) throw new Error(`Mutation "${name}" no longer matches its file`);
  return `${text.slice(0, index)}${to}${text.slice(index + from.length)}`;
}

function writeFile(container, file, content) {
  const result = docker(["exec", "-i", container, "sh", "-c", `cat > '${TF}/${file}'`], { input: content });
  if (result.status !== 0) throw new Error(`Could not write ${file}\n${result.output}`);
}

function runCodeMutations() {
  const original = "infra/terraform/modules/opennext-site/functions";
  const nodeTest = (functions) => spawnSync(process.execPath, ["--test", "tests/terraform-functions.test.mjs"], { encoding: "utf8", env: { ...process.env, HARTOLIT_TF_FUNCTIONS: functions } });
  if (nodeTest(original).status !== 0) throw new Error("The function tests fail before any mutation");
  let survived = 0;
  for (const [name, file, from, to] of CODE_MUTATIONS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hartolit-function-mutation-"));
    try {
      fs.cpSync(original, dir, { recursive: true });
      const target = path.join(dir, file);
      fs.writeFileSync(target, replaceOnce(fs.readFileSync(target, "utf8"), from, to, name));
      const result = nodeTest(dir);
      if (result.status === 0) { survived += 1; console.error(`SURVIVED code: ${name}`); }
      else console.log(`caught code: ${name}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return survived;
}

const workspace = copyWorkspace();
let container;
let survived = 0;
try {
  ensureProviders(workspace);
  container = startContainer(workspace);
  for (const root of ROOTS) {
    initRoot(container, root);
    const baseline = terraform(container, root, ["test", "-no-color"]);
    if (baseline.status !== 0) throw new Error(`${root} fails before any mutation\n${baseline.output}`);
  }
  for (const mutation of MUTATIONS) {
    const source = fs.readFileSync(path.join(workspace, "infra/terraform", mutation.file), "utf8");
    writeFile(container, mutation.file, replaceOnce(source, mutation.from, mutation.to, mutation.name));
    const result = terraform(container, mutation.root, ["test", "-no-color"]);
    writeFile(container, mutation.file, source);
    const named = new RegExp(`run "${mutation.run}"\\.\\.\\. fail`).test(result.output);
    if (result.status !== 0 && named) console.log(`caught: ${mutation.name} -> ${mutation.run}`);
    else { survived += 1; console.error(`SURVIVED: ${mutation.name} (expected ${mutation.run} to fail, exit ${result.status})\n${result.output.slice(0, 1500)}`); }
  }
  survived += runCodeMutations();
  const total = MUTATIONS.length + CODE_MUTATIONS.length;
  if (survived) {
    console.error(`FAIL ${survived} of ${total} mutations survived`);
    process.exitCode = 1;
  } else {
    console.log(`PASS all ${total} mutations were caught (${MUTATIONS.length} Terraform, ${CODE_MUTATIONS.length} function code)`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (container) stopContainer(container);
  fs.rmSync(workspace, { recursive: true, force: true });
}
