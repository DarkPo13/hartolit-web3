# Project — Hartolit Digital Field Passport

What this project IS. Stable: change it only when the project changes, and audit it with "refresh project context" (see `AGENTS.md`). Last audited against the code: 2026-09-24, commit `a4154a1`.

## Purpose

Hartolit performs drone crop-protection treatments in Ukraine. This application records each treatment as a **field passport**: farmer, field, treatment, weather and chemical data plus evidence files. It is built so that a passport can later be published as a non-transferable ERC-721 token on BNB Smart Chain. The token carries the SHA-256 of a canonical public JSON snapshot stored on IPFS, and anyone can re-hash that snapshot at `/verify/{tokenId}` and compare. The intended verifiers are insurers, subsidy offices and EU auditors.

**The stakes:** a published passport is permanent and public. A wrong hash, a private field in the snapshot, or a simulated certificate issued in production cannot be recalled; neither the chain nor pinned IPFS content can be edited. When in doubt, fail closed and do not publish.

Current reality (2026-09-24): an authenticated local MVP covering Phases 1–4 (accounts, drafts, private evidence, review). Publication is not built; no contract is deployed; no real customer data may be entered. The live frontier is in `.ai/STATE.md`.

## Repository structure

Single Next.js application (not a monorepo) plus a Foundry workspace.

| Path | What it holds |
|---|---|
| `app/` | App Router pages. `page.tsx` → `PassportHome.tsx` (signed-in home: drafts, or the demo wizard). `admin/` (MFA admin console), `login/`, `two-factor/`, `forgot-password/`, `reset-password/`, `settings/security/`, `verify/[tokenId]/` (public verification). |
| `app/api/drafts/…` | Owner-scoped draft CRUD and evidence reserve/complete/preview/remove. |
| `app/api/passports/…` | Operator: list own submitted passports, submit, reopen, evidence preview. |
| `app/api/admin/…` | Admin: overview, review queue, passport detail, assign, decision, evidence preview, read-only record lists. |
| `app/api/auth/[...all]` | Better Auth handler with an admin-operation allowlist and MFA-enrollment session reset. |
| `app/api/mint`, `ipfs/pin`, `files/upload` | Legacy demo issuance path. Returns 503 unless in local demo mode (DECISIONS D1, D2). |
| `app/api/diia/*` | Always returns 501 (D4). |
| `app/api/passport/[tokenId]` | Public read of on-chain data and IPFS. |
| `lib/drafts/`, `lib/evidence/`, `lib/review/` | Server services: transactions, optimistic concurrency, audit, storage, scanning, workflow. |
| `lib/auth*.ts`, `lib/db*.ts`, `lib/demo-mode.ts` | Auth configuration, actor lookup and guards, Prisma client, demo switch. |
| `lib/hash.ts`, `lib/contract.ts`, `lib/ipfs.ts`, `lib/wagmi.ts` | Canonical JSON + SHA-256, hand-written contract ABI, Pinata REST client, wallet config. |
| `lib/i18n/` | Ukrainian (default) and English translations behind a typed `Translations` object. |
| `components/drafts/` | Draft workspace, evidence panel, review status. `components/wizard/`, `form/`, `web3/` belong to the demo wizard. |
| `prisma/` | `schema.prisma` and six committed migrations. The client is generated into `generated/prisma/` (gitignored). |
| `contracts/` | Foundry: `src/HartolitFieldPassport.sol`, `test/HartolitFieldPassport.t.sol` (22 test functions), `script/Deploy.s.sol`. `contracts/lib/` is gitignored and installed by `forge install`. |
| `scripts/`, `tests/` | Local setup, fictional seed, evidence cleanup, four live smoke tests, the compiled-contract ABI check, and the JSON hash regression test. |
| `compose.yaml` | Local services: PostgreSQL, Mailpit, SeaweedFS, ClamAV, all bound to loopback. |
| `.github/workflows/ci.yml` | CI: a `web` job (with Postgres, SeaweedFS and ClamAV service containers) and a `contract` job (Foundry). |
| `docs/` | **Gitignored.** Holds local-only planning and presentation documents; not present in a clone (D12). |

## Architecture

- **One TypeScript application.** Route Handlers are the backend; there is no separate API service.
- **Request path:** browser → Route Handler → actor lookup (`getActor` re-reads the user row on every request) → service function in `lib/*/service.ts` → Prisma transaction → audit row. `proxy.ts` only adds `Cache-Control: no-store`, `X-Robots-Tag` and `Referrer-Policy` headers on matched pages.
- **Passport lifecycle** (`PassportStatus`, transitions in `lib/review/service.ts`):
  - Main path: `DRAFT → SUBMITTED → APPROVED | REJECTED | CORRECTION_REQUIRED`.
  - An `APPROVED` passport can be recalled to `CORRECTION_REQUIRED` (D16).
  - `REJECTED` and `CORRECTION_REQUIRED` reopen to `DRAFT`.
  - `PUBLISHING`, `PUBLISHED` and `FAILED_RETRYABLE` exist in the enum and appear only as UI labels until Phase 5.
- **Concurrency:** every passport mutation is a conditional `updateMany` on `(id, owner or reviewer, status, version)` that increments `version`. The passport row is the serialization point (D14).
- **Evidence:** the browser uploads directly to the private bucket with a presigned POST (5-minute grant). The server then re-reads the object and checks size, declared type against magic bytes, and SHA-256, runs a ClamAV `INSTREAM` scan, and only then marks it `READY`. Download links are owner- or admin-checked redirects that expire after 1 minute. Submission freezes the evidence.
- **Demo path (legacy):** a 3-step wizard (form → simulated mint → certificate) that works only when `isDemoMode()` is true. The wallet stack (Wagmi, RainbowKit) is loaded by dynamic import only in demo mode.
- **Public verification:** `/verify/[tokenId]` reads `ownerOf`, `tokenURI` and `payloadHash` from the chain, fetches the JSON from IPFS, runs `canonicalize` + SHA-256 (`lib/hash.ts`) and compares. It uses the same `canonicalize` as mint time; the two must agree byte-for-byte.

## Stack

Versions are those installed on 2026-09-24. "Pinned" means an exact version in `package.json`.

| Layer | Choice | Why / prohibition / expiry |
|---|---|---|
| Web framework | Next.js 16.3.5 (App Router, Turbopack), React 19.2 | APIs differ from older Next; read `node_modules/next/dist/docs/` before writing Next code. `proxy.ts` is the Next 16 name for middleware. |
| Language | TypeScript 5.9, `strict` + `noUncheckedIndexedAccess` | `allowJs` is false, so `scripts/*.mjs` are not type-checked (see AGENTS → Validation). |
| Database | PostgreSQL 17.6 (local image), Prisma ORM 7.10.0 pinned, driver adapter `@prisma/adapter-pg` | Do not upgrade to Prisma 8 while it is a release candidate (D10). Expiry: re-evaluate when Prisma 8 is stable. |
| Auth | Better Auth 1.7.5 pinned, with `admin` and `twoFactor` plugins and its Prisma adapter | Use its maintained password, session, rate-limit and TOTP facilities; do not hand-roll password or session cryptography. |
| Validation | Zod 4.6.5 pinned | Strict DTOs at every request boundary (`z.strictObject`). |
| Evidence storage | Any S3-compatible private bucket (`@aws-sdk/client-s3` 3.1136.0); SeaweedFS 4.47 locally | The hosted provider and region are **not chosen** (STATE, open decision). |
| Malware scan | ClamAV 1.5.4 over the clamd TCP protocol | Evidence cannot become `READY` without a clean verdict. |
| Email | Nodemailer 10.0.8 over SMTP; Mailpit locally | Used only for password reset. Reset returns 503 when SMTP is not configured. |
| Client state | Zustand 5 with tab-scoped `sessionStorage` | PostgreSQL is authoritative for signed-in drafts; the tab store only recovers unsynced edits and the demo wizard (D11). |
| UI | Tailwind CSS 4.3, React Hook Form 7, custom i18n context | No external i18n library. |
| Chain client | viem 2, wagmi 2, RainbowKit 2 | Wallet UI loads only in demo mode. |
| Contract | Solidity, `pragma ^0.8.24`, compiled with solc 0.8.28 (`contracts/foundry.toml`, EVM `cancun`); OpenZeppelin v5.6.0 and forge-std v1.16.1 installed by `forge install` | Not vendored: `contracts/lib/` is gitignored and CI installs the pinned tags. |
| IPFS | Pinata REST API via `fetch` (`lib/ipfs.ts`); there is no Pinata SDK dependency | Only the demo path uses it, and the demo refuses a real `PINATA_JWT` (D2). |
| Node | CI uses Node 24 | README says ≥ 20.10. |

## Data and storage

- **Better Auth tables** (`user`, `session`, `account`, `verification`, `twoFactor`, `rateLimit`): sessions and rate-limit counters live in PostgreSQL.
- **Domain models:** `Farmer`, `Field`, `Passport`, `Treatment`, `MeteoMeasurement`, `ChemicalApplication`, `EvidenceFile`, `Publication`, `AuditLog`.
  - Farmer, Field, Passport and EvidenceFile carry `ownerId`. Composite foreign keys `(id, ownerId)` stop cross-owner references at the database level.
  - Deletes are `Restrict`, except that the reviewer links and the meteo/chemical source-file links are `SetNull`.
- **Audit:** `AuditLog` is append-only in code and records actor, action, version, from/to status and an optional note. There is no update or delete path outside smoke-test cleanup.
- **Publication:** the model exists (idempotency key, snapshot, payload hash, CID, chain, contract, tx, token; unique constraints on the hash and on the chain/contract/token triple). It is only read by the admin record list; nothing writes it yet (Phase 5).
- **Evidence bytes** live in the private bucket under `EvidenceFile.objectKey`, never in PostgreSQL. `npm run evidence:prune` cleans stale quarantine objects; it previews by default and deletes only with `--execute`.
- **Configuration:** variable names only are listed in `.env.local.example`. Local values are generated into gitignored `.env.local`, `.env.db.local` and `.env.storage.local` by `npm run db:setup` and `npm run evidence:setup`.

## Auth

- Invite-only: public sign-up is disabled. Accounts are created by `npm run auth:create-admin` or `npm run auth:create-operator`, which prompt interactively and never print credentials.
- Roles: `admin` and `user` (operator). An admin must have TOTP enabled to reach `/admin`, admin APIs, or even the draft APIs (`draftActor` returns 403 otherwise).
- Passwords are 12–128 characters. Sessions last 8 hours, refresh after 1 hour, and are stored in the database. Reset tokens last 1 hour and revoke existing sessions.
- Rate limits are stored in the database: 30 requests per 60 seconds by default; 5 per 15 minutes for sign-in and TOTP; 3 per 15 minutes for reset requests.
- Every write requires an `Origin` header equal to `BETTER_AUTH_URL`; a missing `Origin` is rejected (D6).
- A ban or role change applies on the next request (D7). MFA enrollment revokes all of that user's sessions (D8). Only four Better Auth admin operations are reachable: list, create, ban and unban users (D9).
- Cookies are `HttpOnly` and `SameSite=Lax`, and `Secure` in production.

## External integrations

| System | Status on 2026-09-24 |
|---|---|
| BNB Smart Chain (Testnet 97, Mainnet 56) via public RPC | No contract deployed. `npm run contracts:deploy:testnet` reads `ADMIN_PRIVATE_KEY` from the deploying shell only. |
| IPFS / Pinata | Demo only; real credentials are refused. Public publication is Phase 5. |
| WalletConnect / Reown | Demo only. |
| SMTP provider | Local Mailpit only; no hosted provider chosen. |
| S3-compatible bucket + ClamAV | Local SeaweedFS + ClamAV only; no hosted provider chosen. |
| Hosting | README names Vercel and `dapp.hartolit-agro.com` as targets. Nothing in the repository confirms a live deployment. |
| Diia (Ukrainian qualified e-signature) | Deferred until after the core MVP. No API documentation is in this repository; do not reconstruct it. |
| GitHub Actions | The `CI` workflow runs on every push. Job logs need repository-admin login. |

## Verified commands

The command table, with what each command needs and does not cover, is kept in one place only, `AGENTS.md` → Validation, so the two copies cannot drift. Current exit statuses are in `.ai/STATE.md`.

## Non-goals (current MVP)

The following come from the phased plan's "defer" list; the full plan is in gitignored `docs/`:

- Diia/KEP signatures, and any claim of legally qualified signing.
- Mainnet publication.
- Farmer self-service accounts; multi-organization tenancy; a custom role editor.
- Advanced analytics and external integrations.
- Direct drone telemetry or flight-log ingestion.
- A server-held minter key: publication is meant to be done by an approved operator wallet.
