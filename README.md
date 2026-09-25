# Hartolit Digital Field Passport

> **Prototype for recording agricultural drone treatments and checking a passport payload against a BNB Chain hash.**

**Release status:** This repository is not ready to issue production passports. Local phases 1–3 provide PostgreSQL accounts, owner-scoped drafts, and private evidence uploads. Phase 4 now has an operator submission and MFA-admin review workflow, with read-only admin record views. Hosted storage, restore testing, browser acceptance, and further admin management work remain. Publication remains disabled outside the local demo. Do not enter real customer data until hosting, privacy, backup, and release gates are completed. Diia signing is deferred until after the core MVP release. Product claims below describe the intended system, not proven current capabilities. See the [phased application architecture](#phased-application-architecture) below for the current implementation.

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

The following example is the legacy local demo payload. It includes farmer identifiers, coordinates, and file references and must not be published for real customers. Phase 5 needs an approved public-field allowlist and retention policy before a real public snapshot is defined. Diia fields are absent.

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

The SHA-256 of the **canonicalized** JSON is stored on chain as `payloadHash`. The current demo payload reflects the earlier fully public concept and must not be used for real records. The final public snapshot needs a field allowlist and approval. The optional demo still returns `internal://` file references and does not preserve uploaded bytes. The authenticated draft path stores private evidence in object storage; it does not publish those files to IPFS.

---

## Phased application architecture

Phase 1 stores individual accounts, sessions, MFA enrollment, password reset tokens, and rate limits in PostgreSQL through Prisma and Better Auth. The shared password gate is removed. Anonymous visitors can still use public certificate verification.

Phase 2 stores farmer, field, passport, treatment, meteo, chemical, and audit records in PostgreSQL. Signed-in users can create and edit their own drafts; autosave uses a version check and shows a conflict if another session saved first. The tab stores structured fields only while edits are unsynced. Phase 3 adds private S3-compatible evidence storage with direct, five-minute upload grants, server-side integrity checks, a malware scan, and one-minute owner-authorized download links. The optional local demo remains separate and still uses tab-scoped state. Phase 4 adds submission, assignment, correction, rejection, and approval with version checks and audit history. The admin console at `/admin` includes a review queue, passport details, and read-only farmer, field, user, publication, and audit lists. Phase 5 will enable controlled publication of an explicitly approved public snapshot.

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

`db:setup` adds a random PostgreSQL password and Better Auth secret to ignored local environment files without replacing existing values. `evidence:setup` adds separate random local storage credentials. `dev:services:up` starts PostgreSQL and a local Mailpit inbox at <http://localhost:8025>; `evidence:up` starts SeaweedFS and ClamAV; `evidence:configure` sets browser CORS on the local private bucket. Wait for the scanner to become healthy before uploading. The account command prompts for an admin email and password; use a unique password of at least 12 characters and store it in a password manager. Sign in at <http://localhost:3000/login>, then enroll an authenticator app at `/settings/security`. Enrollment revokes earlier sessions, so sign in once more with your new six-digit code. Create another individual operator with `npm run auth:create-operator`; the command prompts for their email and password. Never pass passwords on a command line or commit local environment files.

After creating an operator, sign in and select **New draft** to save structured details to PostgreSQL. Attach up to 20 active evidence files per draft in the private evidence panel. Supported files are PDF, PNG, JPEG, JSON, CSV, TXT, and XML up to 10 MB each. An attachment is downloadable only after the server verifies its size, type, SHA-256, and ClamAV result. Remove abandoned or unwanted attachments in the panel. An already issued download link can remain usable for up to one minute if object deletion fails. Optional fictional local data can be added with `npm run db:seed:fictional -- --owner operator@example.com`; the command is idempotent for that owner and refuses a nonlocal database. `npm run drafts:smoke`, `npm run evidence:smoke`, and `npm run review:smoke` check the authenticated APIs against the running local server, then remove their fixture accounts, drafts, and objects. `npm run evidence:prune` previews stale quarantine cleanup; add `-- --execute` to perform it.

To review a passport, complete the required form fields, upload weather and chemical evidence, and wait until both files show **Verified**. Save the draft, then select **Submit for review**. Submission freezes the draft and its evidence. Sign in as an MFA-enabled admin at `/admin`, open the review queue, assign the passport to yourself or another active MFA admin, inspect the details and evidence, and approve, reject, or request changes. Rejection and correction require a reason. The operator sees the decision and can reopen a rejected or correction-requested passport, edit it, and submit again. All transitions are version checked and audited. Publishing a passport or certificate is still disabled.

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
| Review workflow and admin console | Phase 4 local implementation: submit, assign, decide, reopen, dashboard, queue, detail, and read-only record views; browser and hosted acceptance remain |
| Diia KEP | 📋 Deferred to Version 2 or later |
| Public evidence storage (IPFS) | 🟡 Pending implementation |
| BSC Testnet deploy | 🔧 Needs clean CI, release gates, and an approved operator wallet |
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
