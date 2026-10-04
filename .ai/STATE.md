# STATE — the frontier

- **Last updated:** 2026-10-04
- **Branch:** `master`
- **Latest verified application commit:** `9263277` closed the legacy production public readers, corrected capture completion, updated Nodemailer and prepared this handoff. [CI run 37208962308](https://github.com/DarkPo13/hartolit-web3/actions/runs/37208962308) completed success for both web and contract jobs. This final CI-status note is documentation only.

Rules for this file:
- It is a frontier, not a log. Keep it under about 250 lines; move history to `PROGRESS.md`.
- Every open item names what unblocks it.
- Every measurement carries its date and the machine it was taken on.
- Mark corrections inline with ~~strikethrough~~ plus the date; never apply them silently.
- If a fresh agent reading only this file cannot act, the file has failed.

## Current goal

**User request 2026-09-28:** Complete the next milestone one step at a time. The user approved the initial public-field policy and clarified the certificate's purpose: help farmers present evidence of proper treatments for organizations assessing crop damage, compliance or compensation. Every public field must be on the certificate; future scope changes use new schema versions while published records retain their original contents (D21). ~~Phase 5 runtime implementation has not started.~~ **2026-10-02 correction:** Two capture migrations and a read-only public-preview slice are implemented locally. The preview builds strict `2.0.0` public JSON from approved passports and two explicitly selected verified evidence files (D24). ~~No public snapshot or publication exists.~~ **2026-10-02 correction:** An ephemeral public snapshot can now be previewed; confirmation, issued certificate, public verifier and publication do not exist. ~~Next user decision: private-data retention (remaining Q1), then publisher access (Q3).~~ **2026-10-03 correction:** The user delegated the choice; README now sets V1 engineering defaults for retention and a designated MFA-admin/wallet publisher (D25). ~~A persisted confirmation slice is implemented in source, awaiting live database verification.~~ **2026-10-04 correction:** The persisted confirmation slice passed CI migration deployment and live DB/HTTP review smoke; ~~browser interaction remains unverified~~ a local desktop/mobile Chrome browser pass now covers preview, confirmation, reload and recall. Counsel/pilot retention review, actual admin/wallet identity, certificate, verifier and publication remain open. No real customer data until hosting, privacy, backup and release gates pass.

**2026-10-02 continuation:** `Passport.publicFarmLabel` (never copied from legal name), DB-generated `Field.publicReference`, `Treatment.timeZone` and `treatedAreaHectares` are implemented. The second migration applied locally; draft and review smokes passed. Submitted records require these facts, with treated area no larger than field area. Old facts remain unknown. ~~The approved public-field table omits treated area; confirmation is pending.~~ **2026-10-02 correction:** The user approved public treated area and the field matrix includes it. The preview is read-only and transient; publication remains absent.

**2026-09-29 consultation package:** Prepared a Ukrainian product brief and cover message for the user's legal/regulatory contact. The Markdown copies are local-only in gitignored `docs/HARTOLIT_REGULATORY_BRIEF_UA.md` and `docs/HARTOLIT_REGULATORY_MESSAGE_UA.md`; the forwardable two-page PDF is untracked in `output/pdf/HARTOLIT_REGULATORY_BRIEF_UA.pdf`. The package distinguishes the local MVP, planned publication and deferred KEP, and asks how the treatment record relates to existing electronic journal requirements. No external message was sent. This work does not settle retention, authorize publication or establish legal recognition.

## Phases

This table is the committed summary of the phased plan, whose full text is gitignored (D12).

| Phase | Scope | State as of 2026-10-03 |
|---|---|---|
| 0 | Approve the boundary: public-field allowlist, retention, providers and regions, who may publish | Public fields approved (D21). V1 retention and publisher rules chosen as engineering defaults (D25); Q2 providers/regions, legal/pilot review and concrete publisher identity/wallet remain open |
| 1 | Accounts, DB sessions, admin TOTP, password reset, invite-only | Built. `auth:smoke` passed locally and in CI on 2026-09-25 |
| 2 | Durable owner-scoped drafts, optimistic concurrency, audit | Built. `drafts:smoke` exit 0 locally and in CI |
| 3 | Private evidence: direct upload, integrity checks, ClamAV, expiring links | Built locally. `evidence:smoke` exit 0 locally and in CI. Hosted gate open (S7) |
| 4 | Submit / assign / decide / reopen; admin console | Local pass 2026-09-25. Draft-only record edits, archive/restore, operator invitation/access controls, audit filters, API smokes, desktop and 390px Chrome pass. Hosted/real-device acceptance remains a release gate |
| 5 | Controlled publication from an allowlisted public snapshot | Confirmation migration, local and CI DB/HTTP smokes, and focused desktop/mobile operator and admin browser passes completed. Issued certificate, public verifier and publication remain open |
| 6 | Release hardening, hosted Testnet pilot | Not started |

## What is open

| Id | Item | Detail lives in | Unblocked by |
|---|---|---|---|
| S6 | Phase 0 release policy: public fields approved; V1 retention and publisher rules chosen, but legal/pilot review, concrete admin/wallet and providers/regions remain open | README → public snapshot, retention and publisher policies; PROGRESS → Q1–Q3 | Counsel and pilot retention review; designated publisher identity/wallet; Q2 provider/region choice before real-data release |
| S7 | Phase 3 hosted gate: managed bucket and scanner, hosted auth and expiry checks, matched DB + object backup/restore | README → "Local Setup" §2, last paragraph | Q2 (hosting and provider choice) |
| S8 | The phased plan and release plan exist only in gitignored `docs/` | D12; PROGRESS Q4 | User: track those two files, or keep them private (their essentials are mirrored here and in DECISIONS) |
| S9 | Hosted and real-device release acceptance for Phase 4 and the complete MVP | README → "Current Status" | Q2 and a deployed test environment for Phase 4; S6 release checks and Phase 5 for full MVP |

**Release readiness:** A hosted staging pilot can be planned after Q2 and S7, but no production launch or real customer data is cleared. The user-facing certificate, safe public `2.0.0` verifier, controlled publication, retention operations, backup/restore rehearsal and hosted/real-device acceptance still need implementation or verification. The `1.0.0` public readers are intentionally unavailable in production (D27).

**2026-10-03 ID correction:** ~~The new audit and confirmation gates reused S10/S11.~~ Those IDs already denote older closed items in PROGRESS; the then-open gates were S12/S13. Historical S10/S11 entries are unchanged; S12/S13 closures are recorded below.

**2026-10-04 closure:** S12 is closed by [CI run 37191462865](https://github.com/DarkPo13/hartolit-web3/actions/runs/37191462865) on `378ada3`. The production audit step and both jobs succeeded. The full-tree development dependency advisories remain outside the configured audit gate.

**2026-10-04 closure:** S13 is closed locally by a migrated PostgreSQL/HTTP review smoke and a real Chrome browser pass for source selection, preview identity, explicit confirmation, saved bytes after reload, mobile layout and recall. CI does not run this browser check; hosted and real-device acceptance remains S9.

S4 and S5 closed locally on 2026-09-25. The in-app browser still could not connect; a separate headless local Chrome pass covered rendered UI, keyboard navigation, English/Ukrainian text, record editing, empty/error states and a 390px viewport. The operator invite and access flows passed local API and Mailpit checks.

S1 closed on 2026-09-25. The current Phase 4 code passed [CI run 36123487787](https://github.com/DarkPo13/hartolit-web3/actions/runs/36123487787) on `513bf88`. The first Phase 4 push, `da38758`, failed its web smoke step; D20 and PROGRESS record the CI correction. Check the run for any later HEAD separately.

## Current validation status

~~The 2026-09-28 policy work and 2026-09-29 consultation package contain documentation only. No application validators or CI were rerun.~~ **2026-10-02 correction:** Dose-unit code was added. On Windows 11, `npx prisma validate`, `npm run db:generate`, `npm run lint`, `npm run typecheck`, `npm run db:deploy`, `npm run drafts:smoke` and `npm run review:smoke` each exited 0. The new migration applied to local PostgreSQL. `npm run test:hash` passed 2/2 and `npm run build` completed with 37 routes when rerun outside the restricted sandbox; initial sandbox runs had `spawn EPERM` and blocked Google Fonts. The development server started at `http://localhost:3000` and responded with HTTP 200. Browser UI and hosted verification were not run. No Phase 5 clean-runner CI result was available at this local check. The historical Phase 4 results below retain their original dates. On Windows 11, 2026-09-29, PDF build and artifact QA exited 0: two pages, source text preserved, five official-source hyperlinks, Cyrillic extraction and page bounds checked. Both rendered pages were visually inspected. These checks do not establish legal recognition or application behavior. Detailed documentation validation is recorded in PROGRESS.

**2026-10-02 continuation, Windows 11:** `npx prisma validate`, `npm run db:generate`, `npm run db:deploy`, `npx prisma migrate status`, and a database-to-model `prisma migrate diff --exit-code` all exited 0 for nine migrations and no schema difference. `npm run drafts:smoke` and `npm run review:smoke` exited 0 after restarting the dev server to reload the generated Prisma client; `npm run lint`, `npm run typecheck` and `npm run build` exited 0 (37 routes). A later four-decimal treated-area validator change passed `drafts:smoke` again. The browser skill connection was rejected by its trust configuration, so this slice has no visual/keyboard/mobile pass. No Phase 5 clean-runner CI result was available at this local check.

**2026-10-02 public-preview slice, Windows 11:** After starting the existing local PostgreSQL, SeaweedFS and ClamAV containers, `npm run review:smoke` exited 0 against the live development server. The smoke checks authorized preview, explicit source-kind selection, strict schema version and unknown-field rejection, private markers absent from the serialized response, selected server-verified digests and hash equality after JSON transport. `npm run test:public` exited 0 for readable preview coverage outside raw JSON; a temporary omission of treated area made it fail with "missing readable public value: 10.25", and restoring the field passed. `npm run lint` and `npm run typecheck` exited 0. `npm run build` first compiled then hit sandbox `spawn EPERM`; the approved rerun exited 0 with 38 routes, including `/api/admin/passports/[id]/public-preview`. No visual/keyboard/mobile or hosted pass; no Phase 5 CI result existed at this local check.

**2026-10-02 push preparation, Windows 11:** Fresh unpiped runs of `npm run lint`, `npm run typecheck`, `npm run test:hash` (2/2), `npm run test:public` (1/1), `npx prisma validate`, `npm run drafts:smoke`, `npm run review:smoke`, and `npm run build` (38 routes) each exited 0. The smoke scripts removed their fictional fixtures. The build ran outside the restricted sandbox because worker spawning previously returned `EPERM`. This does not establish browser, hosted or CI acceptance for the new commit.

**2026-10-03 CI and local follow-up:** [CI run 37028448665](https://github.com/DarkPo13/hartolit-web3/actions/runs/37028448665) for `aab771f` completed with a failed web job at `npm audit --omit=dev --audit-level=high`; the contract job passed. The same local audit exited 1, reporting one critical Next.js advisory on the locked `16.3.5` package and 23 moderate advisories. The [Next.js advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j) lists `16.3.6` as patched. The user deferred repair; do not call this commit CI-green. A local admin preview request-identity fix is uncommitted: `npm run lint` and `npm run typecheck` exited 0; `npm run test:public` passed 1/1 after an initial sandbox-only `spawn EPERM`. That rendering test does not exercise request races. Browser setup failed before connection, so there is no browser interaction pass for this fix.

**2026-10-03 confirmation slice, Windows 11:** `npx prisma validate`, `npm run db:generate`, `npm run lint`, `npm run typecheck`, `npm run test:hash` (2/2), `npm run test:public` (1/1, including the saved-state disclaimer), `npm run build` (39 routes), `node --check scripts/smoke-review.mjs`, and `git diff --check` exited 0. Node test workers and Google Fonts required an outside-sandbox rerun after sandbox `spawn EPERM`/font-fetch failures. The Docker Desktop engine was unavailable even after launch and a service-start attempt, so `db:deploy`, migration status and the expanded live `review:smoke` were **not run** for this slice. No browser/hosted/CI pass exists for this working tree. The known audit failure is deferred by the user. These results establish compilation and static rendering, not persistence or HTTP behavior.

**2026-10-03 handoff check, Windows 11:** Fresh unpiped `npm run lint`, `npm run typecheck`, `npx prisma validate`, `node --check scripts/smoke-review.mjs` and `git diff --check` each exited 0; no runtime code changed after the passing build/hash/rendering tests above. `docker compose ps` exited 1 because the Docker Desktop Linux engine pipe was absent. The migration and expanded live smoke remain **not run**. No new CI or browser result exists.

**2026-10-04 CI check, macOS via GitHub Actions API:** [Run 37144642862](https://github.com/DarkPo13/hartolit-web3/actions/runs/37144642862) for `b81cd36` completed with web **failure** only at `npm audit --omit=dev --audit-level=high`; contract **success**. Earlier web steps succeeded: `npm ci`, lint, typecheck, hash and public rendering tests, build, `db:deploy`, storage/scanner setup and the combined draft/evidence/review/auth live-smoke step. The committed review smoke asserts exact confirmation bytes and hash in PostgreSQL, idempotence, audit and recall invalidation. CI does not cover admin browser interaction, hosted services or a real device. This supersedes the handoff's pending CI/database-smoke status, not its historical Windows local-run results.

**2026-10-04 dependency repair, macOS, Node 26.4.0/npm 11.17.0:** The old lockfile's production audit exited 1 with one critical Next.js advisory and 23 moderate advisories. Updated `next`, `@next/env` and `eslint-config-next` to `16.3.8` with a regenerated lockfile. `npm audit --omit=dev --audit-level=high`, `npm ci`, lint, typecheck, `test:hash` (2/2), `test:public` (1/1), production build (39 routes) and `git diff --check` exited 0. The production audit still reports 23 moderate advisories, below this CI gate's threshold. A separate full-tree audit exits 1 with five high advisories in the development ESLint/glob chain; this gate explicitly omits dev dependencies. Local service smokes were **not run** because the Docker daemon was unavailable. No workflow code changed, and no CI run exists for this uncommitted repair.

**2026-10-04 clean-runner verification:** Commit `378ada3` was pushed to `master`; [run 37191462865](https://github.com/DarkPo13/hartolit-web3/actions/runs/37191462865) completed **success**. The web job passed the production audit, build, migration deployment and live smokes; the contract job passed. This supersedes the preceding local check's pending-CI sentence. The earlier context-only edits in this working tree remain uncommitted.

**2026-10-04 local E2E, macOS, Node 26.4.0, Chrome headless:** Docker Desktop ran local PostgreSQL, Mailpit, SeaweedFS and ClamAV. `db:deploy` applied all ten migrations; `prisma migrate status` found the schema current. A production build exited 0 with 39 routes. Draft, evidence and review smokes exited 0 against `next start`; the review smoke asserted exact confirmation bytes/hash and recall invalidation. A temporary Playwright-controlled Chrome pass at 1440×900 and 390×844 exercised anonymous redirect, MFA login, selected evidence, stale-preview discard after a source change, readable public facts, opt-in confirmation, persisted bytes after reload and recall; it found no page errors or horizontal overflow. Both screenshots were inspected. The auth smoke initially found no invitation email because the local test used `127.0.0.1` against Mailpit's `localhost` TLS certificate; restarting the app with `SMTP_HOST=localhost` made auth/invite/reset smoke exit 0. A database check found zero fictional users, passports and evidence files after cleanup. Temporary browser fixture code was removed and test containers stopped with volumes retained. No hosted or real-device test was run, and the browser harness is not in CI.

**2026-10-04 operator browser follow-up, macOS, Chrome headless:** A second fictional operator used the production server to enter the separate public farm label, treatment time zone and treated area, UTC weather measurement time and dose unit; the browser confirmed server persistence, uploaded and verified weather and chemical evidence through the private bucket/scanner, reloaded the draft, checked 390px layout without horizontal overflow, and submitted it. No page errors occurred. The operator fixture and its objects were removed. An early harness assertion observed the initial autosave before later fields; waiting for the final server record showed both versioned saves completed. Repeated login attempts reached the configured five-per-15-minute rate limit; a fresh fictional test IP completed the run. Hosted and real-device checks remain open.

**2026-10-04 pre-release audit and handoff, macOS, Node 26.4.0:** Production boundary inspection found that the legacy verifier and payload API could expose private `1.0.0` fields if a production contract were configured. Both now fail closed (page 404, API 503); `test:public-boundary` passed against `next start`. Signed-in completion indicators now use capture requirements rather than demo-only private fields/files; `test:capture` passed, and a separate fictional Chrome operator pass confirmed four cards complete, auto-advance, persisted facts, 390px layout and no page errors or overflow. The fixture was removed. `nodemailer` was updated to `10.0.14`; the production audit now reports 22 moderate, zero high/critical advisories, while the full development tree still has five high advisories in the ESLint/glob chain. A webpack production build passed with 39 routes, as did lint, typecheck, Prisma validation, hash/public tests and live review/auth smokes during this audit. Local Turbopack build was blocked by sandbox process/port restrictions; ~~CI's default build must be checked on this new commit.~~ Foundry was unavailable locally; contract code is unchanged apart from a comment, so ~~CI must check it.~~ **2026-10-04 correction:** Both checks passed in the clean-runner result below. No hosted or real-device pass occurred.

**2026-10-04 clean-runner result:** `9263277` passed [CI run 37208962308](https://github.com/DarkPo13/hartolit-web3/actions/runs/37208962308): web `npm ci`, lint, typecheck, hash/public/capture tests, default build, migration, live public-boundary/draft/evidence/review/auth checks and production audit; contract Foundry build, ABI comparison and tests. This closes the preceding paragraph's CI checks. The follow-up handoff note changes documentation only.

All local runs were unpiped, reading each command's exit status. "Local" = Windows 11, Node 26.1.0, npm 11.13.0, Docker 29.7.2 on 2026-09-25. "CI" = GitHub-hosted `ubuntu-latest`, Node 24, [run 36123487787](https://github.com/DarkPo13/hartolit-web3/actions/runs/36123487787) on `513bf88`, completed **success** with `web` and `contract` jobs on 2026-09-25.

| Validator | Local, Windows 11, 2026-09-25 | CI run 36123487787 on `513bf88` |
|---|---|---|
| `npm run lint`, `npm run typecheck` | both exit 0; typecheck rerun after the final UI expression | both success |
| `npm run test:hash` | 2/2 pass | success |
| `npm run build` | exit 0, 37 routes | success |
| `npx prisma validate` | exit 0 | not a CI step |
| `npx prisma migrate status` | exit 0, seven migrations up to date | `db:deploy` success |
| `npm run drafts:smoke`, `npm run evidence:smoke`, `npm run review:smoke`, `npm run auth:smoke` | each exit 0 against local services and running app; fictional fixtures removed | all success in shared live-smoke step |
| Foundry build, 22 tests, ABI comparison | not rerun locally on 2026-09-25; local Foundry passed 22/22 on 2026-09-24 | success |
| `npm audit --omit=dev --audit-level=high` | not run locally | success |

The Phase 4 migration `20260925090000_phase4_admin_actions` applied locally with `npm run db:deploy` exit 0; `npm run db:generate` exited 0. A temporary headless Chrome pass at desktop and 390px rendered the admin UI, edited a record, switched language, navigated by keyboard, and showed empty/error states. Temporary browser files and fictional fixtures were removed. The in-app browser connection remained unavailable. Real-device and hosted validation were **not run**.

Negative controls: `evidence:smoke` against a closed port, the hash regression before its fix, and the ABI check against a changed artifact all failed on 2026-09-24. On 2026-09-25, production-style Nodemailer verification against default Mailpit failed with `ETLS`; the same verification against temporary Mailpit STARTTLS with a trusted test certificate passed. The temporary container and certificate were removed.

## Environment

- **Local services:** `compose.yaml` binds PostgreSQL 55432, Mailpit 1025/8025, SeaweedFS 8333 and ClamAV 3310 to loopback. Credentials are generated into gitignored env files by `npm run db:setup` and `npm run evidence:setup`.
- **Setup order:** the command sequence is in README → "Local Setup" §2.
- **CI:** `.github/workflows/ci.yml` runs on every push. The runner label `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19, per a notice on run 35979500952.
- **Not deployed anywhere:** no hosted app, no contract, nothing published.

## Important context

- Do not enter real customer data. The legacy demo payload exposes tax IDs, coordinates and cadastral numbers. ~~The public-field allowlist is undecided (Q1).~~ **2026-09-28 correction:** the initial field policy is approved (D21); ~~its runtime enforcement and Q1 retention are incomplete.~~ **2026-10-03 correction:** strict preview and V1 engineering retention policy exist, but legal/pilot review and deletion/hold/restore implementation remain release gates.
- The certificate supports evidence assessment for a specific treatment. It must display every public field, preserve schema history, and retain source evidence/private farmer-plot linkage under an approved policy. Dose appropriateness and compensation are not determined by the current completeness checks or hash verifier.
- The legacy wizard, `/api/mint`, `/api/passport/[tokenId]` and `/verify/[tokenId]` are prototype paths that must stay behind `isDemoMode()` (D1, D2, D27). Phase 5 publication is meant to be done by an approved operator wallet, not a server key (D3).
- Decisions are made by AI agents under the user's control; there is no other human decision-maker (user, 2026-09-24). Ask the user for anything marked as a user decision.

## Next steps

Ordered by leverage.

1. **[Agent] Build a certificate and verifier from only the confirmed bytes.** Display all public schema fields in both, make their unpublished status clear, and keep public access disabled until the publication design and release gates are ready. Add browser coverage for those new views, then implement controlled publication and its failure/retry/reconciliation tests.
2. **[User with agent preparation] Complete S6/S7/S9 release specifics.** Obtain counsel/pilot review of the V1 retention target; choose Q2 hosting, database, private bucket, scanner and SMTP providers/regions; designate the MFA publisher account and wallet. Then implement and test retention, backup/restore and hosted acceptance. Engineering defaults are in README (D25); they do not authorize real publication. A deployment workflow depends on the Q2 hosting choice.

## Open questions

Owners and blocking status are recorded in `PROGRESS.md` → Open questions: Q1 V1 retention default chosen, legal/pilot review pending · Q2 hosting and providers · Q3 publisher role chosen, actual admin/wallet pending · Q4 track the plans in git? · Q5 a "latest stable versions" repo rule? Q6 is settled: the hash regression uses `node --test` with the existing `jiti` dependency.
