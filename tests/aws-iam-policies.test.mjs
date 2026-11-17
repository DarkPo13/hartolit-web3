// Checks the hand-applied IAM policies in infra/aws/iam (D82) without AWS: JSON shape and size,
// that every name SST 4.17.2 gives this app's resources falls inside their patterns while other
// names do not, and - through a small model of the condition operators these files use - that
// the GitHub deploy role can do what a deploy needs but cannot step outside the Lambda boundary.
// This is a model, not the AWS policy engine: IAM Access Analyzer and a real deploy remain the proof.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";

const DIR = "infra/aws/iam";
const ACCOUNT = "111122223333";
const FILES = ["hartolit-staging-lambda-boundary", "hartolit-staging-deploy-bootstrap", "hartolit-staging-deploy-functions", "hartolit-staging-deploy-web", "hartolit-staging-deploy-guardrails"];
const text = (name) => fs.readFileSync(path.join(DIR, `${name}.json`), "utf8");
const load = (name) => JSON.parse(text(name).replaceAll("ACCOUNT_ID", ACCOUNT));
const [boundary, bootstrap, functions, web, guardrails] = FILES.map(load);
const BOUNDARY_ARN = `arn:aws:iam::${ACCOUNT}:policy/hartolit-staging-lambda-boundary`;
const DEPLOY = [functions, web, guardrails];
const FIRST_DEPLOY = [bootstrap, ...DEPLOY];

// --- names, as SST 4.17.2 builds them (.sst/platform/src/components/naming.ts, component.ts) ---
const APP = "hartolit-field-passport", STAGE = "staging";
function prefixName(max, name) {
  name = name.replace(/[^a-zA-Z0-9]/g, "");
  if (name.length + 1 >= max) return name.substring(0, max);
  if (name.length + STAGE.length + 2 >= max) return `${STAGE.substring(0, max - name.length - 1)}-${name}`;
  return `${APP.substring(0, max - STAGE.length - name.length - 2)}-${STAGE}-${name}`;
}
const physicalName = (max, name, suffix = "") => `${prefixName(max - 9 - suffix.length, name)}-abcdefgh${suffix}`;
// The queue subscriber's name carries a 6-character hash of the queue ARN (queue.ts).
const SUBSCRIBER = "WebRevalidationEventsSubscriberAbcdef";
const FUNCTIONS = { server: "WebServerEucentral1", image: "WebImageOptimizer", seeder: "WebRevalidationSeeder", subscriber: `${SUBSCRIBER}Function` };
const fn = Object.fromEntries(Object.entries(FUNCTIONS).map(([key, name]) => [key, physicalName(64, `${name}Function`)]));
const role = Object.fromEntries(Object.entries(FUNCTIONS).map(([key, name]) => [key, physicalName(64, `${name}Role`)]));
fn.edge = physicalName(64, "WebEdgeFn");
role.edge = physicalName(64, "WebEdgeRole");
const queue = physicalName(80, "WebRevalidationEventsQueue", ".fifo");
const table = physicalName(255, "WebRevalidationTable");
const bucket = physicalName(63, "WebAssetsBucket").toLowerCase();
const cfFunctions = ["WebCloudfrontFunctionRequest", "WebCloudfrontFunctionResponse"].map((name) => physicalName(64, name));

const lambdaArn = (name, region = "eu-central-1") => `arn:aws:lambda:${region}:${ACCOUNT}:function:${name}`;
const roleArn = (name) => `arn:aws:iam::${ACCOUNT}:role/${name}`;
const logArn = (name, region = "eu-central-1") => `arn:aws:logs:${region}:${ACCOUNT}:log-group:/aws/lambda/${name}`;
const queueArn = `arn:aws:sqs:eu-central-1:${ACCOUNT}:${queue}`;
const tableArn = `arn:aws:dynamodb:eu-central-1:${ACCOUNT}:table/${table}`;
const bucketArn = `arn:aws:s3:::${bucket}`;
const distributionArn = `arn:aws:cloudfront::${ACCOUNT}:distribution/E2EXAMPLE0000`;
const BASIC_LOGGING = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole";
const ADMIN = "arn:aws:iam::aws:policy/AdministratorAccess";

// --- a model of IAM evaluation for exactly the operators these files use ---
const list = (value) => (Array.isArray(value) ? value : [value]);
const escape = (part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&");
const glob = (pattern, value, flags = "") => new RegExp(`^${pattern.split("*").map((part) => part.split("?").map(escape).join(".")).join(".*")}$`, flags).test(value);
function conditionHolds(condition = {}, context) {
  return Object.entries(condition).every(([operator, pairs]) => Object.entries(pairs).every(([key, expected]) => {
    const actual = context[key];
    const values = list(expected);
    switch (operator) {
      case "StringEquals": return actual !== undefined && values.includes(actual);
      // A missing key makes a negated operator true (IAM User Guide, condition operators).
      case "StringNotEquals": return actual === undefined || !values.includes(actual);
      case "ArnEquals": case "ArnLike": return actual !== undefined && values.some((value) => glob(value, actual));
      default: throw new Error(`operator ${operator} is not modelled`);
    }
  }));
}
// "denied" = an explicit Deny matched; "not allowed" = no Allow matched (implicit deny).
function decide(policies, action, resource, context = {}) {
  const requestContext = { "aws:RequestedRegion": "eu-central-1", ...context };
  let allowed = false;
  for (const policy of policies) for (const statement of policy.Statement) {
    if (!list(statement.Action).some((pattern) => glob(pattern, action, "i"))) continue;
    if (!list(statement.Resource).some((pattern) => glob(pattern, resource))) continue;
    if (!conditionHolds(statement.Condition, requestContext)) continue;
    if (statement.Effect === "Deny") return "denied";
    allowed = true;
  }
  return allowed ? "allowed" : "not allowed";
}
// IAM, CloudFront and the global STS endpoint are requested in us-east-1.
const GLOBAL = { "aws:RequestedRegion": "us-east-1" };
const withBoundary = (extra = {}) => ({ ...GLOBAL, "iam:PermissionsBoundary": BOUNDARY_ARN, ...extra });

test("the five files are IAM policies within the managed-policy size limit, with no Allow on everything", () => {
  assert.deepEqual(fs.readdirSync(DIR).filter((file) => file.endsWith(".json")).sort(), FILES.map((name) => `${name}.json`).sort(), "no stray policy files");
  for (const name of FILES) {
    const policy = load(name);
    assert.equal(policy.Version, "2012-10-17", name);
    // A customer managed policy may hold 6,144 characters, white space not counted.
    const size = text(name).replace(/\s/g, "").length;
    assert.ok(size <= 6144, `${name}: ${size} characters`);
    const sids = policy.Statement.map((statement) => statement.Sid);
    assert.equal(new Set(sids).size, sids.length, `${name}: duplicate Sid`);
    for (const statement of policy.Statement) {
      assert.deepEqual(Object.keys(statement).filter((key) => !["Sid", "Effect", "Action", "Resource", "Condition"].includes(key)), [], `${name}/${statement.Sid}: NotAction, NotResource or Principal`);
      assert.ok(["Allow", "Deny"].includes(statement.Effect));
      if (statement.Effect !== "Allow") continue;
      assert.ok(!list(statement.Action).some((action) => action === "*" || action.endsWith(":*")), `${name}/${statement.Sid}: a whole-service Allow`);
      // Only these APIs take no resource ARN (Service Authorization Reference).
      if (list(statement.Resource).includes("*")) assert.ok(["WhoAmI", "QueueTriggerCreate", "QueueTriggerList"].includes(statement.Sid), `${name}/${statement.Sid}: Resource "*"`);
    }
    assert.ok(!/\d{12}/.test(text(name)), `${name}: an account number is committed`);
  }
  assert.ok(boundary.Statement.every((statement) => statement.Effect === "Allow"), "the boundary only allows");
});

test("SST's own naming gives the names these patterns were written for", { skip: !fs.existsSync(".sst/platform/src/components/naming.ts") && "needs `npx sst install`" }, async () => {
  globalThis.$app = { name: APP, stage: STAGE };
  const naming = await createJiti(import.meta.url).import("../.sst/platform/src/components/naming.ts");
  const strip = (value) => value.replace(/-[a-z]{8}(\.fifo)?$/, "$1");
  for (const [max, name, suffix] of [[64, "WebServerEucentral1Function"], [64, "WebServerEucentral1Role"], [64, `${SUBSCRIBER}FunctionFunction`], [64, `${SUBSCRIBER}FunctionRole`], [64, "WebEdgeFn"], [80, "WebRevalidationEventsQueue", ".fifo"], [255, "WebRevalidationTable"], [64, "WebCloudfrontFunctionResponse"]]) {
    assert.equal(strip(naming.physicalName(max, name, suffix)), strip(physicalName(max, name, suffix)), name);
  }
});

test("a first deploy can create everything SST makes for this app, and later deploys need no bootstrap rights", () => {
  const needed = [
    ["sts:GetCallerIdentity", "*", GLOBAL],
    ["ssm:GetParameter", `arn:aws:ssm:eu-central-1:${ACCOUNT}:parameter/sst/bootstrap`],
    ["ssm:GetParameters", `arn:aws:ssm:eu-central-1:${ACCOUNT}:parameter/sst/passphrase/hartolit-field-passport/staging`],
    ["ecr:DescribeRepositories", `arn:aws:ecr:eu-central-1:${ACCOUNT}:repository/sst-asset`],
    ["s3:PutObject", "arn:aws:s3:::sst-state-abcdefgh/app/hartolit-field-passport/staging.json"],
    ["s3:PutObject", "arn:aws:s3:::sst-asset-abcdefgh/assets/server-code.zip"],
    ["s3:GetObject", "arn:aws:s3:::sst-asset-abcdefgh/assets/server-code.zip"],
    ...Object.entries(fn).filter(([key]) => key !== "edge").flatMap(([, name]) => [
      ["lambda:CreateFunction", lambdaArn(name)], ["lambda:UpdateFunctionCode", lambdaArn(name)], ["lambda:TagResource", lambdaArn(name)],
      ["lambda:GetFunctionCodeSigningConfig", lambdaArn(name)], ["lambda:DeleteFunction", lambdaArn(name)],
      ["logs:CreateLogGroup", logArn(name)], ["logs:PutRetentionPolicy", logArn(name)], ["logs:TagResource", logArn(name)],
    ]),
    ["lambda:CreateFunction", lambdaArn(fn.edge, "us-east-1"), { "aws:RequestedRegion": "us-east-1" }],
    ["lambda:PublishVersion", lambdaArn(fn.edge, "us-east-1"), { "aws:RequestedRegion": "us-east-1" }],
    ["lambda:GetFunction", `${lambdaArn(fn.edge, "us-east-1")}:1`, { "aws:RequestedRegion": "us-east-1" }],
    ["lambda:EnableReplication", `${lambdaArn(fn.edge, "us-east-1")}:1`, { "aws:RequestedRegion": "us-east-1" }],
    ["lambda:CreateFunctionUrlConfig", lambdaArn(fn.server), { "lambda:FunctionUrlAuthType": "AWS_IAM" }],
    ["lambda:CreateFunctionUrlConfig", lambdaArn(fn.image), { "lambda:FunctionUrlAuthType": "AWS_IAM" }],
    ["lambda:AddPermission", lambdaArn(fn.server), { "lambda:Principal": "cloudfront.amazonaws.com" }],
    ["lambda:InvokeFunction", lambdaArn(fn.seeder)],
    ["lambda:CreateEventSourceMapping", "*", { "lambda:FunctionArn": lambdaArn(fn.subscriber) }],
    ["lambda:DeleteEventSourceMapping", `arn:aws:lambda:eu-central-1:${ACCOUNT}:event-source-mapping:0b0b0b0b-0000-4000-8000-000000000000`],
    ...Object.values(role).flatMap((name) => [
      ["iam:CreateRole", roleArn(name), withBoundary()], ["iam:TagRole", roleArn(name), GLOBAL], ["iam:GetRole", roleArn(name), GLOBAL],
      ["iam:PutRolePolicy", roleArn(name), withBoundary()], ["iam:AttachRolePolicy", roleArn(name), withBoundary({ "iam:PolicyARN": BASIC_LOGGING })],
      ["iam:PassRole", roleArn(name), { ...GLOBAL, "iam:PassedToService": "lambda.amazonaws.com" }],
      ["iam:DeleteRolePolicy", roleArn(name), withBoundary()], ["iam:DetachRolePolicy", roleArn(name), withBoundary({ "iam:PolicyARN": BASIC_LOGGING })],
      ["iam:ListInstanceProfilesForRole", roleArn(name), GLOBAL], ["iam:DeleteRole", roleArn(name), GLOBAL],
    ]),
    ["iam:CreateServiceLinkedRole", roleArn("aws-service-role/replicator.lambda.amazonaws.com/AWSServiceRoleForLambdaReplicator"), { ...GLOBAL, "iam:AWSServiceName": "replicator.lambda.amazonaws.com" }],
    ["s3:CreateBucket", bucketArn], ["s3:PutBucketPolicy", bucketArn], ["s3:PutBucketPublicAccessBlock", bucketArn], ["s3:PutObject", `${bucketArn}/_next/static/app.js`],
    ["sqs:CreateQueue", queueArn], ["sqs:SetQueueAttributes", queueArn],
    ["dynamodb:CreateTable", tableArn], ["dynamodb:UpdateContinuousBackups", tableArn],
    ...cfFunctions.flatMap((name) => [["cloudfront:CreateFunction", `arn:aws:cloudfront::${ACCOUNT}:function/${name}`, GLOBAL], ["cloudfront:PublishFunction", `arn:aws:cloudfront::${ACCOUNT}:function/${name}`, GLOBAL]]),
    ["cloudfront:CreateDistribution", distributionArn, GLOBAL], ["cloudfront:CreateInvalidation", distributionArn, GLOBAL],
    ["cloudfront:CreateCachePolicy", `arn:aws:cloudfront::${ACCOUNT}:cache-policy/0b0b0b0b-0000-4000-8000-000000000000`, GLOBAL],
    ["cloudfront:CreateKeyValueStore", `arn:aws:cloudfront::${ACCOUNT}:key-value-store/0b0b0b0b-0000-4000-8000-000000000000`, GLOBAL],
    ["cloudfront-keyvaluestore:UpdateKeys", `arn:aws:cloudfront::${ACCOUNT}:key-value-store/0b0b0b0b-0000-4000-8000-000000000000`, GLOBAL],
  ];
  const bootstrapOnly = [
    ["s3:CreateBucket", "arn:aws:s3:::sst-state-abcdefgh"], ["s3:PutBucketPolicy", "arn:aws:s3:::sst-state-abcdefgh"], ["s3:PutBucketVersioning", "arn:aws:s3:::sst-asset-abcdefgh"],
    ["ecr:CreateRepository", `arn:aws:ecr:eu-central-1:${ACCOUNT}:repository/sst-asset`],
    ["ssm:PutParameter", `arn:aws:ssm:eu-central-1:${ACCOUNT}:parameter/sst/bootstrap`],
    ["ssm:PutParameter", `arn:aws:ssm:eu-central-1:${ACCOUNT}:parameter/sst/passphrase/hartolit-field-passport/staging`],
  ];
  for (const [action, resource, context] of needed) {
    assert.equal(decide(FIRST_DEPLOY, action, resource, context), "allowed", `first deploy: ${action} ${resource}`);
    assert.equal(decide(DEPLOY, action, resource, context), "allowed", `later deploy: ${action} ${resource}`);
  }
  for (const [action, resource] of bootstrapOnly) {
    assert.equal(decide(FIRST_DEPLOY, action, resource), "allowed", `bootstrap: ${action} ${resource}`);
    assert.equal(decide(DEPLOY, action, resource), "not allowed", `after bootstrap: ${action} ${resource}`);
  }
});

test("the deploy role cannot create or change a role outside the boundary, nor the boundary itself", () => {
  const server = roleArn(role.server);
  const ownRole = roleArn("hartolit-github-staging-deploy");
  const denied = [
    // explicit Deny in the guardrails, whatever an Allow might say later
    ["iam:CreateRole", server, { ...GLOBAL }],
    ["iam:CreateRole", server, { ...GLOBAL, "iam:PermissionsBoundary": ADMIN }],
    ["iam:PutRolePolicy", server, { ...GLOBAL }],
    ["iam:AttachRolePolicy", server, { ...GLOBAL, "iam:PolicyARN": BASIC_LOGGING }],
    ["iam:PutRolePermissionsBoundary", server, { ...GLOBAL, "iam:PermissionsBoundary": ADMIN }],
    ["iam:DeleteRolePermissionsBoundary", server, GLOBAL],
    ["iam:CreatePolicyVersion", BOUNDARY_ARN, GLOBAL],
    ["iam:SetDefaultPolicyVersion", BOUNDARY_ARN, GLOBAL],
    ["iam:DeletePolicyVersion", BOUNDARY_ARN, GLOBAL],
    ["iam:DeletePolicy", BOUNDARY_ARN, GLOBAL],
    ["iam:CreatePolicyVersion", `arn:aws:iam::${ACCOUNT}:policy/hartolit-staging-deploy-functions`, GLOBAL],
    ["iam:AttachRolePolicy", ownRole, withBoundary({ "iam:PolicyARN": ADMIN })],
    ["iam:PutRolePolicy", ownRole, withBoundary()],
    ["iam:DetachRolePolicy", ownRole, withBoundary({ "iam:PolicyARN": `arn:aws:iam::${ACCOUNT}:policy/hartolit-staging-deploy-guardrails` })],
    ["iam:UpdateAssumeRolePolicy", ownRole, GLOBAL],
    ["iam:UpdateAssumeRolePolicy", server, GLOBAL],
    ["iam:PassRole", ownRole, { ...GLOBAL, "iam:PassedToService": "lambda.amazonaws.com" }],
    ["iam:UpdateOpenIDConnectProviderThumbprint", `arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com`, GLOBAL],
    ["iam:CreateUser", roleArn("x").replace(":role/", ":user/"), GLOBAL],
    ["iam:CreatePolicy", `arn:aws:iam::${ACCOUNT}:policy/anything`, GLOBAL],
    ["sts:AssumeRole", server, GLOBAL],
    ["lambda:CreateFunction", lambdaArn(fn.server, "eu-west-1"), { "aws:RequestedRegion": "eu-west-1" }],
  ];
  const notAllowed = [
    ["iam:CreateRole", roleArn("attacker-admin"), withBoundary()],
    ["iam:AttachRolePolicy", server, withBoundary({ "iam:PolicyARN": ADMIN })],
    ["iam:PutRolePermissionsBoundary", server, withBoundary()],
    ["iam:PassRole", server, { ...GLOBAL, "iam:PassedToService": "ec2.amazonaws.com" }],
    ["iam:PassRole", roleArn("OrganizationAccountAccessRole"), { ...GLOBAL, "iam:PassedToService": "lambda.amazonaws.com" }],
    ["lambda:CreateFunctionUrlConfig", lambdaArn(fn.server), { "lambda:FunctionUrlAuthType": "NONE" }],
    ["lambda:AddPermission", lambdaArn(fn.server), { "lambda:Principal": "*" }],
    ["lambda:InvokeFunction", lambdaArn(fn.server)],
    ["lambda:CreateFunction", lambdaArn("other-app-prod-Api")],
    ["lambda:CreateEventSourceMapping", "*", { "lambda:FunctionArn": lambdaArn(fn.server) }],
    // (Bucket policies on the SST buckets and the passphrase write exist only while the
    // bootstrap policy is attached; the previous test checks they are gone afterwards.)
    ["ssm:GetParameter", `arn:aws:ssm:eu-central-1:${ACCOUNT}:parameter/sst/passphrase/other-app/production`],
    ["s3:PutBucketPolicy", "arn:aws:s3:::other-company-bucket"],
  ];
  for (const policies of [DEPLOY, FIRST_DEPLOY]) {
    for (const [action, resource, context] of denied) assert.equal(decide(policies, action, resource, context), "denied", `${action} ${resource}`);
    for (const [action, resource, context] of notAllowed) assert.notEqual(decide(policies, action, resource, context), "allowed", `${action} ${resource}`);
  }
  // The Allows alone already refuse a role without the boundary; the guardrails are a second lock.
  for (const [action, resource, context] of [
    ["iam:CreateRole", server, GLOBAL], ["iam:CreateRole", server, { ...GLOBAL, "iam:PermissionsBoundary": ADMIN }],
    ["iam:PutRolePolicy", server, GLOBAL], ["iam:AttachRolePolicy", server, { ...GLOBAL, "iam:PolicyARN": BASIC_LOGGING }],
    ["iam:DeleteRolePermissionsBoundary", server, GLOBAL], ["iam:UpdateAssumeRolePolicy", server, GLOBAL],
    ["iam:CreatePolicyVersion", BOUNDARY_ARN, GLOBAL], ["iam:PassRole", ownRole, { ...GLOBAL, "iam:PassedToService": "lambda.amazonaws.com" }],
  ]) assert.equal(decide([bootstrap, functions, web], action, resource, context), "not allowed", `without guardrails: ${action} ${resource}`);
  // The guardrails' policy-name pattern covers every policy file, so none can be rewritten by the role.
  for (const name of FILES) assert.equal(decide(DEPLOY, "iam:CreatePolicyVersion", `arn:aws:iam::${ACCOUNT}:policy/${name}`, GLOBAL), "denied", name);
});

test("the boundary admits what SST grants each function and nothing an escalation would need", () => {
  // Statements SST 4.17.2 writes into each role (nextjs.ts, ssr-site.ts, queue-lambda-subscriber.ts) plus AWSLambdaBasicExecutionRole.
  const needed = [
    ...["s3:GetObject", "s3:PutObject", "s3:DeleteObject"].map((action) => [action, `${bucketArn}/_cache/build/index.cache`]),
    ["s3:ListBucket", bucketArn],
    ...["sqs:SendMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility"].map((action) => [action, queueArn]),
    ...["dynamodb:BatchGetItem", "dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:Query", "dynamodb:GetItem", "dynamodb:Scan", "dynamodb:ConditionCheckItem", "dynamodb:BatchWriteItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:DescribeTable"]
      .flatMap((action) => [[action, tableArn], [action, `${tableArn}/index/revalidate`]]),
    ["cloudfront:CreateInvalidation", distributionArn],
    ...Object.entries(fn).filter(([key]) => key !== "edge").flatMap(([, name]) => ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"].map((action) => [action, `${logArn(name)}:log-stream:2026/11/17/[$LATEST]0000`])),
    // Lambda@Edge replicas log in the region that ran them, under the us-east-1 name.
    ...["eu-west-2", "us-east-1", "ap-northeast-1"].map((region) => ["logs:PutLogEvents", `${logArn(`us-east-1.${fn.edge}`, region)}:log-stream:0000`]),
  ];
  for (const [action, resource] of needed) assert.equal(decide([boundary], action, resource), "allowed", `${action} ${resource}`);
  const outside = [
    ["iam:CreateRole", roleArn("x")], ["iam:PassRole", roleArn(role.server)], ["iam:PutRolePolicy", roleArn(role.server)],
    ["sts:AssumeRole", roleArn(role.server)], ["lambda:InvokeFunction", lambdaArn(fn.server)], ["lambda:UpdateFunctionCode", lambdaArn(fn.server)],
    ["s3:GetObject", "arn:aws:s3:::sst-state-abcdefgh/secret/hartolit-field-passport/staging.json"], ["s3:PutObject", "arn:aws:s3:::sst-asset-abcdefgh/assets/x.zip"],
    ["s3:PutBucketPolicy", bucketArn], ["s3:GetObject", "arn:aws:s3:::other-company-bucket/data.csv"],
    ["ssm:GetParameter", `arn:aws:ssm:eu-central-1:${ACCOUNT}:parameter/sst/passphrase/hartolit-field-passport/staging`],
    ["dynamodb:Scan", `arn:aws:dynamodb:eu-central-1:${ACCOUNT}:table/other-table`], ["sqs:SendMessage", `arn:aws:sqs:eu-central-1:${ACCOUNT}:other-queue`],
    ["logs:PutLogEvents", `${logArn("other-function")}:log-stream:0000`], ["cloudfront:UpdateDistribution", distributionArn],
    ["kms:Decrypt", `arn:aws:kms:eu-central-1:${ACCOUNT}:key/0b0b0b0b-0000-4000-8000-000000000000`], ["secretsmanager:GetSecretValue", `arn:aws:secretsmanager:eu-central-1:${ACCOUNT}:secret:x`],
  ];
  for (const [action, resource] of outside) assert.equal(decide([boundary], action, resource), "not allowed", `${action} ${resource}`);
});

test("the patterns hold every name SST gives this app and no look-alike", () => {
  const statement = (policy, sid) => policy.Statement.find((item) => item.Sid === sid);
  const covers = (policy, sid, arn) => list(statement(policy, sid).Resource).some((pattern) => glob(pattern, arn));
  for (const name of Object.values(role)) for (const sid of ["FunctionRolesReadTagDelete", "FunctionRolesOnlyInsideBoundary", "PassFunctionRolesToLambdaOnly"]) assert.ok(covers(functions, sid, roleArn(name)), `${sid} ${name}`);
  for (const [key, name] of Object.entries(fn)) assert.ok(covers(functions, "LambdaFunctions", lambdaArn(name, key === "edge" ? "us-east-1" : "eu-central-1")), name);
  for (const name of cfFunctions) assert.ok(covers(web, "CloudFrontFunctions", `arn:aws:cloudfront::${ACCOUNT}:function/${name}`), name);
  for (const outsider of ["hartolit-github-staging-deploy", "OrganizationAccountAccessRole", "hartolit-field-passport-production-WebServerRole-abcdefgh", "staging-Admin"]) {
    assert.ok(!covers(functions, "FunctionRolesOnlyInsideBoundary", roleArn(outsider)), outsider);
    assert.ok(!covers(functions, "PassFunctionRolesToLambdaOnly", roleArn(outsider)), outsider);
  }
  assert.ok(!covers(functions, "RunRevalidationSeeder", lambdaArn(fn.server)), "only the seeder may be invoked");
  assert.ok(!covers(functions, "LambdaFunctions", lambdaArn(fn.server.replace("staging", "production"))), "another stage");
});
