# Decisions — index

**An index, never an authority.** Each entry cites where the real record lives; when this index and its source disagree, the source wins. Fix the index.

**Admission test:** an entry belongs here only if a competent fresh reader, seeing only the code, would plausibly UNDO the decision. Each entry names that wrong move. Where the repository does not record *why*, the entry says so; rationale is never invented. Some reasons were recorded only in the gitignored `docs/` plans (D12); those are quoted verbatim so they travel.

**Checks** are greps run from the repository root with an expected count, or named assertions in the smoke scripts. "refresh project context" re-runs them. A grep that returns a different count means the decision changed or the index is stale; find out which.

Ids are never reused. To retract an entry, strike it through in place with the date and what was checked.

---

### D1 — Demo mode needs BOTH `NODE_ENV=development` AND `NEXT_PUBLIC_DEMO_MODE=true`
- **Wrong move prevented:** treating the flag alone as the switch, or "enabling the demo" on a hosted build. That would let production return simulated tokens and mock CIDs.
- **Source:** `lib/demo-mode.ts`; README → "Testing Without a Wallet" ("Production builds ignore the demo flag").
- **Why:** README: production builds ignore the flag and keep write APIs disabled until the release gates are met.
- **Check:** `grep -rln NEXT_PUBLIC_DEMO_MODE app lib components` lists exactly 1 file, `lib/demo-mode.ts`.

### D2 — Legacy issuance routes return 503 outside demo mode, and demo mode refuses real credentials
- **Wrong move prevented:** "wiring up" `/api/mint`, `/api/ipfs/pin` or `/api/files/upload` by setting `ADMIN_PRIVATE_KEY` or `PINATA_JWT`. These routes are the prototype path, not the planned publication design (Phase 5).
- **Source:** `app/api/mint/route.ts` (refuses either credential); `lib/ipfs.ts` `pinJson` (throws when demo mode and a JWT are both present); `lib/demo-mode.ts` `DEMO_WRITE_UNAVAILABLE`.
- **Why:** README → "Local Setup" §4: "the unauthenticated demo refuses real credentials".
- **Check:** `grep -l "isDemoMode()" app/api/mint/route.ts app/api/ipfs/pin/route.ts app/api/files/upload/route.ts` lists 3 files; `grep -c "isDemoMode() && jwt" lib/ipfs.ts` = 1.

### D3 — No blockchain private key in the web environment
- **Wrong move prevented:** configuring `ADMIN_PRIVATE_KEY` on the web host so the server can mint.
- **Source:** README → "Local Setup" §3 ("a deployment-only input and must not be configured in the web host") and "Production Deployment Checklist".
- **Why (quoted from the gitignored database plan, §8):** "No web-hosted blockchain administrator private key. Use an approved operator wallet or a separately designed signing service with narrow permissions."
- **Check:** `grep -c "^ADMIN_PRIVATE_KEY" .env.local.example` = 0.

### D4 — Diia (KEP) is deferred; both Diia routes return 501
- **Wrong move prevented:** restoring the old mock signing, or showing "signed"/"KEP"/legal claims in the UI or certificate.
- **Source:** `app/api/diia/sign/route.ts`, `app/api/diia/verify/route.ts`; README → "Diia KEP Integration — deferred".
- **Why (quoted from the gitignored release plan, decision dated 2026-09-22):** "Diia is deferred until the core application and infrastructure are released. … No MVP screen or certificate may claim KEP signing."
- **Check:** `grep -c "status: 501" app/api/diia/sign/route.ts app/api/diia/verify/route.ts` gives 1 per file.

### D5 — The contract stores only `payloadHash` and the IPFS URI (no `farmerId`)
- **Wrong move prevented:** adding identifying fields back on chain "for convenience". Anything on chain is permanent and public.
- **Source:** `contracts/src/HartolitFieldPassport.sol`, changed in commit `a4154a1`.
- **Why (quoted from the gitignored release plan, decision dated 2026-09-22):** "The contract stores only the payload hash and IPFS URI instead of duplicating `farmerId`; the full public record is read from IPFS. A fresh contract deployment is required because the ABI changed."
- **Check:** `grep -c farmerId contracts/src/HartolitFieldPassport.sol` = 0.

### D6 — A write without an `Origin` header is rejected (403), not only a cross-origin one
- **Wrong move prevented:** "fixing" a 403 from a script or server-side client by allowing a missing `Origin`.
- **Source:** `lib/auth-guard.ts` `isSameOrigin`; `lib/drafts/http.ts` `draftActor` (also used by the review APIs).
- **Why:** not recorded in the repository beyond general CSRF/origin protection.
- **Check:** `grep -c "if (!origin) return false" lib/auth-guard.ts` = 1. Smoke assertions: `smoke-auth` → "write without origin denied"; `smoke-drafts` → "cross-origin create denied"; `smoke-evidence` → "cross-origin reservation denied".

### D7 — Every request re-reads the user row; the session's cached user is not trusted
- **Wrong move prevented:** removing the per-request `findUnique` as a "performance fix". A ban or role change would then not apply until the session expires.
- **Source:** `lib/auth-guard.ts` `getActor`, comment "Always use current database state so a ban or role removal applies immediately."
- **Check:** smoke assertion `smoke-auth` → "ban takes effect immediately".

### D8 — Enabling MFA deletes ALL of the user's sessions, including the one just issued
- **Wrong move prevented:** treating the forced re-login after enrollment as a bug.
- **Source:** `app/api/auth/[...all]/route.ts`, comment "Expire every earlier session, including that new cookie, so the next login proves both factors."
- **Check:** smoke assertion `smoke-auth` → "enrollment revokes old sessions".

### D9 — Only the read-only Better Auth admin user list is reachable
- **Wrong move prevented:** exposing mutating plugin routes that bypass the Phase 4 `AdminAction` audit, or impersonation and role changes.
- **Source:** `app/api/auth/[...all]/route.ts`: the allowlist contains only `GET /api/auth/admin/list-users`; everything else under `/api/auth/admin/` returns 404. Audited operator actions use `app/api/admin/users/`.
- **Why:** the Phase 4 console must attribute each account change and keep role changes outside this MVP UI.
- **Check:** the allowlist has 1 entry (count the `"GET /api/auth/admin/` and `"POST /api/auth/admin/` strings in that file). Smoke assertion `smoke-auth` → "unaudited create-user endpoint unavailable".

### D10 — Prisma ORM 7 is pinned, not 8
- **Wrong move prevented:** a routine "upgrade to latest" onto Prisma 8.
- **Source:** `package.json` pins `prisma` and `@prisma/client` to `7.10.0`.
- **Why (quoted from the gitignored database plan, §1, 2026-09-23):** "Prisma ORM 8 is currently a release candidate, so it should not be the first production dependency for this MVP."
- **Expiry:** re-evaluate when Prisma 8 is a stable release. Whether it is stable today was not checked.
- **Check:** `grep -c '"prisma": "7.10.0"' package.json` = 1.

### D11 — Client draft state uses tab-scoped `sessionStorage`; PostgreSQL is authoritative
- **Wrong move prevented:** switching the store to `localStorage` "for persistence". Private farmer data would then outlive the tab on shared devices, and the database would stop being the single source.
- **Source:** `lib/store.ts`; README → "Tech Stack", State row.
- **Check:** `grep -c "createJSONStorage(() => sessionStorage)" lib/store.ts` = 1; `grep -c localStorage lib/store.ts` = 0.

### D12 — `/docs/` is gitignored
- **Wrong move prevented:** citing a file under `docs/` as a source that a fresh clone will have; or un-ignoring `docs/` wholesale, which would publish local-only material (presentations, exports) to a public GitHub repository.
- **Source:** `.gitignore` line "# Docs (local-only; exported assets, PDFs, screenshots)" followed by `/docs/`; commit `b68d6b5`.
- **Consequence:** the phased plan and release plan currently live only there. Whether to track them is an open question in `.ai/STATE.md`.
- **Check:** `git check-ignore -q docs/any.md` exits 0.

### D13 — The server re-verifies evidence bytes; client-declared hash and type are never trusted
- **Wrong move prevented:** skipping the server-side re-download or scan to speed up uploads, or accepting the browser's SHA-256.
- **Source:** `lib/evidence/service.ts`: after a direct upload it re-reads the object and checks size, content type, SHA-256 and magic bytes (`validFileContent`), runs the ClamAV scan, then checks the final object metadata.
- **Check:** `grep -c "validFileContent(bytes, file.filename)" lib/evidence/service.ts` = 1. Smoke assertions `smoke-evidence` → "hash mismatch rejected", "malware test signature rejected".

### D14 — Passport content and status changes are version-checked conditional updates
- **Wrong move prevented:** replacing `updateMany({ where: { …, version } })` with a plain `update`. That silently loses concurrent edits and review decisions.
- **Source:** `lib/drafts/service.ts`, `lib/review/service.ts`, `lib/review/management.ts`, `lib/drafts/lock.ts` (comment: "The passport row is the serialization point for edits, evidence changes, and submission."). Evidence and archival operations can touch `updatedAt` to lock that row without changing the content version.
- **Check:** `grep -c "version: { increment: 1 }"` gives 1 in `lib/drafts/service.ts`, 4 in `lib/review/service.ts`, and 1 in `lib/review/management.ts`. Smoke assertions: `smoke-drafts` → "stale version rejected", "concurrent writes serialize"; `smoke-review` → "stale assignment rejected" and "admin edit invalidated operator draft version".

### D15 — Only the assigned reviewer can decide a passport
- **Wrong move prevented:** letting any MFA admin approve or reject. A reviewer must first assign the passport to themselves.
- **Source:** `lib/review/service.ts` `decideReview` returns 403 "This passport is assigned to another reviewer".
- **Why:** not recorded in the repository.
- **Check:** `grep -c "row.reviewerId !== adminId" lib/review/service.ts` = 1.

### D16 — An APPROVED passport can be recalled to CORRECTION_REQUIRED (before publication)
- **Wrong move prevented:** treating `APPROVED → CORRECTION_REQUIRED` as an invalid transition and "fixing" it.
- **Source:** `lib/review/service.ts` `decideReview`.
- **Why:** not recorded beyond the smoke assertion's wording.
- **Check:** `grep -c 'row.status === "APPROVED" && decision === "CORRECTION_REQUIRED"' lib/review/service.ts` = 1. Smoke assertion `smoke-review` → "approved passport can be recalled before publication".

### D17 — Hash the JSON value that survives transport
- **Wrong move prevented:** sorting an in-memory object directly before hashing. `undefined` fields and `Date` values then produce a hash that differs from the JSON later fetched for verification.
- **Source:** `lib/hash.ts` `canonicalize`; `tests/hash.test.mjs`.
- **Why:** minting and verification are separated by JSON storage and retrieval. The hash must describe the serialized value that can actually be published and fetched.
- **Check:** `npm run test:hash` asserts canonical bytes and SHA-256 equality before and after a JSON round-trip; it failed against the earlier implementation on 2026-09-24.

### D18 — Admin edits are draft-only and advance every linked passport version
- **Wrong move prevented:** editing farmer or field rows while a submitted or reviewed passport references them. That would silently change data after review.
- **Source:** `lib/review/management.ts` `editRecord` and `archiveRecord`; `lib/review/service.ts` `reopenPassport` checks archived records.
- **Why:** farmer and field rows are shared references inside a passport. A completed record can be archived without altering its historical content, but must be restored before a rejected or correction-requested passport can reopen.
- **Check:** `npm run review:smoke` asserts admin edits invalidate an operator's draft version, submitted details reject edits, submitted records reject archive, and completed records archive and restore with audit entries.

### D19 — Operator access changes use audited routes; admin roles stay outside the console
- **Wrong move prevented:** calling Better Auth's exposed create/ban/unban plugin routes from the browser, adding role changes to the UI, or sending a known temporary password to an invited operator.
- **Source:** `app/api/auth/[...all]/route.ts`, `app/api/admin/users/`, `lib/review/management.ts`, `AdminAction` in `prisma/schema.prisma`.
- **Why:** an invitation gives only the operator role, uses a random unknown password, and requests a password setup email. Disabling an operator also revokes their sessions. Admin accounts still require CLI setup and MFA.
- **Check:** `npm run auth:smoke` verifies invite email, password setup, denied plugin bypass, disable/enable, session revocation, and four admin action rows.

### D20 — CI verifies the production SMTP STARTTLS requirement
- **Wrong move prevented:** weakening `lib/reset-email.ts` production TLS enforcement to make a plain Mailpit service pass.
- **Source:** `.github/workflows/ci.yml` configures Mailpit with an auto-generated `localhost` certificate and required STARTTLS, then trusts that test certificate for the `next start` process. No private key is committed. [Mailpit's SMTP documentation](https://mailpit.axllent.org/docs/configuration/smtp/) describes its plain default and STARTTLS configuration; [certificate documentation](https://mailpit.axllent.org/docs/configuration/certificates/) describes `sans:localhost`.
- **Why:** the CI smoke runs against a production server. Default Mailpit does not advertise STARTTLS, but the production mailer requires it. The first Phase 4 CI web smoke failed; its detailed log required repository admin rights, so this is an evidence-backed diagnosis rather than a quoted assertion from that run.
- **Check:** local Nodemailer `requireTLS` verification failed with `ETLS` against default Mailpit and passed with a trusted temporary STARTTLS Mailpit certificate. [CI run 36123487787](https://github.com/DarkPo13/hartolit-web3/actions/runs/36123487787) passed the web and contract jobs after the fix, including `auth:smoke`.
