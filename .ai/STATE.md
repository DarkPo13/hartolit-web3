# STATE — the frontier

- **Last updated:** 2026-09-25
- **Branch:** `master`
- **Phase 4 code:** `da38758` (implementation) and `513bf88` (CI STARTTLS), pushed to `master`. Use `git log -1` for the latest handoff commit.

Rules for this file:
- It is a frontier, not a log. Keep it under about 250 lines; move history to `PROGRESS.md`.
- Every open item names what unblocks it.
- Every measurement carries its date and the machine it was taken on.
- Mark corrections inline with ~~strikethrough~~ plus the date; never apply them silently.
- If a fresh agent reading only this file cannot act, the file has failed.

## Current goal

**User request 2026-09-25:** Complete Phase 4, then prepare handoff and push. The local workflow, management and headless browser checks passed, and [CI run 36123487787](https://github.com/DarkPo13/hartolit-web3/actions/runs/36123487787) passed both jobs on `513bf88`. Next, settle the Phase 0 decisions that gate Phase 5 controlled publication and the hosted release. No real customer data until hosting, privacy, backup and release gates pass.

## Phases

This table is the committed summary of the phased plan, whose full text is gitignored (D12).

| Phase | Scope | State on 2026-09-25 |
|---|---|---|
| 0 | Approve the boundary: public-field allowlist, retention, providers and regions, who may publish | Open. Decisions Q1–Q3 |
| 1 | Accounts, DB sessions, admin TOTP, password reset, invite-only | Built. `auth:smoke` passed locally and in CI on 2026-09-25 |
| 2 | Durable owner-scoped drafts, optimistic concurrency, audit | Built. `drafts:smoke` exit 0 locally and in CI |
| 3 | Private evidence: direct upload, integrity checks, ClamAV, expiring links | Built locally. `evidence:smoke` exit 0 locally and in CI. Hosted gate open (S7) |
| 4 | Submit / assign / decide / reopen; admin console | Local pass 2026-09-25. Draft-only record edits, archive/restore, operator invitation/access controls, audit filters, API smokes, desktop and 390px Chrome pass. Hosted/real-device acceptance remains a release gate |
| 5 | Controlled publication from an allowlisted public snapshot | Not started. Blocked by Q1 and Q3 |
| 6 | Release hardening, hosted Testnet pilot | Not started |

## What is open

| Id | Item | Detail lives in | Unblocked by |
|---|---|---|---|
| S6 | Phase 0 decisions | PROGRESS → Open questions Q1–Q3 | User decision |
| S7 | Phase 3 hosted gate: managed bucket and scanner, hosted auth and expiry checks, matched DB + object backup/restore | README → "Local Setup" §2, last paragraph | Q2 (hosting and provider choice) |
| S8 | The phased plan and release plan exist only in gitignored `docs/` | D12; PROGRESS Q4 | User: track those two files, or keep them private (their essentials are mirrored here and in DECISIONS) |
| S9 | Hosted and real-device release acceptance for Phase 4 and the complete MVP | README → "Current Status" | Q2 and a deployed test environment for Phase 4; Q1/Q3 and Phase 5 for full MVP |

S4 and S5 closed locally on 2026-09-25. The in-app browser still could not connect; a separate headless local Chrome pass covered rendered UI, keyboard navigation, English/Ukrainian text, record editing, empty/error states and a 390px viewport. The operator invite and access flows passed local API and Mailpit checks.

S1 closed on 2026-09-25. The current Phase 4 code passed [CI run 36123487787](https://github.com/DarkPo13/hartolit-web3/actions/runs/36123487787) on `513bf88`. The first Phase 4 push, `da38758`, failed its web smoke step; D20 and PROGRESS record the CI correction. Check the run for any later HEAD separately.

## Current validation status

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

- Do not enter real customer data. The demo payload publishes tax IDs, coordinates and cadastral numbers, and the public-field allowlist is undecided (Q1).
- The legacy wizard and `/api/mint` are a prototype path that must stay behind `isDemoMode()` (D1, D2). Phase 5 publication is meant to be done by an approved operator wallet, not a server key (D3).
- Decisions are made by AI agents under the user's control; there is no other human decision-maker (user, 2026-09-24). Ask the user for anything marked as a user decision.

## Next steps

Ordered by leverage.

1. **[User] Decide Q1 and Q3.** Approve the public-field allowlist and retention period, then name who may publish Testnet records. These gate Phase 5.
2. **[User] Decide Q2.** Choose hosting, database, private bucket, scanner and SMTP providers/regions to enable the Phase 3 hosted gate and Phase 4 hosted acceptance.
3. **[Agent] After decisions, implement Phase 5 controlled publication and prepare hosted release verification.** Keep demo publication disabled for real records.

## Open questions

Owners and blocking status are recorded in `PROGRESS.md` → Open questions: Q1 public-field allowlist and retention · Q2 hosting and providers · Q3 who may publish Testnet records · Q4 track the plans in git? · Q5 a "latest stable versions" repo rule? Q6 is settled: the hash regression uses `node --test` with the existing `jiti` dependency.
