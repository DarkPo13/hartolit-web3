import { notFound } from "next/navigation";
import { createPublicClient, http } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { AlertTriangle, Leaf } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { HARTOLIT_PASSPORT_ABI } from "@/lib/contract";
import { fetchJsonFromIpfs } from "@/lib/ipfs";
import { canonicalize, sha256Hex } from "@/lib/hash";
import { VerifyDisplay } from "./VerifyDisplay";
import type { FieldPassportPayload } from "@/types/passport";

interface PageProps {
  params: Promise<{ tokenId: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadPassport(tokenIdStr: string) {
  let tokenId: bigint;
  try {
    tokenId = BigInt(tokenIdStr);
  } catch {
    return null;
  }

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97);
  const chain = chainId === 56 ? bsc : bscTestnet;
  const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as
    | `0x${string}`
    | undefined;

  if (!contractAddress) {
    return { error: "Contract address not configured" };
  }

  const client = createPublicClient({
    chain,
    transport: http(
      chainId === 56
        ? process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com"
        : process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com",
    ),
  });

  try {
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
    let computedHash: string | null = null;
    let hashesMatch = false;
    try {
      payload = await fetchJsonFromIpfs<FieldPassportPayload>(tokenURI as string);
      computedHash = `0x${await sha256Hex(canonicalize(payload))}`;
      hashesMatch = computedHash.toLowerCase() === (payloadHash as string).toLowerCase();
    } catch (e) {
      console.warn("[verify] IPFS fetch failed:", e);
    }

    return {
      tokenId: tokenIdStr,
      owner: owner as `0x${string}`,
      tokenURI: tokenURI as string,
      payloadHash: payloadHash as `0x${string}`,
      farmerId: farmerId as string,
      chainId,
      contractAddress,
      payload,
      computedHash,
      hashesMatch,
    };
  } catch (e) {
    console.error("[verify] read error:", e);
    return null;
  }
}

export default async function VerifyPage({ params }: PageProps) {
  const { tokenId } = await params;
  const data = await loadPassport(tokenId);

  if (!data) notFound();
  if ("error" in data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <Card className="p-8">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-amber-600 flex-shrink-0" />
            <div>
              <h1 className="text-lg font-semibold">Verification unavailable</h1>
              <p className="text-sm text-ink-muted mt-1">{data.error}</p>
            </div>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:py-12">
      <header className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-soft">
          <Leaf className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Hartolit · Field Passport</h1>
          <p className="text-xs text-ink-muted">Token #{data.tokenId}</p>
        </div>
      </header>

      <VerifyDisplay data={data} />
    </main>
  );
}
