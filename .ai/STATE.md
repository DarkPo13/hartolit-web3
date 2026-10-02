# STATE — the frontier

- **Last updated:** 2026-10-02
- **Branch:** `master`
- **Phase 4 code:** `da38758` (implementation) and `513bf88` (CI STARTTLS), pushed to `master`. Use `git log -1` for the latest handoff commit.

Rules for this file:
- It is a frontier, not a log. Keep it under about 250 lines; move history to `PROGRESS.md`.
- Every open item names what unblocks it.
- Every measurement carries its date and the machine it was taken on.
- Mark corrections inline with ~~strikethrough~~ plus the date; never apply them silently.
- If a fresh agent reading only this file cannot act, the file has failed.

## Current goal

**User request 2026-09-28:** Complete the next milestone one step at a time. The user approved the initial public-field policy and clarified the certificate's purpose: help farmers present evidence of proper treatments for organizations assessing crop damage, compliance or compensation. Every public field must be on the certificate; future scope changes use new schema versions while published records retain their original contents (D21). ~~Phase 5 runtime implementation has not started.~~ **2026-10-02 correction:** Two capture migrations and a read-only public-preview slice are implemented locally. The preview builds strict `2.0.0` public JSON from approved passports and two explicitly selected verified evidence files (D24). ~~No public snapshot or publication exists.~~ **2026-10-02 correction:** An ephemeral public snapshot can now be previewed; confirmation, issued certificate, public verifier and publication do not exist. **Next user decision: private-data retention (remaining Q1)** using README → "Private-data retention proposal — remaining Q1 decision", then publisher access (Q3). No real customer data until hosting, privacy, backup and release gates pass.

**2026-10-02 continuation:** `Passport.publicFarmLabel` (never copied from legal name), DB-generated `Field.publicReference`, `Treatment.timeZone` and `treatedAreaHectares` are implemented. The second migration applied locally; draft and review smokes passed. Submitted records require these facts, with treated area no larger than field area. Old facts remain unknown. ~~The approved public-field table omits treated area; confirmation is pending.~~ **2026-10-02 correction:** The user approved public treated area and the field matrix includes it. The preview is read-only and transient; publication remains absent.

**2026-09-29 consultation package:** Prepared a Ukrainian product brief and cover message for the user's legal/regulatory contact. The Markdown copies are local-only in gitignored `docs/HARTOLIT_REGULATORY_BRIEF_UA.md` and `docs/HARTOLIT_REGULATORY_MESSAGE_UA.md`; the forwardable two-page PDF is untracked in `output/pdf/HARTOLIT_REGULATORY_BRIEF_UA.pdf`. The package distinguishes the local MVP, planned publication and deferred KEP, and asks how the treatment record relates to existing electronic journal requirements. No external message was sent. This work does not settle retention, authorize publication or establish legal recognition.

## Phases

This table is the committed summary of the phased plan, whose full text is gitignored (D12).

| Phase | Scope | State as of 2026-10-02 |
|---|---|---|
| 0 | Approve the boundary: public-field allowlist, retention, providers and regions, who may publish | Initial public fields approved 2026-09-28 and treated area added 2026-10-02 (D21). Retention proposal awaits the user; Q2/Q3 remain open |
| 1 | Accounts, DB sessions, admin TOTP, password reset, invite-only | Built. `auth:smoke` passed locally and in CI on 2026-09-25 |
| 2 | Durable owner-scoped drafts, optimistic concurrency, audit | Built. `drafts:smoke` exit 0 locally and in CI |
| 3 | Private evidence: direct upload, integrity checks, ClamAV, expiring links | Built locally. `evidence:smoke` exit 0 locally and in CI. Hosted gate open (S7) |
| 4 | Submit / assign / decide / reopen; admin console | Local pass 2026-09-25. Draft-only record edits, archive/restore, operator invitation/access controls, audit filters, API smokes, desktop and 390px Chrome pass. Hosted/real-device acceptance remains a release gate |
| 5 | Controlled publication from an allowlisted public snapshot | Public scope including treated area approved. Two capture migrations, strict schema, allowlisted builder and MFA-admin read-only preview passed local smokes on 2026-10-02. Confirmation, issued certificate, public verifier and publication remain open; publication requires Q1 and Q3 |
| 6 | Release hardening, hosted Testnet pilot | Not started |

## What is open

| Id | Item | Detail lives in | Unblocked by |
|---|---|---|---|
| S6 | Phase 0 decisions: initial public fields including treated area approved; retention, publishers, providers/regions remain open | README → public snapshot policy and retention proposal; PROGRESS → Open questions Q1–Q3 | User decision on retention, then Q3 publishers and Q2 providers/regions. Q1 is only partially closed |
| S7 | Phase 3 hosted gate: managed bucket and scanner, hosted auth and expiry checks, matched DB + object backup/restore | README → "Local Setup" §2, last paragraph | Q2 (hosting and provider choice) |
| S8 | The phased plan and release plan exist only in gitignored `docs/` | D12; PROGRESS Q4 | User: track those two files, or keep them private (their essentials are mirrored here and in DECISIONS) |
| S9 | Hosted and real-device release acceptance for Phase 4 and the complete MVP | README → "Current Status" | Q2 and a deployed test environment for Phase 4; Q1/Q3 and Phase 5 for full MVP |

S4 and S5 closed locally on 2026-09-25. The in-app browser still could not connect; a separate headless local Chrome pass covered rendered UI, keyboard navigation, English/Ukrainian text, record editing, empty/error states and a 390px viewport. The operator invite and access flows passed local API and Mailpit checks.

S1 closed on 2026-09-25. The current Phase 4 code passed [CI run 36123487787](https://github.com/DarkPo13/hartolit-web3/actions/runs/36123487787) on `513bf88`. The first Phase 4 push, `da38758`, failed its web smoke step; D20 and PROGRESS record the CI correction. Check the run for any later HEAD separately.

## Current validation status

~~The 2026-09-28 policy work and 2026-09-29 consultation package contain documentation only. No application validators or CI were rerun.~~ **2026-10-02 correction:** Dose-unit code was added. On Windows 11, `npx prisma validate`, `npm run db:generate`, `npm run lint`, `npm run typecheck`, `npm run db:deploy`, `npm run drafts:smoke` and `npm run review:smoke` each exited 0. The new migration applied to local PostgreSQL. `npm run test:hash` passed 2/2 and `npm run build` completed with 37 routes when rerun outside the restricted sandbox; initial sandbox runs had `spawn EPERM` and blocked Google Fonts. The development server started at `http://localhost:3000` and responded with HTTP 200. Browser UI and hosted verification were not run. No Phase 5 clean-runner CI result was available at this local check. The historical Phase 4 results below retain their original dates. On Windows 11, 2026-09-29, PDF build and artifact QA exited 0: two pages, source text preserved, five official-source hyperlinks, Cyrillic extraction and page bounds checked. Both rendered pages were visually inspected. These checks do not establish legal recognition or application behavior. Detailed documentation validation is recorded in PROGRESS.

**2026-10-02 continuation, Windows 11:** `npx prisma validate`, `npm run db:generate`, `npm run db:deploy`, `npx prisma migrate status`, and a database-to-model `prisma migrate diff --exit-code` all exited 0 for nine migrations and no schema difference. `npm run drafts:smoke` and `npm run review:smoke` exited 0 after restarting the dev server to reload the generated Prisma client; `npm run lint`, `npm run typecheck` and `npm run build` exited 0 (37 routes). A later four-decimal treated-area validator change passed `drafts:smoke` again. The browser skill connection was rejected by its trust configuration, so this slice has no visual/keyboard/mobile pass. No Phase 5 clean-runner CI result was available at this local check.

**2026-10-02 public-preview slice, Windows 11:** After starting the existing local PostgreSQL, SeaweedFS and ClamAV containers, `npm run review:smoke` exited 0 against the live development server. The smoke checks authorized preview, explicit source-kind selection, strict schema version and unknown-field rejection, private markers absent from the serialized response, selected server-verified digests and hash equality after JSON transport. `npm run test:public` exited 0 for readable preview coverage outside raw JSON; a temporary omission of treated area made it fail with "missing readable public value: 10.25", and restoring the field passed. `npm run lint` and `npm run typecheck` exited 0. `npm run build` first compiled then hit sandbox `spawn EPERM`; the approved rerun exited 0 with 38 routes, including `/api/admin/passports/[id]/public-preview`. No visual/keyboard/mobile or hosted pass; no Phase 5 CI result existed at this local check.

**2026-10-02 push preparation, Windows 11:** Fresh unpiped runs of `npm run lint`, `npm run typecheck`, `npm run test:hash` (2/2), `npm run test:public` (1/1), `npx prisma validate`, `npm run drafts:smoke`, `npm run review:smoke`, and `npm run build` (38 routes) each exited 0. The smoke scripts removed their fictional fixtures. The build ran outside the restricted sandbox because worker spawning previously returned `EPERM`. This does not establish browser, hosted or CI acceptance for the new commit.

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

- Do not enter real customer data. The legacy demo payload exposes tax IDs, coordinates and cadastral numbers. ~~The public-field allowlist is undecided (Q1).~~ **2026-09-28 correction:** the initial field policy is approved (D21); its runtime enforcement and Q1 retention are incomplete.
- The certificate supports evidence assessment for a specific treatment. It must display every public field, preserve schema history, and retain source evidence/private farmer-plot linkage under an approved policy. Dose appropriateness and compensation are not determined by the current completeness checks or hash verifier.
- The legacy wizard and `/api/mint` are a prototype path that must stay behind `isDemoMode()` (D1, D2). Phase 5 publication is meant to be done by an approved operator wallet, not a server key (D3).
- Decisions are made by AI agents under the user's control; there is no other human decision-maker (user, 2026-09-24). Ask the user for anything marked as a user decision.

## Next steps

Ordered by leverage.

1. **[User] Approve or amend private-data retention (remaining Q1).** The public-field part is approved (D21). Read README → "Private-data retention proposal — remaining Q1 decision": five-year finalized treatment/evidence retention, 90-day unused drafts with notice, open-claim preservation holds and a 30-day backup target. These periods are proposed, not adopted or legal minima.
2. **[User with agent proposal] Set publisher access (Q3).** Prepare a concrete recommendation after retention is settled. Do not publish real records on the user's behalf.
3. **[Agent] Build a persisted confirmation of the exact public snapshot and a certificate/verifier that use those confirmed bytes, after Q1 and Q3.** The transient preview uses a strict `2.0.0` schema and an allowlisted builder but generates new metadata on each request. The future confirmation must bind snapshot bytes and hash to the approved passport version; if content or approval changes, fail closed. Keep demo issuance closed for real records.
4. **[User with agent proposal] Decide Q2, then perform hosted release verification.** Choose hosting, database, private bucket, scanner and SMTP providers/regions to enable S7 and S9.

## Open questions

Owners and blocking status are recorded in `PROGRESS.md` → Open questions: Q1 public fields including treated area approved, retention pending · Q2 hosting and providers · Q3 who may publish Testnet records · Q4 track the plans in git? · Q5 a "latest stable versions" repo rule? Q6 is settled: the hash regression uses `node --test` with the existing `jiti` dependency.
