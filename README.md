# Hartolit Digital Field Passport

> **On-chain ERC-721 certificates for every agricultural drone treatment — immutable, legally-admissible proof for farmers, insurers, and EU certification bodies.**

[![Built on BNB Chain](https://img.shields.io/badge/Built%20on-BNB%20Chain-F0B90B?logo=binance&logoColor=black)](https://www.bnbchain.org/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org/)
[![Solidity 0.8.24](https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity)](https://soliditylang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](LICENSE)

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

**Hartolit Digital Field Passport** mints a unique ERC-721 NFT on BNB Smart Chain for every drone treatment. Each token:

1. Contains a cryptographic SHA-256 fingerprint of the complete treatment payload
2. Links to full metadata stored on IPFS (treatment details, drone telemetry, meteo conditions, chemical data)
3. Carries two qualified electronic signatures (KEP) — from the drone pilot and the chemical supplier — signed via Ukraine's national **Diia** app
4. Is publicly verifiable at `/verify/{tokenId}` — anyone can check authenticity without a wallet or account

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
│  Block 03: Meteo file + Drone Pilot KEP signature    │
│  Block 04: Chemical doc + Supplier KEP signature     │
└──────────────────────┬───────────────────────────────┘
                       │  All data + signatures
                       ▼
┌──────────────────────────────────────────────────────┐
│  STEP 2 — Blockchain Mint  (server-side)             │
│                                                      │
│  1. Canonicalize payload → SHA-256 hash (bytes32)    │
│  2. Pin JSON metadata to IPFS via Pinata             │
│  3. Call mintPassport(owner, hash, farmerId, cid)    │
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
       ├── Read: ownerOf, tokenURI, payloadHash, farmerId (from BSC)
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

    mapping(uint256 => bytes32) public payloadHash;  // immutable on-chain proof
    mapping(uint256 => string)  public farmerId;     // indexed by farmer EDRPOU/IPN
    mapping(bytes32 => uint256) private hashToTokenId; // duplicate guard

    event PassportMinted(
        uint256 indexed tokenId,
        address indexed mintedBy,
        bytes32 payloadHash,
        string farmerId,
        string ipfsUri
    );

    function mintPassport(
        address to,
        bytes32 _payloadHash,
        string memory _farmerId,
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

## Diia KEP Integration

Ukraine's [Diia](https://diia.gov.ua/) platform provides government-grade qualified electronic signatures (KEP) legally equivalent to a handwritten signature under Ukrainian law and EU eIDAS regulation.

Hartolit integrates **two signatures per passport**:

- **Drone pilot** signs the meteo observation file (confirms conditions at treatment time)
- **Chemical supplier** signs the purchase document (confirms product authenticity and chain of custody)

Both KEP signatures — keyId, signer name, certificate serial, timestamp, and document SHA-256 — are stored in the IPFS payload. The on-chain `payloadHash` fingerprints the entire bundle. If any signature or document is tampered with post-mint, the hash verification fails automatically.

Each Field Passport becomes a legally admissible record under:
- Ukrainian Law No. 2155-IX (electronic documents)
- EU Regulation 910/2014 (eIDAS — qualified electronic signatures)

---

## Data Model

Each NFT stores a rich, canonicalized JSON payload on IPFS:

```jsonc
{
  "version": "1.0",
  "timestamp": "2026-05-15T07:30:00.000Z",

  // Block 01 — Farmer & Field
  "farmerName": "ФГ «Степ-Агро»",
  "farmerId": "32456789",             // EDRPOU (Ukrainian company registry ID)
  "fieldArea": 56.2,                  // hectares
  "gpsCoords": "49.5826, 34.5544",
  "cadastralNumber": "5322487800:01:001:0042",
  "crop": "sunflower",

  // Block 02 — Treatment
  "treatmentType": "insecticide",
  "treatmentDate": "2026-05-15",
  "treatmentTime": "07:30",
  "droneModel": "DJI Agras T50",
  "droneSerial": "1ZNBC3K0025678",
  "operator": "Марченко Андрій Вікторович",
  "pilotCert": "UA-DARS-A2-2024-0342",

  // Block 03 — Meteo + Pilot KEP
  "meteoFile": { "url": "ipfs://Qm...", "sha256": "0xabc...", "size": 1024 },
  "meteoData": { "temperatureCelsius": 18.5, "humidityPercent": 72,
                 "windSpeedMps": 2.8, "rainfallMm": 0 },
  "pilotSignature": { "keyId": "DRFO-1234567890",
                      "signerName": "Петренко Іван Олегович",
                      "sha256": "0xdef...", "certSerial": "UA-KEP-2024-XXXXXX" },

  // Block 04 — Chemical + Supplier KEP
  "chemical": "Актара 25 WG",
  "chemicalActive": "тіаметоксам 250 г/кг",
  "dose": "0.14 кг/га",
  "workingVolume": 10,
  "manufacturer": "Syngenta AG",
  "regNumber": "UA-01-00823-0000",    // Ukrpestycid registration
  "supplierName": "ТОВ «Агрохім-Плюс»",
  "supplierEdrpou": "43210987",
  "supplierSignature": { "keyId": "EDRPOU-43210987",
                         "sha256": "0x789...", "certSerial": "UA-KEP-2024-YYYYYY" }
}
```

The SHA-256 of the **canonicalized** (deterministically serialized) JSON is what gets written on-chain as `payloadHash`. This is the tamper-proof fingerprint the whole system is built on.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16.2 (App Router, Turbopack) + TypeScript strict |
| Styling | Tailwind CSS v4 (CSS-first `@theme`, zero config file) |
| Forms | React Hook Form + Zod validation |
| State | Zustand with `persist` middleware (localStorage) |
| Web3 | Wagmi v2 + Viem + RainbowKit |
| Blockchain | BNB Smart Chain — Mainnet (56) + Testnet (97) |
| Smart Contract | Solidity 0.8.24 + OpenZeppelin v5 + Foundry |
| IPFS | Pinata SDK (server-side — JWT never exposed to browser) |
| Electronic Signatures | Ukraine Diia KEP (qualified, legally binding) |
| i18n | Custom React context — Ukrainian (default) + English |
| QR Code | `qrcode` library — verification URL embedded in certificate |
| File Parsing | PapaParse (CSV), Web Crypto API (SHA-256 hashing) |
| Hosting | Vercel (Next.js native, Edge Runtime) |

---

## Project Structure

```
hartolit-dapp/
├── app/
│   ├── layout.tsx                    # Root layout — fonts, providers
│   ├── page.tsx                      # 3-step wizard host
│   ├── providers.tsx                 # Wagmi + RainbowKit + React Query + i18n
│   └── verify/[tokenId]/
│       ├── page.tsx                  # Server component — fetches from BSC + IPFS
│       ├── VerifyDisplay.tsx         # Client component — renders with locale
│       └── not-found.tsx
│
├── app/api/
│   ├── files/upload/route.ts         # Multipart upload + SHA-256 hash
│   ├── ipfs/pin/route.ts             # Pinata pinning (PINATA_JWT server-only)
│   ├── mint/route.ts                 # Admin wallet mint via Viem
│   ├── diia/sign/route.ts            # Diia KEP initiation
│   ├── diia/verify/route.ts          # Diia KEP verification (polling)
│   └── passport/[tokenId]/route.ts  # On-chain data read
│
├── components/
│   ├── wizard/    # StepsNav, Step1Form, Step2Blockchain, Step3Certificate
│   ├── form/      # FarmerBlock, TreatmentBlock, MeteoBlock, ChemicalBlock, SignatureSummary
│   ├── diia/      # DiiaBlock, DiiaModal, DiiaSigPreview
│   ├── ui/        # Button, Card, Input, Select, FileUpload, Badge
│   └── web3/      # ConnectWallet, ChainBadge
│
├── lib/
│   ├── i18n/                  # Ukrainian + English translations + React context
│   ├── contract.ts            # HartolitFieldPassport ABI (fully typed)
│   ├── hash.ts                # SHA-256 + canonical JSON serialization
│   ├── store.ts               # Zustand wizard state (fillMockData, persist)
│   ├── wagmi.ts               # Wagmi + RainbowKit config (BSC mainnet + testnet)
│   ├── ipfs.ts                # Pinata client with mock fallback
│   ├── diia.ts                # Diia.Signature wrapper with mock for dev
│   ├── meteo-parser.ts        # JSON / CSV / TXT meteo file parser
│   ├── mock-data.ts           # Realistic Ukrainian farm test data
│   ├── schemas.ts             # Zod schemas for all 4 form blocks
│   ├── validation.ts          # Step-1 completeness check (typed MissingKey)
│   └── utils.ts               # cn, shortHash, BSCScan URLs, ipfsToHttp
│
├── types/
│   ├── passport.ts            # FieldPassportPayload, MintResult, FileRef, DiiaSignatureRef
│   └── diia.ts
│
└── contracts/                 # Foundry workspace
    ├── src/HartolitFieldPassport.sol
    ├── test/HartolitFieldPassport.t.sol
    ├── script/Deploy.s.sol
    └── foundry.toml
```

---

## Local Setup

### Prerequisites

- Node.js ≥ 20.10
- [Foundry](https://getfoundry.sh/) — `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- WalletConnect project ID — [cloud.reown.com](https://cloud.reown.com) (free)
- Pinata account + JWT — [app.pinata.cloud](https://app.pinata.cloud) (free tier works)
- Admin wallet private key with test BNB on BSC Testnet

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
# Required for wallet connection UI
NEXT_PUBLIC_WALLETCONNECT_ID=your_project_id

# Set after deploying the contract (see below)
NEXT_PUBLIC_CONTRACT_ADDRESS=0x...
NEXT_PUBLIC_CHAIN_ID=97           # 97 = BSC Testnet, 56 = Mainnet
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Server-side only — NEVER expose to the browser
ADMIN_PRIVATE_KEY=0x...           # Wallet with MINTER_ROLE
PINATA_JWT=eyJ...
BSC_TESTNET_RPC=https://bsc-testnet-rpc.publicnode.com
BSCSCAN_API_KEY=...
```

### 3. Smart contracts

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.6.0 --no-commit
forge install foundry-rs/forge-std --no-commit
forge build
forge test -vvv
```

Deploy to BSC Testnet:

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

Click the **"Fill mock data"** wand button in the hero to instantly prefill all form fields with realistic Ukrainian farm data and pre-signed Diia KEP stubs. No external configuration needed for Steps 1–3.

---

## Testing Without a Wallet

The app has a complete mock-first architecture — every external service has a graceful fallback:

| Feature | No config (mock) | With config (real) |
|---|---|---|
| Form fill | One-click "Fill mock data" | Manual entry |
| File upload | Returns mock SHA-256 + internal URL | Uploads to server |
| Diia KEP signing | Simulated modal + instant signature | Real Diia OAuth + KEP |
| IPFS pinning | Returns deterministic mock CID | Pins to Pinata |
| Blockchain mint | Returns simulated tokenId + txHash | Mints on BSC Testnet/Mainnet |

---

## Internationalization

The UI ships with full **Ukrainian** (default) and **English** support. The locale toggle (UK/EN pill) is in the app header and persists to `localStorage`. All 20+ components read from a typed `Translations` object via React context — no external i18n library, no restructuring of the Next.js app directory.

---

## Current Status

| Feature | Status |
|---|---|
| Smart contract + Foundry tests | ✅ Complete |
| Full 3-step wizard UI | ✅ Complete |
| SHA-256 file hashing (Web Crypto API) | ✅ Complete |
| Server-side mint pipeline (Viem + admin wallet) | ✅ Complete |
| Pinata IPFS pinning with mock fallback | ✅ Complete |
| QR-coded certificate (printable + downloadable HTML) | ✅ Complete |
| Public `/verify/[tokenId]` with hash verification | ✅ Complete |
| Ukrainian + English i18n | ✅ Complete |
| One-click mock data prefill | ✅ Complete |
| Diia KEP — mocked | 🟡 Pending Diia platform approval |
| File storage (S3/Supabase) | 🟡 Pending configuration |
| BSC Testnet deploy | 🔧 Ready — needs Foundry + admin wallet |
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

| Phase | Timeline | Description |
|---|---|---|
| Testnet + pilot | Q2 2026 | Deploy to BSC Testnet, real Hartolit season, 50 passports |
| Real Diia KEP | Q3 2026 | Diia.Signature production integration |
| Mainnet + production | Q3 2026 | BSC Mainnet deploy, real subsidy claim pilots |
| EU audit export | Q4 2026 | PDF/XML export in GlobalG.A.P. format |
| Third-party operators | Q1 2027 | Open API for other drone operators |
| Mobile app | Q1 2027 | React Native for field operators |
| On-chain insurance | Q2 2027 | Parametric crop insurance using passport data as oracle |

---

## Production Deployment Checklist

- [ ] Smart contract audited (at minimum, internal review with OpenZeppelin patterns)
- [ ] Contract deployed and verified on BSC Mainnet
- [ ] Admin wallet moved into a Gnosis Safe multisig
- [ ] All `.env` keys set in Vercel
- [ ] Diia.Signature production credentials approved
- [ ] Pinata account upgraded for production traffic
- [ ] S3/Supabase Storage bucket with CORS + lifecycle policies
- [ ] Rate limiting on `/api/mint` (Upstash Ratelimit)
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
