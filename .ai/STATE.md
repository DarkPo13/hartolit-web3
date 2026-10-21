# STATE — the frontier

- **Last updated:** 2026-10-21
- **Branch:** `master`
- **Checkpoint:** user authorized handoff, commit and push of the wallet UI, durable publication attempts and verified IPFS readback. The application checkpoint is prepared; check its exact CI run after push.
- **Last recorded green application CI:** `cdf106a`, [run 39624900884](https://github.com/DarkPo13/hartolit-web3/actions/runs/39624900884), web and contract success. That run does not cover the newer work in this handoff.
- **2026-10-21 handoff correction:** earlier dated goal/validation paragraphs were archival and contained superseded uncommitted/pending claims. They are consolidated into the dated history in `PROGRESS.md`; this file is the current frontier.

Keep this file under about 250 lines. Source/config and exact pushed-commit CI override handwritten status. Never claim a check passed without its exit status. Historical implementation choices and negative controls live in PROGRESS and D21–D32.

## Current goal

Finish the controlled hosted Testnet MVP one increment at a time. The next implementation slice is the exact-byte upload boundary plus a separate explicit publication action, using local test transport before any real external write. Ownership signing is not publication consent. No customer data, real pin, deployed contract, mint or hosted release is authorized or exists.

## Implemented in this checkpoint

- **Private admin wallet UI (D30):** designated MFA publisher only; other admins are read-only. Reservation, injected EOA connection, BSC Testnet, exact message review/signing, expiry/refusal/account-change handling and saved proof after reload. Isolated client-only, memory-only provider; no Mainnet/WalletConnect/seed/key input. A queue request-generation guard prevents stale filter results overwriting current rows.
- **Durable attempts (D31):** separate acknowledgement binds confirmation/version/hash; recheck current publisher/MFA, approval, exact canonical bytes, selected READY evidence and the consumed signature. One concurrent caller receives dispatch permission. Passport lock serializes start/cancellation/recall. Cancellation and a new request are allowed only before dispatch; timeout/transport ambiguity remains `UNKNOWN` with recall/resending blocked.
- **Readback/receipt (D32):** expected CID bound before dispatch; one raw CIDv1/SHA-256 block, lowercase base32, at most 64 KiB. Read-only standard Pinning Service API plus raw gateway; HTTPS, bounded GETs, deadlines, no redirects, no gateway credential forwarding. Match pin status and exact bytes/hash/CID, then recheck the commitment and atomically save attempt `VERIFIED`, publication `PINNED`, receipt and one system audit event. Delayed negative/error results reread concurrent success. Recovery remains possible after the initiating user is banned. No network I/O holds a DB transaction.
- **Migrations 14–15:** `20261021170000_publication_pin_attempt` and `20261021171000_publication_pin_verification`; proof/publication FK, active-attempt unique index, timestamp/receipt CHECKs. No committed migration was modified. Apply with `npm run db:deploy`.
- **Tests:** `test:ipfs` is in CI. Expanded publication smoke exercises real PostgreSQL/production HTTP and fictional provider transport, not live IPFS. No dependency changes; the manifest adds only a test script.

## Still absent / intentionally disabled

No uploader, publication HTTP endpoint/Server Action, worker/scheduler, provider-bound actual dispatch, post-dispatch retry permission, chain-stage writer, issued certificate or public `2.0.0` verifier. `PINNED` is not `PUBLISHED`; no token/transaction is fabricated. Legacy `1.0.0` readers and demo issuance remain unavailable in production (D1/D2/D27). The ownership panel cannot start external publication.

Real provider/profile compatibility, stable actual-dispatch provenance, pin retention/monitoring and an installed browser extension/device have not been accepted. The raw profile is an initial engineering boundary, not a claim that the legacy Pinata JSON helper supports it.

## Phases

| Phase | Scope | Current state |
|---|---|---|
| 0 | Public fields, retention, publisher and hosting policy | Public fields approved (D21); retention/publisher defaults chosen (D25). Legal/pilot review, providers/regions and concrete account/wallet remain open |
| 1 | Invite-only accounts, DB sessions, admin TOTP, reset | Implemented; green checkpoint CI on `cdf106a`; no hosted acceptance |
| 2 | Owner-scoped drafts, versions, audit | Implemented; local/CI acceptance |
| 3 | Private uploads, integrity, ClamAV, expiring reads | Local implementation/acceptance; hosted gate S7 open |
| 4 | Submit, assign, decide, reopen and admin management | Implemented locally; hosted/real-device gate S9 open |
| 5 | Confirmed public snapshot and controlled publication | Private views, reservation/proof, wallet UI, durable attempts and readback exist. Upload, chain stages, issued/public views and live provider acceptance remain open |
| 6 | Release hardening and hosted pilot | Incomplete; hosting, retention/holds and backup/restore remain open |

## Open release items

| Id | Item | Detail | Unblocked by |
|---|---|---|---|
| S6 | Release policy and actual publisher | README public-field/retention/publisher policies; PROGRESS Q1–Q3 | Counsel/pilot retention review, actual MFA account/public wallet address, provider/region choice before real data |
| S7 | Hosted private evidence, auth and recovery | Managed bucket/scanner, hosted auth/expiry, matched DB/object backup and restore | Q2 provider/region choice and configured staging infrastructure |
| S8 | Original detailed plans remain local-only in ignored `docs/` | D12/Q4; committed completion guide, README and STATE carry their essentials | User decision only if those original documents should become tracked; does not block the next code slice |
| S9 | Hosted and real-device MVP acceptance | Installed wallet, hosted workflow, actual pin/chain/public certificate tests | Q2 staging environment, S6/S7 release gates and remaining Phase 5 implementation |

No open row above is closed by this checkpoint. Public field scope is approved, but integrity does not prove agronomic correctness, legal recognition or entitlement to compensation. Readers/farmers will not need a wallet/account for the future public QR verifier (D21/D29).

## Validation

**Handoff run, 2026-10-21, Windows 11, Node 24.18.0.** Each command's own exit status was read unpiped.

| Check | Result | Limit |
|---|---|---|
| Full lint, standalone typecheck, production build | Each exit 0 | Runtime/browser/hosted behavior require separate checks |
| Hash/public/button/wallet/capture/IPFS Node tests | 9 tests passed, exit 0 | IPFS transport injected; no live provider |
| `db:deploy` | Exit 0; all 15 migrations current | Primary local DB only in this handoff |
| Public-boundary, drafts, evidence, review, feedback, publication smokes | Each exit 0 against production build and local services | Fictional accounts/records cleaned; publication provider transport is fictional |
| Production audit high/critical gate | Exit 0; zero high/critical, 23 moderate | Moderate findings remain; no dependency upgrade in this checkpoint |
| `git diff --check` | Exit 0 | Does not validate semantics |
| Auth/STARTTLS smoke and Foundry/ABI | Not rerun locally for this checkpoint | Unchanged auth/contract; CI must run its full configured sequence |
| Browser/installed extension/hosted | Not rerun for this handoff; real-extension/hosted acceptance remains open | See dated prior evidence below |

**Earlier same-day evidence:** local production Chromium desktop/390px signing UI acceptance used an injected provider with real signatures, not an installed extension. Covered UK/EN, keyboard, missing/wrong wallet, Testnet, refusal, expiry, account changes, navigation, reload and uncertain saves. D30/PROGRESS record the SSR/storage and stale-queue fixes. Fresh isolated replay of all 15 migrations, client generation and schema/database no-drift check passed during the readback slice; the temporary database was removed. Negative controls for consumed-signature and CID verification failed with their guards bypassed, then passed after restoration. No actual provider/chain operation was performed.

**Runtime at handoff:** task-owned production servers and only the three Hartolit services used for checks are stopped, with volumes retained. Unrelated containers and local environment files are preserved. The existing driver concurrent-query deprecation warning remains.

## Environment and fresh-machine setup

- Nothing is deployed. No published contract or passport exists.
- Follow README Local Setup: `npm ci`, generate local ignored configuration, start the configured Compose services, then `npm run db:deploy` before using this schema.
- Secrets, local credentials, ignored `docs/`, generated Prisma client and Foundry libraries do not travel through Git. The environment example lists names only. No web-server wallet private key is permitted.
- Readback variables are `HARTOLIT_IPFS_PINNING_API_URL`, `HARTOLIT_IPFS_PINNING_TOKEN`, `HARTOLIT_IPFS_GATEWAY_URL`; setting them does not activate publishing. See README for the standard API/raw gateway boundary. Do not reuse the legacy JSON uploader.

## Next steps

1. **Agent:** verify the exact pushed checkpoint CI result, then implement/test an exact-byte upload boundary and separate publication consent. Bind actual provider identity/configuration and raw storage profile to dispatch; use local positive/negative transport tests first. Preserve current MFA/approval/proof checks and unknown-outcome blocking. No blind resend after a missing readback.
2. **User with agent preparation:** choose/verify the actual MFA publisher and public Testnet wallet address; manually accept the installed extension via README. Choose hosting/database/private bucket/scanner/SMTP/IPFS providers and regions (Q2); obtain counsel/pilot retention review. No seed/private key sharing. These choices do not block local uploader-boundary code.
3. **After those gates:** provider upload/readback compatibility and retention acceptance; Testnet mint/receipt/reconciliation; issued certificate and anonymous public verifier; holds/deletion, matched backup/restore, then hosted/device acceptance.

## Open questions

PROGRESS owns Q1–Q6: Q1 retention engineering default chosen, legal/pilot review pending; Q2 providers/regions open; Q3 designated role chosen, actual actor/wallet open; Q4 original plan tracking open; Q5 latest-version policy open; Q6 Node test runner settled. D21–D32 exist in DECISIONS. Older closures/CI failures and corrections remain in PROGRESS.
