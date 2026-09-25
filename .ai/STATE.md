# STATE — the frontier

- **Last updated:** 2026-09-25
- **Branch:** `master`
- ~~**HEAD:** `a4154a1`, with the release-check changes uncommitted.~~ **2026-09-25:** The validated code commit is `0a7764c` ("Fix contract test setup and harden release checks"), pushed to `origin/master`. This handoff update changes documentation only; use `git log -1` for its final HEAD.

Rules for this file:
- It is a frontier, not a log. Keep it under about 250 lines; move history to `PROGRESS.md`.
- Every open item names what unblocks it.
- Every measurement carries its date and the machine it was taken on.
- Mark corrections inline with ~~strikethrough~~ plus the date; never apply them silently.
- If a fresh agent reading only this file cannot act, the file has failed.

## Current goal

*Inferred from repository evidence (commit `a4154a1`, README "Release status", the phased plan), not a standing instruction:*

~~Get `master` CI green (the last pushed Foundry run failed; S1).~~ **Completed 2026-09-25:** CI run 36107136075 passed both jobs on `0a7764c`. Next, finish Phase 4 browser acceptance and settle the Phase 0 decisions that gate Phase 5, controlled publication. No real customer data until the hosting, privacy, backup and release gates pass.

## Phases

This table is the committed summary of the phased plan, whose full text is gitignored (D12).

| Phase | Scope | State on 2026-09-25 |
|---|---|---|
| 0 | Approve the boundary: public-field allowlist, retention, providers and regions, who may publish | Open. Decisions Q1–Q3 |
| 1 | Accounts, DB sessions, admin TOTP, password reset, invite-only | Built. `auth:smoke` passed locally on 2026-09-24 |
| 2 | Durable owner-scoped drafts, optimistic concurrency, audit | Built. `drafts:smoke` exit 0 locally and in CI |
| 3 | Private evidence: direct upload, integrity checks, ClamAV, expiring links | Built locally. `evidence:smoke` exit 0 locally and in CI. Hosted gate open (S7) |
| 4 | Submit / assign / decide / reopen; admin console | Workflow built; `review:smoke` exit 0 locally and in CI. Admin record editing and invitations not built (S5). Browser acceptance not done (S4) |
| 5 | Controlled publication from an allowlisted public snapshot | Not started. Blocked by Q1 and Q3 |
| 6 | Release hardening, hosted Testnet pilot | Not started |

## What is open

| Id | Item | Detail lives in | Unblocked by |
|---|---|---|---|
| S4 | Phase 4 UI has had no browser, keyboard or mobile acceptance pass. Browser connection failed because its runtime code path was not trusted. | README → "Current Status", Phase 4 row | A working browser connection, or a human acceptance pass |
| S5 | Admin record editing and user invitations not built | README → "Phased application architecture" | A scoped design approved by the user (AI proposes, user controls) |
| S6 | Phase 0 decisions | PROGRESS → Open questions Q1–Q3 | User decision |
| S7 | Phase 3 hosted gate: managed bucket and scanner, hosted auth and expiry checks, matched DB + object backup/restore | README → "Local Setup" §2, last paragraph | Q2 (hosting and provider choice) |
| S8 | The phased plan and release plan exist only in gitignored `docs/` | D12; PROGRESS Q4 | User: track those two files, or keep them private (their essentials are mirrored here and in DECISIONS) |

S1 closed on 2026-09-25: [CI run 36107136075](https://github.com/DarkPo13/hartolit-web3/actions/runs/36107136075) completed with both `contract` and `web` jobs successful on `0a7764c`. Earlier run 35979500952 remains a failed historical result for `a4154a1`.

## Current validation status

All runs were unpiped, reading the command's own exit status.
- "Local" = Windows 11, Node 26.1.0, npm 11.13.0, Docker 29.7.2. A portable Foundry binary was used on 2026-09-24 from a temporary directory; it was not installed system-wide and was unavailable on 2026-09-25. PostgreSQL, SeaweedFS, ClamAV, and Mailpit were running from `compose.yaml` on 2026-09-24. The earlier smokes ran against a clean `a4154a1`; the release checks describe `0a7764c`.
- "CI" = GitHub-hosted `ubuntu-latest`, Node 24, run 36107136075 on `0a7764c`, completed **success** on 2026-09-25. Both jobs passed. The separate handoff commit changes documentation only; check GitHub Actions for its own CI result.

| Validator | Local, Windows 11, 2026-09-24/25 | CI run 36107136075 on `0a7764c` |
|---|---|---|
| `npm run lint` | exit 0 on 2026-09-25 with zero-warning gate; `.mjs` undefined and unused probes failed on 2026-09-24 | success |
| `npm run typecheck` | exit 0 on 2026-09-25 with unused TypeScript checks | success |
| `npm run test:hash` | 2/2 pass on 2026-09-25; before the fix both assertions failed on 2026-09-24 | success |
| `npm run build` | exit 0, 34 routes on 2026-09-24 | success |
| `npx prisma validate` | exit 0 | not a CI step |
| `npx prisma migrate status` | exit 0: 6 migrations, "Database schema is up to date" | `db:deploy` success |
| `npm run drafts:smoke` | exit 0 | success (runs inside "Verify authenticated draft and evidence routes") |
| `npm run evidence:smoke` | exit 0 | success (same step) |
| `npm run review:smoke` | exit 0 | success (same step) |
| `npm run auth:smoke` | exit 0 on 2026-09-24 after Mailpit started | not a CI step |
| `forge build --root contracts` | exit 0 on 2026-09-24 using portable Foundry | success |
| `forge test --root contracts -vvv` | 22/22 pass on 2026-09-24 after fixing two test setups; not rerun locally on 2026-09-25 | success |
| ABI comparison script | exit 0 for 21 entries on 2026-09-25; a deliberately changed output failed on 2026-09-24 | success |
| `npm audit --omit=dev --audit-level=high` | not run locally | success |

Negative controls, 2026-09-24, local: `evidence:smoke` pointed at a closed port exits 1; the hash regression tests failed before the fix; the ABI check rejected a modified artifact with exit 1.

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

1. **[Human, or agent with a working browser] Phase 4 browser, keyboard, and mobile acceptance (S4).** The in-app browser could not connect on this machine because its runtime code path was rejected by the trust configuration; no visual pass is claimed.
2. **[Agent + user] Scope admin record editing and invitations (S5).** The review workflow and read-only records are present; define the permissions and audit behavior before writing these mutations.
3. **[User] Decide Q1–Q3.** They gate Phase 5 and hosted release work.

## Open questions

Owners and blocking status are recorded in `PROGRESS.md` → Open questions: Q1 public-field allowlist and retention · Q2 hosting and providers · Q3 who may publish Testnet records · Q4 track the plans in git? · Q5 a "latest stable versions" repo rule? Q6 is settled: the hash regression uses `node --test` with the existing `jiti` dependency.
