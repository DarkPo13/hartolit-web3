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

### D21 — Public certificates support treatment evidence and evolve through versioned snapshots
- **Wrong move prevented:** hiding public snapshot fields from the certificate, publishing private rows when changing the policy, rewriting an issued record, or describing a matching hash as proof of correct agronomy or a guaranteed payment.
- **Source:** user approval and purpose clarification, 2026-09-28, recorded in PROGRESS; README → "Phase 5 public snapshot policy — initial scope approved"; PROJECT → Purpose.
- **Why:** the farmer needs a readable, traceable record of products, doses, timing, crop and conditions for an organization's assessment. Every public field must be visible. Future policy changes need new schema versions and confirmation; old published records remain verifiable. Correcting an issued record needs an explicit replacement link and visible history. Real farmer/plot linkage and original evidence remain private under the approved starting field matrix.
- **Status:** approved requirements, including treated area in hectares by explicit user approval on 2026-10-02. The strict `2.0.0` schema, allowlisted builder and admin preview are implemented. ~~Snapshot confirmation is pending; retention and publisher rules are undecided.~~ **2026-10-03 correction:** confirmation code and migration are implemented in source, ~~with live DB validation pending~~; V1 retention and publisher engineering defaults were chosen (D25). **2026-10-04 correction:** CI migration deployment and live confirmation smoke passed; ~~browser interaction remains unverified~~ a focused local browser pass now covers confirmation and recall. Issued certificate, public verifier, publication and legal/pilot retention review remain open. No real publication or claims acceptance is asserted.
- **Check:** `rg -c '^### Phase 5 public snapshot policy' README.md` = 1; `rg -c '^#### Certificate purpose and evidence requirements' README.md` = 1; `rg -c '^#### Future policy and schema changes' README.md` = 1. These check the durable requirement sections only, not runtime enforcement.

### D22 — Dose unit is explicit and old values remain unknown
- **Wrong move prevented:** inferring `L/ha` or `kg/ha` from product names or silently assigning a unit to existing doses.
- **Source:** 2026-10-02 Phase 5 working-tree slice in `prisma/schema.prisma`, `lib/drafts/`, `lib/review/service.ts` and `components/form/ChemicalBlock.tsx`.
- **Why:** a number without its unit cannot support a reliable treatment assessment. `DoseUnit` is nullable for historical rows, while submission requires an explicit selection. The legacy demo payload is unchanged; this is not a publication schema.
- **Check:** `scripts/smoke-drafts.mjs` covers validated save and persisted unit; `scripts/smoke-review.mjs` covers rejection of a unitless submission. Both live smokes exited 0 on Windows 11, 2026-10-02, after the local migration applied.

### D23 — Public references are independent; unknown treatment facts stay unknown
- **Wrong move prevented:** copying a legal name to the public label, deriving the public field reference from a private ID, or treating the whole field as treated without evidence.
- **Source:** 2026-10-02 Phase 5 capture in `prisma/schema.prisma`, `lib/drafts/`, `lib/review/service.ts` and the signed-in form.
- **Why:** `Passport.publicFarmLabel` is entered separately and versioned with the draft; `Field.publicReference` is a DB-generated random UUID with a unique constraint and no write field in the draft DTO. The treatment zone and treated area are nullable for historical rows, required for new submission, and treated area must not exceed field area. The legacy demo payload stays isolated from these new fields. A UTC instant is not inferred from local date/time and time zone. The user approved treated area for the public schema on 2026-10-02; no snapshot is published.
- **Check:** local migration and model diff exited 0 on 2026-10-02; draft/review smokes cover reference stability, invalid zones, precision, missing values, over-area rejection, persisted values and admin details. Browser UI and CI for these changes were unverified at the time of local checks.

### D24 — Preview only approved facts through a strict public schema

- **Wrong move prevented:** using the complete private review response or unselected attachment metadata as the published payload, or mistaking a fresh preview for a stored publication commitment.
- **Source:** user approval of treated-area publication on 2026-10-02; README public-field matrix; `lib/public-snapshot/`, `app/api/admin/passports/[id]/public-preview/route.ts` and the admin preview.
- **Why:** the server query selects only candidate public facts and verifies two explicitly selected `READY` source digests. `z.strictObject` rejects extra fields, an unknown category and the legacy demo schema version. The read-only preview is admin/MFA protected, includes treated area, and hashes the exact canonical JSON shown in the UI. Its ID/timestamp are transient and there is no publication write. Public text is still subject to human review, and future confirmation must persist and bind the exact bytes to the approved passport version.
- **Check:** `review:smoke` checks authorization, source kind, private-marker exclusion in serialized output, selected digests, schema version and JSON round-trip hash. `test:public` checks readable preview values outside the raw JSON. Issued certificate and public verifier are still unbuilt.

### D25 — Retention and publisher defaults remain release gated

- **Wrong move prevented:** treating the five-year period as verified Ukrainian law, silently deleting claim evidence, granting all admins irreversible publishing rights, or placing a wallet private key in the web host.
- **Source:** user delegated the V1 choice on 2026-10-03; README → "V1 private-data retention policy" and "V1 publisher rule"; official EU Article 67 and Ukrainian personal-data law linked there.
- **Why:** the claim-support purpose needs the original private evidence and linkage. V1 targets five years for finalized records and evidence, notice before deleting 90-day inactive never-submitted drafts, explicit claim holds and 30-day matched DB/object backups. These are internal design targets. Counsel and the pilot organization must review them before real data. Only one designated MFA admin using an allowlisted operator wallet may publish Testnet records; the concrete identity and wallet are release configuration. The approving MFA reviewer alone confirms an exact snapshot; confirmation is private and has no chain or IPFS side effect.
- **Check:** `rg -c '^#### V1 private-data retention policy' README.md` = 1; `rg -c '^#### V1 publisher rule' README.md` = 1. Runtime deletion/hold and wallet enforcement are not built.

### D26 — Confirmation commits exact approved public bytes before publication

- **Wrong move prevented:** publishing a freshly rebuilt or silently changed payload after human review, mistaking a confirmation for an issued certificate, or reusing a confirmation after recall.
- **Source:** 2026-10-03 Phase 5 continuation in `lib/public-snapshot/confirmation.ts`, the new migration, admin route/UI and review recall transaction.
- **Why:** a reviewer selects the two verified source files and inspects every public value. The server locks the approved passport, verifies the same reviewer and version, rebuilds using preview metadata, compares SHA-256, and stores canonical JSON, file IDs, hash and audit in one transaction. A repeat with identical inputs is idempotent; a different snapshot conflicts. Recall invalidates the saved confirmation in the same transaction. Future publication must recheck the current approval and consume these stored bytes under a new controlled workflow.
- **Check:** `review:smoke` asserts auth/MFA, origin, strict input, stale version/hash rejection, stored bytes and hash, idempotence, audit and recall invalidation. It passed with `db:deploy` in CI on `b81cd36` ([run 37144642862](https://github.com/DarkPo13/hartolit-web3/actions/runs/37144642862)) and locally on 2026-10-04. A temporary local Chrome test exercised admin preview, confirmation, reload, mobile layout and recall; hosted browser behavior remains unverified.

### D27 — Legacy public readers stay disabled outside the local demo

- **Wrong move prevented:** treating the legacy `1.0.0` verifier as the Phase 5 public verifier, or exposing a payload with private farmer and field details by configuring a production contract.
- **Source:** 2026-10-04 release audit; `app/api/passport/[tokenId]/route.ts` and `app/verify/[tokenId]/page.tsx` call `isDemoMode()` before any chain/IPFS read. The strict approved public format is `2.0.0` (D24).
- **Why:** those readers still consume the demo schema. A safe public verifier must use only confirmed `2.0.0` bytes and the controlled publication record. The current production routes return 503 and 404, respectively.
- **Check:** `npm run test:public-boundary` against `next start` passed locally on 2026-10-04 and is now part of the CI live-smoke step. Publication and the new verifier remain unbuilt.

### D28 — Confirmed bytes feed private certificate and integrity views first

- **Wrong move prevented:** rendering a fresh preview as a certificate, exposing a public link before publication, or claiming that a matching saved hash verifies the treatment or an on-chain record.
- **Source:** user request to implement the next certificate/verifier slice on 2026-10-04; `app/admin/passports/[id]/`, `components/public-snapshot/ConfirmedSnapshotDocument.tsx` and the existing confirmation service.
- **Why:** the two MFA-admin pages load only an active confirmation, whose stored canonical JSON, SHA-256 and certificate ID are checked before rendering. Both reuse the complete public-value renderer, state that the record is unissued and unpublished, and disappear after recall. The verification page checks local saved integrity only; it makes no IPFS, chain, agronomic or compensation claim. The legacy `1.0.0` public readers stay guarded (D27). An issued certificate and public verifier require controlled publication.
- **Check:** `test:public` asserts every public scalar is readable in both views. The expanded `review:smoke` passed against migrated local services on Windows 11, 2026-10-04: authentication, no view before confirmation, saved values, private-marker exclusion and closure after recall. A temporary fictional Chrome pass confirmed both languages, MFA admin access, desktop/mobile layout and recalled-page 404. A same-segment `loading.tsx` was removed after the smoke caught a streamed HTTP 200 on anonymous access; without it, anonymous and missing-record requests return 307 and 404. Hosted acceptance remains open; check CI on the commit containing this slice separately.

### D29 — One publisher wallet; a private ownership proof is not issuance

- **Wrong move prevented:** requiring farmers or QR readers to own a wallet, creating separate wallets for proof and issuance, accepting an address string as ownership, or treating message signing as permission to publish.
- **Source:** user clarification on 2026-10-21; README → "Private wallet ownership proof"; `lib/publication/wallet-proof.ts`, `wallet-signature.ts`, new challenge/proof routes and migration.
- **Why:** one designated MFA publisher uses the same service wallet for ownership proof and later issuance. The server issues a five-minute EIP-191 challenge bound to the application origin and exact reservation/hash. Only a valid EOA signature can consume it; approval, actor, evidence and configured wallet are rechecked under the passport lock. Recall invalidates pending/consumed challenges and clears active proof atomically while retaining history. No key is stored by the server. Contract-wallet support and external publication remain separate work; the planned public QR verifier requires no wallet/account.
- **Check:** `test:wallet` checks actual recovery and rejects other-wallet/changed-message/malformed signatures. `publication:smoke` checks private authorization, context/expiry/replay, stored proof, concurrent requests and recall. These tests do not cover browser wallet signing, contract wallets or real issuance.

### D30 — Isolate the private browser-wallet flow from the legacy demo

- **Wrong move prevented:** reusing the demo's Mainnet/WalletConnect configuration for private publishing, persisting wallet connection state on a shared device, enabling SSR hydration with disabled storage, or submitting a signature after the selected wallet/passport changed.
- **Source:** `app/admin/PublicationPanel.tsx`, `PublisherWallet.tsx`, private publisher eligibility metadata and the 2026-10-21 browser checks recorded in PROGRESS.
- **Why:** only the designated MFA actor sees signing controls. A lazily loaded Testnet-only injected-wallet provider keeps its connection in memory. With storage disabled it is client-only: the installed Wagmi SSR hydration path requires persistence middleware and otherwise throws. Before and after signing, the client checks current account/chain/connector and ignores results after unmount; the server remains authoritative. Unknown save outcomes trigger a server status read before another prompt. One module-level provider avoids recreating wallet listeners while navigating between passports.
- **Check:** production Chromium checks with an injected test provider and actual signatures covered missing/wrong wallets, network switching, rejection, expiry, account changes, uncertain saves, navigation and reload. The original hydration error was reproduced, then absent after the fix. This is local simulator evidence, not acceptance of a user's installed extension.

### D31 — Persist dispatch uncertainty; never infer safe retry from a timeout

- **Wrong move prevented:** resending after a lost response, permitting recall while a provider might have published, treating `walletVerifiedAt` as sufficient authority, or claiming a prepared intent is an issued certificate.
- **Source:** `lib/publication/pinning.ts`, `requireStoredWalletProof`, migration `20261021170000_publication_pin_attempt`, recall transaction and `scripts/smoke-publication-pinning.mjs`.
- **Why:** a separately acknowledged exact confirmation prepares a private attempt. Preparation and dispatch recheck the full current approval, evidence, designated MFA actor/wallet and consumed signature under the passport lock. Commit `DISPATCHING`/`PINNING` before network I/O; only the first caller gets dispatch permission. Cancel/retry only before dispatch. Transport ambiguity or an elapsed deadline becomes `UNKNOWN` without resetting publication, reopening recall or returning another command. Recovery is internal and audited as `system:publication-recovery`, so a revoked initiator cannot strand the uncertainty marker. No endpoint, adapter, scheduler, successful-CID writer or reconciliation implementation is enabled yet.
- **Check:** expanded `publication:smoke` passes real PostgreSQL preparation/cancellation, concurrent dispatch/recall, exact bytes, active-attempt/timestamp constraints and unknown recovery. Bypassing stored signature recovery makes its forged-proof assertion fail; restoring it passes. Provider idempotency, readback, post-dispatch retry, chain stages and actual network behavior remain unverified.

### D32 — Verify a provider pin and the exact raw block before storing its CID

- **Wrong move prevented:** equating a CID-looking string, a successful status alone or gateway availability alone with verified storage; accepting JSON reserialization; reopening dispatch on an empty provider search; or turning an IPFS receipt into an issued certificate.
- **Source:** `raw-cid.ts`, `ipfs-reader.ts`, `reconciliation.ts`, migration `20261021171000_publication_pin_verification`, `test:ipfs` and the extended publication smoke. Official CID, gateway and standard Pinning Service API references are linked in README.
- **Why:** the initial bounded storage profile is one raw CIDv1/SHA-256 block, whose address can be determined from the exact confirmed UTF-8 bytes before dispatch. Read the configured provider's matching `pinned` result and raw gateway block using HTTPS GETs with separate credentials, no redirects, size bounds and deadlines. Verify bytes/hash/CID, then recheck the immutable commitment under the passport lock and save one atomic `VERIFIED`/`PINNED` receipt. Do not hold DB locks during network I/O. Unknown results stay blocked; delayed negative/error responses reread a concurrent verified result. Logging an already authorized external result is a system recovery action, not new user authorization; an initiator's later ban must not hide that result. A saved receipt records a historical verification, not continuous provider availability.
- **Status:** internal read-only reconciliation is locally tested; no uploader, worker, HTTP action or real provider is activated. Legacy attempts without an expected CID are rejected rather than silently reinterpreted. Provider compatibility with the raw profile, receipt provenance at actual dispatch, live storage retention and chain/public issuance remain release gates. The legacy JSON pin helper is not suitable for this path.
- **Check:** the independent specification vector and negative CID control pass; real PostgreSQL verifies exact receipts, concurrent idempotence, stale negative readback, missing/tampered results, post-read commitment validation, revoked-user recovery and SQL receipt shape. Fixtures use injected HTTP transport, not live IPFS. Fresh isolated PostgreSQL replay of all 15 migrations passed.

### D33 — Bind upload to a server-owned target and test the protocol offline

- **Wrong move prevented:** changing provider/account/profile between preparation and dispatch/readback, silently assigning a target to historical unbound attempts, treating upload acknowledgement as storage proof, resending after a lost response, or presenting a local fixture as hosted acceptance.
- **Source:** user direction on 2026-10-21 to finish local work before external setup; `target.ts`, `upload.ts`, `local-kubo.ts`, migration `20261021185106_publication_upload_target` and upload/offline smokes.
- **Why:** persist the provider key, fingerprint of its non-secret server-owned description (protocol/account scope/API/gateway/profile) and raw profile before dispatch. Revalidate every stage; never accept target URLs from browser JSON. Credentials stay outside that fingerprint. It binds configuration, not independently attested remote identity. Old nullable bindings remain history but cannot dispatch or reconcile through a new target. One internal driver consumes one dispatch command, uploads exact strict public bytes and always requires readback; a lost acknowledgement can recover a pin, while uncertainty never grants another send. The local Kubo factory rejects production and non-loopback use; no HTTP publication action/worker/configured hosted uploader invokes it.
- **Local fixture:** Kubo `v0.43.1` runs `--offline` on an internal Docker network with an ephemeral repository and no published container ports. Temporary test-only loopback tunnels use `docker exec` to reach its actual RPC/gateway without granting the node external networking. The smoke verifies isolation, owns/cleans only its fictional blocks and closes its tunnels. No public IPFS pin, hosted authentication/retention or blockchain claim follows.
- **Check:** 12 Node tests and real PostgreSQL/HTTP publication smokes pass, including actual offline Kubo upload/readback, lost acknowledgement, failed-before-write, concurrent single send, changed/unbound target rejection, stored binding/receipt and rolled-back SQL constraint checks. Removing strict schema validation makes the private-field-before-I/O test fail; restoration passes. Migration 16, client generation and schema/database drift check pass. User-facing publication consent, real provider acceptance, chain stages and public issuance remain separate work.

### D34 — Expose private preparation consent without enabling dispatch

- **Wrong move prevented:** treating the ownership signature as publication consent, accepting a target that changed since the UI review, letting other MFA admins mutate preparation, losing a saved intent after a dropped response, or enabling public upload merely by entering configuration.
- **Source:** `PublicationPreparation.tsx`, `preparation.ts`, the private `publication/pin-attempts` route and the 2026-10-22 local HTTP/browser checks in PROGRESS.
- **Why:** the designated MFA publisher separately reviews exact confirmed `2.0.0` facts and the server-owned target, acknowledges future public permanence and saves a private intent. The strict DTO includes the reviewed data/version/confirmation and target fingerprint; URLs/account scope are never browser input. POST prepares and DELETE cancels only before dispatch, reusing the serialized services and current proof/approval checks. Read-only metadata is available to other MFA admins. Target-description variables enable preparation only, with no provider construction, external I/O, upload endpoint, worker or issued certificate. Missing configuration fails closed. Configuration changes cannot rebind old attempts; cancellation remains possible before dispatch.
- **UI invariant:** show preparation/cancellation history and unknown/pinned states explicitly, clear consent when context changes, ignore unmounted work and reread server state after lost responses. Keep the child mounted during status refresh so the mutation's recovery state survives; key it by its commitment/target/access context. Reuse the complete public-value renderer; no private review fields enter the consent preview.
- **Check:** production HTTP/PostgreSQL tests cover authorization/origin, strict input, missing target/proof, stale target/hash, idempotent concurrent preparation, read-only metadata, cancellation/history and recall, with no CID/chain fields written. Local browser checks cover UK/EN, keyboard, narrow layout, reload, dropped successful prepare/cancel responses, failed-before-write, missing/changed target, load failure/recovery and other-admin read-only access. Bypassing the reviewed-target comparison makes the direct domain regression fail; restoration passes. No installed-extension, hosted/provider or chain acceptance follows.

### D35 — Bind a mint call and verify its canonical receipt before adopting chain data

- **Wrong move prevented:** equating a transaction hash or successful status with the approved mint, accepting extra calldata or another recipient/contract, trusting an event without stored contract state, treating confirmation depth as absolute finality, or issuing a certificate from an unpersisted read.
- **Source:** `chain-mint.ts`, its regressions and actual `chain:smoke` on 2026-10-22. The current contract already guards duplicate payload hashes and emits `PassportMinted`; no Solidity change was needed.
- **Why:** first implement a bounded read-only chain boundary, separate from durable attempts/wallet UI. A versioned immutable commitment binds strict canonical public bytes/hash/raw CID, Testnet chain, exact contract/runtime hash, sender/recipient, depth and calldata. Readiness is advisory only. Verify exact transaction/value, one matching event, owner/URI/hash/index at the inclusion block, runtime at inclusion/head and stable canonical block/receipt/chain identity after reads. Return explicit missing/pending/confirming/reverted/reorg/verified outcomes; every result remains unissued and grants no resend. The caller must still authorize current DB approval/consent/proof/pin and persist/monitor a chain attempt. Recipient policy, actual target/RPC and production finality are not chosen by this helper.
- **Local proof:** the smoke owns a loopback-only, non-forked Anvil with zero default accounts, ephemeral in-process test keys and a freshly compiled contract. Compare actual runtime to the artifact; test successful mint, depth, pending, duplicate/revert/pause, wrong recipient and actual branch rollback with stale readback. Solidity accepts extra trailing calldata; the exact-call guard rejects that successful transaction. No public RPC, published contract, IPFS write or app issuance occurs. Foundry `v1.8.6` is pinned in CI; portable local tools were verified against the official release digest and kept only in ignored tooling.
- **Check:** 15 Node regressions and actual Anvil smoke pass; all 22 Foundry tests and the 21-entry ABI comparison pass. Removing exact calldata equality makes the receipt regression fail, then restoration passes. This is receipt/readiness evidence, not DB persistence, wallet interaction, lost-hash/replacement recovery, hosted-provider or permanent-finality acceptance.

### D36 — Persist reviewed mint preparation before designing send authority

- **Wrong move prevented:** saving a mint intent from a mere CID or stale proof, silently changing its target after review, reopening ordinary previews after pinning, or treating preparation as transaction dispatch/issuance.
- **Source:** `mint-preparation.ts`, migration 17 and the expanded fictional PostgreSQL publication smoke, 2026-10-22.
- **Why:** take one complete local step: persist canonical intent/fingerprint bound to the publication and its verified pin receipt. Reuse the passport lock and current publisher/MFA/approval/fact/evidence checks, recover the consumed signature, and separately require exact confirmation/version/hash/intent acknowledgement. A narrowly scoped PINNED revalidation allows that exact record only; preview/confirmation callers retain their original block after dispatch. Unique request/publication constraints and composite pin/publication FK protect linkage. Repeats reauthorize and return the identical record; different requests/commitments conflict. No amendment/cancellation is implemented. The service has no network dependency, HTTP caller or configured target and never updates chain/publication success fields.
- **Next boundary:** prepared data grants no wallet send. Persist/serialize nonce, dispatch permission, hash and receipt/replacement/reorg history separately before wiring wallet UI; reauthorize current state at that action. Actual target/recipient/RPC/finality remain release choices. No signing key belongs in the web environment.
- **Check:** `publication:smoke` exercises exact stored values, concurrent idempotence/audit, changed consent/target/facts/proof/pin, revoked actor/confirmation, default preview closure and rolled-back SQL checks. Disabling the reviewed-intent equality causes the regression to fail. Test tooling binds and requests the same literal IPv4 loopback, avoiding an unrelated IPv6 localhost application. No combined DB/chain dispatch or hosted acceptance follows. `rg -c '^export async function prepareMintIntent' lib/publication/mint-preparation.ts` = 1.

### D37 — Consume a shared-wallet nonce permission before returning a mint command

- **Wrong move prevented:** treating saved preparation as send consent, returning a command twice after a lost response, racing two passports on one wallet nonce, or inferring safe retry from an expired deadline/refusal/missing hash.
- **Source:** `mint-dispatch.ts`, migration 18 and the injected/actual-local-chain variants of `publication:smoke`, 2026-10-22.
- **Why:** a separate strict SEND_EXACT_MINT acknowledgement binds the saved intent. Recheck current publisher/MFA, confirmation/version/facts/evidence, consumed proof, verified pin and exact target before and after read-only RPC. Readiness must be READY; anchored latest nonce and two pending counts must agree as a nonnegative safe integer, with stable chain/block and an observation under 15 seconds old. No RPC holds DB locks. Passport plus transaction-scoped shared-wallet advisory lock serialize eligibility/writes; SQL independently enforces unique preparation/request/nonce and one active chain/wallet attempt. Commit DISPATCHING, fixed nonce/five-minute deadline, CHAIN_PENDING and audit before returning one exact zero-value command. Only the first caller receives it.
- **Recovery:** record UNKNOWN idempotently under the passport lock after transport ambiguity/expiry, even when the actor/config is revoked. Never release the nonce/slot or reopen recall/send. No HTTP caller, configured RPC, broadcaster, scheduler, cancellation/slot-release path, hash/receipt writer or issued certificate exists. An exclusive application wallet remains required: DB locks cannot stop outside software using its nonce. Future transaction adoption must verify the nonce in addition to the saved mint intent and preserve replacement/reorg history.
- **Check:** real PostgreSQL tests cover strict separate consent, changed state during RPC, staleness/idle nonce, stored values, cross-passport concurrency, SQL constraints and revoked-actor recovery. Bypassing post-RPC reauthorization makes the revocation regression fail. The actual owned Anvil variant sends one authorized fixed-nonce transaction with the ephemeral test signer, checks actual transaction/success/payload index, deliberately withholds its hash and proves uncertainty still blocks another passport. This does not adopt a durable receipt or issue a certificate. CI is configured for the actual variant; exact pushed-commit success remains a separate gate. `rg -c '^export async function beginMintDispatch' lib/publication/mint-dispatch.ts` = 1.

### D38 — Separate reported hashes, matched transactions and historical receipt evidence

- **Wrong move prevented:** treating a reported hash or matching event as the authorized transaction, accepting the wrong nonce, overwriting earlier branch evidence, appending a delayed result as newer truth, or issuing/retrying from a historical verification.
- **Source:** `mint-observation.ts`, exact transaction matcher, migration 19 and expanded injected/actual-Anvil DB smokes, 2026-10-22.
- **Why:** revalidate the saved dispatched canonical commitment, nonce, confirmation/approval and verified pin before/after read-only RPC. A transaction record requires exact chain/from/to/value/calldata AND stored nonce. Reported hashes without a match stay diagnostic observations. Separate matched candidates retain replacement history. Versioned bounded unissued receipt JSON, revision, timestamp and system audit are append-only in application code; FK/SQL checks protect nonce/linkage/result shape. Every new check is historical evidence about that read, not a canonical publication selection. Current actor/publisher config is unnecessary for system readback; no new sending authority is granted.
- **Concurrency:** passport serialization plus initial observation revision rejects any response whose peer committed first. Return SUPERSEDED with no transaction/observation/audit write; do not reinterpret a cached success or delayed negative response as fresh. Keep both verified old-branch evidence and later REORG/other candidate observations. Missing/unavailable/mismatched results never release the nonce/wallet slot. No finalizer, discovery scanner, scheduler, HTTP action, broadcaster or issued certificate exists yet.
- **Check:** 16 Node tests plus real PostgreSQL smokes check exact nonce/hash/receipt storage, stale reads in both directions, commitment changes during RPC, revoked-actor recovery and rolled-back SQL probes. Removing nonce equality makes the new unit regression fail; weakening revision equality makes the delayed-read smoke fail. The actual owned Anvil variant persists a confirmed receipt, rolls back its branch, rejects stale readback and records a repriced same-nonce/call on the new branch while preserving history. This is not hosted mempool-replacement or permanent-finality acceptance. `rg -c '^export async function observeMintAttempt' lib/publication/mint-observation.ts` = 1.

### D39 — Select a revocable as-of mint result without releasing the wallet slot

- **Wrong move prevented:** promoting a historical receipt without fresh RPC, mixing proof from another attempt, treating stored success as permanent finality, or releasing a nonce before later rollback is safely handled.
- **Source:** `reconcileMintResult` in `mint-observation.ts`, migration 20 and `smoke-publication-mint-result.mjs`, 2026-10-22.
- **Why:** selection accepts only an existing exact-call/nonce-matched transaction ID. Recheck the chain and saved commitment outside DB transactions, then under the passport lock reject changed candidates, reads at least 15 seconds old and superseded observation revisions. Atomically append the observation/audit and update a separate result projection. Composite FKs bind both receipt pointers to the attempt and the proof to status VERIFIED; CHECKs enforce all-or-none proof metadata and current-check equality for selected VERIFIED.
- **Conservative policy:** completed non-VERIFIED reconciliation or any subsequent diagnostic observation suspends selected success, preserving the last verified proof and all history. Invalid, expired and superseded checks make no writes or success grant. Only explicit fresh reconciliation can promote it. This is an as-of private result, not publication/finality; future consumers must revalidate. Keep the original UNKNOWN/DISPATCHING attempt and wallet slot, CHAIN_PENDING publication and unset chain success fields. Safe release/quarantine after a late reorg, canonical publication finalization, discovery and continuous monitoring remain separate work. No HTTP action, signing key or broadcaster is enabled.
- **Check:** injected and actual owned-Anvil PostgreSQL smokes inspect fresh proof pointers, strict candidates, suspension, expiry, bidirectional stale reads, changed commitment/candidate, revoked-actor recovery, SQL ownership/status constraints and blocked dispatch after selection. Actual rollback suspends selected success without deleting its proof; a new-branch same-call transaction is selected only after fresh checks. Removing the explicit-reconciliation promotion guard makes the regression exit 1; restoration passes. `rg -c '^export async function reconcileMintResult' lib/publication/mint-observation.ts` = 1.
