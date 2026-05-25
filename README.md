# Hartolit Digital Field Passport

On-chain certificates (NFTs) for every agricultural drone treatment performed by Hartolit.
Each passport bundles farmer data, treatment parameters, drone telemetry, pilot-signed meteo
data (Diia KEP) and supplier-signed chemical document (Diia KEP), hashes it all with SHA-256,
pins the JSON to IPFS, and mints an ERC-721 token on BNB Chain.

**Stack:** Next.js 16.2 · TypeScript · Tailwind CSS v4 · Wagmi v2 · Viem · RainbowKit
· Foundry · OpenZeppelin v5 · Solidity 0.8.28 · Pinata · Diia.Signature.

---

## Quick start

### 1. Prerequisites
- **Node.js ≥ 20.10** and **npm/pnpm**
- **Foundry** — `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- A **WalletConnect Cloud** project id — [cloud.reown.com](https://cloud.reown.com)
- A **Pinata** account + JWT — [app.pinata.cloud](https://app.pinata.cloud)
- An **admin wallet** (private key) holding test BNB on BSC Testnet

### 2. Install + env
```bash
npm install
cp .env.local.example .env.local
# Fill in the values — minimum required for local dev: NEXT_PUBLIC_WALLETCONNECT_ID
```

The app works without `ADMIN_PRIVATE_KEY` / `NEXT_PUBLIC_CONTRACT_ADDRESS` / `PINATA_JWT` —
in that mode `/api/mint` returns a deterministic simulated result and IPFS returns a mock CID.
Useful for UI development without spending gas.

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
export ADMIN_PRIVATE_KEY=0x…
export BSC_TESTNET_RPC=https://bsc-testnet-rpc.publicnode.com
export BSCSCAN_API_KEY=…
npm run contracts:deploy:testnet
```
Copy the deployed address into `NEXT_PUBLIC_CONTRACT_ADDRESS` in `.env.local`.

### 4. Run the dApp
```bash
npm run dev
# → http://localhost:3000
```

---

## Architecture at a glance

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (Wagmi · RainbowKit · Zustand wizard store)           │
│  ── Step 1: form blocks (RHF + Zod) ──────────────┐             │
│       ├── File upload → /api/files/upload (SHA-256)             │
│       └── Diia KEP   → /api/diia/sign + /api/diia/verify (poll) │
└──────────────────────────────────┬─────────────────┘             │
                                   ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│  Step 2: /api/mint  (server-only, uses ADMIN_PRIVATE_KEY)       │
│   ├── canonicalize(payload) → SHA-256 → bytes32                 │
│   ├── Pinata: pinJSONToIPFS  → ipfs://CID                       │
│   └── viem.writeContract     → HartolitFieldPassport.mintPassport│
└──────────────────────────────────┬──────────────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│  BNB Smart Chain  ── HartolitFieldPassport.sol (ERC-721)        │
│   tokenId → payloadHash (bytes32) + tokenURI (ipfs://CID)       │
│   soulbound (non-transferable), paused-able, role-gated mint    │
└─────────────────────────────────────────────────────────────────┘

Public verification: /verify/[tokenId]
  Reads on-chain hash + fetches IPFS JSON + re-computes SHA-256 → confirms match.
```

---

## Project layout

```
.
├── app/                       # Next.js 16 App Router
│   ├── layout.tsx             # Geist + Crimson Pro fonts, providers
│   ├── page.tsx               # Wizard host (Step 1/2/3)
│   ├── verify/[tokenId]/      # Public read-only verification page
│   └── api/
│       ├── files/upload/      # multipart upload + SHA-256
│       ├── ipfs/pin/          # Pinata pinning (server-only)
│       ├── diia/sign/         # Diia KEP initiation
│       ├── diia/verify/       # Diia KEP polling
│       ├── mint/              # The big one — pin + on-chain mint
│       └── passport/[tokenId] # On-chain read
│
├── components/
│   ├── ui/                    # Button, Card, Input, Select, FileUpload, Badge
│   ├── web3/                  # ConnectWallet (RainbowKit), ChainBadge
│   ├── wizard/                # StepsNav, Step1Form, Step2Blockchain, Step3Certificate
│   ├── form/                  # FarmerBlock, TreatmentBlock, MeteoBlock, ChemicalBlock
│   └── diia/                  # DiiaBlock, DiiaModal, DiiaSigPreview
│
├── lib/
│   ├── wagmi.ts               # RainbowKit + Wagmi config (BSC mainnet + testnet)
│   ├── contract.ts            # HartolitFieldPassport ABI (typed)
│   ├── hash.ts                # SHA-256 + canonical JSON serialization
│   ├── ipfs.ts                # Pinata client (mock fallback if PINATA_JWT unset)
│   ├── diia.ts                # Diia.Signature wrapper (mock for dev)
│   ├── schemas.ts             # Zod schemas for the 4 form blocks
│   ├── validation.ts          # Step-1 completeness + buildPayload()
│   ├── store.ts               # Zustand wizard state (persisted to localStorage)
│   ├── meteo-parser.ts        # JSON / CSV / TXT meteo file parser
│   └── utils.ts               # cn, shortHash, BSCScan URLs, ipfsToHttp
│
├── types/
│   ├── passport.ts            # FieldPassportPayload, MintResult, FileRef, DiiaSignatureRef
│   ├── diia.ts
│   └── meteo.ts
│
└── contracts/                 # Foundry workspace
    ├── src/HartolitFieldPassport.sol
    ├── test/HartolitFieldPassport.t.sol
    ├── script/Deploy.s.sol
    └── foundry.toml
```

---

## Smart contract design

`HartolitFieldPassport.sol` extends `ERC721URIStorage` + `AccessControl` (OpenZeppelin v5).

Key safety features beyond the spec:
- **Soulbound by default** — `_update` reverts on any transfer between non-zero addresses.
  Passports are records, not assets, so they cannot be sold or moved.
- **Duplicate-payload guard** — `hashToTokenId` reverts mint with `DuplicatePayload` if the
  same SHA-256 has already been minted (prevents accidental double-issuance).
- **Pauser role** — emergency stop for new mints without revoking minter keys.
- **Custom errors** instead of revert strings (cheaper gas, typed at the client).
- **Comprehensive test suite** — `forge test` covers happy path, all reverts, role gating,
  soulbound enforcement, ERC-165 interface ids, and fuzz of unique-hash invariant.

---

## Environment variables

Public (safe in the browser):
| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_WALLETCONNECT_ID` | RainbowKit / WalletConnect project id |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | Deployed HartolitFieldPassport |
| `NEXT_PUBLIC_CHAIN_ID` | 56 = mainnet, 97 = testnet |
| `NEXT_PUBLIC_APP_URL` | Used in QR codes for `/verify` |

Server-only (NEVER expose to the client):
| Var | Purpose |
|-----|---------|
| `ADMIN_PRIVATE_KEY` | Wallet that holds `MINTER_ROLE` |
| `BSC_TESTNET_RPC` / `BSC_MAINNET_RPC` | RPC endpoints |
| `PINATA_JWT` | IPFS pinning |
| `DIIA_API_KEY` / `DIIA_API_SECRET` | Diia.Signature production credentials |
| `BSCSCAN_API_KEY` | Contract verification |

---

## Status: what's working today

- ✅ Smart contract + Foundry tests
- ✅ Full wizard UI (Step 1–3) with the four form blocks
- ✅ Client-side SHA-256 file hashing (Web Crypto)
- ✅ Server-side mint pipeline (Viem + admin wallet)
- ✅ Pinata IPFS pinning with mock fallback
- ✅ QR-coded certificate (printable + downloadable HTML)
- ✅ Public `/verify/[tokenId]` page with on-chain ↔ IPFS hash matching
- 🟡 **Diia KEP signing — mocked** until production API credentials are approved
  (see `lib/diia.ts` — swap `mockSign`/`mockVerify` for real HTTP calls)
- 🟡 **File storage** returns a virtual `internal://` URL until S3/Supabase is wired

---

## Production deployment checklist

- [ ] Smart contract deployed + verified on BSC Mainnet
- [ ] Admin wallet moved into a Gnosis Safe multisig
- [ ] All `.env` keys set in Vercel
- [ ] Diia.Signature production credentials approved
- [ ] Pinata account upgraded for production traffic
- [ ] S3/Supabase Storage bucket with CORS + lifecycle policies
- [ ] Rate limiting on `/api/mint` (e.g. Upstash Ratelimit)
- [ ] Sentry + Vercel Analytics
- [ ] SSL + custom domain → `dapp.hartolit-agro.com`

---

*Project: Hartolit Digital Field Passport · Owner: Vladyslav Polovyk (CTO, VANTREXIS)*
