# Hartolit Digital Field Passport

> **Prototype for recording agricultural drone treatments and checking a passport payload against a BNB Chain hash.**

**Release status:** This repository is not ready to issue production passports. Local phases 1–4 provide PostgreSQL accounts, owner-scoped drafts, private evidence uploads, review, and audited admin management. Phase 5 captures public facts and allows an MFA reviewer to confirm an exact private `2.0.0` snapshot. MFA admins can now inspect an unissued certificate preview and a private saved-hash verification view derived from that confirmation. Local migrated API and headless Chrome checks passed for operator capture, admin confirmation and both new private views. [CI for application commit `e304a77`](https://github.com/DarkPo13/hartolit-web3/actions/runs/37486507646) passed; hosted storage, restore testing and real-device release acceptance remain open. The issued certificate, public verifier, controlled publication, retention operations and deployment workflow are still to be built. Legacy `1.0.0` public readers are disabled in production because their payload includes private data. Do not enter real customer data until hosting, privacy, backup, and release gates are completed. Diia signing is deferred until after the core MVP release. Product claims below describe the intended system, not proven current capabilities. See the [phased application architecture](#phased-application-architecture) below for the current implementation and the [MVP completion guide](MVP_COMPLETION_GUIDE.md) for ordered next steps and a progress estimate.

[![Built on BNB Chain](https://img.shields.io/badge/Built%20on-BNB%20Chain-F0B90B?logo=binance&logoColor=black)](https://www.bnbchain.org/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org/)
[![Solidity 0.8.28](https://img.shields.io/badge/Solidity-0.8.28-363636?logo=solidity)](https://soliditylang.org/)

---

## The Problem

Ukraine is one of the world's top producers of sunflower, corn, and wheat — yet farmers face a critical verification gap that costs them real money:

- **Subsidy fraud** — State agricultural subsidies require proof of treatments; paper logbooks are trivially forged, so honest farmers compete against fraudulent ones.
- **Insurance disputes** — Crop loss claims are rejected when treatment history cannot be independently verified. Insurers need cryptographic proof, not printed PDFs.
- **EU market access** — Phytosanitary export requirements demand auditable chemical application records. Modern EU trace-and-trace mandates cannot be satisfied by paper.
- **No trusted intermediary** — There is no neutral party that farmers, insurers, and regulators all trust — until blockchain.

**Hartolit** operates drone-based crop protection services across central Ukraine. Each season we perform hundreds of treatments. Without tamper-proof records, our clients cannot claim subsidies, prove compliance, or qualify for EU certification programs. This dApp solves that.

---

## The Solution

**Hartolit Digital Field Passport** is designed to mint a unique ERC-721 NFT on BNB Smart Chain for each approved drone treatment. Each token:

1. Will contain a cryptographic SHA-256 fingerprint of the approved public treatment snapshot
2. Will link to an explicitly approved public passport snapshot on IPFS
3. Will be issued directly by an approved Hartolit operator wallet; the website will store no server minter key
4. Will be publicly verifiable at `/verify/{tokenId}` — anyone will be able to check integrity without a wallet or account

The planned certificate QR code will link to the public verifier. A matching hash will show that the published bytes match the on-chain commitment; it will not prove that the treatment happened or met a legal or agronomic standard.

---

## Why BNB Chain

| Requirement | BNB Chain Answer |
|---|---|
| Low cost for high-volume operations | ~$0.05–0.15 per NFT vs $5–50 on Ethereum |
| Fast finality | ~3 second block time |
| EVM compatibility | Full Solidity + Viem/Wagmi + Foundry support |
| Public audit trail | BSCScan contract verification, readable by anyone |
| Testnet parity | BSC Testnet (chainId 97) mirrors Mainnet (56) exactly |
| Accessible globally | BNB is widely available in Ukraine and EU markets |

BNB Chain's economics make this viable at agricultural scale. A farm with 500 drone passes per year pays ~$75 in total gas — less than a single insurance dispute arbitration fee.

---

## How It Works

```
Hartolit Operator
       │
       ▼
┌──────────────────────────────────────────────────────┐
│  STEP 1 — Treatment Form                             │
│                                                      │
│  Block 01: Farmer + Field (name, EDRPOU, GPS, crop)  │
│  Block 02: Treatment (date, drone model, operator)   │
│  Block 03: Meteo file + parsed weather data          │
│  Block 04: Chemical + supplier document              │
└──────────────────────┬───────────────────────────────┘
                       │  Approved public snapshot (Phase 5)
                       ▼
┌──────────────────────────────────────────────────────┐
│  STEP 2 — Public IPFS + operator-wallet mint         │
│                                                      │
│  1. Canonicalize payload → SHA-256 hash (bytes32)    │
│  2. Pin approved public JSON to IPFS                  │
│  3. Call mintPassport(owner, hash, cid)              │
│     on HartolitFieldPassport.sol                     │
│  4. Return tokenId + txHash + blockNumber            │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  STEP 3 — Certificate                                │
│                                                      │
│  Printable NFT certificate with QR code              │
│  Downloadable HTML export                            │
│  → /verify/{tokenId} public verification page        │
└──────────────────────────────────────────────────────┘
```

### Public Verification (Zero-Trust)

Anyone with the QR code or token ID can verify independently — no account, no wallet:

```
/verify/{tokenId}
       │
       ├── Read: ownerOf, tokenURI, payloadHash (from BSC)
       ├── Fetch: full JSON payload (from IPFS)
       ├── Compute: SHA-256 of fetched payload
       └── Compare: on-chain hash === computed hash?
                         │
                    ✅ VERIFIED            ⚠️ TAMPERED
           (data is cryptographically     (IPFS metadata was
            identical to what was          modified after mint)
            submitted at mint time)
```

---

## Smart Contract

`HartolitFieldPassport.sol` — extends `ERC721URIStorage` + `AccessControl` (OpenZeppelin v5).

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract HartolitFieldPassport is ERC721URIStorage, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    mapping(uint256 => bytes32) public payloadHash;    // immutable on-chain proof
    mapping(bytes32 => uint256) public hashToTokenId;  // duplicate guard and recovery

    event PassportMinted(
        uint256 indexed tokenId,
        address indexed mintedBy,
        address indexed to,
        bytes32 payloadHash,
        string ipfsUri
    );

    function mintPassport(
        address to,
        bytes32 _payloadHash,
        string memory _ipfsUri
    ) external onlyRole(MINTER_ROLE) returns (uint256) { ... }
}
```

**Security properties beyond the spec:**

- **Soulbound** — `_update` reverts on any transfer between non-zero addresses. Passports are records, not tradeable assets.
- **Duplicate-payload guard** — `hashToTokenId` reverts mint with `DuplicatePayload()` custom error if the same SHA-256 was already minted.
- **Pauser role** — emergency stop on new mints without revoking minter keys.
- **Custom errors** — cheaper gas, typed on the client.
- **Comprehensive Foundry test suite** — happy path, all reverts, role gating, soulbound enforcement, ERC-165 interface IDs, and fuzz of the unique-hash invariant.

---

## Diia KEP Integration — deferred

Ukraine's [Diia](https://diia.gov.ua/) platform provides government-grade qualified electronic signatures (KEP) legally equivalent to a handwritten signature under Ukrainian law and EU eIDAS regulation.

Diia signing is not part of Version 1. The active wizard, public payload, and certificate do not require or claim KEP signatures. The integration will be designed after the core application and infrastructure are released.

The future design may add two signatures per passport:

- **Drone pilot** signs the meteo observation file (confirms conditions at treatment time)
- **Chemical supplier** signs the purchase document (confirms product authenticity and chain of custody)

The Version 1 IPFS payload contains no signature fields. A later schema version must distinguish signed passports from Version 1 records and verify real signatures before displaying any signed or legally qualified claim.

Future legal review must cover:
- Ukrainian Law No. 2155-IX (electronic documents)
- EU Regulation 910/2014 (eIDAS — qualified electronic signatures)

---

## Data Model

The following example is the legacy local demo payload. It includes farmer identifiers, coordinates, and file references and must not be published for real customers. The Phase 5 public-field policy and separate `2.0.0` schema are described below. Private snapshot confirmation is implemented locally; publication, retention operations and the concrete publishing identity remain incomplete. Diia fields are absent.

```jsonc
{
  "schema": "hartolit.field-passport.public",
  "version": "1.0.0",
  "issuedAt": "2026-05-15T07:30:00.000Z",
  "farmer": {
    "farmerName": "Example Farm",
    "farmerId": "32456789",
    "fieldArea": 56.2,
    "gpsCoords": "49.5826, 34.5544",
    "cadastralNumber": "5322487800:01:001:0042",
    "crop": "sunflower"
  },
  "treatment": {
    "treatmentType": "insecticide",
    "treatmentDate": "2026-05-15",
    "treatmentTime": "07:30",
    "droneModel": "DJI Agras T50",
    "droneSerial": "1ZNBC3K0025678",
    "operator": "Example Operator",
    "pilotCert": "UA-DARS-A2-2024-0342",
    "notes": "Public Version 1 notes"
  },
  "meteo": {
    "file": {
      "url": "https://public.example/meteo.json",
      "sha256": "64-character SHA-256 hex",
      "size": 1024,
      "filename": "meteo.json",
      "contentType": "application/json"
    },
    "data": {
      "temperatureCelsius": 18.5,
      "humidityPercent": 72,
      "windSpeedMps": 2.8,
      "rainfallMm": 0,
      "measuredAt": "2026-05-15T07:15:00.000Z"
    }
  },
  "chemical": {
    "product": "Example product",
    "activeSubstance": "Example active substance",
    "dosePerHa": 0.14,
    "workingVolumeLitresPerHa": 10,
    "manufacturer": "Example manufacturer",
    "registrationNumber": "UA-01-00823-0000",
    "supplierName": "Example supplier",
    "supplierEdrpou": "43210987",
    "file": {
      "url": "https://public.example/invoice.pdf",
      "sha256": "64-character SHA-256 hex",
      "size": 204800,
      "filename": "invoice.pdf",
      "contentType": "application/pdf"
    }
  }
}
```

The SHA-256 of the **canonicalized** JSON is stored on chain as `payloadHash`. The current demo payload reflects the earlier fully public concept and must not be used for real records. The separate Phase 5 allowlist now has a private preview and confirmation; controlled publication remains future work. The optional demo still returns `internal://` file references and does not preserve uploaded bytes. The authenticated draft path stores private evidence in object storage; it does not publish those files to IPFS.

---

## Phased application architecture

Phase 1 stores individual accounts, sessions, MFA enrollment, password reset tokens, and rate limits in PostgreSQL through Prisma and Better Auth. The shared password gate is removed. Anonymous visitors can still use public certificate verification.

Phase 2 stores farmer, field, passport, treatment, meteo, chemical, and audit records in PostgreSQL. Signed-in users can create and edit their own drafts; autosave uses a version check and shows a conflict if another session saved first. The tab stores structured fields only while edits are unsynced. Phase 3 adds private S3-compatible evidence storage with direct, five-minute upload grants, server-side integrity checks, a malware scan, and one-minute owner-authorized download links. The optional local demo remains separate and still uses tab-scoped state. Phase 4 adds submission, assignment, correction, rejection, and approval with version checks and audit history. The admin console at `/admin` includes a review queue and details, draft-only farmer and field editing, archive and restore for completed records, operator invitations and access control, publication monitoring, and searchable passport and admin audit history. Phase 5 will enable controlled publication of an explicitly approved public snapshot.

---

### Phase 5 public snapshot policy — initial scope approved

**Approved by the user on 2026-09-28**, with treated area added by explicit approval on 2026-10-02. Prepared from the Prisma schema, draft DTOs, review service and legacy public viewer. The public schema, allowlisted builder, admin preview and private confirmation are implemented locally; publication is not. V1 retention and publisher engineering defaults are below; their release gates remain open.

Anyone with an IPFS CID can read an unencrypted snapshot and keep a copy. Deleting our database record or unpinning our copy cannot recall other people's copies. Each exact snapshot therefore needs confirmation before publication, even under this approved field policy. See the [official IPFS privacy documentation](https://docs.ipfs.tech/concepts/privacy-and-encryption/).

#### Certificate purpose and evidence requirements

The primary goal is to help a farmer present evidence of a properly performed treatment when an insurer, compensation provider, auditor or other organization assesses crop damage or compliance. A useful certificate must show which field and crop were treated, when, with which products and doses, under which weather conditions, and what evidence supports that record.

- **Every public snapshot field must appear on the certificate and public verifier.** Treatment facts belong in readable sections with units; schema/version, public references, timestamps and evidence digests belong in a verification appendix. The certificate must use the confirmed snapshot, not mutable private rows. Chain receipt facts are shown separately after confirmation.
- **Traceability must reach the real farmer and treated land.** Public farm labels and random field references must have a retained private mapping to the verified farmer/plot. An authorized review of that mapping and original evidence is needed when an organization requires precise identity or location; it does not make those private values public. Recipient sharing/export access is not implemented yet.
- **A dose needs context.** Product instructions or an agronomist recommendation, the relevant crop/use, units, treatment time and conditions must support any claim that the dose was appropriate. The current review service checks required values and verified attachments; it performs no comparison with a product label or agronomic standard. Such supporting records can stay private under this field policy.
- **Field area and treated area must be distinguished.** The current model records both values separately. Before claiming treatment of an entire plot, obtain supporting evidence of coverage; partial treatments require an explicit treated-area value rather than silently treating field area as coverage. Original flight logs or other source documents can support review; automated telemetry ingestion is outside the current MVP.
- **Integrity and factual assessment are separate results.** The hash check confirms the published record has not changed. File scanning confirms technical integrity and malware status. The certificate supports an organization's assessment of proper treatment; that organization assesses the evidence, crop-loss cause, coverage and any compensation. The app must not describe a hash match or internal approval as proof of correct agronomy, full-season care or entitlement to a payment. No Diia/KEP claim is made.

As a design reference, the [EU plant-protection record format](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32023R0564) includes product/authorization, time, dose, treated-area identification/size and crop. This informs the evidence checklist; it does not establish compliance or acceptance for this Ukrainian MVP. Validate a sample certificate and its supporting evidence with the selected pilot organization before claiming it accepts them for claims.

#### Approved starting public fields

| Group | Fields to publish | Source and boundary |
|---|---|---|
| Certificate | Schema name/version, a random public certificate ID, snapshot timestamp, issuer label `Hartolit` | Generated publication metadata; no account or private passport IDs. Timestamp records snapshot creation, not a confirmed mint. |
| Farm | A separately entered and explicitly confirmed public farm display label | `Passport.publicFarmLabel` is entered separately from `Farmer.legalName`; never automatically copy contact names or registration IDs. The label may identify the farm, so its exact text must be reviewed. |
| Field | A random public field reference, area in hectares, crop category | `Field.publicReference` is a random UUID independent of the private field ID; `Field.areaHectares` and normalized `Field.crop` supply the other values. No field label, cadastral number or coordinates. |
| Treatment | Treatment category, date, local time with an explicit timezone, **treated area in hectares**, drone model | `Treatment.treatmentType`, `treatmentDate`, `treatmentTime`, `timeZone`, `treatedAreaHectares`, `droneModel`. Treated area must be positive and no greater than field area. No drone serial, operator name, pilot certificate or notes. |
| Weather | Temperature in Celsius, humidity percent, wind speed in m/s, rainfall in mm, measurement timestamp | Only the five measurement fields in `MeteoMeasurement`. No source file metadata or location. |
| Chemical | Product, active substance, dose per hectare with its unit, working volume in L/ha, manufacturer, product registration number | Only these values from `ChemicalApplication`; `doseUnit` is captured explicitly. Product registration is distinct from farmer/supplier registration. |
| Evidence integrity | Kind and server-verified SHA-256 of the selected weather and chemical source files | Only the reviewed source files with `READY` status. No bytes, filenames, object keys, URLs or other attachments. A digest can link an identical file held elsewhere; it does not grant access to our private copy. |

The connected publisher and recipient wallet addresses, chain, contract, token, transaction, payload hash and IPFS URI will also be public through the blockchain. The verifier reads these separately; they are not embedded in a snapshot that would need to contain its own hash or URI.

#### Fields kept private

| Group | Excluded fields |
|---|---|
| Farmer and field identity | Legal name, tax/registration ID, contact name/email/phone, stored field label, GPS, cadastral number, internal farmer/field/owner IDs |
| People and equipment | Operator name, pilot certificate, drone serial, account details, reviewer identity and assignment |
| Supplier | Supplier name and EDRPOU |
| Notes and operations | Treatment notes, review reasons, audit records, draft versions, archive state, upload/scan state, session and authentication data |
| Evidence access | Raw files, original filenames, MIME/size metadata, storage keys, source-file IDs, signed links, download URLs |

This summary still reveals agricultural and commercial facts. It is not anonymous. Private identifiers must not be hashed into public identifiers; the public references are random values unrelated to those identifiers.

#### Future policy and schema changes

The user may revise the public-field policy for future certificates. A change to field meanings, required evidence or public scope must introduce a new schema version and require confirmation of the new snapshot. New public fields need explicit approval; private values must never become public automatically during an upgrade.

Already published snapshots, hashes and certificates retain their original contents and version. Historical verification must continue to understand supported old versions. Correcting a published treatment requires a new record with an explicit link to the earlier certificate; the original stays available, and the correction history must be visible. This correction flow is planned, not implemented. Correctable private drafts remain editable through the existing review lifecycle.

#### Implementation gates

**2026-10-04 progress:** Gate 1 captures an explicit chemical dose unit, separately entered public farm label, random field reference, treatment time zone and distinct treated area. Existing unknown values remain unknown. A strict `2.0.0` public schema and allowlisted server builder select two explicit verified source files, render all public values and calculate SHA-256 of canonical JSON. An MFA admin can preview it; the approving reviewer can save the exact bytes, hash and source selection against the approved version. This confirmation is private and is neither an issued certificate nor a publication. The confirmation migration and live smoke passed in CI and locally; a focused desktop/mobile Chrome pass covered the admin confirmation flow. Hosted acceptance remains open.

1. Capture explicit public labels/references, dose unit, timezone and treated area through new migrations and validated form fields. Do not guess units, timezones, treated area or labels for existing drafts. **Completed locally on 2026-10-02; a local Chrome operator flow verified entry, persistence, evidence upload, reload and submission on 2026-10-04. Hosted verification remains open.**
2. Define a new strict public schema, separate from legacy demo version `1.0.0`, and a server builder that selects each approved field by name. Normalize crop/treatment categories; never spread or serialize raw Prisma rows. Review each remaining public text field for private content. **Builder and category validation implemented locally; human review of free text remains necessary.**
3. Show the exact public snapshot to an MFA admin, then bind confirmation to the approved passport version and snapshot hash. Rebuilding server-side must detect changed facts or evidence; recall invalidates the saved confirmation. Derive every future public certificate/verifier field from those confirmed bytes and display all of them, including the verification appendix. **Persistence, reviewer confirmation and recall invalidation are implemented locally. Private admin-only certificate and saved-hash verification views render every public field from confirmed bytes and close on recall. Their local signed-in HTTP and desktop/mobile Chrome checks passed; an issued certificate and a public verifier remain pending.**
4. Test private-field exclusion, unknown-field rejection, missing units/timezones, unapproved versions, hash equality after JSON transport and certificate coverage of every public field. Tests must use private markers in excluded source fields and inspect the actual serialized output. Future schema additions must preserve historical verification. **Live review smoke covers preview authorization, source selection, serialized private-marker exclusion, version rejection and transported hash; `test:public` checks readable preview coverage. Issued-certificate coverage and historical verification remain pending.**
5. Apply the internal retention and publisher rules below before adding real IPFS or wallet publication. Verify retention with Ukrainian counsel and the pilot organization, and designate the initial publishing admin and wallet before real-data release. Keep legacy demo issuance closed for real data.

Public verification will confirm integrity of the published snapshot. It does not prove the treatment happened or provide a Diia/KEP signature. Public certificate and verifier screens must use this new schema, rather than the legacy viewer that exposes the complete demo payload.

#### V1 private-data retention policy — implementation target

The certificate's claim-support purpose depends on keeping the original evidence and private farmer/field mapping available. **The user delegated the V1 product choice on 2026-10-03. These are adopted engineering defaults, not verified Ukrainian legal minimums or an active deletion workflow.** Have Ukrainian counsel and the pilot organization review the actual record, notice and hold requirements before accepting real customer data. EU pesticide-use record periods differ by actor under [Regulation 1107/2009, Article 67](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02009R1107-20221121); they do not establish a Ukrainian period. The [Ukrainian personal-data law](https://zakon.rada.gov.ua/laws/show/2297-17) makes deletion and continued-processing grounds relevant; do not infer a universal five-year term from it.

| Record class | V1 engineering policy |
|---|---|
| Issued certificate support | Keep the private treatment record, necessary farmer/field mapping, referenced original evidence and review history for **five years from publication**. Preserve the reviewed version referenced by each certificate; reprinting does not restart the period. |
| Final reviews without publication | Keep finalized review records and their supporting evidence for **five years from the final decision**. A later publication starts its own certificate-support period. |
| Unused drafts | After **90 days of inactivity**, notify the owner before deleting never-submitted drafts and unreferenced attachments. Submitted records, certificate references and active claims are excluded. The notice and deletion workflow must be implemented before any automatic cleanup. |
| Open claims or disputes | An explicit preservation hold blocks deletion of the relevant records and files until the hold is released and the ordinary retention period has expired. Hold management is not implemented yet. |
| Private backups | Target a **30-day rolling window** of matched database/object backups. Deletions must age out of backups, and a restore must reapply deletion records and preservation holds before user access resumes. Provider support and restore acceptance remain Q2/S7 work. |
| Authentication data | Keep the existing session/reset expiry rules separate; this policy does not extend token or session lifetime to five years. |

Public snapshots and blockchain records remain public after private retention expires. A digest alone cannot recreate the deleted original evidence. Changing a future retention default must account for existing certificates and active claims; it must not silently shorten preservation commitments. Current `evidence:prune` only cleans stale upload/scan/rejected objects; no business-record retention or preservation holds exist in the application. **Do not automatically delete business records until notice, holds, deletion and restore behavior are implemented and tested.**

#### V1 publisher rule — implementation target

Only one designated, active Hartolit MFA admin may publish Testnet records, using an explicitly allowlisted operator wallet. The application must bind each future publish to the current confirmed public snapshot and require a fresh server-side status/version check before any irreversible operation. The web host must not hold a blockchain private key. The concrete admin account and wallet address must be configured and verified before publication; no publication route exists yet. Other MFA admins may inspect previews, but only the reviewer who approved a passport can confirm its exact snapshot. Confirmation stores private audit data and public-intended bytes in PostgreSQL; it does not write to IPFS or a chain.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16.3 (App Router, Turbopack) + TypeScript strict |
| Styling | Tailwind CSS v4 (CSS-first `@theme`, zero config file) |
| Forms | React Hook Form + Zod validation |
| State | PostgreSQL is authoritative for signed-in structured drafts; Zustand and tab-scoped `sessionStorage` recover unsynced edits |
| Accounts | Better Auth + PostgreSQL + Prisma; invite-only users and admin TOTP |
| Web3 | Wagmi v2 + Viem + RainbowKit |
| Blockchain | BNB Smart Chain — Mainnet (56) + Testnet (97) |
| Smart Contract | Solidity `^0.8.24` source, compiled with 0.8.28; OpenZeppelin v5 + Foundry |
| IPFS | Pinata HTTP API through a server-only `fetch` helper; publication remains disabled |
| Electronic Signatures | Deferred until after the core application and infrastructure release |
| i18n | Custom React context — Ukrainian (default) + English |
| QR Code | `qrcode` library — verification URL embedded in certificate |
| File Parsing | PapaParse (CSV), Web Crypto API (SHA-256 hashing) |
| Hosting | Provider and region to be selected before a hosted pilot; server routes use the Node.js runtime |

---

## Project Structure

```text
app/                    # Pages: home, auth, admin, settings, public verification
app/api/                # Auth, drafts, evidence, review, and guarded prototype routes
components/drafts/      # Durable draft editor, evidence panel, review status
components/wizard/      # Optional local prototype wizard and certificate
components/form/        # Shared farmer, treatment, weather, and chemical forms
lib/drafts/             # Draft validation, ownership, and persistence
lib/evidence/           # Private storage, scanning, and file lifecycle
lib/review/             # Submission, assignment, decisions, audit-backed records
lib/contract.ts         # Hand-maintained app ABI, checked against Foundry output
prisma/                 # Schema and committed migrations
scripts/                # Setup, smoke checks, cleanup, and ABI check
contracts/              # Foundry contract, tests, and deployment script
```

---

## Local Setup

### Prerequisites

- Node.js 24, matching CI
- Docker for local PostgreSQL, private storage, malware scanner, and Mailpit
- [Foundry](https://getfoundry.sh/) for contract builds and tests
- WalletConnect project ID for the optional local wallet demo
- An approved operator wallet with test BNB only when the Testnet release gates are met; never place its private key in the website environment

### 1. Install dependencies

```bash
npm ci
```

### 2. Configure environment

```bash
npm run db:setup
npm run evidence:setup
npm run dev:services:up
npm run evidence:up
npm run evidence:configure
npm run db:deploy
npm run auth:create-admin
npm run dev
```

`db:setup` adds a random PostgreSQL password and Better Auth secret to ignored local environment files without replacing existing values. `evidence:setup` adds separate random local storage credentials. `dev:services:up` starts PostgreSQL and a local Mailpit inbox at <http://localhost:8025>; `evidence:up` starts SeaweedFS and ClamAV; `evidence:configure` sets browser CORS on the local private bucket. Wait for the scanner to become healthy before uploading. The account command prompts for an admin email and password; use a unique password of at least 12 characters and store it in a password manager. Sign in at <http://localhost:3000/login>, then enroll an authenticator app at `/settings/security`. Enrollment revokes earlier sessions, so sign in once more with your new six-digit code. Invite operators from `/admin` → **Users** after configuring SMTP; the console requests a password setup email and reports if that request fails. The operator can also use **Forgot password** to request a fresh link. `npm run auth:create-operator` remains available for local setup without SMTP. Never pass passwords on a command line or commit local environment files.

After creating an operator, sign in and select **New draft** to save structured details to PostgreSQL. Attach up to 20 active evidence files per draft in the private evidence panel. Supported files are PDF, PNG, JPEG, JSON, CSV, TXT, and XML up to 10 MB each. An attachment is downloadable only after the server verifies its size, type, SHA-256, and ClamAV result. Remove abandoned or unwanted attachments in the panel. An already issued download link can remain usable for up to one minute if object deletion fails. Optional fictional local data can be added with `npm run db:seed:fictional -- --owner operator@example.com`; the command is idempotent for that owner and refuses a nonlocal database. `npm run drafts:smoke`, `npm run evidence:smoke`, `npm run review:smoke`, and `npm run auth:smoke` check the authenticated APIs against the running local server, then remove their fixture accounts, drafts, messages, and objects. `npm run evidence:prune` previews stale quarantine cleanup; add `-- --execute` to perform it.

To review a passport, complete the required form fields, upload weather and chemical evidence, and wait until both files show **Verified**. Save the draft, then select **Submit for review**. Submission freezes the draft and its evidence. Sign in as an MFA-enabled admin at `/admin`, open the review queue, assign the passport to yourself or another active MFA admin, inspect the details and evidence, and approve, reject, or request changes. Rejection and correction require a reason. The operator sees the decision and can reopen a rejected or correction-requested passport, edit it, and submit again. For an approved passport, choose one verified weather file and one verified chemical file, inspect the exact public preview, and have the approving reviewer check and confirm it. The saved confirmation links to private certificate and verification views; both are marked unissued and unpublished. A recall invalidates that private confirmation and closes both views. All transitions are version checked and audited. Publishing a passport or certificate is still disabled.

In **Records**, admins can search farmer, field, user, publication, passport audit, and admin action lists. Farmer and field details can be edited while all linked passports remain drafts; an edit increments those draft versions, so an operator with an older version must reload. Submitted and reviewed details are locked. A farmer or field can be archived after its linked drafts and submissions are completed, then restored if needed. The **Users** tab creates operator accounts by email and can disable, enable, or sign out an operator on all devices; admin accounts and roles are managed outside this console. Both audit views support actor/action search and UTC date filters. Publication rows are monitoring only until Phase 5.

The local inbox captures password reset emails. For hosting, configure a managed PostgreSQL `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and transactional SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and optional `SMTP_USER`/`SMTP_PASSWORD`). Configure a **private** S3-compatible bucket with `EVIDENCE_S3_BUCKET`, `EVIDENCE_S3_REGION`, and optional `EVIDENCE_S3_ENDPOINT`; the endpoint must be reachable by the server and operators' browsers. Use a dedicated storage identity via `EVIDENCE_S3_ACCESS_KEY`/`EVIDENCE_S3_SECRET_KEY` or the host's workload identity, restricted to this bucket. Permit POST and GET from the deployed app origin in bucket CORS, block anonymous access, and run ClamAV at `EVIDENCE_CLAMD_HOST`/`EVIDENCE_CLAMD_PORT`. Schedule `npm run evidence:prune -- --execute` daily. Apply committed migrations with `npm run db:deploy` before starting the app. Use a production SMTP service that supports TLS. The deployed origin must be reachable only through a trusted reverse proxy that controls the client IP header used for rate limiting. Test a matched PostgreSQL and object-bucket backup/restore, unauthorized access, and expired links in the hosted environment before real data.

Edit `.env.local`:

```env
# Required only for the optional local wallet demo
NEXT_PUBLIC_WALLETCONNECT_ID=your_project_id

# Set after deploying the contract (see below)
NEXT_PUBLIC_CONTRACT_ADDRESS=0x...
NEXT_PUBLIC_CHAIN_ID=97           # 97 = BSC Testnet, 56 = Mainnet
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Server-side only — protects the IPFS integration
PINATA_JWT=eyJ...
BSC_TESTNET_RPC=https://bsc-testnet-rpc.publicnode.com
BSCSCAN_API_KEY=...
```

### 3. Smart contracts

```bash
cd contracts
forge install --no-git OpenZeppelin/openzeppelin-contracts@v5.6.0 foundry-rs/forge-std@v1.16.1
forge build
forge test -vvv
```

The deploy script currently reads `ADMIN_PRIVATE_KEY` and `BSC_TESTNET_RPC` from the deployment shell; Foundry does not load `.env.local` automatically. `ADMIN_PRIVATE_KEY` is a deployment-only input and must not be configured in the web host. Deploy only after the release gates are met. Then deploy to BSC Testnet:

```bash
# from project root
npm run contracts:deploy:testnet
```

Copy the deployed address into `NEXT_PUBLIC_CONTRACT_ADDRESS`.

### 4. Run the dApp

```bash
npm run dev
# → http://localhost:3000
```

For the local prototype only, set `NEXT_PUBLIC_DEMO_MODE=true` in `.env.local` and restart the dev server. Leave `ADMIN_PRIVATE_KEY` and `PINATA_JWT` unset: the unauthenticated demo refuses real credentials. The **"Fill mock data"** button then pre-fills fictional test data. Diia is not part of this flow.

With demo mode off, the signed-in home page shows durable structured drafts. Private evidence upload and submission for admin review are available locally. Issuance and public publication remain disabled.

---

## Testing Without a Wallet

The local prototype can run without a wallet when `NEXT_PUBLIC_DEMO_MODE=true` and no real contract or Pinata configuration is present. Production builds ignore the demo flag. Authenticated draft and private-evidence APIs can write to configured storage; issuance, public pinning, and Diia write routes remain disabled outside the local demo until the approval and controlled publication phases are complete.

| Feature | Local demo | Current configured path |
|---|---|---|
| Form fill | One-click "Fill mock data" | Signed-in PostgreSQL drafts with autosave |
| File upload | Returns SHA-256 + `internal://` reference without storing bytes | Bytes are stored in a private S3-compatible bucket; evidence becomes available after integrity and malware checks |
| Diia KEP signing | Deferred | Planned after the core MVP and infrastructure release |
| IPFS pinning | Returns deterministic mock CID | Disabled until the public snapshot and approval flow are implemented |
| Blockchain mint | Returns simulated tokenId + txHash | Direct approved-wallet minting still needs implementation and end-to-end validation |

---

## Private publication reservation

The first publication increment reserves the exact active confirmed `2.0.0` bytes in PostgreSQL. MFA admins can read reservation metadata at `GET /api/admin/passports/{id}/publication`. Only the active MFA admin configured by `HARTOLIT_PUBLISHER_USER_ID`, using the wallet allowlisted by `HARTOLIT_PUBLISHER_WALLET`, can POST a reservation. The strict input contains `confirmationId`, `passportVersion`, `expectedSha256` and `walletAddress`. Missing publisher configuration fails closed. These variables belong in the server environment; wallet private keys do not.

Concurrent identical requests converge on one reservation and one audit entry. The server rechecks approval, the active confirmation, canonical bytes/hash and the selected verified evidence. Recalling approval cancels the reservation atomically while retaining its history; recall is blocked once an external stage has started. A configured wallet address is **not proof of ownership**. A separate private wallet-signature API and admin UI now provide that proof. Internal dispatch boundaries and readback reconciliation are described below; external dispatch remains disabled. These APIs perform no IPFS or blockchain operation.

### Private wallet ownership proof

The same designated service wallet will prove ownership and later sign issuance; a second wallet is not required. Pilots enter facts through their application accounts. The planned public certificate/QR verifier will require neither a wallet nor an account from farmers or readers.

1. POST `/api/admin/passports/{id}/publication/wallet-challenge` with `{ "publicationId": "<reservation UUID>" }`. The designated MFA publisher receives an exact server-created message identifying the application origin, Testnet chain, wallet, certificate, reservation, payload hash, random nonce and five-minute expiry. Concurrent retries reuse the live challenge.
2. Sign the returned **unchanged message** with that wallet using EIP-191 message signing. It proves wallet control only and does not authorize publication or a blockchain transaction. This step has no chain fee.
3. POST `/api/admin/passports/{id}/publication/wallet-proof` with `publicationId`, `challengeId` and the 65-byte hex `signature`. The server rechecks current approval, saved bytes, evidence, publisher, wallet and challenge context, verifies the signature locally, then atomically consumes the challenge, stores its private proof and writes audit. Concurrent replays are rejected. Reservation metadata exposes only `walletVerifiedAt`, not the signature/message.

Apply the additive `20261021135954_publication_wallet_proof` migration before starting this version. Expired challenges can be renewed; the previous challenge stays invalid. Recall invalidates pending and consumed challenges and clears active verification while preserving history. Later external stages must recheck the complete current authorization and confirmed-byte conditions; the timestamp alone must never authorize publication.

This slice supports ordinary EOA wallets only, using [Viem's local EIP-191 verifier](https://github.com/wevm/viem/blob/main/src/utils/signature/verifyMessage.ts); contract wallets are not supported. No RPC is used for server signature verification, and no signing key belongs in the web environment. Actual minting remains unbuilt.

### Use the admin wallet panel

1. Configure `HARTOLIT_PUBLISHER_USER_ID` with the designated MFA administrator's database ID and `HARTOLIT_PUBLISHER_WALLET` with that person's public service-wallet address, then restart the server. No wallet secret is needed. Open the application at its configured `BETTER_AUTH_URL` origin.
2. Sign in as that administrator, open an approved passport and confirm its exact public snapshot. The **Service wallet** panel appears below the saved public facts. Other MFA admins see read-only access; missing publisher configuration is shown explicitly.
3. Choose **Prepare record**, then **Connect browser wallet**. This slice uses the browser's injected EOA wallet only; WalletConnect, QR wallet pairing and mobile deep links are not included. The wallet session stays in memory, without local/session storage. Wrong accounts are blocked; select the allowed account and BSC Testnet when prompted.
4. Choose **Prepare message**, inspect the exact message and check the review box. **Sign message** requests a message signature only. Refusal, expiry and renewal have explicit states. Changing accounts or leaving the passport during the wallet prompt prevents a late signature from being submitted for that screen.
5. Successful proof is read back from the server and survives page reload. If a save response is lost, the panel rereads status before offering another signature. The record remains private and visibly unissued; this panel sends no minting transaction.

The interface is available in Ukrainian and English. Local Chromium checks used an injected EIP-1193 test provider with real ephemeral EIP-191 signatures and migrated PostgreSQL; an actual user extension/device still needs manual acceptance. The new panel uses an isolated Testnet-only Wagmi provider, independent of the legacy demo's Mainnet/WalletConnect configuration.

`npm run publication:smoke` requires the local migrated database, a production build and free port 3001 (override with `PUBLICATION_SMOKE_PORT`). It starts/stops isolated production servers, checks exact PostgreSQL constraints, authorization, private history, publisher eligibility metadata, source rejection/purging, real test-wallet signatures, message/context binding, expiry, replay, concurrency and recall, then removes its fictional accounts/records. Signing keys are generated only in the test process and never sent to the application server or printed. It models already scanned evidence; the separate `review:smoke` checks actual uploads/scanning. `npm run test:wallet` checks local signature recovery independently of the database. The exact application checkpoint and its CI result are recorded in [STATE](.ai/STATE.md); a CI pass does not establish browser-extension, hosted or live-provider acceptance.

### Durable pinning boundary — internal foundation

Apply all migrations with `npm run db:deploy`, including `20261021185106_publication_upload_target`. The MFA-admin panel can now save or cancel a **private preparation** through `POST`/`DELETE /api/admin/passports/{id}/publication/pin-attempts`. There is still **no dispatch endpoint, Server Action, worker or configured production uploader**. An internal upload driver and an offline-only Kubo fixture exercise that separate boundary locally. Ownership signing alone is insufficient: preparation requires separate acknowledgement of the exact confirmation ID, version, data hash and server-owned target fingerprint.

| Attempt state | Meaning | Permitted recovery |
|---|---|---|
| `PREPARED` | Private intent only; the publication remains `RESERVED` | Cancel before dispatch and create a new request; recall atomically cancels prepared attempts |
| `DISPATCHING` | The database committed dispatch permission; the publication is `PINNING` | Never issue another dispatch command for a repeated request |
| `UNKNOWN` | A transport error or elapsed dispatch deadline leaves the external result uncertain | Keep `PINNING`, block recall/resending, and use internal readback reconciliation to establish the result |
| `CANCELLED` | Cancelled before dispatch; history retained | A different request ID may prepare a new attempt while the approval remains active |
| `VERIFIED` | Provider reported a pin and the returned raw block matched the confirmed bytes and CID | Publication is `PINNED`; no repeat dispatch, recall, token or issued certificate |

Preparation and dispatch recheck current publisher configuration, active MFA administrator, approved version, exact saved bytes, selected READY evidence, and the complete consumed/unrevoked wallet signature. A challenge consumed before its five-minute deadline remains valid afterwards; its stored signature/context are checked again. All transitions share the passport lock with recall. PostgreSQL additionally enforces one active attempt per publication, timestamp consistency and a proof belonging to the same publication. Only one concurrent caller receives the saved canonical bytes and stable provider idempotency key. Provider idempotency support is still unverified; this is not an exactly-once network-delivery guarantee.

Internal recovery may mark an attempt unknown even if the initiating administrator has since lost access. Its audit actor is explicitly `system:publication-recovery`. Expiry is never treated as proof that nothing was published. Readback and verified-CID persistence now exist internally; automatic retry after dispatch, a hosted uploader, wallet send integration and a recovery scheduler remain unbuilt. Internal chain history/finalization are described below.

The expanded `publication:smoke` exercises these internal services against real PostgreSQL and real ephemeral wallet proofs, alongside the existing production HTTP checks. It covers explicit acknowledgement, invalid/revoked stored proof, concurrent preparation/dispatch, cancellation/retry before dispatch, recall races, exact dispatch bytes, SQL constraints, timeout recovery and blocked resending. The readback fixture runs the read-only adapter with fictional HTTP responses and checks exact stored receipts; it does not establish live provider behavior, hosted recovery or a publication UI.

### Verify a pin after a lost response

The current storage profile is deliberately narrow: one block of at most 64 KiB, CIDv1 `raw`, SHA-256 and lowercase base32. It follows the [IPFS CID specification](https://specs.ipfs.tech/cid/) and [raw gateway response format](https://specs.ipfs.tech/http-gateways/trustless-gateway/). The CID is computed and bound before dispatch; computing it alone makes no storage claim. DAG-PB, CIDv0, directories, JSON reserialization and larger/multiblock files are unsupported. Do not reuse the legacy `pinJson` helper: a future uploader must preserve the exact canonical UTF-8 bytes and this storage profile, or fail closed.

`lib/publication/ipfs-reader.ts` implements **GET only** against the [standard IPFS Pinning Service API](https://github.com/ipfs/pinning-services-api-spec/blob/main/ipfs-pinning-service.yaml), filtering the exact CID and `pinned` status, then reads its raw gateway block. Set `HARTOLIT_IPFS_PINNING_API_URL` to the API base without `/pins`, `HARTOLIT_IPFS_PINNING_TOKEN` to its server credential and `HARTOLIT_IPFS_GATEWAY_URL` to an HTTPS origin. This is not the legacy Pinata JSON API; the selected provider must demonstrate compatibility before release. Both endpoints require HTTPS, reject redirects and use bounded response sizes and 10-second request deadlines. The provider credential is never sent to the gateway. Raw upstream errors/content are not logged or returned. No environment variable enables uploads or public issuance.

`reconcilePinAttempt` is an internal service, with no HTTP/worker entry point. Network reads run outside database transactions; the saved confirmation, hash, CID binding and dispatched attempt are rechecked under the passport lock before storing the receipt. A matching pinned status alone, or matching gateway bytes alone, is insufficient. Successful verification atomically stores `VERIFIED`, CID, provider pin ID, verification time, publication `PINNED` and one system audit event. Concurrent repeats converge without replacing the receipt. Missing/malformed/unavailable reads stay blocked as `UNKNOWN`; a stale negative response rereads current state before reporting uncertainty. An already verified repeat returns the saved historical receipt, not a new availability guarantee.

Recovery records the result of an already authorized dispatch even if its initiator is now banned; it grants no new publishing permission. It does not mint, mark the certificate issued, permit a post-dispatch retry or open public access. The default test transport creates no real pin; the optional fixture below stores only fictional blocks on an offline local node. Provider choice and live readback/upload compatibility, retention monitoring, explicit publication UI and chain issuance remain release work. `npm run test:ipfs` checks an independent spec vector and the HTTP boundary; the publication smoke checks the actual persisted receipt, invalid data, races and SQL constraints.

### Local upload and recovery fixture

`preparePinAttempt` now requires a server-owned target: provider key, protocol, non-secret account scope, normalized API/gateway origins and raw storage profile. Its fingerprint and profile are saved before dispatch and checked again before upload and every readback. A changed target or a historical attempt without a binding is rejected; it is never silently rebound. Credentials are not stored in this description. This is configuration binding, not independent attestation of a remote provider's identity.

The internal `executePinUpload` driver consumes one dispatch permission, uploads the exact confirmed UTF-8 block, then verifies pin status and bytes before saving `PINNED`. Upload acknowledgement alone is insufficient. If the acknowledgement is lost after storage, readback can recover the result. If storage cannot be established, the attempt stays blocked and cannot be resent. No browser route or production configuration calls this driver yet.

The local adapter follows [Kubo's block/put and pin/ls RPC](https://docs.ipfs.tech/reference/kubo/rpc/). It validates the strict public schema, canonical bytes/hash/CID and 64 KiB limit before I/O, pins the raw block and checks its returned CID/byte count. It rejects production execution and non-loopback endpoints. It is a protocol fixture, **not the selected hosted IPFS service**; choosing it does not activate public publishing.

To run the optional actual-node check after local database setup:

```sh
docker compose --env-file .env.db.local --profile publication-local up -d postgres kubo-local
npm run db:deploy
npm run build
npm run publication:smoke:offline
docker compose --env-file .env.db.local --profile publication-local stop postgres kubo-local
```

The fixture uses Kubo `v0.43.1`, `--offline`, an internal Docker network, no published container ports and an ephemeral repository. The smoke verifies that isolation and opens temporary **loopback-only** tunnels on ports 15001/18080 through `docker exec`; they close in its `finally` block. Port 3001 must also be free. The test covers successful storage, concurrent requests, lost acknowledgement, failure before writing, target mismatch, historical unbound attempts, SQL target constraints and blocked resending. Only its fictional blocks/pins and database records are cleaned; it does not contact the public IPFS network. Stopping the fixture discards its ephemeral repository. These checks do not establish hosted TLS/authentication, provider retention, installed-wallet or public issuance acceptance.

`npm run test:upload` and the default `publication:smoke` use injected transport and do not need Docker Kubo. Both are configured in CI; the optional offline-node check is local only. The current CI result covers only its exact committed SHA, not uncommitted changes.

### Save separate publication consent

1. The designated MFA publisher opens the approved, confirmed record and completes the existing wallet ownership proof. That message signature does not save publication consent.
2. The server needs a **description**, not a service credential: `HARTOLIT_PUBLICATION_TARGET_KEY`, `HARTOLIT_PUBLICATION_TARGET_SCOPE`, `HARTOLIT_PUBLICATION_API_ORIGIN` and `HARTOLIT_PUBLICATION_GATEWAY_ORIGIN`. The scope is a non-secret account/namespace identifier; the origins have no paths/credentials and describe the current Kubo raw profile. These variables do not activate upload/readback or select an accepted hosted provider. Leave them blank until a target is chosen; local tests use only fictional descriptions.
3. In **Publication preparation consent**, inspect the selected storage and exact saved public facts. The same complete `2.0.0` renderer is reused. Review the permanence notice, check the separate consent box and choose **Save consent and prepare**. The API rechecks current MFA/designated publisher, approval/version, exact confirmation/hash, consumed wallet proof, READY evidence and the reviewed target fingerprint under the passport lock.
4. A successful save remains `PREPARED`/`RESERVED`: no upload, token, transaction or issued certificate exists. Refresh/reload reads saved state. Lost responses trigger a status read before offering another action. Repeated identical requests converge; a stale target is rejected rather than silently accepted.
5. Before dispatch, **Cancel preparation** retains history; a later preparation needs fresh consent. Other MFA admins can inspect state but cannot prepare/cancel. A changed target is visible, and a prepared attempt can still be cancelled without rebinding it. Once internal dispatch starts, cancellation/resend/recall stay blocked; `UNKNOWN` and verified `PINNED` states are distinct from issuance. No UI button starts dispatch in this increment.

`publication:smoke` covers the real private preparation/cancellation HTTP routes and stored values in addition to the internal lifecycle. The optional browser fixture is `PUBLICATION_BROWSER_FIXTURE=1` with that smoke: it pauses with fictional authenticated sessions on a loopback-only helper at port 3103, then resumes/cleans up after `/finish` or a timeout. It is test tooling, not an application authentication route; never run it with real users or expose it remotely.

## Local chain mint verification foundation

`lib/publication/chain-mint.ts` is a **read-only internal boundary**. It has no HTTP endpoint, wallet prompt, DB writer or configured production caller. It does not turn a pin receipt into an issued certificate. Current database authorization/approval/consent, verified storage and a separately authorized send remain the future caller's responsibility.

- Create an immutable versioned intent from strict canonical `2.0.0` public bytes/hash/raw CID and server-selected Testnet chain, contract/runtime-code hash, publisher, recipient and confirmation depth. The fingerprint binds all of them and the exact `mintPassport` calldata. The wallet-call description contains only the zero-value call and public addresses/hash/URI. No recipient policy or actual release addresses are chosen by this helper.
- Read-only readiness checks the actual runtime code, `MINTER_ROLE`, pause state and existing payload index at one anchored block. `READY` is advisory, with no permission to send. `ALREADY_MINTED` blocks duplicate work; it does not silently adopt an existing certificate.
- Transaction inspection requires exact chain, sender, contract, calldata and zero value; one matching `PassportMinted` event with the correct block/transaction context; and matching owner, URI, hash and payload index at the inclusion block. Contract code is checked at inclusion and the observed head. Canonical block/receipt/chain identity is read again after state reads to detect branch changes.
- `UNKNOWN`, `PENDING`, `CONFIRMING`, `REVERTED`, `REORG` and `VERIFIED` remain distinct. Every result says `issued: false` and `canResend: false`. `VERIFIED` includes observed receipt evidence after the configured depth, not permanent finality or a public certificate. The durable attempt/finalization and bounded hash-recovery layers are described below. Scheduled reorg monitoring, reviewed failed-send/quarantine recovery and a wallet send action remain open. The selected RPC and finality policy need external acceptance before release.

The reader uses Viem's [transaction receipt](https://viem.sh/docs/actions/public/getTransactionReceipt), [event decoding](https://viem.sh/docs/contract/parseEventLogs) and [block-scoped contract reads](https://viem.sh/docs/contract/readContract). RPC credentials, timeouts and limits belong to a trusted server dependency; no request-supplied RPC URL or signing key is accepted by this module.

```sh
npm run test:chain
npm run contracts:build
npm run chain:smoke
```

The actual-node smoke needs Foundry/Anvil (`anvil` on PATH, or `ANVIL_BIN` pointing to the binary) and the compiled contract/libraries described above. It starts its **own** [Anvil](https://www.getfoundry.sh/anvil/index.html) on an ephemeral loopback port with chain ID 97, no fork and no default accounts. Only ephemeral fictional test keys are generated inside the test process; they are never sent to the app, put in its environment or printed. It verifies its child's readiness before RPC, deploys the actual contract, compares deployed runtime to the compiled artifact, tests actual mint/depth/pending/duplicate/reverted/paused/wrong-recipient/trailing-calldata behavior, and uses snapshot/revert to reject a stale receipt on a new branch. The child is stopped in `finally`; no public network, database or app server is involved.

This increment was tested with Foundry `v1.8.6` and solc `0.8.28`; CI pins that Foundry version. The web job runs injected chain regressions; the contract job additionally installs JS dependencies without lifecycle scripts (no Prisma/DB needed) and runs the actual local-chain smoke after compiling/testing the contract. A configured CI step is not a passed run until the exact commit is pushed and succeeds.

## Private durable mint preparation

`lib/publication/mint-preparation.ts` adds a separate **internal, private planning step** after verified storage. It has no HTTP action, RPC client, wallet send or configured target. A trusted future caller must show the exact mint intent and supply the reviewed fingerprint and separate `PREPARE_EXACT_MINT` acknowledgement. Actual recipient/contract/RPC choices remain release decisions.

Under the passport lock, the service rechecks the current designated MFA publisher, approval/version, active confirmation, canonical public bytes, current facts and selected READY evidence, consumed wallet signature and the bound `VERIFIED` pin receipt. Only the exact `PINNED` publication can proceed. Ordinary preview/confirmation remain blocked after external dispatch. Migration 17 stores canonical intent JSON/fingerprint and its pin/publication linkage, with unique request/publication constraints and a composite foreign key preventing cross-publication pin references.

Concurrent identical requests create one preparation and audit event; replay returns that record only after all checks pass again. A different request or changed commitment cannot replace it. There is no amendment/cancellation path yet. Preparation leaves publication `PINNED` and contract/transaction/token fields unset; it grants no send/resend permission. The separate internal dispatch boundary below does not have an application caller.

Apply with `npm run db:deploy` and regenerate the client with `npm run db:generate`. The expanded `npm run publication:smoke` tests the actual DB/HTTP workflow plus internal mint services with fictional data and injected IPFS transport. It uses an explicit IPv4 loopback listener/address (override `PUBLICATION_SMOKE_PORT` if occupied) and cleans its own records. Default chain reads are injected; the local-chain variant below additionally exercises actual nonce/send behavior on owned Anvil. Existing `chain:smoke` separately checks receipt/reorg verification.

## Internal single-use mint dispatch permission

`lib/publication/mint-dispatch.ts` consumes a separate strict `SEND_EXACT_MINT` acknowledgement bound to the saved preparation/fingerprint. The trusted read-only dependency checks readiness and the [wallet transaction count](https://viem.sh/docs/actions/public/getTransactionCount): a nonnegative safe nonce at an anchored block must match two pending reads. Pending activity, changed chain/block/code/role, an existing payload or unavailable RPC refuses permission. The observation must be less than 15 seconds old before writing the attempt. No RPC runs while a DB transaction is open.

After reads, reauthorize current MFA publisher, confirmation, version, facts/evidence, consumed proof, verified pin and exact intent under the passport lock. A transaction-scoped [PostgreSQL advisory lock](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS) serializes that wallet's check/write across passports; SQL independently enforces one active attempt per chain/wallet and unique preparation/request/nonce bindings. Migration 18 commits attempt `DISPATCHING`, its fixed nonce/deadline and audit together with publication `CHAIN_PENDING` **before** returning one zero-value wallet command. Replays never receive it again, including after a lost response.

The five-minute deadline is an uncertainty threshold, not permission expiry that makes retry safe. Internal recovery records `UNKNOWN` idempotently even after initiator/config revocation and retains the wallet slot/nonce. Fresh successful finalization or separately reviewed exact reverted-send closure below can release the active slot. Unresolved/cancelled sends remain blocked, and no original command/preparation can be resent automatically. No scheduler or resend path exists. An exclusive application wallet is required: DB locks cannot prevent unrelated software using its nonce. The historical observer below verifies the stored nonce as well as the exact mint intent.

This service **does not broadcast** and has no HTTP action, configured RPC, wallet UI caller or signing key. Dispatch alone leaves publication transaction/token/contract success fields unset. Historical readback and internal fresh finalization are described below; continuous monitoring and unresolved-send/quarantine recovery remain open.

With migrated local PostgreSQL, a production build, Foundry/Anvil on PATH (or `ANVIL_BIN`) and the compiled contract, run the combined fixture in PowerShell:

```powershell
$env:PUBLICATION_LOCAL_CHAIN = "1"
try { npm run publication:smoke } finally { Remove-Item Env:PUBLICATION_LOCAL_CHAIN }
```

The test owns a loopback-only, non-forked Anvil, creates no default accounts and deploys the actual contract using the existing ephemeral fictional test signer. The key remains inside test tooling, never in the web environment. Real PostgreSQL races across two passports must grant one command; the test wallet sends it with the fixed nonce, then initially leaves the hash unreported. The observer tests below subsequently check durable historical readback. Uncertainty/replay tests keep the app blocked and unissued. It stops only its owned child and deletes its own DB fixtures. IPFS transport remains injected; no public IPFS/chain write, hosted RPC, installed-extension or issued-certificate acceptance follows. CI's web job is configured to run this variant; its result is pending until an authorized push.

## Historical transaction and receipt observations

`lib/publication/mint-observation.ts` is an internal readback service with an injected trusted reader, no HTTP action, configured RPC or signing key. It loads the stored dispatched commitment and verified pin, validates strict canonical bytes/intent, then performs network reads outside the transaction. Recovery does not require the initiating actor or publisher configuration to remain active: recording an already sent result grants no new authority. The saved active confirmation/approval and immutable commitment are checked again after reads.

Migration 19 separates **reported hashes** from **matched transactions**. A reported or missing hash alone never becomes a transaction record. Exact chain/sender/recipient contract/value/calldata **and stored nonce** must match before saving a hash. A composite nonce foreign key and observation/transaction linkage protect the stored association. Matching replacement candidates retain separate hashes. Unknown, unavailable and mismatched results contain no provider error details.

Receipt observations are appended with a revision, timestamp, versioned bounded result JSON and system audit. `VERIFIED` records the inspector's exact event/state/code/block/depth evidence, not issuance or permanent finality. Missing/pending/confirming/reverted/reorg/unavailable/mismatch reads remain distinct. A previously verified branch stays in history when a later read detects its rollback. These rows are evidence about individual reads, not a selected canonical publication result.

The passport lock and observation revision prevent a late response from being recorded as newer evidence. When another observation commits during RPC, the losing read returns `SUPERSEDED` without writing a transaction, observation or audit; callers may reread, never resend. This applies both to delayed negative reads after verification and delayed success after a newer reorg. A missing report records uncertainty without RPC; bounded system discovery is a separate service described below. Search and observation now also compare discovery revisions.

The existing `publication:smoke` covers real DB rows, strict input, exact nonce/hash linkage, receipt JSON, concurrent reads in both directions, changed commitment after RPC, revoked-actor recovery, SQL constraints and unchanged publication/nonce reservation through this historical stage. With `PUBLICATION_LOCAL_CHAIN=1`, it also persists actual confirmation-depth evidence, rolls back the owned chain, rejects stale old-branch receipts and records a newly priced same-nonce/call transaction on the new branch. It preserves prior evidence throughout. This is local branch-replacement coverage, not acceptance of hosted mempool replacement behavior. A historical observation alone leaves UNKNOWN/CHAIN_PENDING blocked; the separate finalization below is now implemented. Bounded hash discovery is now described below; scheduled monitoring and unresolved-send/quarantine recovery remain open.

## Revocable mint result selection

`reconcileMintResult` in `lib/publication/mint-observation.ts` selects an **as-of private result**, not an issued certificate. Its strict input accepts only a saved exact-call/nonce-matched transaction ID belonging to the attempt. It never accepts a caller hash, observation ID or RPC URL, and never promotes a historical VERIFIED row without a new network check. The trusted reader, commitment checks and revision guard are shared with historical observation. Reads older than 15 seconds, changed saved candidates/confirmation and superseded revisions cannot select a result or leave partial writes.

Migration 20 adds `PublicationMintResult`: the latest check and last selected VERIFIED observation are separate references. Composite foreign keys enforce same-attempt ownership and VERIFIED proof status; CHECKs reject partial proof references and a VERIFIED projection whose current check differs from its proof. Selection, observation, revision and audit commit atomically. A completed non-VERIFIED reconciliation suspends the projection but preserves the prior proof. Invalid, expired or superseded checks make no writes and grant no selected success to their caller. Any later diagnostic observation also suspends it, even if that diagnostic reports success; only explicit fresh reconciliation may promote success again. All old receipts and branch candidates remain in history.

This projection describes the chain **at the recorded observation time**. It is not permanent finality, continuous monitoring or authority to publish/release a nonce. Selection alone leaves UNKNOWN/DISPATCHING and CHAIN_PENDING unchanged, success fields unset and the slot held. The finalizer below revalidates; future public readers must also revalidate instead of trusting stored status indefinitely. There is no HTTP caller, scheduler, configured RPC, broadcaster or issued/public certificate path.

The expanded `publication:smoke` checks fresh selection despite historical success, strict candidates, suspension, receipt pointers, expiry, both stale-read races, changed commitments/candidates, revoked-actor recovery, SQL proof ownership and blocked dispatch after selection. The owned Anvil variant additionally selects a real confirmed receipt, rolls back its branch, suspends the projection while retaining that receipt, and selects a newly priced same-call transaction only after fresh verification. The subsequent finalization stage is tested separately below; hosted mempool replacement remains outside these checks; bounded missing-hash discovery has its own tests below.

## Internal publication finalization and wallet quarantine

`finalizeMintPublication` performs its **own fresh verification** of a saved matched transaction. Historical VERIFIED observations and private result selection do not finalize anything by themselves. Recheck the stored intent, approval/confirmation/pin, candidate, observation revision, wallet history and 15-second read limit. Under the passport and shared-wallet locks, atomically append the fresh receipt, mark the attempt FINALIZED, save its first finalization time/proof, set publication PUBLISHED with the exact contract/transaction/token and write one finalization audit. System recovery remains possible after actor/config revocation because this records an already authorized send. Repeats must reverify and never replace that first proof or emit another publication audit. Passport approval/version remains frozen; no public certificate or HTTP finalization action is enabled.

Migration 21 binds finalization to a same-attempt VERIFIED observation and enforces complete metadata/timestamps. Its proof FK is deferred until commit to permit atomic cleanup of fictional attempt/observation cycles; no business deletion path is added. The active-slot index excludes FINALIZED and reviewed FAILED_TERMINAL attempts, while the permanent `(chain, wallet, nonce)` unique claim remains. Before another command, the server revalidates all prior successful/failed closed receipt blocks/depth against a stable chain head, requires an idle nonce greater than every closed nonce claim, and compares the wallet history again after RPC. Verification is bounded: at **64 closed receipts (successful or failed)**, refuse another send until a separately verified checkpoint policy is implemented; never silently skip old receipts.

After finalization, readback accepts only the saved canonical transaction, rejecting missing/foreign hash cues. A fresh successful check of the same original receipt leaves publication intact. A completed negative, unavailable, changed-anchor or stale diagnostic check atomically marks publication CHAIN_SUSPENDED and records a sticky `quarantinedAt`, retaining its original contract/hash/token/proof. Quarantine is independent of the active slot: a newer attempt may already occupy it. New app commands/finalizations for that wallet are blocked; private selection cannot clear the quarantine, and unknown recovery cannot reopen a finalized attempt. Separate reviewed unchanged-original restoration is now described below; lost/remined receipts remain blocked; separately reviewed exact reverted-send closure is described below. Transient provider failures are deliberately conservative here.

This is internal, as-of chain accounting. There is no continuous observer yet, so PUBLISHED alone is not proof of current validity for a public reader. A command returned before a later rollback cannot be recalled from a wallet and may still broadcast; quarantine blocks further application permissions/finalizations. No automatic resend/cancellation, configured provider, server key, broadcaster or issued/public view is enabled. Separate reviewed exact reverted-send closure is described below.

The extended PostgreSQL/production HTTP smoke tests fresh success/failure, immutable proof and replay, SQL proof/status/nonce constraints, prior anchor/depth/nonce checks, history changes during RPC, next-slot concurrency and an independent third-passport quarantine probe. With the owned Anvil, it finalizes an actual mint, grants the next nonce, rolls back the first branch and sends a real same-nonce cancellation. Stale old receipt readback suspends that publication; the already granted next command can mint, but its finalization and a third permission are refused. History remains intact. `test:chain` also includes the bounded-history and anchor regressions; disabling quarantine makes it fail. This does not establish hosted mempool replacement, installed-wallet behavior, ongoing monitoring or manual recovery acceptance.

## Bounded recovery of an unreported mint hash

New dispatch permissions persist the stable preflight block number/hash together with the fixed nonce. Migration 22 adds this nullable historical binding, an anchored search cursor, a separate discovery revision and an append-only private search journal. Old attempts with no saved dispatch block are refused for discovery; the server does not infer an anchor from a timestamp or accept one from a caller. Their known hashes can still use ordinary exact readback.

`discoverMintTransaction` is an internal system service accepting only `{}` and an injected trusted reader. It scans standard full-transaction blocks from the saved cursor, at most **32 blocks, 2,048 transactions per block and 4,096 transactions per page**, with a **10-second RPC deadline** and **15-second commit freshness limit**. Check chain/head/dispatch/cursor identities, parent links, transaction positions and a separate candidate lookup, then reread canonical boundaries. The reader's transport must separately bound response bytes; a timed-out underlying request may still settle, but its late result cannot write progress.

| Result | Meaning and effect |
|---|---|
| FOUND | Exact sender, saved nonce and mint call match. Save a matched transaction candidate; receipt verification/finalization remains separate. |
| CONFLICT | The sender/nonce was used by another call, including cancellation. Save diagnostic hash only; retain the blocked attempt. |
| SCANNED | A page without a matching sender/nonce completed; save its anchored cursor and continue on another invocation. |
| CAUGHT_UP | No candidate through the captured head, possibly with no new blocks. This is not proof that nothing was broadcast or is pending. |
| REORG | Do not adopt a hash. Reset a changed cursor only if the original dispatch anchor and head are still canonical; otherwise retain progress for reviewed recovery. |
| UNAVAILABLE | Missing/malformed/oversized/unresponsive data; save generic uncertainty with no progress or provider error details. |

FOUND/CONFLICT do not advance past the candidate, so a lost response or later branch change cannot silently skip that nonce. Search and receipt observation compare both revision streams under the passport lock; superseded reads leave no journal/candidate/audit/cursor writes. Recheck the saved commitment/cursor after RPC; invalid/expired checks roll back. SQL enforces paired anchors, range/count bounds, revisions and exact transaction/hash ownership. Recovery survives actor/config revocation and never changes approval, publication success or wallet-slot eligibility. Finalized attempts use their stored canonical hash and reject discovery before RPC.

`test:chain` includes paging, exact-call/conflict, reorg/malformed data, work-budget and real deadline regressions. `publication:smoke` checks actual journal/cursor/candidate rows, strict input, missing legacy anchors, cross-writer races, expiry/cursor drift, SQL constraints and unchanged UNKNOWN/CHAIN_PENDING. With owned Anvil it discovers the deliberately unreported actual mint, detects real same-nonce cancellation after rollback and retains a new-branch exact replacement without a caller hash. No mempool search, scheduler, hosted provider, automatic failed-send/quarantine recovery, broadcaster, resend or public certificate is enabled.

## Internal bounded mint monitoring

Migration `20261022190000_publication_mint_monitor` adds a due time and paired private lease token/expiry. `runMintMonitorBatch({ limit }, readerFor)` is an internal tick for a future trusted scheduler: select the oldest due attempts, at most **five**, and stop admitting another attempt after **60 seconds**. The last admitted attempt may finish afterward; database availability/lock waits are separate limits. No timer, cron deployment, HTTP endpoint or configured RPC is activated.

Each attempt is claimed under the passport lock using **database wall time**, with a **90-second lease**. Claiming increments the observation revision so older unleased reads cannot commit afterward. Both discovery and receipt/finalization recheck the lease token and expiry under that same lock before and after their writes; expired or replaced work rolls back. Completion clears/reschedules only its own token, so an old process cannot clear another process's reclaimed lease. Process death leaves a reclaimable lease. Network I/O never holds a database transaction.

Pending attempts run one anchored discovery page; FOUND then uses the separate fresh finalizer, including all existing wallet-history/nonce guards. Finalized attempts recheck only their original saved transaction through reconciliation. Negative canonical readback triggers the existing sticky quarantine; later verification cannot clear it or replace the first proof. Unknown, conflict, caught-up and unavailable outcomes never authorize resending or failed-send slot release. Legacy missing anchors remain blocked for reviewed recovery.

One **20-second cumulative RPC budget** spans discovery, receipt and wallet-history methods per attempt. The reader's transport still owns byte limits and actual cancellation; late RPC settlement cannot resume timed-out writes. Complete ticks wait **30 seconds** before becoming due again; blocked/unavailable ticks wait **120 seconds**. These are local engineering defaults, not an accepted hosted polling, retention or finality policy. Generic outcomes omit provider error text. The scheduler, operational alerting, journal retention/checkpoint consolidation and reviewed failed-send/genuine-reorg resolution remain open. Unchanged-original restoration is a separate operation below.

`test:chain` includes cumulative-budget/timeout tests. `publication:smoke` covers due ordering/cooldown, duplicate exclusion, abandoned/expired/reclaimed leases, stale unleased reads, receipt expiry, factory/RPC failures, SQL lease shape and immutable canonical proof/quarantine. Its owned-Anvil variant uses the worker to discover/finalize a real local mint and quarantine it after actual rollback/cancellation. No browser, hosted scheduler/provider or public certificate acceptance is implied.

## Reviewed recovery of an unchanged original mint

`getMintRecoveryReview` and `restoreOriginalMint` are internal services for a narrow quarantine case: a previously finalized transaction is still canonical with its **original hash, block number/hash, token, contract and intent**. They do not resolve a lost/remined original receipt, failed/cancelled send or missing dispatch anchor. There is no recovery HTTP route, button or automatic unblocking.

Only the **current designated, active MFA administrator and configured wallet** may review/restore. Separate `RESTORE_ORIGINAL_MINT` acknowledgement binds the exact intent, first-proof ID, quarantine timestamp, observation revision and fingerprint of all wallet attempts (including an already active later attempt). Recheck current authority, saved approval/confirmation/pin/intent, matched transaction and reviewed wallet state before and after RPC under passport/shared-wallet serialization. No RPC holds a DB transaction. Invalid/stale/revoked requests leave quarantine intact.

Verify every bounded closed wallet receipt's canonical block (successful or failed) and at least its originally attested depth, then freshly inspect the original exact mint/nonce/event/state and recheck the captured head. The check must be less than **15 seconds** old at the commit gate; reader calls share the existing **20-second cumulative RPC budget**. Real reorg/loss or a different inclusion anchor cannot be overridden by administrator consent. These injected checks do not accept a hosted provider or permanent finality.

Migration `20261022220000_publication_mint_recovery` adds an append-only private recovery journal. Atomically save the actor, exact reviewed state and a new same-attempt VERIFIED observation; clear only this attempt's quarantine, restore its publication to PUBLISHED, select the fresh private result and append one audit. Preserve first finalization proof/time, chain identity, permanent nonce/preparation claims, all prior incidents and any later active slot. Other wallet quarantines remain independent blockers. This is restoration of an existing result, not a new certificate or send command.

Request-ID retries reauthorize and return **historical RECORDED evidence**, without RPC or repeated writes. A retry after a new quarantine explicitly reports that it is currently quarantined and cannot clear it. A new incident needs a new reviewed state/request. SQL requires distinct same-attempt VERIFIED proof pointers, positive review revision, finite ordered timestamps, hash shape and unique request/review ownership. Future consumers must freshly verify; historical RECORDED is not a health guarantee.

The expanded PG/production HTTP smoke covers exact review/consent, actor/MFA/role/config revocation during RPC, commitment/candidate/peer-wallet changes, expired checks, duplicate/concurrent/lost-response requests, stale observers, repeated quarantine and SQL journal constraints. The owned-Anvil variant restores the actual unchanged original after a simulated provider outage, then refuses restoration after real rollback/cancellation. Exact reverted-send closure and unchanged failed-proof restoration are described below; cancellation/genuine-reorg/supersession policy, legacy-anchor recovery, wallet checkpoint consolidation and recovery UI remain open.

## Reviewed closure of an exact reverted send

An EVM **reverted** receipt for the exact saved mint call/nonce is a consumed nonce with no success from that execution. Internal `getMintFailureReview` / `closeRevertedMint` require a separately reviewed `CLOSE_REVERTED_MINT` acknowledgement from the current designated active MFA publisher/wallet. Bind the saved candidate, intent, observation revision and wallet-state fingerprint. Reauthorize and recheck approval/confirmation/pin/intent/candidate/history after read-only RPC; reject changed or at least 15-second-old work. Reader calls share the 20-second cumulative RPC budget. No network I/O holds DB locks.

Only a fresh, sufficiently confirmed **REVERTED** result closes the attempt. A reported hash, old failure observation, missing/pending/confirming result, timeout, successful receipt or different-call cancellation is insufficient. Migration `20261022230000_publication_mint_failure` saves a distinct same-attempt REVERTED first proof/time and append-only actual-admin review journal/audit; SQL binds the journal to the exact transaction/attempt/status. The attempt becomes **FAILED_TERMINAL**, publication **CHAIN_FAILED**, and any private success projection is suspended. No token/hash/contract success fields or certificate are issued.

Release only the shared **active slot**. The original preparation/request/nonce remains permanently claimed and cannot be resent/reopened. Another passport needs its own consent and a freshly checked idle **higher nonce**. All subsequent permissions/finalizations/recoveries revalidate canonical anchors and original attested depth for both successful and failed closed sends, with a combined 64-proof limit. Idempotent closure retries return historical RECORDED with current quarantine state, without RPC or repeated writes.

Monitor only the first closed failure hash. If its receipt becomes missing, unavailable, shallower, successful, remined or reorganized, retain FAILED_TERMINAL/first proof/nonce and mark **CHAIN_FAILED_SUSPENDED** with sticky wallet quarantine. Never reclaim an old slot that a newer attempt already occupies, adopt another hash or promote a closed failure to success. Quarantine on a failed proof blocks new permissions independently of successful receipts. Only separately reviewed unchanged-failure restoration below can clear that incident. Cancellation/supersession policy and genuine reorg/legacy-anchor resolution remain open; unchanged-success restoration cannot override a failed proof. No failure closure/recovery HTTP route, UI action or broadcaster is enabled.

The PG/production HTTP smoke closes a reviewed exact failure, grants another passport a higher nonce and retains all first proofs/claims. It covers consent, authority/MFA/role/config/confirmation changes during RPC, expiry, concurrent/idempotent requests, late reads and SQL ownership/status/shape/nonce constraints. Owned Anvil mines the actual exact call with insufficient execution gas, records the real reverted receipt, then exercises the next passport's real mint. A later actual rollback removes that failure and a test-only replacement succeeds; the app retains the failed closure and quarantine without adopting success/resend. Node regressions independently reject a quarantined failed-only wallet; bypassing that guard makes the test fail. This is local acceptance, not hosted finality, browser-wallet or public-certificate acceptance.

## Reviewed recovery of an unchanged closed failure

`getMintFailureRecoveryReview` / `restoreFailedMint` reuse the original-receipt recovery engine with a separate strict **RESTORE_FAILED_MINT** acknowledgement. The current designated active MFA publisher/wallet must review the exact failure proof, intent, incident timestamp, observation revision and complete bounded wallet-state fingerprint. Reauthorize and revalidate commitment/history after RPC under passport/shared-wallet serialization; retain the 20-second cumulative reader budget and sub-15-second commit gate. No HTTP route, recovery button, configured provider or broadcaster is enabled.

Freshly verify every closed wallet anchor/depth and the original exact failed transaction/call/nonce. Require **REVERTED** with the identical hash, block number/hash, contract and intent, and at least its original attested depth. Missing, changed, remined, shallow, unavailable or successful receipts cannot clear this quarantine. Administrator consent cannot override genuine loss or turn a failure into success.

Additive migration `20261022233000_publication_failed_recovery` extends the existing private recovery journal with SUCCESS/FAILURE kinds, separate original-proof pointers and same-attempt/status SQL constraints. Existing rows default to SUCCESS. Atomically append a distinct fresh REVERTED observation, FAILURE recovery and actual-admin audit; clear only the reviewed quarantine and restore **CHAIN_FAILED**. Keep **FAILED_TERMINAL**, first failure proof/time, nonce/preparation claims, null public chain fields, suspended private success, other quarantines and any newer active slot. No resend or certificate is produced.

Request-ID retries remain historical RECORDED evidence and report renewed quarantine without clearing it. New incidents require new review/request; success and failure requests cannot substitute for each other. PG/production HTTP and owned-Anvil smokes cover concurrent/repeated incidents, stale authority/wallet/review, expiry, old observers, other quarantine preservation, SQL kind/proof ownership and genuine rollback refusal. Node regression prevents a successful receipt from restoring a failed original; removing its status guard makes the test fail. Cancellation, genuinely lost/remined proofs, legacy anchors, checkpoint consolidation and UI/public views remain separate work.

## Read-only evidence for a same-nonce cancellation

`inspectMintCancellation` checks one narrow cancellation profile against an already saved intent/nonce: a successful zero-value, empty-input **self-send by the publisher**, using a standard legacy/EIP-2930/EIP-1559 transaction. A different-call nonce conflict is not sufficient. Reject another nonce/wallet/recipient/value/input, authorization-list transaction, delegated/code-bearing publisher, contract creation or logs. Require empty publisher code at the preceding block, inclusion and captured head, the expected passport runtime and no payload-hash token at inclusion/head.

Bind transaction, receipt, exact block/index membership (at most 2048 entries), required depth and stable inclusion/head/chain/receipt rereads. RPC calls share the existing cumulative 20-second budget, now in the database-independent `mint-reader.ts`; the monitor retains its existing export. Provider failures expose only the generic chain-verification error. Unknown, pending, confirming and reorg results remain distinct. A sufficiently deep **CANCELLED** result contains the exact intent/nonce/hash/inclusion/captured head and always says **issued:false / canResend:false**. It is as-of evidence, not permanent finality or permission.

This inspector changes no DB status, journal, nonce claim or wallet slot. The separate reviewed closure below owns those effects. There is no app cancellation sender, HTTP route or UI action; genuinely lost/remined-receipt resolution remains blocked. Arbitrary different calls and EIP-7702/delegated-wallet recovery remain blocked.

Node regressions cover strict input/nonce/profile, receipt/membership/state/code/depth, changed head/chain/receipt and deadline. The owned-Anvil chain smoke verifies actual pending/confirming/cancelled and rollback/stale-receipt behavior; PostgreSQL/Anvil publication smoke checks a discovered conflict becomes read-only cancellation evidence while the attempt remains UNKNOWN/CHAIN_PENDING. This read-only slice required no migration or contract/dependency change; the subsequent closure migration is described below. No installed-wallet or hosted acceptance is implied.

## Reviewed durable cancellation closure and canonical monitoring

`getMintCancellationReview` / `closeCancelledMint` use a separate strict **CLOSE_CANCELLED_MINT** acknowledgement from the current designated active MFA publisher/wallet. Select only the latest saved **CONFLICT** discovery for this attempt, with its original dispatch anchor and exact discovered hash/block/head. Bind the intent, observation/discovery revisions and wallet/commitment fingerprint; recheck authority, approval/confirmation/pin, history and review after read-only RPC under passport/shared-wallet serialization. No RPC holds DB locks. The existing cumulative 20-second budget and sub-15-second commit gate remain.

Freshly verify prior released wallet anchors, saved dispatch/search anchors and the exact self-send at sufficient depth. Missing/pending/shallow/changed/unavailable proof, a mint/different call, stale review or revoked authority cannot close. Additive migration `20261023090000_publication_mint_cancellation` stores the actual actor/review and distinct same-attempt **CANCELLED** observation linked by SQL to the exact **CONFLICT** discovery/hash. The observation carries private proofKind=CANCELLATION and no matched mint transaction; it never becomes a VERIFIED mint.

Atomically write **FAILED_TERMINAL** with failureStatus=CANCELLED, first proof/time, **CHAIN_FAILED**, a suspended private result and one administrator audit. Release only the active slot; keep the original request/preparation/nonce permanently claimed and public success fields null. Another passport requires its own separate permission and a fresh idle higher nonce. All wallet history checks include cancellation proof anchors, exact nonce/wallet and the existing combined 64-proof limit.

A matching request retry reauthorizes and returns historical RECORDED/current quarantine without RPC or another write. New requests cannot re-close or reopen it. Monitoring checks only the original cancellation hash and retains the first proof. Missing/remined/shallow/changed/unavailable proof or a newly minted payload causes sticky **CHAIN_FAILED_SUSPENDED** quarantine without reclaiming an old slot from a newer attempt. Later positive monitoring cannot clear it. Existing REVERTED recovery consent does not restore cancellation quarantine; the separate reviewed policy below does. Genuine supersession/legacy anchors and checkpoint consolidation remain open. No closure/recovery HTTP/UI, broadcaster, recurring scheduler or issued certificate is activated.

Default PG/production HTTP and actual owned-Anvil suites cover authority/consent, fresh anchored proof, stale reviews/revisions/expiry, concurrent idempotence, older observer fencing, exact proof/journal/status, permanent nonce, next-passport higher nonce and late quarantine. Actual Anvil performs the self-send, next passport's mint and real rollback. SQL rollback probes reject wrong status/discovery/proof, matched mint binding and duplicate nonce. Fixtures clean only their owned records; no hosted finality or browser acceptance follows. WorkflowError recognition also has a regression across duplicate module instances (D47); lease checks remain unchanged.

## Reviewed unchanged-cancellation restoration

`getMintCancellationRecoveryReview` / `restoreCancelledMint` use a separate strict **RESTORE_CANCELLED_MINT** acknowledgement from the current designated active MFA publisher/wallet, checked before and after RPC. The review binds the quarantine timestamp, observation revision, intent, complete bounded wallet-state fingerprint, the attempt's first **CANCELLED** proof and its closure journal ID. Success or REVERTED consent cannot restore a cancellation, and this consent cannot restore either of them.

Freshly verify every closed wallet anchor, the saved dispatch anchor (before and after the proof read) and the original exact self-send through the read-only cancellation inspector: identical hash/block/block hash/nonce/wallet/contract/intent, at least the original depth, empty publisher code and an unminted payload, within the shared 20-second budget and sub-15-second commit gate. Missing, pending, remined, shallow or changed proof, a changed dispatch anchor, stale review or revoked authority/confirmation leaves the quarantine. Additive migration `20261023120000_publication_cancelled_recovery` adds the CANCELLATION journal kind and a composite SQL foreign key binding the journal's original proof to that closure row's own proof.

Atomically append a fresh CANCELLED observation (proofKind=CANCELLATION, no matched mint transaction), the journal row and one administrator audit; clear only this quarantine and restore **CHAIN_FAILED**. FAILED_TERMINAL/CANCELLED, first proof/time, nonce/preparation claims, null public chain fields, the suspended private result, other quarantines and a newer active slot stay unchanged. Request retries return historical RECORDED evidence and report a renewed quarantine without clearing it. No HTTP/UI, resend or certificate is enabled.

Default PG/production HTTP and actual owned-Anvil suites cover consent and kind isolation, stale review refused before RPC, outage/changed-anchor/wrong-nonce/missing/pending refusal, authority/config/confirmation/expiry races, concurrent idempotence, old-observer supersession, stored rows, renewed incidents, a newer active slot and SQL shape/foreign-key probes. Actual Anvil restores after an injected outage and refuses after a real rollback.

## Product feedback and responsible treatment reminder

Signed-in users can open `/feedback` from the home-page footer. The private confirmed certificate preview opens an accessible responsibility dialog with a reminder to record doses and weather and care for Ukraine's soils; its **Leave feedback** button opens the same form. The dialog can be dismissed and reopened without submitting feedback. It does not claim that a certificate has been issued or that a treatment is environmentally safe.

The form collects a 1–5 usability rating and a concrete comment (10–2000 characters). Responses are stored privately in PostgreSQL, associated with the current account; no passport, evidence or farmer details are copied into feedback or a public snapshot. Only MFA administrators can read the latest 50 responses at `/admin/feedback`, linked from the admin console. Responses are deleted with their account. The form asks users to exclude personal/field/document details. An account can send up to five responses per hour; an identical request retry is idempotent. Apply the additive `20261020120000_product_feedback` migration with `npm run db:deploy` before running this version.

`npm run feedback:smoke` needs the migrated database and production server at `BETTER_AUTH_URL`. It checks authentication/MFA, private page access, origin, input validation, exact stored values, retries, ownership and the concurrent per-account quota, then removes its fictional users and their responses. Browser interaction and real user research are separate checks.

## Internationalization

The UI ships with full **Ukrainian** (default) and **English** support. The locale toggle (UK/EN pill) is in the app header and persists to `localStorage`. All 20+ components read from a typed `Translations` object via React context — no external i18n library, no restructuring of the Next.js app directory.

---

## Current Status

| Feature | Status |
|---|---|
| Smart contract + Foundry tests | 22/22 tests passed locally and the contract job passed in [CI run 36107136075](https://github.com/DarkPo13/hartolit-web3/actions/runs/36107136075) |
| Full 3-step wizard UI | ✅ Complete |
| SHA-256 file hashing (Web Crypto API) | ✅ Complete |
| Legacy server-side mint pipeline | 🟡 Present in demo; will be replaced by direct approved-wallet minting |
| Stateless public IPFS pinning | 🟡 Provider path exists; wallet authorization and real evidence upload are pending |
| QR-coded certificate (printable + downloadable HTML) | Legacy `1.0.0` demo only; no issued production certificate |
| Public `/verify/[tokenId]` with hash verification | Legacy `1.0.0` demo only; unavailable in production |
| Private confirmed `2.0.0` certificate and saved-hash views | Built for MFA admins; local signed-in smoke and desktop/mobile Chrome checks passed, with issuance/public access still disabled |
| Ukrainian + English i18n | ✅ Complete |
| One-click mock data prefill | ✅ Complete |
| Invite-only accounts | Phase 1 complete locally: PostgreSQL, individual sessions, admin MFA, reset email, and server role checks |
| Refresh-safe draft | Phase 2 local pass: owner-scoped PostgreSQL drafts; tab cache only for unsynced edits |
| Private evidence | Phase 3 local pass: owner-scoped direct upload, integrity and malware checks, private storage, expiring download links; hosted restore gate remains |
| Review workflow and admin console | Phase 4 local pass: submit, assign, decide, reopen, record edits and archive, operator invitation and revocation, searchable audit; API smokes and desktop/390px keyboard browser checks passed on 2026-09-25. Hosted release acceptance remains |
| Diia KEP | 📋 Deferred to Version 2 or later |
| Public evidence storage (IPFS) | 🟡 Pending implementation |
| BSC Testnet deploy | 🔧 Clean CI passed; release gates and an approved operator wallet remain |
| BSC Mainnet deploy | 📋 After testnet validation |

---

## Impact & Scale Potential

**Who benefits today:**
- **Farmers** — undeniable proof of treatment for subsidy claims and insurance
- **Hartolit operators** — automated digital records, zero paper logistics
- **Chemical suppliers** — KEP-signed chain of custody documentation
- **Insurers** — cryptographic evidence for crop loss assessment
- **State subsidy offices** — fraud-resistant verification at scale
- **EU importers** — auditable phytosanitary records meeting trace-and-trace requirements

**Scale potential:**

Ukraine has ~33 million hectares of farmland. Drone crop protection grows at 40% YoY. If 1% of drone treatments are issued as on-chain passports by 2027, that is 300,000+ NFT mints on BNB Chain — bringing real agricultural users into Web3 who otherwise have no reason to touch blockchain.

---

## Why This Matters for BNB Chain

Agricultural data is borderless — a Ukrainian farm's export record needs to be readable by an auditor in Amsterdam or a bank in Singapore without any intermediary. BNB Chain provides:

1. **Neutral, permissionless infrastructure** that no single government or company controls
2. **Sub-$1 transactions** accessible to smallholder farmers earning $3,000/season
3. **EVM tooling ecosystem** (MetaMask, BSCScan, Viem) that auditors and developers already know
4. **Established DeFi ecosystem** enabling future features: tokenized crop yield bonds, on-chain agricultural insurance, DeFi-native subsidy distribution

This is real-world utility for a population that genuinely needs decentralized trust infrastructure — not speculation or financial primitives, but verifiable agricultural records that unlock access to EU markets and fair insurance.

---

## Roadmap

| Phase | Gate | Description |
|---|---|---|
| Controlled Testnet pilot | After public-field, operator, hosting, and release gates | Deploy to BSC Testnet and validate approved public records end to end |
| Core application release | After hosted storage, restore, security, and browser acceptance | Admit real customer data only when these checks pass |
| Diia KEP | After the core application and infrastructure release | Design and verify real signatures before showing signed claims |
| Mainnet and other integrations | After Testnet evidence and separate approval | Scope production deployment, exports, partner APIs, and mobile access |

---

## Production Deployment Checklist

- [ ] Smart contract audited (at minimum, internal review with OpenZeppelin patterns)
- [ ] Contract deployed and verified on BSC Mainnet
- [ ] Admin wallet moved into a Gnosis Safe multisig
- [ ] Required secrets configured in the chosen hosting provider
- [ ] Public pinning provider selected and limited to approved snapshots
- [ ] Public evidence and payload CIDs replicated through a second pinning provider
- [ ] Approved operator wallet holds `MINTER_ROLE`; the website has no server minter key
- [ ] Wallet-authorized stateless upload routes have request limits and edge rate limiting
- [ ] Error monitoring (Sentry) + Vercel Analytics configured
- [ ] SSL + custom domain → `dapp.hartolit-agro.com`

---

## Team

**VANTREXIS** — agricultural technology company based in Ukraine, operating Hartolit drone crop protection services.

- **Mykyta Godovanets** — CEO, business development and agricultural operations
- **Vladyslav Polovyk** — CTO, full-stack + Web3 development
- Domain expertise in Ukrainian agricultural regulations, Diia ecosystem, EU phytosanitary export requirements

Contact: [vladpolovukkenway@gmail.com](mailto:vladpolovukkenway@gmail.com)
Website: [hartolit-agro.com](https://hartolit-agro.com)

---

*Hartolit Digital Field Passport · Built on BNB Chain · VANTREXIS © 2026*
