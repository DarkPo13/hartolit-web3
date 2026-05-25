/**
 * Pinata IPFS pinning. Server-only — uses PINATA_JWT secret.
 * Falls back to a deterministic mock CID in dev if PINATA_JWT is unset.
 */

import { sha256Hex } from "./hash";

const PINATA_BASE = "https://api.pinata.cloud";

export interface PinResult {
  cid: string;
  uri: `ipfs://${string}`;
  size: number;
  isMock: boolean;
}

export async function pinJson(value: unknown, name: string): Promise<PinResult> {
  const jwt = process.env.PINATA_JWT;
  const json = JSON.stringify(value);
  const size = new TextEncoder().encode(json).length;

  if (!jwt) {
    const hash = await sha256Hex(json);
    const mockCid = `bafkmock${hash.slice(0, 50)}`;
    return {
      cid: mockCid,
      uri: `ipfs://${mockCid}`,
      size,
      isMock: true,
    };
  }

  const res = await fetch(`${PINATA_BASE}/pinning/pinJSONToIPFS`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      pinataContent: value,
      pinataMetadata: { name },
      pinataOptions: { cidVersion: 1 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pinata pinJSONToIPFS failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { IpfsHash: string; PinSize: number };
  return {
    cid: data.IpfsHash,
    uri: `ipfs://${data.IpfsHash}`,
    size: data.PinSize,
    isMock: false,
  };
}

export async function fetchJsonFromIpfs<T>(uri: string): Promise<T> {
  const gateway = process.env.PINATA_GATEWAY ?? "https://gateway.pinata.cloud";
  const cid = uri.replace(/^ipfs:\/\//, "");
  const res = await fetch(`${gateway}/ipfs/${cid}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`IPFS fetch failed (${res.status}) for ${uri}`);
  }
  return (await res.json()) as T;
}
