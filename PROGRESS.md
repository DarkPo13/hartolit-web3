# PROGRESS — the long-form record

**Append-only.** This file only grows. Never delete or silently rewrite a claim that turned out wrong: strike it through (~~like this~~) or append a dated correction that quotes what was claimed and why it was wrong. The current frontier is `.ai/STATE.md`; this file is the history and the reasons behind it.

## Status legend

| Mark | Meaning |
|---|---|
| ✅ | Done AND verified, with the evidence named: command, exit status, date, machine |
| ⚠️ | Written or claimed but unproven. May never be reported as done |
| ❌ | Ran and failed |
| ⏸️ | Deliberately not run or not built; the reason is stated |
| ~~text~~ | Retracted; a dated note says why |

Numbers, not adjectives. A count carries its previous value when one exists.

---

## History before this record (reconstructed 2026-09-24 from git and local files)

- **2026-05-25 → 2026-05-27, commits `e421a84` … `9c57fa1`:** a prototype. It had the 3-step wizard, `HartolitFieldPassport.sol` with a Foundry test file, a mock Diia flow, a `localStorage` draft, and the README. Two commits are titled "fix: trigger deploy"; nothing in the repository shows what they deployed to.
- **2026-09-17 → 2026-09-24:** work described in two gitignored plans under `docs/` (see D12). Their "local pass" claims (auth smoke, draft/evidence/review smokes, a browser pass, npm audit counts) are ⚠️ for this record: they were written in files that do not travel, and **only what is listed under 2026-09-24 below was reproduced here**.
- **2026-09-24, commit `a4154a1` "Build authenticated MVP foundation and review workflow":** 121 files, +9641/−1325 lines. Phases 1–3 and the Phase 4 workflow, six Prisma migrations, four smoke scripts, the CI workflow, and the contract ABI change (D5). Pushed to `origin/master`.

---

## 2026-09-24 — Durable-context setup (Tier 1) and baseline validation

### What was done
- ✅ Created `.ai/PROJECT.md`, `.ai/STATE.md`, `.ai/DECISIONS.md` (16 entries) and this file, and extended `AGENTS.md` below the untouched Next.js block. Not committed.
- ✅ Established a validation baseline on `a4154a1`; see STATE → "Current validation status" for the table. Summary for the local workstation (Windows 11, Node 26.1.0):
  - lint exit 0; typecheck exit 0; build exit 0 (34 routes)
  - `prisma validate` exit 0; `prisma migrate status` exit 0 (6 migrations, up to date)
  - drafts, evidence and review smokes exit 0
- ✅ Read the CI result for `a4154a1` through the public GitHub API: run 35979500952 concluded **failure**. The `web` job succeeded on every step; the `contract` job failed at `forge test` (F2).
- ✅ Negative control: `evidence:smoke` pointed at a closed port exits 1, so a smoke failure does reach the exit status.

### Numbers (first recorded values; no previous value exists)
- Foundry test functions in `contracts/test/HartolitFieldPassport.t.sol`: **22** (count of `function test`). They have **never passed anywhere** (F2).
- `assert.` call sites per smoke script (a grep count, not a count of executed assertions): auth **38**, drafts **27**, evidence **31**, review **54**.
- JS/TS unit tests: **0**. There is no `test` script.
- Committed Prisma migrations: **6**.

### Findings

- **F1 — `canonicalize` is not stable across a JSON round-trip.** Measured on 2026-09-24 on the local workstation, importing the real `lib/hash.ts` through `jiti`:
  - `canonicalize({ b: 1, a: undefined })` gives `{"a":undefined,"b":1}`.
  - After `JSON.parse(JSON.stringify(…))` it gives `{"b":1}`.
  - Equal: `false`.

  Mint hashes a payload, IPFS stores JSON, and `/verify` re-hashes the JSON. If any hashed object ever carries an `undefined` value, a genuine passport shows as tampered. Whether any current path does is **unverified**: the mint route parses JSON through Zod, which by itself cannot introduce `undefined`, but no one has traced it. No test covers `lib/hash.ts`. → STATE S2.
- **F2 — The Foundry suite fails in CI.** Run 35979500952, job "contract": steps 1–5 succeeded (toolchain, `forge install` of the pinned libraries, `forge build`); step 6 `forge test --root contracts -vvv` failed with "Process completed with exit code 1". The job log returns HTTP 403 without repository-admin login, so the failing test is **unknown**. This is the first recorded run of the suite anywhere; Foundry is not installed on the local workstation. → STATE S1.
- **F3 — README contradicts the code** (read 2026-09-24):
  - The "Current Status" row "Smart contract + Foundry tests ✅ Complete" is false (F2).
  - "Local Setup" §4 says evidence upload and submission are "intentionally unavailable", while §2 of the same section describes both working.
  - The "Testing Without a Wallet" table says configured file upload "Bytes are not durably stored yet", while Phase 3 stores them in the private bucket.
  - The Tech Stack names a "Pinata SDK"; `lib/ipfs.ts` uses `fetch` and there is no Pinata dependency.
  - The "Project Structure" tree omits `lib/drafts`, `lib/evidence`, `lib/review`, `components/drafts`, `app/admin`, `prisma/`, `scripts/`.
  - The MIT badge links a `LICENSE` file that does not exist.
  - The Solidity badge says 0.8.24; the compiler is solc 0.8.28 (`pragma ^0.8.24`, so they are consistent, but the badge is misleading).

  → STATE S9.
- **F4 — What the validators do not cover.** Measured 2026-09-23 on the local workstation by planting malformed probe files (`zzprobe_*`) in 14 directories and 4 extensions, then removing them; `git status` showed none left. The ESLint and TypeScript configuration measured then is the configuration committed in `a4154a1`.
  - Both validators can fail: syntax probes gave lint exit 1 and typecheck exit 2.
  - A `react-hooks/exhaustive-deps` **warning** printed and lint **exited 0**.
  - An unused variable produced **no output at all**.
  - An undefined identifier in `scripts/*.mjs` passed both validators (`allowJs` false; no `no-undef`).
  - ESLint skips `contracts/` and `generated/` but lints the gitignored `docs/` and `.github/`.
  - tsc skips `contracts/` and dot-directories; `.tsx` probes were caught in `app`, `components`, `lib`, `types`, `scripts`, `generated`.
  - Malformed `.md`, `.yml` (including a workflow file), `.json`, `.css`, `.prisma` and `.sol` files: both exit 0.
  - Method note: a `.tsx` probe sharing a basename with a `.ts` probe in the same directory was hidden by TypeScript's extension preference; the round was repeated with unique names. Another counting grep matched nothing because of box-drawing characters and read 0 until rewritten. Silence is not a pass.

  → STATE S11 and AGENTS → Validation.
- **F5 — The contract ABI is maintained by hand in `lib/contract.ts`.** Nothing compares it with the compiled contract, and both changed in `a4154a1`. → STATE S3.
- **F6 — The phased plan lives only in gitignored `docs/`.** Tracked files no longer link to it; the README now points to its own "Phased application architecture" section. The plan's "Architecture revision" line read "23 September 2026" when read on 2026-09-23 and "24 September 2026" when read on 2026-09-24, with no change marker. This is one reason the plans are treated as below the code and CI in the source-of-truth order. → STATE S8, D12.

### Deliberately NOT done (⏸️)
- ⏸️ Did not install Foundry or GitHub CLI. Reason: a machine-wide toolchain install to diagnose F2 goes beyond setting up context files, and CI is the authoritative record for the suite (AGENTS override B).
- ⏸️ Did not run `auth:smoke`: Mailpit was not running, and the three CI-covered smokes did not need it.
- ⏸️ Did not run `npm audit` locally; CI's audit step on `a4154a1` succeeded.
- ⏸️ Did not edit the README (F3) or any code. Scope: this task only writes context files.
- ⏸️ Did not un-ignore or copy the `docs/` plans into git (Q4). Their essentials are mirrored into STATE (phase table) and DECISIONS (quoted rationale).
- ⏸️ Did not create `.ai/ISSUES.md`, `docs/plans/` or per-tool rules directories (Tier 1; see the Decisions log).

### Not verified by this session (so nobody reports it as done)
- The Foundry suite passing anywhere (F2).
- `auth:smoke` on `a4154a1`.
- Any browser, keyboard, mobile or second-device behaviour of the Phase 4 UI.
- Anything hosted: deployment, SMTP, bucket, scanner, backup/restore.
- Whether `lib/contract.ts` matches the compiled ABI (F5).
- Whether F1 is reachable.

---

## Decisions log

Append the day each call is made. The "why" is what a future reader cannot reconstruct from the code.

- **2026-09-22 — Diia deferred; both Diia routes return 501.** (Recorded only in the gitignored release plan; quoted in D4.) Why: the core application and infrastructure release comes first, and no screen or certificate may claim KEP signing without real signature verification.
- **2026-09-22 — The contract stores only the payload hash and IPFS URI.** (Gitignored release plan; quoted in D5.) Why: not duplicating `farmerId` on chain; the full record is read from IPFS. It requires a fresh deployment because the ABI changed.
- **2026-09-23/24 — The database-free shared-password pilot was rejected in favour of PostgreSQL, individual accounts, admin MFA, private evidence and a review console.** (Gitignored release plan, "Architecture revision"; its date changed between reads, F6.) Why, as recorded there: a shared password cannot identify who created, changed, approved or published a passport, and `sessionStorage` cannot provide cross-device recovery, review, revocation or an audit trail.
- **2026-09-23 — Prisma ORM 7, not 8.** (Gitignored database plan §1; quoted in D10.) Why: Prisma 8 was a release candidate.
- **2026-09-24 — Durable-context Tier 1 chosen: AGENTS.md, `.ai/PROJECT.md`, `.ai/STATE.md`, `.ai/DECISIONS.md`, `PROGRESS.md`.** Why:
  - **No Tier 2 register.** No finding has been lost because it lived in a chat log. What was at risk of being lost lived in gitignored local files, and Tier 1 fixes that by committing the essentials. The user also stated on 2026-09-24 that decisions are made by AI under the user's control, with no one else. A register partitioned by who can act would therefore have one section.
  - **No Tier 3 specs folder.** The phased plan already exists, and `docs/plans/` would sit inside the gitignored `docs/`.
  - **No Tier 4 rules folder.** `CLAUDE.md` imports `AGENTS.md`, so one file serves every tool.
  - **What would justify more:**
    - Tier 2: a finding lost from chat, or a second person or team owning decisions.
    - Tier 3: building without a tracked plan costs a rewrite.
    - Tier 4: an agent tool that does not read `AGENTS.md` starts working here.
- **2026-09-24 — The validation command table exists once, in `AGENTS.md`.** `PROJECT.md` points to it and results live only in STATE. Why: duplicated tables drift, and a stale second copy is worse than one copy.
- **2026-09-24 — Rationale that existed only in the gitignored plans was quoted into DECISIONS, instead of un-ignoring `docs/`.** Why: `.gitignore` marks `docs/` as local-only material (presentations, exports). The GitHub repository answered unauthenticated API requests, so it is publicly readable. Publishing internal plans with open security gaps is the user's call (Q4).
- **2026-09-24 — `npm run build` was run while the user's `next dev` server was running.** Why this was safe: the bundled Next.js 16 CLI docs say dev output goes to `.next/dev`, so dev and build can run concurrently (`node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md`).
- **2026-09-24 — The smokes were run against the already-running `next dev` server.** Why valid: that server serves the working tree, which was clean at `a4154a1` when the smokes ran, so the results describe that commit.
- **2026-09-24 — Two preferences from a local AI memory store were not written into the repository.** "Ignore `prototype.html`" is obsolete: the user confirmed no such file exists. "Always upgrade to the latest stable version" was not confirmed as a repository rule (Q5), and it would interact with D10's pin.

---

## Open questions

| Id | Question | Owner | Blocking? |
|---|---|---|---|
| Q1 | Which collected fields become public after approval, and what is the retention period? | User | **Yes**, blocks Phase 5 and any real data. No for current local work |
| Q2 | Hosting, managed PostgreSQL, private bucket, scanner and SMTP providers and regions | User | **Yes** for the Phase 3 hosted gate and release. No for local work |
| Q3 | Who is the initial admin, and who may publish Testnet records? | User | **Yes** for Phase 5. No otherwise |
| Q4 | Should `docs/DATABASE_AUTH_ADMIN_PLAN.md` and `docs/MVP_RELEASE_PLAN.md` be tracked in git (a `.gitignore` exception) or stay private? | User | No; the essentials are mirrored in STATE and DECISIONS |
| Q5 | Should "prefer the latest stable version of dependencies" be a repository rule? | User | No |
| Q6 | Which JS test harness? `node --test` with the existing `jiti` needs no new dependency. | AI decides, user controls | **Yes** for closing S2 |

## Blockers

- **B1 — CI red (S1, F2).** Unblocking requires the failing test's output: from the run 35979500952 log (repository-admin login) or from a local Foundry run. **Must NOT be done instead:**
  - deleting or skipping the failing test, or filtering it with `--no-match-test`
  - making the CI step non-blocking
  - reporting the contract as done because `forge build` succeeded
- **B2 — Publication (Phase 5).** Requires Q1 and Q3. **Must NOT be done instead:**
  - enabling the legacy `/api/mint` path with real keys
  - configuring `ADMIN_PRIVATE_KEY` on a web host (D3)
  - publishing the demo payload shape, which includes tax IDs, coordinates and cadastral numbers

---

## 2026-09-24 continuation — local fixes awaiting a clean CI run

- **Correction to F2:** ~~The failing Foundry tests are unknown, and Foundry has never run locally.~~ A portable Foundry binary in a temporary directory reproduced 20 passes and two failures. `test_GrantMinterRole` and `test_Mint_RejectsDuplicateHashDuringReceiverCallback` called `MINTER_ROLE()` after `vm.prank(admin)`, consuming the one-call prank before `grantRole`. Both tests now read the role before the prank. `forge test --root contracts -vvv` exits 0 with **22/22** passing on Windows 11. The contract source was not changed. The last pushed CI run is still red until a new commit is pushed and verified.
- **F1 / S2 closed locally:** `canonicalize` now serializes through JSON before sorting keys, so an object hashes the same before and after JSON transport. The new `node --test` regression in `tests/hash.test.mjs` failed both assertions against the old helper and passes **2/2** after the fix. The current mint route parses request JSON through a strict payload schema before hashing, so no present route-level exploit of the old `undefined` behavior was found. Q6 is settled with the existing `jiti` dependency; no new test framework was added.
- **F5 / S3 closed locally:** `scripts/check-contract-abi.mjs` compares the 21 manually declared ABI entries with the compiled Foundry artifact, including names, types, indexed event fields, outputs, and mutability. It exits 0 on the actual artifact. A temporary artifact with a changed `mintPassport` output is rejected with exit 1. The contract CI job now runs this check after `forge build`.
- **S10 closed locally:** Mailpit was started with `npm run dev:services:up`. `npm run auth:smoke` exits 0, covering signup denial, roles, ban, admin MFA, SMTP password reset, and session revocation; the smoke script removes its fixtures.
- **Correction to F3:** The README drift listed above was addressed: the stale contract-test pass claim, disabled-evidence wording, incorrect private-file storage claim, Pinata SDK description, incomplete structure tree, nonexistent `LICENSE` badge, and compiler-version badge. The README also now distinguishes the legacy public demo payload from the unapproved Phase 5 snapshot and replaces expired roadmap dates with gates. F3 is closed for these findings; marketing and legal claims were not revalidated here.
- **S4 remains open:** The in-app browser connection failed because the browser runtime's code path was rejected by its trust configuration. No visual, keyboard, or mobile pass was performed.
- **Validation on the working tree, Windows 11, 2026-09-24:** `npm run lint`, `npm run typecheck`, `npm run test:hash`, and `npm run build` exit 0. `forge build --root contracts`, `forge test --root contracts -vvv`, and `node --experimental-strip-types scripts/check-contract-abi.mjs` exit 0. The build initially hit a sandbox `spawn EPERM` at the worker stage; the unrestricted rerun completed. These are local results for uncommitted files; they do not change the conclusion of CI run 35979500952 on `a4154a1`.
- **Decision:** Keep the ABI comparison as a subset check because `lib/contract.ts` declares only the entries used by the app; the contract artifact also includes inherited methods and errors. Node 24's built-in TypeScript stripping reads this self-contained file in CI without installing web dependencies in the contract job.
- **F4 / S11 closed locally:** `npm run lint` now fails on any warning. `.mjs` files fail on undefined and unused variables; `npm run typecheck` fails on unused TypeScript locals and parameters. Two unused imports were removed from the existing UI. Baseline `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` failed on those two imports before removal. After configuration, stdin probes for an undefined `.mjs` identifier and an unused `.mjs` variable each exited 1, and a warning probe with `--max-warnings 0` exited 1. The final lint, typecheck, and build all exit 0 on Windows 11, 2026-09-24. Markdown, YAML, JSON, CSS, Prisma, and Solidity still require their own validators.

---

## 2026-09-25 — clean CI closes S1

- Commit `0a7764c` ("Fix contract test setup and harden release checks") was pushed to `origin/master`. It contains the contract test setup fix, JSON hash regression, compiled ABI comparison, stricter lint and TypeScript checks, and README corrections. The pre-existing durable-context files were kept separate for this verified handoff.
- [GitHub Actions CI run 36107136075](https://github.com/DarkPo13/hartolit-web3/actions/runs/36107136075) on `0a7764cd46018bad285f6493f51c65472d1a2a2d` completed `success` on 2026-09-25. Both `contract` and `web` jobs completed successfully. This closes S1 for that code commit; historical run 35979500952 on `a4154a1` remains failed.
- Local Windows 11 checks on 2026-09-25: `npm run lint` exit 0, `npm run typecheck` exit 0, `npm run test:hash` 2/2, and the ABI comparison exits 0 for 21 entries. The temporary Foundry binary from 2026-09-24 was unavailable, so the contract suite was not rerun locally on 2026-09-25; the clean CI contract job is the authoritative new result. The production build and auth smoke results remain those measured on 2026-09-24.
- Remaining gates: Phase 4 browser/keyboard/mobile acceptance (S4), Phase 3 hosted storage and restore (S7), and user decisions Q1–Q3 before controlled publication. No hosted app or contract deployment is claimed.
