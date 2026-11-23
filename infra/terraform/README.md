# Hartolit infrastructure in Terraform

Terraform 1.17.2 and AWS provider 6.73.0 describe the AWS hosting for OpenNext 4.1.16 on Next.js 16.4.6 and Node.js 24 (D83). **Nothing here has been applied.** `sst.config.ts` stays in the repository until parity is confirmed on real staging.

## Who owns what

| Owner | Responsibility |
|---|---|
| Terraform | AWS infrastructure, IAM, the placeholder Lambda package |
| App deploy (`app-deploy` role) | Application code, static files, page cache, CloudFront invalidation |
| Prisma Migrate | PostgreSQL schema |
| Better Auth | Application users and sessions |
| An administrator | The bootstrap run and secret values |

## Layout

```text
bootstrap/                 state bucket, Lambda boundary, GitHub roles (administrator only)
modules/naming/            every resource name, shared by policies and resources
modules/opennext-site/     CloudFront, Lambda, Lambda@Edge, S3, SQS, DynamoDB
modules/github-oidc-roles/ tf-plan, tf-apply, app-deploy
envs/staging/site/         staging infrastructure
envs/staging/secrets/      write-only staging secrets (administrator only)
envs/production/           prepared and refused until production is approved
```

Each root has its own state key. Staging and production use separate AWS accounts and state buckets, and `allowed_account_ids` makes Terraform refuse credentials from the wrong account.

## Security model

- **Direct Lambda calls are refused.** Function URLs use `AWS_IAM`, and only this CloudFront distribution may invoke them, through OAC.
- **Request bodies are signed.** A Lambda@Edge function adds the SHA-256 for POST, PUT and PATCH, and answers 413 above CloudFront's 1 MB limit.
- **The client IP cannot be forged.** The CloudFront Function overwrites `x-hartolit-client-ip`, and the app reads only that header (D78).
- **CSP stays per request.** The cache policies have TTL 0/0 and no behavior has a response headers policy, so a page and its nonce are never shared.
- **Every execution role has a boundary.** `hartolit-<stage>-tf-lambda-boundary` is created by bootstrap. The existing SST boundary is not changed, because it does not allow reading SSM.
- **Secrets stay out of Git, logs and state.** They are ephemeral inputs written with `value_wo` to SSM SecureString, then loaded by the server at cold start. Lambda settings hold only their names.
- **A push to `master` cannot change IAM.** It can reach `tf-plan` (read-only) and `app-deploy` (code only). `tf-apply` is not created until `apply_environment_protected = true`.

**Remaining risk:** whoever can push to `master` can deploy code that runs as the server role, and that code can read the server's secrets. Branch protection and a required reviewer are the mitigation. Independent approval is **not** configured yet.

## Deliberate differences from SST

| SST | Terraform | Why |
|---|---|---|
| One behavior plus KeyValueStore routing | Static CloudFront behaviors from OpenNext's output | Fewer moving parts, no KVS write rights |
| CloudFront may read the whole bucket | Only `_assets/` | The page cache stays private |
| Open CORS on the bucket | No CORS | Assets are same-origin |
| Viewer location headers are copied | Viewer location and signature headers are removed | A viewer cannot forge them or leave a cached error |
| CloudFront's default error caching | Errors are not cached | One bad request cannot answer for others |
| Secrets in Lambda environment | SSM, loaded at cold start | Not in state or function settings |
| Server may invalidate any distribution | No such right | OpenNext's invalidation here is a no-op |
| Static and image routes accept every method | GET/HEAD (image also OPTIONS) | Smaller attack surface |

## Checks

All of them work without AWS. After the provider download, the container has no network.

```bash
npm run test:terraform:functions   # CloudFront, Lambda@Edge and secrets code
npm run test:terraform             # fmt, validate, test, offline provider plans
npm run test:terraform:mutations   # removes each protection; its test must fail
```

## Before the first `terraform apply`

Each AWS or Neon step below needs its own approval.

1. Confirm with a read-only inventory that the account holds no SST resources.
2. Confirm the repository's OIDC `sub` format (README, "AWS staging", step 1).
3. An administrator runs `bootstrap` with `staging.tfvars`, then moves its state into the new bucket.
4. Create the GitHub Environment `staging-terraform-apply` (master only, required reviewer). Only then set `apply_environment_protected = true`.
5. Build the application deploy script and the plan, apply and deploy workflows. They do not exist yet, so a fresh site answers 503. The deploy must add `functions/server-entry/*.mjs` to the server bundle, build with `HARTOLIT_CLIENT_IP_SOURCE=cloudfront` and the public site URL from a repository variable (the `app-deploy` role cannot read SSM), upload `_assets` and `_cache` with SST's cache headers, invoke the seeder with `{"RequestType":"Create"}`, and invalidate `/*`.
6. Add PostgreSQL technical roles for Neon. Prisma needs a migration role and the app a runtime role.
7. An administrator writes the staging secrets through `envs/staging/secrets`.
8. Review a real `terraform plan`. The IAM action lists are derived from the provider and are not yet proven against AWS.
9. After the first apply, verify on staging: POST and PATCH through OAC, a bodiless DELETE, 403 on direct Lambda URLs, the CSP nonce, sign-in limits by client IP, and ISR.

```bash
# Example for step 3, with short-lived administrator credentials:
cd infra/terraform/bootstrap
terraform init
terraform plan -var-file=staging.tfvars
```
