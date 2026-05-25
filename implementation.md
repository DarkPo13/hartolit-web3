# Claude Code — Hartolit Digital Field Passport (dApp)
## Full Implementation Prompt

---

## DESIGN REFERENCE

The file `prototype.html` (provided separately) is the approved UX/UI prototype from the founder.
Use it as the **single source of truth** for:
- All colors, fonts, spacing and visual hierarchy
- Layout and structure of every screen and component
- Card styles, buttons, badges, modals
- All animations, hover effects, transitions
- The 3-step wizard flow (Form → Blockchain → Certificate)

**Do NOT invent any design decisions.**
Read `prototype.html` first, extract every visual detail, then replicate it into the new tech stack.

---

## PROJECT CONTEXT

**Hartolit Digital Field Passport** is a Web3 dApp that creates immutable on-chain certificates (NFTs) for every agricultural drone treatment performed by Hartolit. Each treatment captures:
- Farmer + field data
- Treatment parameters + drone telemetry
- Pilot-signed meteo data (Diia KEP qualified signature)
- Supplier-signed chemical purchase document (Diia KEP)
- All combined into single SHA-256 payload → minted as ERC-721 NFT on BNB Chain
- Full metadata stored on IPFS

**Users:**
- Hartolit operator (fills the form)
- Drone pilot (signs meteo data via Diia)
- Chemical supplier (signs purchase doc via Diia)
- Verifier (insurance / state subsidy / EU certification body) — reads on-chain proof

---

## RECOMMENDED TECH STACK

### Frontend
- **Framework:** Next.js 15 (App Router) — server components, edge runtime, best SEO
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS v4 — extract design tokens from `prototype.html`
- **UI primitives:** Radix UI (modals, dropdowns, accessible by default)
- **Forms:** React Hook Form + Zod for validation
- **Icons:** Lucide React
- **Notifications:** Sonner (matches the toast style in prototype)
- **State:** Zustand for wizard state across steps

### Web3 / Blockchain
- **Wallet:** Wagmi v2 + Viem (BNB Chain support)
- **Wallet UI:** RainbowKit (clean wallet connection modal)
- **Chain:** BNB Smart Chain (BSC) — Mainnet `chainId: 56`, Testnet `chainId: 97`
- **Smart Contract:** Solidity 0.8.24 — ERC-721 with metadata extension
- **Contract framework:** Foundry (faster than Hardhat, modern toolchain)
- **Contract libraries:** OpenZeppelin v5 (ERC721URIStorage, AccessControl)

### Storage / IPFS
- **Pinata SDK** for IPFS pinning — most reliable for production
- Store JSON metadata + signed documents on IPFS
- Pin from server-side API route (keep API key private)

### Diia KEP Integration
- **Diia.Signature SDK** (official) — for KEP qualified electronic signatures
- Server-side validation of signatures via Diia API
- For development: mock signature flow (matches prototype's modal)

### Backend / API Routes
- **Next.js API routes** (no separate backend needed)
- **Database:** PostgreSQL via Supabase — store off-chain user data, file metadata, draft passports
- **File hashing:** Server-side SHA-256 via `crypto` module
- **File storage:** AWS S3 or Supabase Storage for uploaded meteo/chem documents

### DevOps
- **Hosting:** Vercel (Next.js native)
- **Smart contract verification:** BSCScan API
- **Environment:** `.env.local` for keys, never commit secrets

---

## SMART CONTRACT — `HartolitFieldPassport.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract HartolitFieldPassport is ERC721URIStorage, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 private _nextTokenId = 1;

    // Maps tokenId -> payload SHA-256 hash (off-chain immutable proof)
    mapping(uint256 => bytes32) public payloadHash;
    // Maps tokenId -> farmer EDRPOU/IPN (for indexing)
    mapping(uint256 => string) public farmerId;

    event PassportMinted(
        uint256 indexed tokenId,
        address indexed mintedBy,
        bytes32 payloadHash,
        string farmerId,
        string ipfsUri
    );

    constructor(address admin) ERC721("Hartolit Field Passport", "HFP") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    function mintPassport(
        address to,
        bytes32 _payloadHash,
        string memory _farmerId,
        string memory _ipfsUri
    ) external onlyRole(MINTER_ROLE) returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, _ipfsUri);
        payloadHash[tokenId] = _payloadHash;
        farmerId[tokenId] = _farmerId;
        emit PassportMinted(tokenId, msg.sender, _payloadHash, _farmerId, _ipfsUri);
        return tokenId;
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721URIStorage, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
```

**Deployment:**
- Deploy to BSC Testnet first (chainId 97)
- After full E2E test → deploy to BSC Mainnet (chainId 56)
- Verify on BSCScan

---

## FILE STRUCTURE

```
hartolit-dapp/
├── contracts/
│   ├── src/HartolitFieldPassport.sol
│   ├── script/Deploy.s.sol
│   ├── test/HartolitFieldPassport.t.sol
│   └── foundry.toml
│
├── app/
│   ├── layout.tsx                  # Root layout with Web3 providers
│   ├── page.tsx                    # Main wizard (3-step flow)
│   ├── verify/[tokenId]/page.tsx   # Public verification page
│   │
│   └── api/
│       ├── ipfs/pin/route.ts       # Server-side IPFS pinning
│       ├── diia/sign/route.ts      # Diia signature initiation
│       ├── diia/verify/route.ts    # Diia signature verification
│       ├── files/upload/route.ts   # File upload + SHA-256 hashing
│       └── mint/route.ts           # Server-side mint (admin wallet)
│
├── components/
│   ├── wizard/
│   │   ├── StepsNav.tsx            # Top stepper
│   │   ├── Step1Form.tsx           # Main treatment form
│   │   ├── Step2Blockchain.tsx     # Tx progress + result
│   │   └── Step3Certificate.tsx    # Printable NFT certificate
│   │
│   ├── form/
│   │   ├── FarmerBlock.tsx         # Block 01
│   │   ├── TreatmentBlock.tsx      # Block 02
│   │   ├── MeteoBlock.tsx          # Block 03 with file upload + Diia
│   │   ├── ChemicalBlock.tsx       # Block 04 with file upload + Diia
│   │   └── SignatureSummary.tsx
│   │
│   ├── diia/
│   │   ├── DiiaBlock.tsx           # The signature block UI
│   │   ├── DiiaModal.tsx           # KEP signing modal
│   │   └── DiiaSigPreview.tsx
│   │
│   ├── ui/                         # Reusable UI primitives
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   ├── Select.tsx
│   │   ├── FileUpload.tsx
│   │   ├── Badge.tsx
│   │   └── Notify.tsx
│   │
│   └── web3/
│       ├── ConnectWallet.tsx
│       └── ChainBadge.tsx          # The green pulse dot from prototype
│
├── lib/
│   ├── wagmi.ts                    # Wagmi config
│   ├── contract.ts                 # Contract ABI + helpers
│   ├── ipfs.ts                     # Pinata client
│   ├── diia.ts                     # Diia SDK wrapper
│   ├── hash.ts                     # SHA-256 utilities
│   └── store.ts                    # Zustand wizard store
│
├── types/
│   ├── passport.ts                 # Full passport type
│   ├── diia.ts
│   └── meteo.ts
│
├── prototype.html                  # Provided design reference
├── .env.local
├── package.json
└── README.md
```

---

## STEP-BY-STEP IMPLEMENTATION ORDER

### Phase 1 — Foundation
1. Initialize Next.js 15 project: `npx create-next-app@latest hartolit-dapp --typescript --tailwind --app`
2. Read `prototype.html` thoroughly. Extract:
   - Color palette → `tailwind.config.ts`
   - Fonts (JetBrains Mono, Crimson Pro, Space Grotesk) → `app/layout.tsx`
   - Component patterns (cards, buttons, upload zones)
3. Set up Wagmi + RainbowKit with BSC chains
4. Create reusable UI primitives (`components/ui/*`)

### Phase 2 — Smart Contract
1. Initialize Foundry project in `contracts/`
2. Implement `HartolitFieldPassport.sol` (above)
3. Write Foundry tests covering mint, access control, metadata
4. Deploy to BSC Testnet via `forge script`
5. Verify on testnet.bscscan.com
6. Export ABI to `lib/contract.ts`

### Phase 3 — Step 1: Form
1. Build wizard shell with `StepsNav` (3 steps)
2. Implement form blocks 01–04 matching prototype exactly
3. File upload component with:
   - Drag-and-drop
   - Client-side SHA-256 hashing (Web Crypto API)
   - Upload to `/api/files/upload` → returns S3 URL + hash
4. Meteo file parser:
   - JSON: parse directly
   - CSV: parse with PapaParse
   - PDF/XML: extract text server-side, regex for key values
5. Diia signature blocks (pilot + supplier):
   - Initially mock the flow with modal (as in prototype)
   - Store mock signatures in state
   - Real integration in Phase 6

### Phase 4 — Step 2: Blockchain
1. Server route `/api/mint`:
   - Build payload from all form data + signatures + file hashes
   - SHA-256 the entire payload
   - Pin metadata JSON to IPFS via Pinata
   - Call `mintPassport(to, payloadHash, farmerId, ipfsUri)` from admin wallet
   - Return tx hash, token ID, block number
2. UI: animated progress steps (1–7 from prototype)
3. Result card with all blockchain details

### Phase 5 — Step 3: Certificate
1. Printable certificate component (matches prototype design)
2. QR code generation pointing to `/verify/{tokenId}` route
3. Download as HTML / PDF (use `@react-pdf/renderer`)

### Phase 6 — Diia Integration (Real)
1. Register app with Diia.Signature platform
2. Implement OAuth + deeplink flow
3. Server-side signature verification
4. Replace mock signatures with real KEP

### Phase 7 — Verification Page
1. `/verify/[tokenId]` public page:
   - Read passport data from IPFS by tokenId
   - Display certificate
   - Show on-chain proof (link to BSCScan)
   - Verify payload hash matches on-chain hash

### Phase 8 — Polish & Production
1. Mobile responsiveness (prototype is desktop-first — adapt)
2. Error handling, loading states, transaction failures
3. Internationalization (UA primary, EN secondary)
4. Deploy contract to BSC Mainnet
5. Deploy frontend to Vercel
6. Add analytics (Vercel Analytics)
7. Set up monitoring (Sentry)

---

## CRITICAL IMPLEMENTATION NOTES

### Wagmi config (`lib/wagmi.ts`)
```ts
import { createConfig, http } from 'wagmi'
import { bsc, bscTestnet } from 'wagmi/chains'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'

export const config = getDefaultConfig({
  appName: 'Hartolit Field Passport',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_ID!,
  chains: [bsc, bscTestnet],
  ssr: true,
})
```

### Environment variables (`.env.local`)
```
NEXT_PUBLIC_WALLETCONNECT_ID=
NEXT_PUBLIC_CONTRACT_ADDRESS=
NEXT_PUBLIC_CHAIN_ID=97  # 56 for mainnet
ADMIN_PRIVATE_KEY=       # Server-side only, never expose
PINATA_JWT=
DIIA_API_KEY=
DIIA_API_SECRET=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
S3_BUCKET=
AWS_ACCESS_KEY=
AWS_SECRET_KEY=
BSCSCAN_API_KEY=
```

### Payload structure (`types/passport.ts`)
```ts
interface FieldPassportPayload {
  // Block 01
  farmerName: string;
  farmerId: string;         // IPN or EDRPOU
  fieldArea: number;        // hectares
  gpsCoords: string;
  cadastralNumber: string;
  crop: string;

  // Block 02
  treatmentType: string;
  treatmentDate: string;
  treatmentTime: string;
  droneModel: string;
  droneSerial: string;
  operator: string;
  pilotCert: string;        // DARS A2/A3 license
  notes: string;

  // Block 03
  meteoFile: { url: string; sha256: string; size: number };
  meteoData: {
    temp: number; humidity: number;
    wind: number; rain: number;
  };
  pilotSignature: {
    keyId: string;
    timestamp: string;
    sha256: string;          // SHA-256 of signed data + KEP signature
  };

  // Block 04
  chemical: string;
  chemicalActive: string;
  dose: number;
  workingVolume: number;
  manufacturer: string;
  regNumber: string;        // Ukrpestycid
  supplierName: string;
  supplierEdrpou: string;
  chemFile: { url: string; sha256: string; size: number };
  supplierSignature: {
    keyId: string;
    timestamp: string;
    sha256: string;
  };

  // System
  timestamp: string;
  version: string;
}

interface MintResult {
  tokenId: number;
  txHash: string;
  blockNumber: number;
  ipfsUri: string;
  payloadHash: string;      // bytes32 — written on-chain
  gasUsed: string;
}
```

### Security checklist
- **NEVER** put `ADMIN_PRIVATE_KEY` in client code — only server routes
- Validate all file uploads server-side (size, type, content)
- Verify Diia signatures server-side before allowing mint
- Use rate limiting on `/api/mint` (e.g. Upstash Ratelimit)
- Sanitize all user input before storing or hashing
- Add CSRF protection on API routes

### Performance
- Server components by default, client only where needed (wizard state, wagmi hooks)
- Lazy-load Step 2 and Step 3 components
- Use Next.js Image for any images
- Cache contract reads with React Query (built into Wagmi)

---

## DEPLOYMENT CHECKLIST (before production)

- [ ] Smart contract audited (at minimum, internal review with @openzeppelin patterns)
- [ ] Contract deployed and verified on BSC Mainnet
- [ ] All `.env` keys set in Vercel
- [ ] Diia.Signature production credentials approved
- [ ] Pinata account upgraded for production traffic
- [ ] S3 bucket with proper CORS + lifecycle policies
- [ ] Rate limiting enabled on mint endpoint
- [ ] Error monitoring (Sentry) configured
- [ ] Analytics enabled
- [ ] SSL + custom domain configured (e.g. dapp.hartolit-agro.com)
- [ ] Admin wallet has BNB balance for gas
- [ ] Smart contract owner secured in multi-sig (Safe) eventually

---

## DELIVERABLES PER PHASE

| Phase | Deliverable | Time estimate |
|---|---|---|
| 1 | Working Next.js shell with design tokens from prototype | 1 day |
| 2 | Deployed + verified ERC-721 on BSC Testnet | 1 day |
| 3 | Full Step 1 form with mocked Diia signatures | 3 days |
| 4 | End-to-end mint flow (Testnet) | 2 days |
| 5 | Certificate page with QR + PDF download | 1 day |
| 6 | Real Diia KEP integration | 3–5 days (depends on Diia approval) |
| 7 | Public verification page | 1 day |
| 8 | Production deploy + monitoring | 1 day |

**Total realistic timeline: 2–3 weeks for full production-ready dApp.**

---

*Project: Hartolit Digital Field Passport*
*Domain: dapp.hartolit-agro.com*
*Contact: Vladyslav Polovyk (CTO) · VANTREXIS*