# Project — Hartolit Digital Field Passport

What this project IS. Stable: change it only when the project changes, and audit it with "refresh project context" (see `AGENTS.md`). Last audited against the code: 2026-09-25, Phase 4 commit `513bf88`.

## Purpose

Hartolit performs drone crop-protection treatments in Ukraine. This application records each treatment as a **field passport**: farmer, field, treatment, weather and chemical data plus evidence files. It is built so that a passport can later be published as a non-transferable ERC-721 token on BNB Smart Chain. The token carries the SHA-256 of a canonical public JSON snapshot stored on IPFS, and anyone can re-hash that snapshot at `/verify/{tokenId}` and compare. The intended verifiers are insurers, subsidy offices and EU auditors.

**Product goal, clarified by the user 2026-09-28:** Help farmers present evidence of proper treatment, including products, doses, timing and conditions, when organizations assess crop damage, compliance or compensation. Every public field must be visible on the certificate. Source evidence and private farmer/plot linkage must support the record; integrity verification alone does not assess agronomy or determine compensation. Public-field policies can evolve through new schema versions while published records retain their original contents (D21).

**The stakes:** a published passport is permanent and public. A wrong hash, a private field in the snapshot, or a simulated certificate issued in production cannot be recalled; neither the chain nor pinned IPFS content can be edited. When in doubt, fail closed and do not publish.

Current reality (targeted publication refresh, 2026-10-22): an authenticated MVP covering Phases 1–4, plus Phase 5 fact capture, strict public confirmation/private unissued views, designated-publisher reservation, EOA ownership proof, an isolated wallet UI and separate private preparation consent/cancellation. Internal services bind a target/profile, dispatch once, and reconcile exact bytes/CID; an actual offline Kubo fixture tests the protocol locally. The pushed wallet/attempt/readback checkpoint has green CI; later local checkpoints require their own CI after an authorized push. No app action invokes upload, no hosted provider is accepted, no external contract/passport is deployed, and no real customer data may be entered. Internal successful chain finalization and late-check quarantine exist; bounded anchored missing-hash discovery also exists. Bounded internal monitoring and separately reviewed unchanged-original quarantine restoration exist locally. Separately reviewed exact reverted sends can close without retrying their nonce/preparation; canonical failed-proof monitoring retains independent quarantine. Separately reviewed recovery can clear only an unchanged canonical failed-proof incident, retaining terminal failure and permanent claims. Read-only exact same-nonce self-send cancellation verification and separately reviewed durable closure/canonical monitoring exist. Cancellation closure keeps the original nonce/preparation permanent; late loss creates independent sticky quarantine; separately reviewed recovery can clear only an unchanged closed cancellation's incident (D49), and a separately reviewed re-inclusion of the same transaction/outcome can replace only the inclusion anchor (D50). Verified wallet checkpoints replace the permanent 64-proof stop (D51). Recurring operation, genuine-reorg resolution, issued/public views and operations remain open. The live frontier and validator evidence are in `.ai/STATE.md`.

## Repository structure

Single Next.js application (not a monorepo) plus a Foundry workspace.

| Path | What it holds |
|---|---|
| `app/` | App Router pages. `page.tsx` → `PassportHome.tsx` (signed-in home: drafts, or the demo wizard). `admin/` (MFA admin console), `login/`, `two-factor/`, `forgot-password/`, `reset-password/`, `settings/security/`, `verify/[tokenId]/` (legacy demo verifier, D27), `passports/[tokenId]/` (anonymous public `2.0.0` verification, D53). |
| `app/api/drafts/…` | Owner-scoped draft CRUD and evidence reserve/complete/preview/remove. |
| `app/api/passports/…` | Operator: list own submitted passports, submit, reopen, evidence preview. |
| `app/api/admin/…` | Admin: overview, review queue, passport detail, assign, decision, evidence preview, public snapshot preview and private confirmation, record editing/archive, operator management, audit lists. |
| `app/api/auth/[...all]` | Better Auth handler with an admin-operation allowlist and MFA-enrollment session reset. |
| `app/api/mint`, `ipfs/pin`, `files/upload` | Legacy demo issuance path. Returns 503 unless in local demo mode (DECISIONS D1, D2). |
| `app/api/diia/*` | Always returns 501 (D4). |
| `app/api/passport/[tokenId]` | Legacy `1.0.0` demo read of on-chain data and IPFS; unavailable outside local demo mode. |
| `lib/drafts/`, `lib/evidence/`, `lib/review/` | Server services: transactions, optimistic concurrency, audit, storage, scanning, workflow. |
| `lib/public-snapshot/` | Strict `2.0.0` public schema, allowlisted preview builder and private confirmation service. Publication completion lives in `lib/publication/`; issued/public views remain disabled. |
| `lib/publication/` | Private reservation/proof/pin consent, bound upload/readback, chain checks, mint preparation/single-use nonce permission, historical receipts and revocable as-of result selection. Private HTTP pin preparation/cancellation; Kubo/Anvil fixtures; fresh successful finalization/slot release, sticky wallet quarantine and bounded anchored missing-hash discovery; no mint action/broadcaster, continuous monitor or hosted uploader. |
| `lib/auth*.ts`, `lib/db*.ts`, `lib/demo-mode.ts` | Auth configuration, actor lookup and guards, Prisma client, demo switch. |
| `lib/hash.ts`, `lib/contract.ts`, `lib/ipfs.ts`, `lib/wagmi.ts` | Canonical JSON + SHA-256, hand-written contract ABI, Pinata REST client, wallet config. |
| `lib/i18n/` | Ukrainian (default) and English translations behind a typed `Translations` object. |
| `components/drafts/` | Draft workspace, evidence panel, review status. `components/wizard/`, `form/`, `web3/` belong to the demo wizard. |
| `prisma/` | `schema.prisma` and thirty-two migrations, including additive confirmation/proof/attempt/receipt/target and mint lifecycle/result migrations. The client is generated into `generated/prisma/` (gitignored). |
| `contracts/` | Foundry: `src/HartolitFieldPassport.sol`, `test/HartolitFieldPassport.t.sol` (22 test functions), `script/Deploy.s.sol`. `contracts/lib/` is gitignored and installed by `forge install`. |
| `scripts/`, `tests/` | Local setup, fictional seed, evidence cleanup, four live smoke tests, the compiled-contract ABI check, JSON hash regression and public-preview rendering test. |
| `compose.yaml` | Local PostgreSQL, Mailpit, SeaweedFS and ClamAV bound to loopback; optional offline Kubo profile on an internal network without published ports. |
| `.github/workflows/ci.yml` | CI: a `web` job (with Postgres, SeaweedFS, ClamAV and Mailpit service containers) and a `contract` job (Foundry). |
| `docs/` | **Gitignored.** Holds local-only planning and presentation documents; not present in a clone (D12). |

## Architecture

- **One TypeScript application.** Route Handlers are the backend; there is no separate API service.
- **Request path:** browser → Route Handler → actor lookup (`getActor` re-reads the user row on every request) → service function in `lib/*/service.ts` → Prisma transaction → audit row. `proxy.ts` only adds `Cache-Control: no-store`, `X-Robots-Tag` and `Referrer-Policy` headers on matched pages.
- **Passport lifecycle** (`PassportStatus`, transitions in `lib/review/service.ts`):
  - Main path: `DRAFT → SUBMITTED → APPROVED | REJECTED | CORRECTION_REQUIRED`.
  - An `APPROVED` passport can be recalled to `CORRECTION_REQUIRED` (D16).
  - `REJECTED` and `CORRECTION_REQUIRED` reopen to `DRAFT`.
  - `PUBLISHING`, `PUBLISHED` and `FAILED_RETRYABLE` exist in the enum and appear only as UI labels until Phase 5.
- **Concurrency:** passport content and status changes use conditional `updateMany` checks on the current version and increment it. Evidence and archival changes lock the passport row without changing its content version. The passport row is the serialization point (D14, D18).
- **Evidence:** the browser uploads directly to the private bucket with a presigned POST (5-minute grant). The server then re-reads the object and checks size, declared type against magic bytes, and SHA-256, runs a ClamAV `INSTREAM` scan, and only then marks it `READY`. Download links are owner- or admin-checked redirects that expire after 1 minute. Submission freezes the evidence.
- **Demo path (legacy):** a 3-step wizard (form → simulated mint → certificate) that works only when `isDemoMode()` is true. The wallet stack (Wagmi, RainbowKit) is loaded by dynamic import only in demo mode.
- **Public verification:** `/verify/[tokenId]` is a legacy `1.0.0` demo reader and is unavailable outside local demo mode. It reads `ownerOf`, `tokenURI` and `payloadHash` from the chain, fetches JSON from IPFS, runs `canonicalize` + SHA-256 (`lib/hash.ts`) and compares. The new private `/admin/passports/[id]/verification` view checks saved `2.0.0` canonical JSON/hash only; public `2.0.0` verification awaits controlled publication.

## Stack

Versions reflect `package.json` on 2026-10-04. "Pinned" means an exact version in that file.

| Layer | Choice | Why / prohibition / expiry |
|---|---|---|
| Web framework | Next.js 16.3.8 (App Router, Turbopack), React 19.2 | APIs differ from older Next; read `node_modules/next/dist/docs/` before writing Next code. `proxy.ts` is the Next 16 name for middleware. |
| Language | TypeScript 5.9, `strict` + `noUncheckedIndexedAccess` | `allowJs` is false, so `scripts/*.mjs` are not type-checked (see AGENTS → Validation). |
| Database | PostgreSQL 17.6 (local image), Prisma ORM 7.10.0 pinned, driver adapter `@prisma/adapter-pg` | Do not upgrade to Prisma 8 while it is a release candidate (D10). Expiry: re-evaluate when Prisma 8 is stable. |
| Auth | Better Auth 1.7.5 pinned, with `admin` and `twoFactor` plugins and its Prisma adapter | Use its maintained password, session, rate-limit and TOTP facilities; do not hand-roll password or session cryptography. |
| Validation | Zod 4.6.5 pinned | Strict DTOs at every request boundary (`z.strictObject`). |
| Evidence storage | Any S3-compatible private bucket (`@aws-sdk/client-s3` 3.1136.0); SeaweedFS 4.47 locally | The hosted provider and region are **not chosen** (STATE, open decision). |
| Malware scan | ClamAV 1.5.4 over the clamd TCP protocol | Evidence cannot become `READY` without a clean verdict. |
| Email | Nodemailer 10.0.14 over SMTP; Mailpit locally | Used for password reset and operator password setup invitations. Reset returns 503 when SMTP is not configured. |
| Client state | Zustand 5 with tab-scoped `sessionStorage` | PostgreSQL is authoritative for signed-in drafts; the tab store only recovers unsynced edits and the demo wizard (D11). |
| UI | Tailwind CSS 4.3, React Hook Form 7, custom i18n context | No external i18n library. |
| Chain client | viem 2, wagmi 2, RainbowKit 2 | Legacy demo stack stays isolated; the private publisher uses a separate client-only injected/Testnet wallet provider without persistent storage. |
| Contract | Solidity, `pragma ^0.8.24`, compiled with solc 0.8.28 (`contracts/foundry.toml`, EVM `cancun`); OpenZeppelin v5.6.0 and forge-std v1.16.1 installed by `forge install` | Not vendored: `contracts/lib/` is gitignored and CI installs the pinned tags. |
| IPFS | Pinata REST API via `fetch` (`lib/ipfs.ts`); there is no Pinata SDK dependency | Only the demo path uses it, and the demo refuses a real `PINATA_JWT` (D2). |
| Node | CI uses Node 24 | README says ≥ 20.10. |

## Data and storage

- **Better Auth tables** (`user`, `session`, `account`, `verification`, `twoFactor`, `rateLimit`): sessions and rate-limit counters live in PostgreSQL.
- **Domain models:** `Farmer`, `Field`, `Passport`, `Treatment`, `MeteoMeasurement`, `ChemicalApplication`, `EvidenceFile`, `PublicSnapshotConfirmation`, `Publication`, `AuditLog`, `AdminAction`.
  - Farmer, Field, Passport and EvidenceFile carry `ownerId`. Composite foreign keys `(id, ownerId)` stop cross-owner references at the database level.
  - Deletes are `Restrict`, except that the reviewer links and the meteo/chemical source-file links are `SetNull`.
- **Audit:** `AuditLog` is append-only in code and records passport actor, action, version, from/to status and an optional note. `AdminAction` records actor, action and entity ID for record and operator access changes without private field values. There is no update or delete path outside smoke-test cleanup.
- **Publication:** private services persist confirmed commitments, target binding, IPFS receipts, one fixed-nonce dispatch permission and historical matched hashes/receipt evidence. Passport/wallet locks serialize dispatch; observation revisions reject stale reads; fresh selection stores a revocable as-of result and later diagnostics suspend it while retaining historical proof (D39). RPC stays outside DB transactions. `CHAIN_PENDING`, UNKNOWN and historical VERIFIED remain unissued and grant no resend/slot release. A separate fresh finalizer atomically records PUBLISHED/FINALIZED with exact chain fields/first proof and releases only a successful slot (D40). Permanent nonce claims and prior-anchor/depth checks protect the next permission; late negative readback records CHAIN_SUSPENDED/sticky wallet quarantine even if a later attempt owns the slot. No app upload/mint action, broadcaster, scheduler, hosted uploader or public `2.0.0` reader is enabled. New dispatches also save block anchors; bounded paged discovery records exact candidates/conflicts without publishing, with cross-writer revision protection (D41). An internal bounded tick claims due attempts with DB-time leases and fences expired/reclaimed writes; it composes discovery/fresh finalization and original-proof canonical monitoring (D42). No recurring scheduler is activated. A separate current-MFA-publisher review can restore only the unchanged original receipt after fresh canonical/depth checks, preserving first proof/nonce/history and recording a new private recovery journal (D43). D44 adds separately reviewed fresh REVERTED closure/active-slot release with permanent nonce/preparation claims and failed-proof monitoring/quarantine; all wallet checks include both success/failure proofs. D45 shares the recovery engine for separately reviewed unchanged REVERTED first proofs, retaining failure/nonce/history and other quarantines. D46 supplies read-only exact self-send evidence; D48 adds separate reviewed cancellation closure and original-proof monitoring, retaining permanent nonce/preparation claims. D47 keeps domain error recognition stable across duplicate runtime modules. D49 extends the shared recovery engine to an unchanged CANCELLED first proof bound by SQL to its closure journal, retaining terminal cancellation/nonce claims. D50 adds a reviewed current inclusion anchor for the same transaction/outcome, keeping the first proof immutable. D51 checkpoints compress verified wallet history to one canonical block plus at most 64 newer proofs. Lost proof, changed outcome/token and closure/recovery UI remain blocked. D52 adds an independent public verifier core (`lib/public-verifier/`) that reads only chain state at depth and trustless IPFS bytes; D53 exposes it at the anonymous `/passports/{tokenId}` page; D54 adds share/QR/download and D55 an issuer-record note that cannot change the verdict; D56 pre-mint withdrawal and D57 post-mint correction links. See D29–D57 and STATE.
- **Private confirmation:** an approving MFA reviewer can persist exact allowlisted public JSON, hash and selected evidence IDs for an approved version. Recall invalidates it. No public read or publication side effect exists. Migration, live DB smoke and a focused local admin browser pass succeeded on 2026-10-04; hosted acceptance remains open.
- **Evidence bytes** live in the private bucket under `EvidenceFile.objectKey`, never in PostgreSQL. `npm run evidence:prune` cleans stale quarantine objects; it previews by default and deletes only with `--execute`.
- **Configuration:** variable names only are listed in `.env.local.example`. Local values are generated into gitignored `.env.local`, `.env.db.local` and `.env.storage.local` by `npm run db:setup` and `npm run evidence:setup`.

## Auth

- Invite-only: public sign-up is disabled. Accounts are created by `npm run auth:create-admin` or `npm run auth:create-operator`, which prompt interactively and never print credentials.
- Roles: `admin` and `user` (operator). An admin must have TOTP enabled to reach `/admin`, admin APIs, or even the draft APIs (`draftActor` returns 403 otherwise).
- Passwords are 12–128 characters. Sessions last 8 hours, refresh after 1 hour, and are stored in the database. Reset tokens last 1 hour and revoke existing sessions.
- Rate limits are stored in the database: 30 requests per 60 seconds by default; 5 per 15 minutes for sign-in and TOTP; 3 per 15 minutes for reset requests.
- Every write requires an `Origin` header equal to `BETTER_AUTH_URL`; a missing `Origin` is rejected (D6).
- A ban or role change applies on the next request (D7). MFA enrollment revokes all of that user's sessions (D8). Only Better Auth's read-only admin user list is reachable through its catch-all route; audited operator changes use separate Phase 4 routes (D9, D19).
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
