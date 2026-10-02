# Hartolit Digital Field Passport

> **Prototype for recording agricultural drone treatments and checking a passport payload against a BNB Chain hash.**

**Release status:** This repository is not ready to issue production passports. Local phases 1–4 provide PostgreSQL accounts, owner-scoped drafts, private evidence uploads, review, and audited admin management. The local Phase 4 API and headless Chrome checks at desktop and 390px passed; hosted storage, restore testing, and real-device release acceptance remain. Publication remains disabled outside the local demo. Do not enter real customer data until hosting, privacy, backup, and release gates are completed. Diia signing is deferred until after the core MVP release. Product claims below describe the intended system, not proven current capabilities. See the [phased application architecture](#phased-application-architecture) below for the current implementation.

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

1. Contains a cryptographic SHA-256 fingerprint of the complete treatment payload
2. Will link to an explicitly approved public passport snapshot on IPFS
3. Is issued directly by an approved Hartolit operator wallet; the website stores no server minter key
4. Is publicly verifiable at `/verify/{tokenId}` — anyone can check integrity without a wallet or account

One QR code on a printed certificate points to an immutable on-chain record. Insurers, subsidy offices, and EU auditors scan it and instantly see tamper-proof data.

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

The following example is the legacy local demo payload. It includes farmer identifiers, coordinates, and file references and must not be published for real customers. The initial Phase 5 public-field policy and a separate read-only `2.0.0` preview schema are described below; snapshot confirmation, private-data retention and publisher decisions remain incomplete. Diia fields are absent.

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

The SHA-256 of the **canonicalized** JSON is stored on chain as `payloadHash`. The current demo payload reflects the earlier fully public concept and must not be used for real records. The separate Phase 5 allowlist and read-only preview require a future confirmation and controlled publication flow. The optional demo still returns `internal://` file references and does not preserve uploaded bytes. The authenticated draft path stores private evidence in object storage; it does not publish those files to IPFS.

---

## Phased application architecture

Phase 1 stores individual accounts, sessions, MFA enrollment, password reset tokens, and rate limits in PostgreSQL through Prisma and Better Auth. The shared password gate is removed. Anonymous visitors can still use public certificate verification.

Phase 2 stores farmer, field, passport, treatment, meteo, chemical, and audit records in PostgreSQL. Signed-in users can create and edit their own drafts; autosave uses a version check and shows a conflict if another session saved first. The tab stores structured fields only while edits are unsynced. Phase 3 adds private S3-compatible evidence storage with direct, five-minute upload grants, server-side integrity checks, a malware scan, and one-minute owner-authorized download links. The optional local demo remains separate and still uses tab-scoped state. Phase 4 adds submission, assignment, correction, rejection, and approval with version checks and audit history. The admin console at `/admin` includes a review queue and details, draft-only farmer and field editing, archive and restore for completed records, operator invitations and access control, publication monitoring, and searchable passport and admin audit history. Phase 5 will enable controlled publication of an explicitly approved public snapshot.

---

### Phase 5 public snapshot policy — initial scope approved

**Approved by the user on 2026-09-28**, with treated area added by explicit approval on 2026-10-02. Prepared from the Prisma schema, draft DTOs, review service and legacy public viewer. The public schema, allowlisted builder and read-only admin preview are implemented; snapshot confirmation and publication are not. Private-data retention and publisher access remain separate decisions.

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

**2026-10-02 local progress:** Gate 1 captures an explicit chemical dose unit, separately entered public farm label, random field reference, treatment time zone and distinct treated area. Existing unknown values remain unknown; the migration generates only independent random references for pre-existing fields. Both new migrations applied locally. A strict `2.0.0` public schema, allowlisted server builder and read-only MFA-admin preview now select two explicit verified source files, render all public values and calculate SHA-256 of the canonical JSON. Each preview creates temporary metadata; refreshing changes its ID, timestamp and hash. It does not store confirmation, mint a token or publish to IPFS.

1. Capture explicit public labels/references, dose unit, timezone and treated area through new migrations and validated form fields. Do not guess units, timezones, treated area or labels for existing drafts. **Completed locally on 2026-10-02; browser UI and hosted verification remain open.**
2. Define a new strict public schema, separate from legacy demo version `1.0.0`, and a server builder that selects each approved field by name. Normalize crop/treatment categories; never spread or serialize raw Prisma rows. Review each remaining public text field for private content. **Builder and category validation implemented locally; human review of free text remains necessary.**
3. Show the exact public snapshot to an MFA admin, then bind a future confirmation to the approved passport version and snapshot hash. Approval must be invalidated if those bytes change. Derive every public certificate/verifier field from those confirmed bytes and display all of them, including the verification appendix. **Read-only preview implemented; persistent confirmation, issued certificate and public verifier are pending.**
4. Test private-field exclusion, unknown-field rejection, missing units/timezones, unapproved versions, hash equality after JSON transport and certificate coverage of every public field. Tests must use private markers in excluded source fields and inspect the actual serialized output. Future schema additions must preserve historical verification. **Live review smoke covers preview authorization, source selection, serialized private-marker exclusion, version rejection and transported hash; `test:public` checks readable preview coverage. Issued-certificate coverage and historical verification remain pending.**
5. Resolve retention (remaining Q1) and publisher authorization (Q3) before adding real IPFS or wallet publication. Keep legacy demo issuance closed for real data.

Public verification will confirm integrity of the published snapshot. It does not prove the treatment happened or provide a Diia/KEP signature. Public certificate and verifier screens must use this new schema, rather than the legacy viewer that exposes the complete demo payload.

#### Private-data retention proposal — remaining Q1 decision

The certificate's claim-support purpose depends on keeping the original evidence and private farmer/field mapping available. **The following periods are proposed product defaults, not adopted policy or a statement of legal requirements.** Confirm them with the user now, then check the chosen pilot organization's record requirements before real-data release.

| Record class | Proposed policy |
|---|---|
| Issued certificate support | Keep the private treatment record, necessary farmer/field mapping, referenced original evidence and review history for **five years from publication**. Preserve the reviewed version referenced by each certificate; reprinting does not restart the period. |
| Final reviews without publication | Keep finalized review records and their supporting evidence for **five years from the final decision**. A later publication starts its own certificate-support period. |
| Unused drafts | After **90 days of inactivity**, notify the owner before deleting never-submitted drafts and unreferenced attachments. Submitted records, certificate references and active claims are excluded. The notice and deletion workflow must be implemented before any automatic cleanup. |
| Open claims or disputes | An explicit preservation hold blocks deletion of the relevant records and files until the hold is released and the ordinary retention period has expired. Hold management is not implemented yet. |
| Private backups | Target a **30-day rolling window** of matched database/object backups. Deletions must age out of backups, and a restore must reapply deletion records and preservation holds before user access resumes. Provider support and restore acceptance remain Q2/S7 work. |
| Authentication data | Keep the existing session/reset expiry rules separate; this proposal does not extend token or session lifetime to five years. |

Public snapshots and blockchain records remain public after private retention expires. A digest alone cannot recreate the deleted original evidence. Changing a future retention default must account for existing certificates and active claims; it must not silently shorten preservation commitments. Current `evidence:prune` only cleans stale upload/scan/rejected objects; no business-record retention or preservation holds exist in the application.

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

To review a passport, complete the required form fields, upload weather and chemical evidence, and wait until both files show **Verified**. Save the draft, then select **Submit for review**. Submission freezes the draft and its evidence. Sign in as an MFA-enabled admin at `/admin`, open the review queue, assign the passport to yourself or another active MFA admin, inspect the details and evidence, and approve, reject, or request changes. Rejection and correction require a reason. The operator sees the decision and can reopen a rejected or correction-requested passport, edit it, and submit again. All transitions are version checked and audited. Publishing a passport or certificate is still disabled.

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
| QR-coded certificate (printable + downloadable HTML) | ✅ Complete |
| Public `/verify/[tokenId]` with hash verification | ✅ Complete |
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
