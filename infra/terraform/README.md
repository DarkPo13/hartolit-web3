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
- **A push to `master` reaches only `tf-plan`,** which reads and changes nothing but its own lock. `app-deploy` and `tf-apply` are not created until their GitHub Environments (`staging-app-deploy`, `staging-terraform-apply`) allow `master` alone and require a reviewer, and an administrator then sets `deploy_environment_protected` or `apply_environment_protected`. An environment's OIDC subject carries no branch, so the environment's own branch rule is the control, and GitHub creates an unknown environment without any rule.
- **State history is kept.** Nobody can delete the state bucket or an earlier state version; only the 90-day Lifecycle rule removes old versions. No role may delete a state file. Terraform releases its lock with a plain `DeleteObject`, which stays allowed.

**Remaining risk:** code that `app-deploy` uploads runs as the server role and can read the server's secrets, which is why that role waits for a protected environment. On 2026-11-24 `master` had no branch protection or ruleset, and independent approval is **not** configured (one maintainer).

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

1. Done 2026-11-23 by the user in the console: Lambda (one manual test function), CloudFront and S3 show no SST resources. This was not a full audit.
2. Done 2026-11-24: the repository uses the default OIDC subject `repo:DarkPo13/hartolit-web3:...` (GitHub API: `use_default: true`, `use_immutable_subject: false`), and `AWS OIDC smoke` succeeded from `master` on 2026-11-17, so the provider and the old role's trust work.
3. In IAM, record which policies `hartolit-github-staging-deploy` has and when it was last used, then detach the `hartolit-staging-deploy-*` policies without deleting them.
4. Choose the administrator identity (IAM Identity Center, or an IAM user with MFA and `aws login`). Neither needs access keys.
5. Protect `master` in GitHub: no force push or deletion, changes through a pull request with the CI checks passing.
6. An administrator runs `bootstrap` with `staging.tfvars` (expected plan: `11 to add, 0 to change, 0 to destroy`), then moves its state into the new bucket (`backend.tf.example`).
7. Create the GitHub Environments `staging-app-deploy` and `staging-terraform-apply` (master only, required reviewer, administrators not exempt). Only then set the matching `*_environment_protected = true` and run bootstrap again.
8. Build the application deploy script and the plan, apply and deploy workflows. They do not exist yet, so a fresh site answers 503. The deploy must add `functions/server-entry/*.mjs` to the server bundle, build with `HARTOLIT_CLIENT_IP_SOURCE=cloudfront` and the public site URL from a repository variable (the `app-deploy` role cannot read SSM), upload `_assets` and `_cache` with SST's cache headers, invoke the seeder with `{"RequestType":"Create"}`, and invalidate `/*`.
9. Add PostgreSQL technical roles for Neon. Prisma needs a migration role and the app a runtime role.
10. An administrator writes the staging secrets through `envs/staging/secrets`.
11. Review a real `terraform plan`. The IAM action lists are derived from the provider and are not yet proven against AWS.
12. After the first apply, verify on staging: POST and PATCH through OAC, a bodiless DELETE, 403 on direct Lambda URLs, the CSP nonce, sign-in limits by client IP, and ISR.

```bash
# Example for step 6, with short-lived administrator credentials:
cd infra/terraform/bootstrap
terraform init
terraform plan -var-file=staging.tfvars
```
