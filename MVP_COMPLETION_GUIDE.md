# Hartolit MVP completion guide

**Status date:** 2026-10-06

**Target:** a controlled, hosted BSC Testnet pilot. Invited staff can create and review treatment records; one designated MFA admin can publish an approved public `2.0.0` snapshot with an allowlisted wallet; a farmer can share or download a readable issued certificate; anyone with its link can verify the published snapshot without an account. A real-data pilot begins only after the privacy, retention, backup, security and legal/pilot gates below pass.

This guide describes the **next release**, not a claim that the product is already deployed. Mainnet and Diia/KEP are later decisions. See [README](README.md), [current state](.ai/STATE.md) and [decisions](.ai/DECISIONS.md) for the implementation and policy source of truth. Older passages in the local, gitignored `docs/MVP_RELEASE_PLAN.md` describe an abandoned database-free pilot and legacy public payload; do not use those passages to plan this release.

## Where we are

**Planning estimate: about 55% complete toward the hosted Testnet MVP, with roughly a 10-point uncertainty. The application is 0% launched.** This is a weighted assessment of usable release capability, not a count of files, tickets or elapsed time. It will change as tests reveal defects or scope changes.

| Release capability | Weight | Credit now | Evidence and remaining gap |
|---|---:|---:|---|
| Accounts, private drafts, evidence, review and admin | 35 | 30 | Implemented with local/CI smokes; hosted and real-device checks remain. |
| Public capture, strict snapshot, MFA confirmation and private previews | 20 | 18 | `2.0.0` confirmed bytes and hash are stored; the preview is explicitly unissued. |
| Controlled IPFS/chain publication, issued certificate and public verifier | 25 | 4 | Contract, schema skeleton and demo helpers exist; there is no production publication path or issued `2.0.0` certificate. |
| Hosted infrastructure, privacy operations and recovery | 15 | 3 | Local services and CI exist; provider choice, deployment, retention and restore drill are open. |
| End-to-end hosted pilot acceptance | 5 | 0 | No hosted application, deployed contract or real publication yet. |
| **Total** | **100** | **55** | **Release is blocked by the unfinished publication and operations gates.** |

The green CI run for application commit `e304a77` checked the current private workflow, build, database migrations, production dependency audit and contract suite. It did **not** test hosted infrastructure or a public issued certificate. Recheck CI for any newer application commit. The repository currently has no deployed contract and no real passport has been published.

The farmer-facing promise is **a traceable treatment record and evidence for an independent assessment**. A matching hash proves integrity of the published bytes. It cannot establish that a treatment occurred, that a chemical dose was appropriate, that a regulator recognizes the record, or that an insurer owes compensation. The issued certificate and verifier must use this wording consistently.

## Release sequence

The steps are ordered so that engineering can proceed while provider and legal decisions are prepared. **“Done” means the stated acceptance evidence exists**, including the negative cases; a screen that looks finished is insufficient.

### 1. Freeze the first pilot's product and public-data contract

**Owner:** agent prepares; user approves the concrete pilot scope with the intended pilot organization.

1. Treat the approved `2.0.0` field allowlist in [README](README.md#approved-starting-public-fields) as the starting contract. Keep legal farmer identity, exact plot coordinates/cadastral data, raw evidence, filenames, staff details and internal IDs private.
2. Confirm that each public field helps a reader understand or check the treatment. Make every approved public scalar visible in readable certificate and verifier sections, with units and a verification appendix.
3. Set the pilot audience, expected record volume, language needs, recipient sharing and what a correction after publication should look like. Use one or two fictional example cases to review the certificate with an insurer, buyer or other intended reviewer.
4. Give Ukrainian counsel and the pilot organization the actual certificate example and private-evidence access procedure. Ask them to review the planned retention period and the legal/operational claims; record what they accept and what wording must change. Do not imply legal recognition from a blockchain transaction.

**Done when:** the pilot scope and sample certificate are approved, the public field list and disclaimers are explicit, and any changed public semantics have a new schema version. Published versions must stay verifiable under their original schema.

### 2. Build the publication state machine around the confirmed bytes

**Owner:** agent. **Owning layers:** Prisma migration, server publication service, route handlers and focused tests.

1. Extend the existing `Publication` model through a **new migration**. Bind a publication to one active `PublicSnapshotConfirmation`, its exact `canonicalJson` and `payloadHash`, passport approval/version and reviewer identity. Store operator authorization and audit facts without exposing private data in public output or logs.
2. Define legal transitions for `RESERVED`, `PINNING`, `CHAIN_PENDING`, `PUBLISHED` and `FAILED_RETRYABLE`. Make reservation idempotent; concurrent requests for the same confirmation must converge on one publication. Decide how recall behaves before and after an irreversible pin or mint.
3. Recheck approval, active confirmation, version, source-file integrity, designated active MFA admin and configured wallet **on the server** before each irreversible stage. `proxy.ts` and a hidden button are not authorization.
4. Add reconciliation that can inspect an existing CID, transaction and contract event after a timeout. A retry must resume safely, including when the chain transaction succeeded but the database write failed. Use the contract's payload-hash uniqueness guard rather than blindly minting again.
5. Test stale confirmation, recalled record, wrong admin, expired MFA, wrong wallet, concurrent requests, pin failure, wallet rejection, chain timeout and database failure after chain success.

**Done when:** the state transitions and audit trail are covered by live database tests, and failures cannot create a second certificate or publish a different snapshot. Keep external pinning/minting disabled until steps 3–5 are ready.

### 3. Pin only the approved public bytes

**Owner:** agent. **Owning layers:** publication service, IPFS adapter and tests.

1. Send the exact saved `canonicalJson` UTF-8 bytes, not a reconstructed Prisma object or a fresh `JSON.stringify` result. Check the SHA-256 against the saved confirmation immediately before pinning.
2. Inspect the serialized bytes for excluded private markers in tests. Require the approved schema version and allowlisted field builder. Do not upload the private weather/chemical files; publish only the selected files' server-verified digests.
3. Read the pinned content back from an independent gateway or provider path and compare its bytes/hash before proceeding to chain submission. Store the CID and any provider receipt. Make retry behavior explicit if the provider succeeds but its response is lost.
4. Keep public pinning behind the designated publisher action and release gate. IPFS content can be copied by anyone with the CID and cannot reliably be recalled by unpinning ([IPFS privacy guidance](https://docs.ipfs.tech/concepts/privacy-and-encryption/)).

**Done when:** a fictional Testnet candidate can be pinned with byte-for-byte hash equality, private data cannot enter the payload, and a failed read-back blocks minting.

### 4. Submit and reconcile the operator-wallet transaction

**Owner:** agent; user designates the real pilot MFA account and operator wallet. **Owning layers:** wallet UI, publication API/service, chain adapter and contract/ABI tests.

1. Deploy the current contract to **BSC Testnet** from an isolated deployment environment. Record the verified contract address, chain ID, deployment transaction and administrator/minter roles. Keep all private keys out of the web server, repository and database.
2. Let only the designated MFA admin connect the allowlisted wallet. Before signing, show the confirmed public fields, CID, payload hash, recipient, chain and contract address. Check the account, chain and `MINTER_ROLE` before requesting the transaction.
3. Call `mintPassport(to, payloadHash, ipfsUri)` using the confirmed hash and verified CID. Persist the transaction hash when available, wait for a suitable confirmed receipt and verify the `PassportMinted` event, token ID, `payloadHash` and token URI against the intended publication.
4. If the browser closes or a transaction is replaced/delayed, reconcile the chain before allowing a retry. Surface `pending`, `failed` and `published` states to the operator without exposing private audit data. The contract permits one mint per payload hash.
5. Exercise wrong network, disconnected/wrong wallet, no minter role, user rejection, paused contract, duplicate hash and lost response cases on Testnet.

**Done when:** one fictional approved snapshot yields exactly one Testnet token and the database, CID, on-chain hash, URI and event agree after refresh and retry scenarios.

### 5. Release the issued certificate and independent public verifier

**Owner:** agent. **Owning layers:** issued certificate route/component, public verifier route/service and export/print UI.

1. Build the issued certificate **only for `PUBLISHED` `2.0.0` records**. Derive all treatment facts from saved confirmed bytes, never mutable private rows. Show all approved fields, units, version, snapshot timestamp, evidence digests and the separate chain receipt facts.
2. Provide a durable share URL and QR code, plus a tested print/download path. The downloaded artifact and the webpage must have the same public facts and a clear treatment-specific scope.
3. Build a wallet-free, sign-in-free verifier that reads the expected chain/contract/token, retrieves the IPFS bytes, hashes them and checks the on-chain hash and URI. Display a distinct result for valid, unavailable, pending, mismatch and unsupported schema. A server database lookup may enrich the display but cannot replace independent verification.
4. Ensure the legacy `1.0.0` public routes remain closed in production. Verify anonymous access to the new public route reveals no private marker, account ID, source filename or signed evidence link.
5. Test every public scalar appears in readable form on both issued surfaces. Test the exported document and QR destination in English and Ukrainian, desktop and narrow mobile widths, keyboard flow and a fresh anonymous browser. Keep the exact statement of what a hash match does and does not prove.

**Done when:** a third party can open a fictional issued certificate on a fresh device, download/share it, independently check its CID and chain commitment, and understand the treatment without an account.

### 6. Handle irreversible mistakes and private evidence access

**Owner:** agent designs; user/pilot organization reviews policy. **Owning layers:** publication lifecycle, admin audit, evidence access and public display.

1. Define an explicit correction record that links a new certificate to the old one. Never silently replace published JSON, rewrite a token's meaning or erase a historical verifier result. Show a visible correction/supersession notice where applicable.
2. Define who can request the original private evidence and farmer/field mapping for a claim, how consent or legal basis is recorded, and how access is audited. Public certificate holders must not automatically gain access to private files.
3. Exercise a mistaken public farm label, a wrong dose discovered before mint, and a wrong dose discovered after mint. Test that pre-mint recall blocks publication and post-mint correction preserves the original history.

**Done when:** staff have a documented and tested response to an erroneous publication and a controlled way to support a claim without making private records public.

### 7. Choose hosting and deploy a private staging environment

**Owner:** agent prepares architecture and options; user controls provider accounts, billing, domain and actual publisher identity. **Owning layers:** infrastructure, deployment workflow and configuration.

1. Choose a hosting region and providers for a persistent Node.js app, managed PostgreSQL, private S3-compatible object storage, malware scanning, transactional SMTP, DNS/TLS and monitoring. Record data region, access controls, costs, service limits and exit/restore options. Next.js's Node server supports its full feature set ([Next.js deployment guide](https://nextjs.org/docs/app/getting-started/deploying)).
2. Create separate local, staging and future production environments. Put credentials in the provider's secret store; use least privilege, private networking where available, storage encryption, HTTPS, secure cookies and a tested domain/email setup.
3. Add a deployment workflow that builds the pushed commit, applies existing migrations with `npm run db:deploy`, starts the app and checks health and key routes. Run migrations once per release and plan recovery for a bad deploy. Prisma documents `migrate deploy` for applying pending migrations in deployment ([Prisma 7 CLI](https://docs.prisma.io/docs/cli/migrate/deploy)).
4. Configure an isolated Testnet RPC, contract address and allowlisted wallet. Verify rate limits, auth callbacks, upload grants, scanner connectivity and SMTP delivery on staging. Do not point staging at production data or a Mainnet contract.
5. Use GitHub environment protections for deployment credentials and approvals if deploying through Actions ([GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)).

**Done when:** a clean checkout can deploy staging reproducibly, migrations and health checks pass, secrets stay out of logs/artifacts, and staff can use invited accounts and private uploads over HTTPS.

### 8. Implement retention, preservation holds and recovery

**Owner:** agent implements after counsel/pilot review of the policy; user approves provider configuration. **Owning layers:** database services/jobs, private object store, admin controls and operations runbook.

1. Start from the [README retention targets](README.md#v1-private-data-retention-policy--implementation-target): five years for issued/finalized support records, notice before removal of inactive unsubmitted drafts after 90 days, explicit claim holds, and 30-day matched DB/object backups. These are engineering defaults, **not established legal minimums**.
2. Add hold creation/release with authorization and audit. A hold must block deletion of the relevant farmer/field linkage, reviewed record and original evidence. Add notice, eligibility checks and deletion workflow for unused drafts; current `evidence:prune` does not implement business-record retention.
3. Back up database and object storage as one recoverable set, then restore into an isolated environment. Verify a published record's private mapping, referenced files, scans, holds and audit history. Reapply deletion/hold events before restored data becomes user-accessible.
4. Set and measure recovery objectives with the chosen providers. Alert on failed backups, restore drift, malware scanner outages and expiring credentials. Restrict backup access and record a successful restore drill.

**Done when:** the staged restore drill recovers a complete fictional record and its files; a hold prevents deletion; expired unused drafts receive notice; the retention policy has been reviewed before real data is accepted.

### 9. Run release verification on the exact build to be piloted

**Owner:** agent, then user/pilot organization for acceptance.

1. On the candidate commit run `npm run lint`, `npm run typecheck`, `npm run test:hash`, `npm run test:public`, `npm run test:capture`, `npm run build`, `npm run contracts:build`, `npm run contracts:test` and `node --experimental-strip-types scripts/check-contract-abi.mjs`. Run `npm audit --omit=dev --audit-level=high`. Read each command's own exit code without a pipe.
2. With migrated PostgreSQL and local services plus the running app, run `npm run drafts:smoke`, `npm run evidence:smoke`, `npm run review:smoke` and `npm run auth:smoke`. Run the production public-boundary check against a production build. Extend tests for the actual publication, public verifier and export paths; existing tests do **not** cover those new paths yet.
3. In staging, exercise the complete fictional workflow: invite/login/MFA, create and autosave, upload and scan, submit, assign/review, confirm, pin, mint, download/share, anonymous verify, correction and private evidence request. Repeat critical flows in Ukrainian and English, narrow mobile view, keyboard navigation and a real device/browser.
4. Inspect public IPFS bytes, the chain transaction/event, exported certificate and anonymous response for private markers. Test wrong user, stale snapshot, revoked confirmation, replay, failed pin, failed chain transaction, delayed receipt and service outage recovery.
5. Review logs, error handling, accessibility, loading/empty/error states, performance with realistic record/evidence sizes, backup alerts and operator runbooks. Check the GitHub `CI` result for the exact pushed commit; a local pass does not replace it.

**Done when:** the exact release commit has green CI and staging acceptance evidence, there are no unresolved critical privacy/issuance defects, and the pilot reviewer agrees that the sample certificate is understandable and useful.

### 10. Start the controlled pilot, then decide on production

**Owner:** user owns external launch and pilot agreement; agent supports deployment, monitoring and defect fixes.

1. Pilot with fictional data first. Enable public pinning/minting only after the publication controls, recovery and anonymous verification pass on the hosted stack.
2. Before entering real farmer data, complete provider/region selection, privacy notice/consent or other legal basis, counsel and pilot review of retention and sharing, backup/restore drill, access review, incident contacts and designated MFA admin/wallet verification.
3. Run a small real-data pilot only with the agreed participants. Monitor failed uploads, review queue, publication retries, verifier availability, storage costs and support requests. Collect feedback on whether the certificate answers the intended organization's actual questions.
4. Fix issues and rerun the affected acceptance checks. Make an explicit **separate** decision about a production/Mainnet launch, irreversible costs, contract admin/minter custody and any additional legal requirements. Plan Diia/KEP only after the core app and infrastructure are released.

**Done when:** the pilot works end to end with an auditable support process and the user has evidence to decide whether to expand it. A green CI run alone is not a launch decision.

## What can proceed immediately

The next engineering slice is **step 2: publication state machine and idempotent reservation**, using the already confirmed snapshot. It can be implemented and tested with fictional data before buying services or connecting a wallet. After that, implement exact-byte pinning, then Testnet wallet minting and the public certificate/verifier. Keep each slice reviewable with its own focused tests and migration if required.

In parallel, prepare a short provider comparison and a sample certificate for pilot/counsel review. The user will need to choose or authorize paid accounts/regions, designate the actual MFA publisher and wallet, and obtain the pilot/legal review before **real-data publication**. These decisions do not block the next local engineering slice.

## Release checklist

- [ ] Current approved `2.0.0` snapshot is the only source of public treatment facts.
- [ ] One confirmed snapshot can produce no more than one token; interrupted operations reconcile safely.
- [ ] Published IPFS bytes, stored hash, on-chain hash/URI and issued certificate agree.
- [ ] The certificate and public verifier display every approved public field; anonymous access reveals no private data.
- [ ] Corrections preserve the original public history and private evidence remains access controlled.
- [ ] Hosted auth, uploads, malware scan, SMTP, migrations, backups and restore drill pass.
- [ ] Retention/holds and privacy terms are reviewed before real data; designated publisher identity and wallet are verified.
- [ ] Exact release commit passes CI, hosted end-to-end checks and pilot organization review.

Reassess the percentage after each completed step using the same table above. Publication and hosted operations carry most of the remaining release risk, so progress will not rise simply because more UI pages exist.
