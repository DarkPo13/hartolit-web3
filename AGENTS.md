<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Hartolit Field Passport — operating guide for any agent or human

This file is tool-agnostic. `CLAUDE.md` imports it; other agents read it directly. Leave the Next.js block above byte-for-byte intact — `next dev` rewrites it.

**The repository is the durable memory.** If a fact is needed to continue the work, it is committed. Chat logs, local AI memory stores and gitignored files do not travel between machines.

Durable-context tier: **Tier 1** (AGENTS.md, `.ai/PROJECT.md`, `.ai/STATE.md`, `.ai/DECISIONS.md`, `PROGRESS.md`). Chosen 2026-09-24; the reasoning and what would justify more are in `PROGRESS.md` → Decisions log. A missing `.ai/ISSUES.md`, `docs/plans/` or per-tool rules directory is deliberate, not an oversight.

## Session bootstrap — read in this order

1. This file.
2. `.ai/PROJECT.md` — what the project is (stable).
3. `.ai/STATE.md` — the frontier: open items, validation status, next steps.
4. `.ai/DECISIONS.md` — calls a fresh reader would otherwise undo.
5. `PROGRESS.md` — only when you need history or the reason behind something.
6. `git status`, `git log --oneline -10`.
7. Verify STATE against the code before trusting it — it is maintained by hand and can lag.
8. Do not ask the user to summarise a previous conversation.

## Source-of-truth hierarchy (most authoritative first)

Project overrides, above everything else:

- **A. Anything already published on a blockchain or to IPFS.** It is permanent and public; code and documents adapt to it, never the reverse. As of 2026-09-24 nothing has been published: no contract is deployed and no real passport exists.
- **B. The GitHub Actions `CI` run for a pushed commit.** It is the clean-runner result for that commit. A local pass on uncommitted changes does not make the last pushed run green.

Then the general order:

1. Actual code and config in this repository.
2. The user's explicit current instructions.
3. The engineering rules below.
4. The current spec: the phased MVP plan. Its full text lives in `docs/`, which is **gitignored** (see DECISIONS D12), so a fresh clone does not have it. The committed summary is README → "Phased application architecture" plus the phase table in `.ai/STATE.md`.
5. `.ai/PROJECT.md`.
6. `.ai/STATE.md` and `PROGRESS.md`.
7. Older summaries and assumptions, including anything remembered from chat.

**Corollary:** if durable context contradicts the code, the code is right about what IS. Fix the stale document as part of the work, and mark the correction (see STATE rules).

**When an override's source is unreadable** (a CI log that needs repository-admin login, a contract that is not deployed, a gitignored plan on a fresh clone, the Diia API documentation, which is not in this repo): say so once, continue with repo-local work, never reconstruct its contents from memory, and name precisely which part is blocked.

## Engineering rules (derived from this repository)

- **Fail closed.** Production must never return a simulated token, mock CID or placeholder certificate. `isDemoMode()` in `lib/demo-mode.ts` is the only switch (D1, D2).
- **Authorization lives on the server, in every route handler** (`getActor`/`requireWriteAccess` in `lib/auth-guard.ts`, `draftActor` in `lib/drafts/http.ts`, `reviewActor` in `lib/review/http.ts`). `proxy.ts` only sets response headers; it is not an access check.
- **No blockchain private key in the web environment** (D3).
- **Nothing private goes to IPFS or on chain.** The initial public-field policy, including treated area, is approved in README (D21); the strict schema, allowlisted builder and admin preview are implemented (D24). Private confirmation passed CI and local DB/HTTP smokes plus a focused local admin browser pass (D26); no real publication path exists yet. Every public field must appear on the issued certificate. Policy changes require new schema versions and confirmation; existing published records retain their original contents. V1 retention and publisher defaults are in README (D25), with release specifics still open in STATE.
- **Schema changes go through a new Prisma migration** (`npm run db:migrate`). Never edit a committed migration: CI and hosts apply them with `npm run db:deploy`.
- **Fixtures are fictional.** Smoke scripts use `@example.invalid` accounts and delete everything they create; the seed refuses a non-local database.
- **Next.js 16 APIs:** read the relevant guide in `node_modules/next/dist/docs/` before writing Next code (block above).

## Validation

**PASS means the validator's own exit status.** A pipeline reports the status of its last command, so `npm run lint | tail` returns tail's 0 even when lint fails. Run validators unpiped (redirecting to a file is fine) and read `$?`.

Current results, with dates and the machine they were taken on, live only in `.ai/STATE.md`. This table says what each command needs and what it does **not** cover. The original gaps were measured on 2026-09-23 by planting malformed files and removing them; the unused-variable and `.mjs` gaps were narrowed on 2026-09-24, with negative controls recorded in PROGRESS.

| Command | Needs | Does NOT cover |
|---|---|---|
| `npm run lint` | `npm ci` | Warnings fail (`--max-warnings 0`); `.mjs` files fail on undefined and unused variables. TypeScript unused declarations are enforced by `typecheck`. Lint skips `contracts/` and `generated/`. It also lints the gitignored `docs/`, so a local run can differ from a fresh clone. It does not read `.md`, `.yml`, `.json`, `.css`, `.prisma` or `.sol` files. |
| `npm run typecheck` | `npm ci` (its postinstall generates the Prisma client into gitignored `generated/prisma/`) | Enforces unused TypeScript locals and parameters. Does not read `.mjs` and `.js` files (`allowJs` is false), `contracts/`, or dot-directories such as `.github/`. |
| `npm run build` | `DATABASE_URL`, `BETTER_AUTH_SECRET` (32+ characters), `BETTER_AUTH_URL`; network access for Google Fonts | Runtime behaviour. Can run while `next dev` runs (dev writes to `.next/dev`). |
| `npx prisma validate` | nothing | Whether a database matches the migrations. |
| `npx prisma migrate status` | running PostgreSQL, `DATABASE_URL` | Whether the code uses the schema correctly. |
| `npm run drafts:smoke`, `npm run evidence:smoke`, `npm run review:smoke` | PostgreSQL, SeaweedFS and ClamAV (`compose.yaml`), migrations applied, the app running on `http://localhost:3000` | Browser UI, keyboard and mobile; hosted storage; backup and restore. |
| `npm run auth:smoke` | as above, plus Mailpit (`npm run dev:services:up`). Against a production build, use the `mail-tls` profile (README, "Production mail locally") and `MAILPIT_API_URL=http://127.0.0.1:8026` | Browser UI and hosted email delivery. Runs in CI with a STARTTLS Mailpit. |
| `npm run feedback:smoke` | Migrated PostgreSQL and production app at `BETTER_AUTH_URL` | Checks private feedback writes, authentication/MFA, origin, strict validation, stored values, retries, ownership and concurrent quota. Does not cover the dialog/form browser UX, the authorized admin inbox or real user research. |
| `npm run publication:smoke` | Local migrated PostgreSQL, production build, free IPv4 loopback ports 3001 (or `PUBLICATION_SMOKE_PORT`) and, with `PUBLICATION_LOCAL_CHAIN=1`, 3002 (or `PUBLIC_VERIFIER_SMOKE_PORT`); owns its servers | Checks pin consent/dispatch/readback, pre-mint withdrawal (refusal after permission, no revival, recall afterwards), post-mint correction (publisher-only link to a server-created draft copy with its own farm/field rows, untouched published record; on the actual chain the public page shows the correction), evidence access for issued records (grant-only admin downloads with scope/expiry/revocation, audited downloads before and after issuance), preservation holds (database guards on deletion/purge, held-draft removal refused, prune exclusion), mint preparation/single-use nonce permission, cross-passport exclusion and unknown/no-resend; exact hash/nonce adoption, historical receipt persistence, fresh revocable result selection/suspension, expiry, stale-read revision protection, post-RPC commitment/candidate, revoked-actor recovery and SQL constraints. Default RPC/IPFS are injected. With `PUBLICATION_LOCAL_CHAIN=1` (CI), also needs Anvil/compiled contract; right after the actual mint is finalized it requires VALID plus the matching issuer-record note on the anonymous production `/passports/{tokenId}` page from the bytes the uploader actually sent (issue-to-verify, not with offline Kubo). It also tests actual nonce/depth receipt persistence, branch rollback/stale receipt, suspended selected success and freshly selected new-branch same-call history. Adds fresh successful finalization/slot release, first-proof replay, prior-wallet anchor/depth/nonce, post-RPC history, late rollback/cancellation and independent cross-attempt quarantine. Adds saved dispatch anchors and bounded paged missing-hash discovery, conflict/reset/journal, cross-writer revisions and SQL range/hash ownership; actual Anvil also covers unreported hash, cancellation and replacement discovery. Adds due batching, duplicate/expired/reclaimed lease fencing, receipt expiry, backoff and actual-node worker discovery/finalization/canonical rollback monitoring. Adds separately reviewed unchanged-original recovery: current MFA publisher, post-RPC authority/commitment/wallet checks, expiry, races, idempotent/new-incident journal and SQL proof constraints; actual Anvil restores after an injected outage and refuses genuine lost-original recovery. Adds reviewed exact REVERTED closure, permanent nonce/preparation claims, next-passport higher nonce, failed-proof canonical monitoring/quarantine and SQL transaction/attempt/status ownership; actual Anvil exercises out-of-gas, next mint and late rollback/replacement. Adds separately reviewed unchanged REVERTED first-proof restoration through the shared recovery journal, kind/status/proof SQL constraints, renewed incidents, stale authority/wallet refusal and preservation of other quarantines/terminal nonce claims; actual Anvil restores after outage and refuses lost failure anchors. Adds actual same-nonce self-send cancellation classification/depth without changing UNKNOWN/CHAIN_PENDING or releasing the slot. Adds separately reviewed durable cancellation closure, exact CONFLICT/proof/hash SQL binding, stale consent/authority/expiry and older-observer races, higher next permission and cancelled-proof wallet quarantine; actual Anvil exercises self-send, next mint and real rollback. Adds separately reviewed unchanged-cancellation restoration through the shared recovery journal: closure-bound SQL proof foreign key, kind isolation, changed dispatch anchor/missing/pending refusal and a preserved newer active slot; actual Anvil restores after outage and refuses after real rollback. Adds separately reviewed same-transaction/outcome re-inclusion anchor adoption with immutable first proof, composite SQL bindings and anchor-based monitoring/restoration/next permission; actual Anvil re-broadcasts the identical signed mint after a real rollback. Adds verified wallet checkpoints: compact history, covered quarantine, a real reorg invalidating the checkpoint block, staleness after re-anchoring and restart from the wallet start. Adds the admin issued state: chain identifiers in the publication overview (none for unissued) and private certificate/verification redirects to the public page; a recall refused after publication started carries `PUBLICATION_STARTED`; record-list marks (issued filter, issued/open-correction marks, correction draft in `/api/drafts`, issued mark in `/api/passports/mine`); the D67 upload route against a fictional loopback Kubo-compatible node (designated publisher, exact acknowledgement/target, exact bytes, RPC-only bearer token, single send, lost acknowledgement and late pin via readback, credential required for a remote target) and, with `publication:smoke:offline`, against the real offline Kubo. Adds the D68 mint routes: without server mint configuration no candidate, permission or report; with `PUBLICATION_LOCAL_CHAIN=1` a fresh publisher wallet on its own Anvil gets a reviewed intent, designated-publisher preparation, one fixed-nonce permission (other admin 403, second permission 409), sends the exact request, reports the hash (recorded) and the first check after the configured depth finalizes to PUBLISHED with the issued token; a record reserved for another wallet reports `walletChanged` with no candidate. Adds the D70 refused-send cancellation over HTTP on actual Anvil: same-nonce self-send found as `CONFLICT`, publisher-only review and closure, depth gate, idempotence and the freed wallet with the record unissued. No hosted mempool replacement, mempool search, genuine-reorg resolution, recovery UI for the other D43-D50 paths, active scheduler, installed wallet, hosted provider, evidence scan or issued certificate. Optional manual browser fixtures (`PUBLICATION_BROWSER_FIXTURE=1`, `upload`, `mint` (with `PUBLICATION_LOCAL_CHAIN=1`; its helper signs for a fresh test wallet on the owned Anvil), `withdrawal` or `issued`) need port 3103; `upload`/`mint`/`withdrawal`/`issued` stop the run with exit 1 after the checkpoint, through cleanup. |
| `npm run browser:acceptance` | Local migrated PostgreSQL, SeaweedFS and ClamAV; the `mail-tls` Mailpit profile and `npm run mail:tls-ca`; a production build; free port 3000; installed Chrome (or `BROWSER_EXECUTABLE`/`BROWSER_CHANNEL`), or `BROWSER_ENGINE=firefox` after `npx playwright-core install firefox`. Uses the `playwright-core` dev dependency | Checks the fictional operator/admin workflow in a real browser: MFA enrolment, emailed invitation, offline save and reload, uploads through ClamAV (EICAR rejected), submission, keyboard approval, snapshot confirmation, UK/EN with the page language, 390px, localized values, audit trail and no unexpected HTTP/console errors with localized admin codes automatic retry after a busy-server answer and recovery-code sign-in (46 checks; prints PASS/FAIL lines and a screenshot folder). Not in CI. WebKit cannot run it over plain-HTTP loopback (it drops the production `Secure` session cookie). Does not cover wallet proof, IPFS upload, mint, the public page or the admin issued panels; those have opt-in `PUBLICATION_BROWSER_FIXTURE` stages. |
| `npm run publication:monitor` | Migrated PostgreSQL; with `--run`, the D68 mint configuration | Prints one JSON line of counts; exit 1 when something needs a person, 2 when `--run` is unconfigured. Covered by `publication:smoke`. Does not schedule itself, deliver alerts or re-read IPFS attempts (only counts them). |
| `npm run retention:smoke` | Local migrated PostgreSQL and Mailpit (`npm run dev:services:up`) | Checks unused-draft eligibility (90 days, never submitted, no hold), sent-only notices through Mailpit, edit-voids-notice, the 30-day period, deletion with storage-failure rollback, tombstones and the counts-only dry-run CLI, with injected time. Does not exercise correction-draft exclusion, real object deletion, a scheduler or hosted SMTP. |
| `npm run backup:drill` | Local migrated PostgreSQL and SeaweedFS from `compose.yaml` (it runs `pg_dump`/`pg_restore` through `docker compose exec`) | Checks a matched dump/object backup, restore into an isolated database and bucket, per-table row digests, object hashes and reapplying a separately exported deletion/hold journal in trigger-safe order on a fictional approved record. Not in CI. Does not cover an issued record, hosted point-in-time recovery, bucket versioning, encryption, backup access control, the rolling window or alerting. |
| `npm run test:hash` | `npm ci` | Browser-specific crypto behavior or real IPFS and chain storage. |
| `npm run test:upload` | `npm ci` | Checks server-owned target fingerprints, strict public bytes, exact UTF-8/raw upload and local-only guards with injected HTTP; does not prove actual network behavior, hosted compatibility or user consent UI. |
| `npm run test:chain` | `npm ci` | Checks strict mint commitments, exact calldata and optional stored nonce, read-only receipt/event/state validation, non-success/no-retry, successful/failed closed-proof parsing, independent failed-wallet quarantine/history limits, stable canonical anchor/depth and bounded paged transaction discovery/conflicts/reorg/deadline and cumulative monitor RPC budget/timeout with injected RPC; unchanged recovery preserves original success/failure/cancellation status, inclusion identity, depth and cancellation nonce/wallet; cancellation evidence requires exact nonce/standard self-send, canonical membership/depth, empty publisher code, expected runtime, absent mint and stable receipt/head/chain. Closed cancellation parsing enforces nonce/wallet and cannot become a matched mint; wallet state loads only proofs after a current checkpoint, rejects stale checkpoints and reads quarantine across the whole wallet; workflow errors retain branded identity across duplicate loaders and reject unbranded status objects; mint configuration (D68) accepts only HTTPS or loopback-HTTP RPC without URL credentials and a complete target. No actual wallet, chain, DB lifecycle, provider or finality acceptance. |
| `npm run chain:smoke` | Foundry/Anvil (or `ANVIL_BIN`), compiled contract and JS dependencies | Tests actual deployment/runtime and mint/pending/depth/revert/duplicate/pause/wrong-recipient/trailing-calldata/reorg behavior, plus same-nonce self-send cancellation/pending/depth/rollback and stale receipt, and the public verifier's NOT_FOUND/PENDING/VALID/MISMATCH/rollback results against the deployed contract, on its owned loopback Anvil without a fork. No public network, installed wallet, DB attempts, hosted RPC or issued certificate. |
| `npm run publication:smoke:offline` | As above, Docker and the optional `publication-local` Compose profile (service `kubo-local`); free loopback ports 15001/18080 | Adds actual offline Kubo RPC/gateway upload, lost acknowledgement and blocked resend tests through temporary test-only tunnels. No public IPFS network, hosted TLS/auth/retention, blockchain or browser acceptance. |
| `npm run test:public` | `npm ci` | Checks that the readable preview and both private confirmed views render every `2.0.0` public scalar with unissued/unpublished wording; does not test page authorization, browser interaction, database confirmation, an issued certificate, or future schema versions. |
| `npm run test:button` | `npm ci` | Checks that Button `asChild` renders a single link with its label and optional icons. Does not test browser focus or navigation. |
| `npm run test:wallet` | `npm ci` | Checks local EIP-191 recovery with real ephemeral EOA signatures, wrong wallets, changed messages and malformed signatures. Does not cover API auth, DB expiry/replay, browser wallet UX or contract wallets. |
| `npm run test:ipfs` | `npm ci` | Checks raw CID against an independent spec vector, exact-byte/CID rejection and bounded read-only HTTP behavior with injected transport. Does not prove a live provider pins content, retention, network TLS/redirect/timeout behavior, or publication/chain issuance. |
| `npm run test:verifier` | `npm ci` | Checks independent public verification with injected chain/gateway: strict token/target before RPC, depth via the checked block, pending/not-found, unavailable/mismatch/unsupported reasons without provider text, the credential-free bounded raw gateway reader, and the public view (every scalar on VALID, per-state copy without facts, both languages), share URL/QR determinism and share actions only for VALID, and every issuer-record note kind including timeout and missing database configuration. Does not test the live route, hosted RPC/gateway or real IPFS. |
| `npm run verifier:smoke` | Production build, Foundry/Anvil (or `ANVIL_BIN`) and compiled contract; free loopback port 3002 (or `PUBLIC_VERIFIER_SMOKE_PORT`); owns its servers | Anonymous `/passports/{id}` against the actual contract on owned Anvil and a loopback gateway: VALID with facts, 404 for absent/malformed IDs, PENDING, MISMATCH on tampered bytes, UNAVAILABLE and recovery, share link/QR from the configured origin despite a forged Host header, a quiet issuer note with an unreachable database, no configuration/private-marker leak, no-store/noindex/no-referrer and the per-request nonce CSP (D71). No browser, hosted RPC/gateway, database enrichment, real clipboard/print/download or QR scanning. |
| `npm run test:capture` | `npm ci` | Checks signed-in form completion against required facts, including string values from number inputs; does not test autosave, uploads, or browser interaction. |
| `npm run test:i18n` | `npm ci` | Checks that every `AuditAction`, `PublicationStatus`, `PassportStatus` and `DoseUnit` value in `prisma/schema.prisma` and every admin action code in `lib/review/management.ts` has a non-empty label in both languages, and that uk/en label the same codes. Does not check that a view uses the labels (`browser:acceptance` checks the admin detail) or the wording. |
| `npm run test:public-boundary` | a production build running at `BETTER_AUTH_URL` | Checks that legacy `1.0.0` payload and verifier routes are unavailable in production; does not test a future `2.0.0` verifier. |
| `npm run contracts:build`, `npm run contracts:test` | Foundry, plus `forge install --no-git OpenZeppelin/openzeppelin-contracts@v5.6.0 foundry-rs/forge-std@v1.16.1` run inside `contracts/` (`contracts/lib/` is gitignored) | Whether the hand-written ABI in `lib/contract.ts` matches the contract; the separate ABI check covers its declared subset. |
| `node --experimental-strip-types scripts/check-contract-abi.mjs` | Node 24+, compiled Foundry artifact at `contracts/out/` | Whether the app declares every compiled function; it checks the 21 entries actually declared in `lib/contract.ts`. |
| CI, `.github/workflows/ci.yml` (on every push) | a push to GitHub | Runs lint, typecheck, hash/public-preview/button/wallet/IPFS/verifier/upload/chain/capture/i18n tests, build, `db:deploy`, the public-boundary and drafts/evidence/review/feedback/publication/verifier/auth/retention smokes (publication with actual local Anvil plus DB, verifier with actual local Anvil), `npm audit --omit=dev --audit-level=high`, ABI comparison, forge build + test and the standalone Anvil receipt smoke. Does not run browser checks, actual offline Kubo or anything hosted. |

Habits:

- **Prove a check can fail before trusting its silence.** A check that matched nothing looks exactly like one that passed. Point it at something broken once and watch the exit status change.
- **Verify a regression test fails without its fix:** revert the fix, watch the test fail, restore it.
- **Check what a test asserts, not just that it passes.** A test can fail without its fix and still assert the wrong value.
- **Check the asserted value against the real system,** not against the code that produces it. For example, read the stored row or the returned JSON of one live request.
- **Record what each validator does not cover** and update the table above when that changes. Never assert coverage you have not measured.

## Git safety

- Inspect before broad changes: `git status`, `git diff`, and read what you are about to overwrite.
- Keep changes scoped to the task; leave unrelated pre-existing changes alone and say they exist.
- **Commit only when asked. Push only when asked. Never force-push.**
- **Standing user instruction, 2026-10-22:** commit each completed, verified functional increment separately. This authorizes those local commits; pushing still requires an explicit request. Include its focused tests/migration/context in the same commit and preserve unrelated work.
- Only committed and pushed state travels between machines. Anything gitignored (`docs/`, `.env*.local`, `.env.db.local`, `.env.storage.local`, `generated/`, `contracts/lib/`) exists only where it was created.
- Commit style from `git log`: an imperative, sentence-case subject ("Build…", "Replace…", "Remove…") with an optional prose body. Prefer a subject that states the finding over the activity, and a body with the measurements, what was rejected, and what remains unverified.

## Security

- No secrets in any committed file: no keys, tokens, passwords or connection strings. Describe configuration by variable name, never by value. `.env.local.example` lists the names.
- No machine-specific state in durable context: no absolute paths, usernames, hostnames, LAN addresses or conversation ids.
- Never write a "passed" or "done" state that the validator or server did not confirm. If it was not run, write "not run".
- Private farmer, field, evidence and audit data never goes into logs, IPFS, or an on-chain payload.

## Session commands

**"continue"** — Re-read `.ai/STATE.md`. Check the branch and `git status`. Verify STATE's claims against the code; do not trust it blindly. Read recent commits if the work continues from them. Take the first genuinely actionable item from Next Steps. State in one or two sentences what you are continuing and why that item, then do the work. Proceed on the inferred priority; do not stop to have it reconfirmed. If STATE is stale, correct it as part of the work. Never ask the user to reconstruct a previous conversation.

**"prepare handoff"** — Leave the repo ready for a fresh session on another computer. Does NOT commit or push.

1. `git status`; review the full diff.
2. Separate this task's work from unrelated pre-existing changes.
3. Run the validation appropriate to what changed. Record the REAL results, each exit status read unpiped.
4. Update `.ai/STATE.md`: goal, what is genuinely complete and what is partial, validation with evidence, blockers, ordered next steps.
5. **Cut STATE back.** Check its line count. Past about 250 lines, remove something before adding anything: move it to PROGRESS or delete it. STATE is a frontier, not a log.
6. Update `PROGRESS.md`, including every non-obvious implementation call in the Decisions log.
7. **Reconcile the open-items table in STATE, the whole row and not just the part you edited.** Does each row's "unblocks" cell still agree with its own text? Did anything you built close a row you did not open? Does every id STATE cites (D-numbers, PROGRESS entries) exist?
8. Confirm no secrets and no machine-specific paths (grep for home-directory prefixes, usernames and private-network URLs).
9. Show the user a short handoff summary.

**"prepare handoff and push"** — Everything in "prepare handoff", then review the diff again. Stage ONLY the intended changes; if unrelated changes cannot be separated safely, stop and explain rather than sweeping them in. Commit in this repo's message style, then push. Report the branch, the sha, the validation actually run, and anything deliberately left uncommitted. Never force-push.

**"refresh project context"** — Audit the stable context (`.ai/PROJECT.md`, `.ai/DECISIONS.md`, this file) against the repository as it now is and correct what has drifted: scripts, stack versions, routes, validators, decision checks (re-run each grep and compare with its expected count). Report what changed and what you left alone.
