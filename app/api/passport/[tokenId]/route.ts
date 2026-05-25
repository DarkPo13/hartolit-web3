import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { HARTOLIT_PASSPORT_ABI } from "@/lib/contract";
import { fetchJsonFromIpfs } from "@/lib/ipfs";
import type { FieldPassportPayload } from "@/types/passport";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  try {
    const { tokenId: rawTokenId } = await params;
    const tokenId = BigInt(rawTokenId);

    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97);
    const chain = chainId === 56 ? bsc : bscTestnet;
    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as
      | `0x${string}`
      | undefined;

    if (!contractAddress) {
      return NextResponse.json(
        { error: "Contract address not configured" },
        { status: 503 },
      );
    }

    const client = createPublicClient({
      chain,
      transport: http(
        chainId === 56
          ? process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com"
          : process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com",
      ),
    });

    const [owner, tokenURI, payloadHash, farmerId] = await Promise.all([
      client.readContract({
        address: contractAddress,
        abi: HARTOLIT_PASSPORT_ABI,
        functionName: "ownerOf",
        args: [tokenId],
      }),
      client.readContract({
        address: contractAddress,
        abi: HARTOLIT_PASSPORT_ABI,
        functionName: "tokenURI",
        args: [tokenId],
      }),
      client.readContract({
        address: contractAddress,
        abi: HARTOLIT_PASSPORT_ABI,
        functionName: "payloadHash",
        args: [tokenId],
      }),
      client.readContract({
        address: contractAddress,
        abi: HARTOLIT_PASSPORT_ABI,
        functionName: "farmerId",
        args: [tokenId],
      }),
    ]);

    let payload: FieldPassportPayload | null = null;
    try {
      payload = await fetchJsonFromIpfs<FieldPassportPayload>(tokenURI as string);
    } catch (e) {
      console.warn("[passport] IPFS fetch failed:", e);
    }

    return NextResponse.json({
      tokenId: rawTokenId,
      owner,
      tokenURI,
      payloadHash,
      farmerId,
      chainId,
      contractAddress,
      payload,
    });
  } catch (e) {
    console.error("[passport] error:", e);
    const msg = e instanceof Error ? e.message : "Read failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
