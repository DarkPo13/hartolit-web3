<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

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
- **Nothing private goes to IPFS or on chain.** A public snapshot must be built from an explicit allowlist that does not exist yet (Phase 5; the allowlist is an open decision in STATE).
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
| `npm run auth:smoke` | as above, plus Mailpit (`npm run dev:services:up`) | Not run by CI. |
| `npm run test:hash` | `npm ci` | Browser-specific crypto behavior or real IPFS and chain storage. |
| `npm run contracts:build`, `npm run contracts:test` | Foundry, plus `forge install --no-git OpenZeppelin/openzeppelin-contracts@v5.6.0 foundry-rs/forge-std@v1.16.1` run inside `contracts/` (`contracts/lib/` is gitignored) | Whether the hand-written ABI in `lib/contract.ts` matches the contract; the separate ABI check covers its declared subset. |
| `node --experimental-strip-types scripts/check-contract-abi.mjs` | Node 24+, compiled Foundry artifact at `contracts/out/` | Whether the app declares every compiled function; it checks the 21 entries actually declared in `lib/contract.ts`. |
| CI, `.github/workflows/ci.yml` (on every push) | a push to GitHub | Runs lint, typecheck, hash tests, build, `db:deploy`, the drafts/evidence/review smokes, `npm audit --omit=dev --audit-level=high`, ABI comparison, and forge build + test. Does not run `auth:smoke`, browser checks, or anything hosted. |

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
