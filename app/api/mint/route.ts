import { NextResponse, type NextRequest } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import { canonicalize, hexToBytes32, sha256Hex } from "@/lib/hash";
import { pinJson } from "@/lib/ipfs";
import { HARTOLIT_PASSPORT_ABI } from "@/lib/contract";
import { DEMO_WRITE_UNAVAILABLE, isDemoMode } from "@/lib/demo-mode";
import { fieldPassportPayloadSchema } from "@/lib/schemas";
import { requireWriteAccess } from "@/lib/auth-guard";
import type { FieldPassportPayload, MintResult } from "@/types/passport";

export const runtime = "nodejs";
export const maxDuration = 60;

interface MintRequestBody {
  payload: FieldPassportPayload;
  recipient?: string | null;
}

export async function POST(req: NextRequest) {
  const denied = await requireWriteAccess(req);
  if (denied) return denied;

  if (!isDemoMode()) {
    return NextResponse.json({ error: DEMO_WRITE_UNAVAILABLE }, { status: 503 });
  }

  try {
    const { payload: untrustedPayload, recipient } = (await req.json()) as MintRequestBody;

    if (!untrustedPayload) {
      return NextResponse.json({ error: "Field 'payload' is required" }, { status: 400 });
    }
    const parsedPayload = fieldPassportPayloadSchema.safeParse(untrustedPayload);
    if (!parsedPayload.success) {
      return NextResponse.json(
        { error: "Invalid public passport payload", issues: parsedPayload.error.flatten() },
        { status: 400 },
      );
    }
    const payload = parsedPayload.data as FieldPassportPayload;

    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97);
    const chain = chainId === 56 ? bsc : bscTestnet;
    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as
      | `0x${string}`
      | undefined;
    const adminKey = process.env.ADMIN_PRIVATE_KEY;

    if (adminKey || process.env.PINATA_JWT) {
      return NextResponse.json(
        { error: "Real credentials cannot be used through the local demo API" },
        { status: 503 },
      );
    }
    if (chainId !== 56 && chainId !== 97) {
      return NextResponse.json({ error: "Unsupported chain configuration" }, { status: 503 });
    }
    if (recipient && !/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
      return NextResponse.json({ error: "Invalid recipient address" }, { status: 400 });
    }
    if (!!contractAddress !== !!adminKey) {
      return NextResponse.json({ error: "Incomplete mint configuration" }, { status: 503 });
    }
    if (!contractAddress && process.env.PINATA_JWT) {
      return NextResponse.json(
        { error: "Simulated minting cannot use real IPFS pinning" },
        { status: 503 },
      );
    }
    if (contractAddress && !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
      return NextResponse.json({ error: "Invalid contract configuration" }, { status: 503 });
    }
    if (contractAddress && !process.env.PINATA_JWT) {
      return NextResponse.json({ error: "Real minting requires IPFS configuration" }, { status: 503 });
    }

    // ---- 1. Hash + 2. Pin to IPFS ----
    const canonical = canonicalize(payload);
    const sha = await sha256Hex(canonical);
    const payloadHash = hexToBytes32(sha);

    const pin = await pinJson(payload, `hartolit-${payload.farmer.farmerId}-${Date.now()}`);

    // ---- 3. Mint on-chain (or simulate only in explicit local demo mode) ----
    if (!contractAddress || !adminKey) {
      console.warn(
        "[mint] NEXT_PUBLIC_CONTRACT_ADDRESS or ADMIN_PRIVATE_KEY not set — returning simulated result.",
      );
      const mock: MintResult = {
        tokenId: Number.parseInt(sha.slice(0, 12), 16) + 1,
        txHash: ("0x" + sha.slice(0, 64)) as `0x${string}`,
        blockNumber: 0,
        ipfsUri: pin.uri,
        payloadHash,
        gasUsed: "0",
        contractAddress: "0x0000000000000000000000000000000000000000",
        chainId,
        mintedAt: payload.issuedAt,
        payload,
      };
      return NextResponse.json(mock);
    }

    if (pin.isMock) {
      return NextResponse.json({ error: "Real minting requires real IPFS pinning" }, { status: 503 });
    }

    const account = privateKeyToAccount(adminKey as Hex);
    const transport = http(
      chainId === 56
        ? process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com"
        : process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com",
    );
    const wallet = createWalletClient({ account, chain, transport });
    const publicClient = createPublicClient({ chain, transport });

    const to = (recipient ?? account.address) as `0x${string}`;

    const { request } = await publicClient.simulateContract({
      account,
      address: contractAddress,
      abi: HARTOLIT_PASSPORT_ABI,
      functionName: "mintPassport",
      args: [to, payloadHash, pin.uri],
    });

    const txHash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error("Mint transaction reverted");
    }

    let tokenId = 0;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: HARTOLIT_PASSPORT_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "PassportMinted") {
          const args = decoded.args as {
            tokenId: bigint;
            to: `0x${string}`;
            payloadHash: `0x${string}`;
            ipfsUri: string;
          };
          if (
            args.to.toLowerCase() !== to.toLowerCase() ||
            args.payloadHash.toLowerCase() !== payloadHash.toLowerCase() ||
            args.ipfsUri !== pin.uri
          ) {
            continue;
          }
          tokenId = Number(args.tokenId);
          break;
        }
      } catch {
        // not a PassportMinted log
      }
    }
    if (!Number.isSafeInteger(tokenId) || tokenId < 1) {
      throw new Error("Mint receipt did not contain the expected PassportMinted event");
    }

    const result: MintResult = {
      tokenId,
      txHash,
      blockNumber: Number(receipt.blockNumber),
      ipfsUri: pin.uri,
      payloadHash,
      gasUsed: receipt.gasUsed.toString(),
      contractAddress,
      chainId,
      mintedAt: new Date().toISOString(),
      payload,
    };
    return NextResponse.json(result);
  } catch (e) {
    console.error("[mint] error:", e);
    const msg = e instanceof Error ? e.message : "Mint failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
