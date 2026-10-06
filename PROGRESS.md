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
- **2026-09-25 — Record editing is draft-only and advances linked passport versions (D18).** Why: farmer and field rows are shared by passports; editing them after submission would change the reviewed record. Archive and restore preserve completed historical content, and a rejected passport cannot reopen while its records are archived.
- **2026-09-25 — Operator invitations and access changes use audited routes (D19).** Why: Better Auth's mutating admin plugin paths did not create `AdminAction` rows; the console now creates only operator accounts with unknown random passwords and setup email, and disabling one revokes sessions. Admin roles stay with CLI setup and MFA.
- **2026-09-25 — CI uses Mailpit STARTTLS with a trusted temporary certificate (D20).** Why: the production server requires TLS for SMTP, and the plain local Mailpit default does not provide it. Testing the production path keeps the TLS requirement intact.
- **2026-09-28 — Resolve the public-field part of Q1 first, then retention and Q3 individually.** Why: the user requested the next milestone one step at a time, and Q1/Q3 reserve these choices for the user. The README field matrix is a proposal, not an approved policy; no decision entry adopts it. Public labels/references, dose units and treatment timezones are absent from the current schema and must be explicit before publication.
- **2026-09-28 — The user approved the starting field policy and clarified the certificate's evidence purpose (D21).** Every public field must appear on the certificate and help reviewers assess proper treatment. Policies can evolve via new schema versions; published records retain their original contents and corrections require an explicit linked record. Private farmer/plot linkage, source evidence and product instructions are necessary for substantive review; matching hashes and existing completeness checks do not establish proper agronomy or payment entitlement. The retention periods prepared next remain a proposal.
- **2026-09-29 — The external consultation brief separates treatment records, the existing inventory/use journal, and future KEP documents.** Why: a certificate for one treatment does not include every inventory transaction or balance, and the earlier pilot/supplier signature concept signs different supporting documents. Official material already describes paper or electronic inventory journals; the consultation must establish the applicable requirements and document/signature model rather than assume a new permission or present an unsigned MVP as a certificate with two KEPs. D4 and D21 remain in force.
- **2026-10-03 — Keep admin previews tied to the selected passport, its version and both evidence files.** Why: a slow read-only request can resolve after navigation or a file change and otherwise display the previous snapshot under the current selection. Request identifiers ignore older responses; the UI also checks the preview identity before rendering. This remains a temporary preview and does not authorize publication.
- **2026-10-03 — Adopt V1 retention and one-wallet publisher rules as engineering defaults (D25).** Why: the user delegated the choice, and the farmer's claim-support purpose needs preserved source evidence. Legal/pilot review and concrete account/wallet configuration remain release gates; no automatic business deletion or publication is enabled.
- **2026-10-03 — Persist the reviewed public bytes before any publish path (D26).** Why: a later rebuild could differ from what the reviewer inspected. The approving reviewer confirms a selected, versioned preview; the server rebuilds and hashes within a passport-serialized transaction, and recall invalidates the record.
- **2026-10-04 — Keep private document authorization and missing-record checks ahead of streaming (D28).** Why: a same-segment `loading.tsx` flushed HTTP 200 before the server component could return a 307 login redirect or 404 for a recalled confirmation. The live smoke caught the mismatch; removing that loading boundary restored the expected status codes without weakening the admin/MFA guard.

---

## Open questions

| Id | Question | Owner | Blocking? |
|---|---|---|---|
| Q1 | Public fields approved (D21). V1 retention and preservation defaults adopted as an engineering target on 2026-10-03 (D25); what do Ukrainian counsel and the pilot organization require? | User with counsel/pilot | **Release gate.** Business deletion/notice/holds and matched restore are not implemented; legal/pilot review is pending |
| Q2 | Hosting, managed PostgreSQL, private bucket, scanner and SMTP providers and regions | User | **Yes** for the Phase 3 hosted gate and release. No for local work |
| Q3 | V1 rule: one designated MFA admin with an allowlisted operator wallet (D25). Which account and address will be designated? | User | **Release gate.** Exact identity/wallet and publish authorization remain unset; confirmation is bound to the approving reviewer |
| Q4 | Should `docs/DATABASE_AUTH_ADMIN_PLAN.md` and `docs/MVP_RELEASE_PLAN.md` be tracked in git (a `.gitignore` exception) or stay private? | User | No; the essentials are mirrored in STATE and DECISIONS |
| Q5 | Should "prefer the latest stable version of dependencies" be a repository rule? | User | No |
| Q6 | Settled 2026-09-24: use `node --test` with the existing `jiti`; no new dependency. | AI decides, user controls | No; S2 closed locally and in CI |

## Blockers from the 2026-09-24 snapshot (B1 resolved; B2 open)

- **B1 — Resolved 2026-09-25 (S1, F2).** The original failure was reproduced and fixed locally; later clean CI runs passed. The original unblocking requirement was the failing test's output, from run 35979500952 or a local Foundry run. The following shortcuts were rejected:
  - deleting or skipping the failing test, or filtering it with `--no-match-test`
  - making the CI step non-blocking
  - reporting the contract as done because `forge build` succeeded
- **B2 — Publication (Phase 5).** Requires Q1 legal/pilot release review, Q2 providers/regions and Q3 concrete admin/wallet identity, plus controlled publish implementation and acceptance. **Must NOT be done instead:**
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

---

## 2026-09-25 — Phase 4 local completion on the uncommitted working tree

- **S4 and S5 closed locally:** Added draft-only admin farmer/field editing with version increments and passport audit rows, archive/restore for completed records, duplicate warnings, operator invitation with unknown random password plus setup email, disable/enable and session revocation, a separate `AdminAction` audit, record search and UTC date filters. Mutating Better Auth admin plugin routes now return 404 so browser clients cannot bypass the audit path. Admin role creation/change stays outside the console; publication remains read-only. See D9 and D18–D19.
- **Migration:** `20260925090000_phase4_admin_actions` creates `AdminAction` and extends `AuditAction`. `npm run db:deploy` exited 0 against the local PostgreSQL database; the migration has not run in CI or hosted infrastructure.
- **Local validation, Windows 11, 2026-09-25:** `npm run db:generate`, `npm run lint`, `npm run typecheck`, and `npm run build` exited 0; the production build listed 37 routes. The first build attempt hit sandbox `spawn EPERM` after TypeScript compilation; the approved rerun exited 0. `npm run review:smoke` and `npm run auth:smoke` exited 0 after the final backend changes. The expanded smokes assert conflict handling, submitted-record immutability, audit/date filtering, invitation email and password setup, operator disable/enable and session revocation. Fixtures and Mailpit messages were removed.
- **Browser pass:** The in-app browser still rejected its runtime dependency as untrusted. A separate temporary local Chrome profile rendered the admin console at desktop and 390px, switched Ukrainian/English, opened and edited a farmer through the form, checked keyboard navigation, empty/list/error states, and opened the invitation/audit tabs. No horizontal overflow at 390px. Temporary browser profile, screenshots, scripts and fictional fixture accounts were removed. This is not a real-device or hosted pass.
- **CI boundary:** `.github/workflows/ci.yml` now includes Mailpit and `auth:smoke`, but no clean-runner result covers these uncommitted Phase 4 changes. The last verified pushed code result remains CI run 36107136075 on `0a7764c`.
- **Open release gates:** Q1–Q3 (public-field scope, providers, Testnet publisher), hosted Phase 3 storage and backup/restore (S7), and hosted/real-device acceptance (S9). No real customer data, IPFS publication, contract deployment or Diia claim is authorized by this local pass.

---

## 2026-09-25 — Phase 4 pushed and clean CI verified

- Implementation commit `da38758` was pushed. [CI run 36122301671](https://github.com/DarkPo13/hartolit-web3/actions/runs/36122301671) passed the contract job but failed the web job at the shared live-smoke step; earlier lint, typecheck, hash, build, migration and service setup steps passed. The detailed log API returned 403 because repository admin rights are required, so the exact failed assertion was not readable.
- The production mailer requires STARTTLS, while default Mailpit advertises none. Local Nodemailer verification against default Mailpit failed with `ETLS`; against a temporary Mailpit service with STARTTLS and a trusted test certificate it passed. This supported the CI diagnosis without weakening the production mailer. The temporary service and certificate were removed.
- Follow-up commit `513bf88` configures Mailpit STARTTLS in CI and trusts its generated certificate for `next start`. [CI run 36123487787](https://github.com/DarkPo13/hartolit-web3/actions/runs/36123487787) completed **success** on 2026-09-25 with both `web` and `contract` jobs passing. The web job includes the four live smokes, `db:deploy`, lint, typecheck, hash, build and dependency audit. The contract job includes Foundry build, 22 tests and the ABI comparison.
- Handoff checks on Windows 11, 2026-09-25: lint, typecheck, hash tests, build (37 routes), Prisma validate and migration status (seven migrations), and each draft/evidence/review/auth smoke exited 0. CI YAML parsed successfully; `git diff --check` exited 0. A one-line UI error-state correction was typechecked and passed in the clean CI run. No hosted, real-device, backup/restore, publication, contract deployment or Diia acceptance is claimed.
- The tracked README, PROJECT, STATE, DECISIONS, AGENTS and PROGRESS files carry the handoff. The two full plans in gitignored `docs/` remain local by D12; Q4 is still the user's choice. Check the current HEAD's CI separately after the documentation commit.

---

## 2026-09-28 — Phase 5 first step: public-field proposal

- Re-read the repository context and compared it with the current Prisma models, draft DTOs, review service, legacy payload and public verifier. `master` was clean at `4a4a8b2` before this work; no publication builder or real publication service exists. Phase 4 remains the latest runtime implementation.
- Added the proposed public/private field matrix and implementation gates to tracked README so a fresh clone can review them. The proposal uses explicitly confirmed public farm labels and random field/certificate references, selected treatment/weather/chemical facts, and server-verified hashes for the selected weather and chemical evidence. It excludes private identifiers, precise locations, personal details, notes, audit data and file access. Even permitted text needs review; evidence digests can link identical files.
- Found concrete data gaps: the UI labels dose as "L/ha or kg/ha", but `ChemicalApplication` stores no unit; `Treatment` stores local date/time without a timezone. Proposed public farm labels and field references also need explicit storage. Do not infer any of these from private identifiers or existing drafts.
- **Pending:** user approval or amendments to the public fields. Retention and publisher decisions remain open and follow separately. The legacy demo and certificate/viewer schema must not become the real public payload. No publication code, migration, deployment, commit or push was performed.
- **Validation, Windows 11, 2026-09-28:** `git diff --check` exited 0. The documentation checks exited 0 for the proposal heading, Q1–Q3 definitions, balanced code fences and STATE length (90 lines). The added-line scan for machine paths, private-network addresses, credentials and private keys exited 0 after fixing a false match on an official HTTPS URL; four in-memory negative controls were detected and the public URL was accepted. These checks do not validate application behavior or guarantee that every form of secret is detected. Application lint, typecheck, build, runtime smokes and CI were not rerun because only Markdown changed. The application results recorded in STATE remain dated 2026-09-25.

## 2026-09-28 — Public scope approved; certificate purpose and retention proposal

- The user approved moving forward with the starting public-field plan, allowed future changes, and identified the primary purpose: evidence that helps organizations assess whether a farmer's treatment was proper when crop damage or other losses lead to a claim. Recorded D21 and updated README, PROJECT, STATE and AGENTS to reflect that approval. The generated Next.js block in AGENTS is unchanged.
- Added requirements to display every public field on the certificate and verifier, retain historical schema interpretation, make corrections through explicit linked records, bind public labels to private farmer/plot identity, and preserve original evidence. These are requirements for implementation, not implemented or insurer-approved behavior.
- Rechecked `missingForSubmission` in `lib/review/service.ts`: it validates required values and verified attachments, with no product-instruction comparison. `Field.areaHectares` represents field area, with no separate treated-area measurement. A truthful certificate must not turn these existing checks into a statement of proper dosage, complete plot coverage or full-season care. Product instructions/recommendations and coverage evidence must support any substantive assessment.
- Used the official EU plant-protection record format as a design reference for dose units, crop, timing and treated-area traceability; no claim of Ukrainian legal compliance or insurer acceptance is inferred. Acceptance still needs a sample reviewed by the selected pilot organization.
- Prepared a separate, unapproved retention proposal: five years for finalized records and original evidence, 90-day inactive never-submitted drafts with notice, explicit claim/dispute preservation holds, and a 30-day matched-backup target. These are product defaults for discussion, not legal minima. `scripts/prune-evidence.mjs` handles stale upload/scan/rejected objects only; no business retention or holds exist. No record or object was deleted.
- **Validation, Windows 11, 2026-09-28:** `git diff --check` exited 0. Documentation checks exited 0 for balanced code fences, the approved policy/purpose/versioning/retention sections, the three D21 section counts, Q1–Q3 definitions, every decision ID referenced in STATE, and an added-line scan for machine paths, private-network addresses and common credential patterns. STATE is 91 lines. The generated Next.js block in AGENTS matches the HEAD blob byte-for-byte (Python check exit 0). These checks do not establish runtime enforcement, insurer acceptance or exhaustive secret detection. Runtime tests and CI were not rerun because only Markdown changed. No runtime code, migrations, deployed resources or git history were changed; no commit or push was requested.

## 2026-09-29 — Ukrainian legal/regulatory consultation package

- Prepared `docs/HARTOLIT_REGULATORY_BRIEF_UA.md`, `docs/HARTOLIT_REGULATORY_MESSAGE_UA.md`, and a two-page `output/pdf/HARTOLIT_REGULATORY_BRIEF_UA.pdf` for forwarding by the user. The Markdown copies are gitignored under D12; the PDF is an untracked local artifact. No external message was sent and no commit/push was requested. The six pre-existing modified context files were preserved.
- Checked current schemas, review completeness rules, the contract source, demo issuance guard and deferred Diia routes against the brief. The text distinguishes implemented local accounts/drafts/evidence/review from planned public snapshots, issuance, recipient evidence access and future KEP. It also distinguishes hashing the public summary from proving every private original or establishing agronomic correctness.
- The official Держпродспоживслужба inspection checklist describes paper/electronic inventory journals and receipts, use, sales and balances. An indexed official Rada text for resolution 722 of 2016 confirms its electronic-form amendment to the procedure. The brief therefore asks which journal requirements and additional functions apply; it does not assert our treatment certificate replaces the whole journal. Full Rada law pages were unavailable to the browsing tool, so the electronic-document/signature laws are consultation references rather than a claimed legal opinion. No court, insurer, foreign buyer or agency acceptance is asserted.
- **Validation, Windows 11, 2026-09-29:** ReportLab generation exited 0. PyMuPDF rendered both final pages, which were visually inspected for Cyrillic text, readable layout, headers/footers, links and section transitions. Artifact QA exited 0 for the two-page count, every source text unit, five matching source hyperlinks, Cyrillic extraction, replacement characters, page bounds and a scan for private machine data. The initial three-page draft had a sparse middle page; the text was tightened and spacing adjusted before the final two-page check. An initial paragraph-comparison check incorrectly joined a bullet block; checking each list item resolved that validator mismatch. No application tests, build or CI were rerun because runtime code was unchanged.
- `git diff --check` and Markdown checks exited 0; STATE is 93 lines and both new Markdown files were confirmed gitignored. Temporary PDF builder, rendered images and workspace-only Python libraries were removed after verification; the final PDF and both source/message Markdown files remain.
- Retention (remaining Q1), publisher access (Q3), hosting (Q2) and release gates remain open. The consultation package is supporting work for these milestones, not a deployed or legally recognized passport.

## 2026-10-02 — Phase 5 first data-capture slice: chemical dose unit

- Added a nullable Prisma `DoseUnit` enum and a new migration. Signed-in draft DTOs, save/load mapping, form selection and admin details now carry `L_PER_HA` or `KG_PER_HA`; review submission reports `chemicalDoseUnit` when missing. Existing rows remain unknown rather than getting an invented default (D22). The legacy demo issuance payload remains unchanged and disabled for real data.
- Extended fictional draft and review smokes to assert invalid units are rejected, saved units persist, and missing units block submission. Local Docker services started, the new migration applied with `npm run db:deploy` exit 0, and `drafts:smoke` and `review:smoke` each exited 0. Their fictional fixtures were removed by the scripts. Browser UI and hosted behavior remain unverified.
- Windows 11: `npx prisma validate`, `npm run db:generate`, `npm run lint`, `npm run typecheck`, `npm run db:deploy`, `npm run drafts:smoke`, and `npm run review:smoke` exited 0. The first sandbox runs of `test:hash`, `build` and `dev` hit `spawn EPERM` or blocked Google Fonts. Rerun outside that restriction: `test:hash` passed 2/2, `build` completed with 37 routes, and `dev` started at `http://localhost:3000`; an HTTP GET to `/login` returned 200. `git diff --check` exited 0 after the documentation updates. No commit, push, real publication, or real customer data.
- Next: add the remaining explicit publication facts and allowlisted versioned snapshot. Private retention (Q1) and publisher identity (Q3) remain required before publication.

## 2026-10-02 — Phase 5 second data-capture slice: public references and treatment scope

- Added `Passport.publicFarmLabel`, DB-generated unique `Field.publicReference`, and nullable `Treatment.timeZone`/`treatedAreaHectares`. The label is entered separately from the legal name; a draft API caller cannot set or change the random field reference. Existing treatment facts stay unknown. The signed-in form and admin details display the new values in both languages; the legacy demo payload parser and builder omit them. Submission requires label, supported named time zone and positive treated area no greater than field area. Draft validation rejects more than four area decimals so storage cannot silently round a claimed area (D23).
- `prisma migrate dev` could not run in a noninteractive terminal. Generated SQL with `prisma migrate diff --from-config-datasource --to-schema` into a new migration, inspected its additive statements, then applied it with `npm run db:deploy`; exit 0. `npx prisma migrate status` found nine migrations up to date and a follow-up model diff found no difference. The local migration assigned independent random references to existing fields; it did not fill missing labels, zones or treated areas.
- The first draft smoke saw an undefined reference from the previously running dev server after Prisma regeneration. Restarted only that dev server; `drafts:smoke` and `review:smoke` then exited 0 against the new code and local services. Smokes check invalid zones, unknown client-supplied field references, saved values, reference stability, missing public label/time zone/treated area, over-area rejection and admin detail values. The later four-decimal validator also passed `drafts:smoke` (exit 0). Fictional fixtures were removed by the scripts.
- Windows 11: `npx prisma validate`, `npm run db:generate`, `npm run lint`, `npm run typecheck`, `npm run build` (37 routes), `npm run db:deploy`, `npx prisma migrate status`, database-to-model diff, `drafts:smoke` and `review:smoke` exited 0. The in-app browser setup rejected a trusted code dependency, so no visual, keyboard or mobile browser pass was made for this slice. No hosted test, CI result on the working tree, commit, push or publication.
- The approved public-field table contains field area but omits treated area while the certificate purpose calls for showing coverage. Treated area is captured privately now; adding it to the public snapshot awaits the user's explicit answer. Private retention and publisher access are still open. Next technical step after that answer: strict versioned public schema, allowlisted builder and exact preview.

## 2026-10-02 — Phase 5 public-scope amendment and read-only preview

- The user explicitly approved displaying treated area in hectares. Added it to the README public-field table and recorded D21/D24. The private-data retention (remaining Q1) and publisher access (Q3) decisions remain open.
- Added a strict `hartolit.field-passport.public` `2.0.0` schema distinct from legacy demo `1.0.0`, with normalized crop/treatment categories, separate field and treated areas, explicit units and time zone, nullable missing optional facts, and exactly two source-file digests. An allowlisted server query and builder select only approved fields; the MFA-admin route requires an approved, unpublished passport and explicit `READY` weather and chemical files. It returns canonical JSON and SHA-256. Every preview generates temporary ID/timestamp metadata and writes nothing, so it is not a publication commitment (D24).
- Added a bilingual admin preview with readable sections for every public field, the verification appendix and exact canonical JSON. Submission now rejects unsupported crop/treatment categories and missing weather measurement time; the signed-in weather form captures the source's UTC measurement time explicitly. Free public text still requires human review before any release.
- **Validation, Windows 11, 2026-10-02:** `review:smoke`, `test:public`, `lint`, `typecheck` and the production `build` exited 0 after the code changes; build listed 38 routes. The first build ran in the restricted sandbox, compiled, then hit `spawn EPERM`; the approved rerun completed. The live smoke uses fictional records and checks authorization, source-kind validation, public area, expected key shape, strict unknown-field/version rejection, private markers excluded from the serialized response, selected verified digests and hash equality after JSON transport. The rendering test checks that readable sections show every version `2.0.0` scalar without relying on the raw JSON section. Temporarily omitting treated area made it fail with "missing readable public value: 10.25"; restoring that field passed. Fixture rows and objects were cleaned up. No visual/keyboard/mobile browser pass, hosted verification or Phase 5 CI result existed at this local check. Confirmation, public verifier, IPFS and chain publication remain absent.
- **Push preparation, Windows 11, 2026-10-02:** Fresh `lint`, `typecheck`, `test:hash` (2/2), `test:public` (1/1), Prisma validation, live draft and review smokes, and production build (38 routes) exited 0. The smokes cleaned their fictional fixtures. This is local validation; browser, hosted and clean-runner CI acceptance for the new commit remain unverified until run separately.

## 2026-10-03 — Continue Phase 5 with CI repair deferred

- Commit `aab771f` is on `master`. [CI run 37028448665](https://github.com/DarkPo13/hartolit-web3/actions/runs/37028448665) failed the web job at `npm audit --omit=dev --audit-level=high`; the contract job passed. The local audit reproduced exit 1 with one critical Next.js advisory for locked `16.3.5` and 23 moderate advisories. The upstream advisory lists `16.3.6` as patched. The user requested that dependency repair happen later; it remains a release gate.
- Asked the user to approve or amend the README private-data retention proposal (remaining Q1). That answer was pending when this local UI slice was completed. Publisher access (Q3) and real publication remain undecided and disabled.
- The admin console now discards late detail and preview responses and renders a preview only when its passport ID, version and two selected evidence IDs match the current view. Switching records or source files clears the preview and its pending state. No server publication route or schema was changed.
- **Validation, Windows 11, 2026-10-03:** `npm run lint` and `npm run typecheck` exited 0. `npm run test:public` initially stopped at sandbox `spawn EPERM` before assertions; the approved rerun passed 1/1. Browser setup failed before connection, so the request-race interaction has no browser pass. The public rendering test covers field display, not this race. The unrelated untracked consultation PDF remains untouched. No commit or push was requested for this slice.

## 2026-10-03 — V1 policy defaults and private snapshot confirmation

- The user delegated the V1 retention/publisher choice. Adopted five years for finalized private treatment/evidence records, a 90-day inactive never-submitted draft target with notice, explicit claim holds, and a 30-day matched DB/object backup target as **engineering defaults** (D25). These are not asserted as Ukrainian legal minima. Counsel and pilot-organization review, notice/hold/deletion workflows and tested backup restore remain release gates. The initial Testnet publisher is one designated MFA admin using an allowlisted operator wallet; the concrete account and wallet remain to be set. No server wallet key is permitted.
- Added an additive Prisma migration and private confirmation route/model. The approving MFA reviewer checks the exact preview and opts in; the server serializes confirmation against recall, rebuilds the same versioned allowlisted payload, compares its hash and stores canonical bytes, selected source IDs, reviewer, time and audit atomically. A repeat of the same request is idempotent, a different snapshot conflicts, and recall invalidates the confirmation (D26). This does not issue a certificate or publish anything.
- Extended the fictional review smoke for access, origin, stale/changed inputs, exact database bytes, idempotence, audit and recall invalidation. The local Docker engine was initially unavailable; the migration and live smoke must be run before marking this slice accepted. Preserve the unrelated untracked consultation PDF and the preceding admin-preview race fix. No commit or push was requested.
- **Validation, Windows 11, 2026-10-03:** Prisma validation and client generation, lint, typecheck, hash tests (2/2), public rendering test (1/1, including the saved-state disclaimer), production build (39 routes), smoke-script syntax check and `git diff --check` exited 0. The initial sandbox runs of tests/build failed before assertions or compilation due to Node worker `spawn EPERM` and Google Fonts access; outside-sandbox reruns passed. Docker Desktop's Linux engine pipe stayed unavailable even after launch and a service-start attempt, so the tenth migration was **not applied locally** and the expanded live review smoke was **not run**. No browser, hosted or clean-runner CI result exists for the working tree. The user-deferred dependency audit failure remains open.

## 2026-10-03 — Handoff without commit or push

- Reviewed the tracked diff and untracked paths. The uncommitted app work contains the prior admin-preview request identity fix and the current private confirmation model/migration, route, UI, translations and smoke assertions. Policy/context updates describe the chosen V1 engineering defaults and their release gates. The pre-existing untracked consultation PDF in `output/pdf/` is unrelated and untouched. No file was staged, committed or pushed; this working tree will not travel to a fresh clone.
- **Fresh handoff validation, Windows 11, 2026-10-03:** unpiped `npm run lint`, `npm run typecheck`, `npx prisma validate`, `node --check scripts/smoke-review.mjs` and `git diff --check` each exited 0. `docker compose ps` exited 1 because the Linux engine pipe was absent; `db:deploy`, migration status, the expanded `review:smoke` and admin browser interaction were **not run**. The successful build, hash test and public rendering test from the preceding slice still apply to unchanged runtime code. ~~S11 tracks the live confirmation gate and S10 the dependency audit failure.~~ **2026-10-03 correction:** S10/S11 were used for older closed items; current gates are S13/S12 respectively.

## 2026-10-03 — Push handoff preparation

- The user requested a commit and push after the local handoff. Rechecked the branch, tracked changes and untracked paths; the intended package is the prior admin-preview race fix plus the Phase 5 confirmation code, migration, tests and updated durable context. The consultation PDF remains unrelated and excluded. Corrected the new open-item IDs to S12/S13 because historical S10/S11 were already assigned to closed 2026-09-24 work; older entries remain intact.
- Fresh lint, typecheck, Prisma schema validation, smoke-script syntax and diff-whitespace checks exited 0 on Windows 11. The Docker engine is still unavailable, so migration application and live review smoke are **not run** for this slice. Prior passing build, hash and rendering tests cover the unchanged runtime code. The known dependency audit failure is still a release gate and was deferred by the user.

## 2026-10-04 — Prepare the CI audit repair

- The user reprioritized the failed pipeline. GitHub Actions run 37144642862 for `b81cd36` passed all web steps through database deployment and the live draft/evidence/review/auth smokes, plus the contract job, then failed the production dependency audit. The repository has one CI workflow and no deployment workflow; hosting/provider selection is still Q2.
- The previous lockfile reproduced the gate failure: one critical Next.js advisory and 23 moderate production advisories. The current Next.js security release recommends `16.3.8`; updated `next`, `@next/env` and `eslint-config-next` together, with a regenerated lockfile. No workflow YAML or application code changed. The new lockfile's `npm audit --omit=dev --audit-level=high` exits 0; 23 moderate production advisories remain below the configured threshold. A separate full-tree audit exits 1 with five high advisories in the development ESLint/glob dependency chain; the configured CI gate omits dev dependencies.
- **Validation, macOS, Node 26.4.0/npm 11.17.0:** `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:hash` (2/2), `npm run test:public` (1/1), production `npm run build` (39 routes), the production audit gate and `git diff --check` exited 0. Docker daemon was unavailable, so local service smokes were not run. The changed lockfile had no clean-runner CI result at this local check.

## 2026-10-04 — Close the local confirmation browser gate

- After the dependency repair was pushed as `378ada3`, CI run 37191462865 completed successfully for both web and contract jobs, including the production audit. The user requested the next browser and E2E pass. Started fresh local PostgreSQL, Mailpit, SeaweedFS and ClamAV containers, generated ignored local credentials, configured the private bucket, applied all ten migrations and confirmed migration status. A production build exited 0 with 39 routes.
- Against the production server, `drafts:smoke`, `evidence:smoke` and `review:smoke` each exited 0. The review smoke checks exact canonical confirmation bytes and hash in PostgreSQL, idempotence, audit and recall invalidation. A temporary fictional approved passport and MFA admin supported a Playwright-controlled Google Chrome pass at 1440×900 and 390×844: anonymous admin redirect, MFA login, source selection, late preview discarded after changing a source, readable public facts, opt-in confirmation, persisted exact bytes after reload, no horizontal mobile overflow, and recall. Both screenshots were visually inspected; no browser page errors occurred. The first two browser harness attempts stopped on locator expectations; correcting those selectors produced a complete pass without changing application code.
- The first `auth:smoke` found no invitation message because the local setup's SMTP host `127.0.0.1` did not match Mailpit's temporary `localhost` STARTTLS certificate. Restarting the production server with `SMTP_HOST=localhost` and the certificate in `NODE_EXTRA_CA_CERTS` made the auth/invite/reset smoke exit 0. This was a test configuration mismatch, not an app code change. A read-only DB check found zero fictional users, passports and evidence files after the smokes. The temporary browser fixture script was removed; test containers were stopped and volumes retained. Browser automation was temporary and is not a CI step; hosted and real-device checks remain open.

## 2026-10-04 — Operator capture browser follow-up

- Restarted the local services and production server. A temporary fictional operator account and Playwright-controlled Chrome flow exercised the signed-in form: public farm label, treatment time zone and treated area, UTC weather measurement time, dose unit, versioned autosave, two browser uploads through SeaweedFS and ClamAV, reload, 390px layout, and submission. The final persisted draft had all expected facts, both evidence files were `READY`, the passport became `SUBMITTED`, and no browser page errors or horizontal overflow occurred. The fixture, its DB rows and S3 objects were removed.
- The first harness attempts checked the initial autosave before the later fields settled. Network tracing showed a second versioned save with the expected values; polling the exact draft ID returned by creation made the assertion reliable. Repeated sign-ins reached the app's local five-per-15-minute rate limit; a fresh fictional client IP let the final run complete. No application code was changed. Hosted, real-device and CI browser checks remain open.

## 2026-10-04 — Pre-release audit and handoff

- Audited the API route guards, public reads, capture flow, CI, dependencies and release state. The legacy public API and verifier accepted the demo `1.0.0` schema, which includes private farmer/field facts. Configuring a production contract could have exposed that payload. Decision D27: both routes now fail closed outside local demo mode; the new public verifier must consume only confirmed `2.0.0` bytes. Added a production HTTP check to CI. Updated page metadata and English/Ukrainian release text so they do not claim issuance or legacy public verification is live.
- Browser testing exposed a signed-in capture UX bug: card completion reused demo requirements for private details and file references, leaving valid signed-in sections incomplete. Added capture-specific completion checks and a focused regression test. Number inputs arrive as strings before persistence, so the indicator normalizes those values. A production Chrome pass with fictional data confirmed all four cards complete, auto-advance, server persistence, 390px layout, and no page errors or horizontal overflow; the temporary account and draft were cleaned. The local production public-route check passed (404/503).
- Updated Nodemailer to `10.0.14` after checking its release/security information. The production dependency audit moved from 23 to 22 moderate advisories with no high/critical finding. Five high advisories remain in development-only ESLint/glob dependencies with no patched `braces` version available at this check; they are outside the configured production audit gate. The webpack build, lint, typecheck, Prisma validation, hash/public/capture tests and live review/auth smokes passed locally. The default Turbopack build could not bind/create a process in the local sandbox, and Foundry was unavailable locally; the new GitHub run is the clean-runner gate. Hosting, certificate, public verifier, controlled publication, retention operations, backup/restore, legal/pilot review and real-device acceptance remain open.
- Commit `9263277` was pushed to `master`. [CI run 37208962308](https://github.com/DarkPo13/hartolit-web3/actions/runs/37208962308) completed success: web `npm ci`, lint, typecheck, hash/public/capture tests, default build, migration, live public-boundary/draft/evidence/review/auth checks and production audit; contract Foundry build, ABI comparison and tests. This resolves the preceding clean-runner uncertainty. A documentation-only follow-up records the result in STATE.

## 2026-10-04 — Private certificate and saved-snapshot verification views

- Added MFA-admin-only `/admin/passports/[id]/certificate` and `/admin/passports/[id]/verification` pages. Each loads only an active confirmed `2.0.0` snapshot through the existing integrity-checking service, renders all public fields with the shared readable renderer, and states that issuance and publication have not occurred. The verification wording is limited to the saved JSON/hash; it does not claim chain or agronomic verification (D28). The admin confirmation panel links to both pages. Recall makes both unavailable through the existing active-confirmation rule.
- Extended the public rendering test to assert scalar coverage and unissued/unpublished wording in both pages' shared document view. Extended the fictional review smoke to check anonymous/operator denial, no view before confirmation, saved values and no private marker after confirmation, and closure after recall.
- **Validation, Windows 11, Node 26.1.0:** `npm ci` aligned local dependencies with the lockfile. `npm run lint`, `npm run typecheck`, `node --check scripts/smoke-review.mjs`, `npm run test:public` (1/1), `npm run build` (41 routes) and `git diff --check` exited 0. A production server returned 307 to `/login` for anonymous requests to both pages. The restricted sandbox blocked the initial test worker (`spawn EPERM`) and Google Fonts fetch; outside-sandbox reruns passed. Docker Desktop's Linux engine was unavailable and its Windows service could not be started; the expanded signed-in smoke and browser pass were not run. No CI result exists for this uncommitted slice. The unrelated untracked `output/` artifact was untouched.

## 2026-10-04 — Complete local certificate-view acceptance

- Started Docker Desktop outside the restricted workspace sandbox, then PostgreSQL, Mailpit, SeaweedFS and ClamAV. Configured the local private bucket and applied the tenth committed migration with `db:deploy` exit 0. The first expanded `review:smoke` exited 1: an anonymous certificate request returned streamed HTTP 200 instead of 307. Next.js 16's local `loading.tsx` guide confirms that a same-segment loading boundary sends 200 before later redirect/not-found content. Removed that boundary (D28), rebuilt the production app (exit 0, 41 routes), and reran `review:smoke` successfully. It checks MFA/admin access, absent confirmations, exact saved values, private-marker exclusion, and 404 after recall.
- A temporary fictional review fixture and Playwright-controlled local Chrome pass at 1440×900 and 390×844 covered anonymous and operator denial, admin email/password plus TOTP login, Ukrainian/English text, certificate and verification links, stable ID/hash after reload, private-marker exclusion in HTML, and the missing-record screen after recall. There were no page errors or horizontal overflow. The first browser assertion used CSS-transformed `innerText` for the uppercase status badge and failed; reading `textContent` fixed the harness. Desktop and mobile screenshots were visually inspected and showed all public fact groups without clipping.
- The fixture smoke completed its database/object cleanup with exit 0. Temporary browser scripts, credentials file, screenshots and temporary browser tooling were removed. The production server and only the four test containers were stopped; Docker volumes were retained. No commit or push occurred, so there is no CI result for this working tree. Hosted and real-device acceptance still need a deployed pilot.

## 2026-10-05 — Private-view handoff and push preparation

- Reviewed the full tracked diff and new admin page files. The package is limited to the private confirmed-snapshot document views, links, translations, focused tests and durable context. The untracked regulatory consultation PDF in `output/` is unrelated and excluded. The existing `Publication` Prisma model is only a skeleton; controlled publication, issued certificates and a safe public `2.0.0` verifier remain the next implementation work. The open S6/S7/S8/S9 rows and their unblockers remain accurate.
- **Fresh validation, Windows 11:** unpiped `npm run lint`, `npm run typecheck`, `npm run test:public` (1/1), `node --check scripts/smoke-review.mjs`, `npm run build` (41 routes) and `git diff --check` each exited 0. The first sandbox test and build attempts stopped at Node worker `spawn EPERM`; outside-sandbox reruns passed. The migrated `review:smoke` and Chrome checks passed on 2026-10-04 and were not repeated because the application code has not changed. Hosted and real-device checks remain open. The pushed commit's clean-runner CI result must be checked separately.

## 2026-10-06 — Push the handoff and repair its production audit gate

- Pushed private-view commit `418db6f` to `master` with the existing repository owner's HTTPS credential. [CI run 37483397365](https://github.com/DarkPo13/hartolit-web3/actions/runs/37483397365) passed the contract job and every web step through the production build, migration and live smokes, then failed the production audit. The audit identified high-severity GHSA-68fv-2mgg-jv7q in locked transitive `source-map-js@1.2.1`.
- Updated only the `source-map-js` lockfile entry to patched `1.2.2`; `@tailwindcss/node` and `postcss` resolve it without a direct dependency or manifest change. **Validation, Windows 11:** `npm ci`, unpiped `npm audit --omit=dev --audit-level=high` (zero high/critical), `npm run build` (41 routes) and `git diff --check` exited 0. The separate full-tree install audit still reports five high development-dependency advisories; this CI gate intentionally omits dev dependencies. The unrelated untracked `output/` PDF remains excluded. The repair's clean-runner result still needs verification after push.
- Pushed `3cd9b0b`. [CI run 37484915450](https://github.com/DarkPo13/hartolit-web3/actions/runs/37484915450) again passed the contract job and the web application checks, then failed the audit. Its full log endpoint returned 403; a fresh local production audit reproduced the new high-severity GHSA-wq5f-xc86-pv6w in Next.js's transitive `sharp@0.35.4`. The advisory was updated on 2026-10-06 and lists `0.35.5` as patched.
- Updated only the lockfile's Sharp family to `sharp@0.35.5`, matching platform binaries and libvips `1.3.4`; this is needed for the corrected Linux image library, and does not add a direct dependency. **Validation, Windows 11:** `npm ci`, unpiped production audit (exit 0, zero high/critical), `npm run build` (41 routes), and `git diff --check` exited 0. A new clean-runner result is required before treating the dependency gate as closed.
