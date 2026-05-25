import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortHash(hex: string, head = 6, tail = 4): string {
  if (!hex) return "";
  if (hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head + 2)}…${hex.slice(-tail)}`;
}

export function shortAddress(addr: string): string {
  return shortHash(addr, 4, 4);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("uk-UA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function bscscanTxUrl(chainId: number, txHash: string): string {
  const base = chainId === 56 ? "https://bscscan.com" : "https://testnet.bscscan.com";
  return `${base}/tx/${txHash}`;
}

export function bscscanAddressUrl(chainId: number, addr: string): string {
  const base = chainId === 56 ? "https://bscscan.com" : "https://testnet.bscscan.com";
  return `${base}/address/${addr}`;
}

export function bscscanTokenUrl(chainId: number, contract: string, tokenId: number | string): string {
  const base = chainId === 56 ? "https://bscscan.com" : "https://testnet.bscscan.com";
  return `${base}/token/${contract}?a=${tokenId}`;
}

export function ipfsToHttp(uri: string, gateway = "https://gateway.pinata.cloud"): string {
  if (uri.startsWith("ipfs://")) {
    return `${gateway}/ipfs/${uri.replace("ipfs://", "")}`;
  }
  return uri;
}
