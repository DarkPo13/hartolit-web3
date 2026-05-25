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
import type { FieldPassportPayload, MintResult } from "@/types/passport";

export const runtime = "nodejs";
export const maxDuration = 60;

interface MintRequestBody {
  payload: FieldPassportPayload;
  recipient?: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const { payload, recipient } = (await req.json()) as MintRequestBody;

    if (!payload) {
      return NextResponse.json({ error: "Field 'payload' is required" }, { status: 400 });
    }
    if (!payload.farmerId) {
      return NextResponse.json({ error: "payload.farmerId missing" }, { status: 400 });
    }

    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97);
    const chain = chainId === 56 ? bsc : bscTestnet;
    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as
      | `0x${string}`
      | undefined;
    const adminKey = process.env.ADMIN_PRIVATE_KEY;

    // ---- 1. Hash + 2. Pin to IPFS ----
    const canonical = canonicalize(payload);
    const sha = await sha256Hex(canonical);
    const payloadHash = hexToBytes32(sha);

    const pin = await pinJson(payload, `hartolit-${payload.farmerId}-${Date.now()}`);

    // ---- 3. Mint on-chain (or return a simulated result if not configured) ----
    if (!contractAddress || !adminKey) {
      console.warn(
        "[mint] NEXT_PUBLIC_CONTRACT_ADDRESS or ADMIN_PRIVATE_KEY not set — returning simulated result.",
      );
      const mock: MintResult = {
        tokenId: Math.floor(Math.random() * 1_000_000) + 1,
        txHash: ("0x" + sha.slice(0, 64)) as `0x${string}`,
        blockNumber: 0,
        ipfsUri: pin.uri,
        payloadHash,
        gasUsed: "0",
        contractAddress: "0x0000000000000000000000000000000000000000",
        chainId,
        mintedAt: new Date().toISOString(),
      };
      return NextResponse.json(mock);
    }

    const account = privateKeyToAccount(adminKey as Hex);
    const transport = http(
      chainId === 56
        ? process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com"
        : process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com",
    );
    const wallet = createWalletClient({ account, chain, transport });
    const publicClient = createPublicClient({ chain, transport });

    const to = (recipient && /^0x[a-fA-F0-9]{40}$/.test(recipient)
      ? (recipient as `0x${string}`)
      : account.address) as `0x${string}`;

    const { request } = await publicClient.simulateContract({
      account,
      address: contractAddress,
      abi: HARTOLIT_PASSPORT_ABI,
      functionName: "mintPassport",
      args: [to, payloadHash, payload.farmerId, pin.uri],
    });

    const txHash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    let tokenId = 0;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: HARTOLIT_PASSPORT_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "PassportMinted") {
          tokenId = Number((decoded.args as { tokenId: bigint }).tokenId);
          break;
        }
      } catch {
        // not a PassportMinted log
      }
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
    };
    return NextResponse.json(result);
  } catch (e) {
    console.error("[mint] error:", e);
    const msg = e instanceof Error ? e.message : "Mint failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
