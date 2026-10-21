"use client";

import { useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, http, WagmiProvider, useAccount, useConfig, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { getAccount } from "wagmi/actions";
import { injected } from "wagmi/connectors";
import { bscTestnet } from "wagmi/chains";
import { Button } from "@/components/ui/Button";
import { useLocale, useT } from "@/lib/i18n/context";
import { walletChallengeResponseSchema, type WalletChallenge } from "@/lib/publication/schema";
import type { PublicationReservation } from "@/lib/publication/types";

type Props = { base: string; reservation: PublicationReservation; walletAddress: string; certificateId: string; disabled: boolean; onVerified: (uncertain?: boolean) => Promise<void> };

// One in-memory browser-wallet session for this lazily loaded admin module.
// Do not recreate injected provider listeners when navigating between passports.
const publisherConfig = createConfig({ chains: [bscTestnet], connectors: [injected()],
  multiInjectedProviderDiscovery: false, storage: null, ssr: false,
  transports: { [bscTestnet.id]: http(process.env.NEXT_PUBLIC_BSC_TESTNET_RPC) },
});

export function PublisherWallet(props: Props) {
  // This real ownership flow is independent of the Mainnet-capable legacy demo.
  // Keep connection state in memory and use the browser's injected wallet only.
  const [queryClient] = useState(() => new QueryClient());
  useEffect(() => () => { queryClient.clear(); }, [queryClient]);
  return <WagmiProvider config={publisherConfig} reconnectOnMount={false}><QueryClientProvider client={queryClient}><WalletControls {...props} /></QueryClientProvider></WagmiProvider>;
}

function rejected(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    if ("code" in current && current.code === 4001) return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

function WalletControls({ base, reservation, walletAddress, certificateId, disabled, onVerified }: Props) {
  const t = useT().publisher;
  const { locale } = useLocale();
  const config = useConfig();
  const { address, chainId, isConnected, connector } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const [challenge, setChallenge] = useState<{ value: WalletChallenge; connectorId: string } | null>(null);
  const [phase, setPhase] = useState<"idle" | "connecting" | "switching" | "preparing" | "signing" | "saving" | "disconnecting">("idle");
  const [error, setError] = useState<"rejected" | "walletError" | "changed" | "actionError" | "accessDenied" | "saveUncertain" | null>(null);
  const [checked, setChecked] = useState(false);
  const [now, setNow] = useState(Date.now);
  const alive = useRef(true);
  const running = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!challenge) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [challenge]);
  useEffect(() => { setChallenge(null); setChecked(false); setError(null); }, [address, chainId, connector?.uid]);

  const matches = address?.toLowerCase() === walletAddress;
  const ready = isConnected && matches && chainId === 97;
  const current = ready && challenge && challenge.connectorId === connector?.uid ? challenge.value : null;
  const expired = current ? Date.parse(current.expiresAt) <= now : false;
  const busy = phase !== "idle";

  function stillConnected() {
    const account = getAccount(config);
    return account.isConnected && account.address?.toLowerCase() === walletAddress && account.chainId === 97 && account.connector?.uid === connector?.uid;
  }

  async function walletAction(action: "connect" | "switch" | "disconnect") {
    if (running.current || disabled) return;
    running.current = true; setError(null);
    setPhase(action === "connect" ? "connecting" : action === "switch" ? "switching" : "disconnecting");
    try {
      if (action === "connect") {
        if (!connectors[0]) throw new Error();
        await connectAsync({ connector: connectors[0] });
      } else if (action === "switch") await switchChainAsync({ chainId: 97 });
      else await disconnectAsync();
    } catch (cause) { if (alive.current) setError(rejected(cause) ? "rejected" : "walletError"); }
    finally { running.current = false; if (alive.current) setPhase("idle"); }
  }

  async function prepare() {
    if (!ready || running.current || disabled) return;
    running.current = true; setPhase("preparing"); setError(null); setChallenge(null); setChecked(false);
    try {
      const response = await fetch(`${base}/wallet-challenge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publicationId: reservation.id }) });
      if (!response.ok) throw new Error(String(response.status));
      const value = walletChallengeResponseSchema.parse((await response.json()).challenge);
      if (!alive.current) return;
      if (!stillConnected() || value.publicationId !== reservation.id || value.walletAddress !== walletAddress ||
        !value.message.startsWith("Hartolit publisher wallet ownership\n") ||
        ![`Application: ${window.location.origin}`, `Wallet: ${walletAddress}`, `Certificate: ${certificateId}`,
          `Publication reservation: ${reservation.id}`, `Payload SHA-256: ${reservation.payloadHash}`, "Chain ID: 97 (BSC Testnet)"].every(line => value.message.split("\n").includes(line))) {
        setError("changed"); return;
      }
      setNow(Date.now()); setChallenge({ value, connectorId: connector!.uid });
    } catch (cause) { if (alive.current) setError(cause instanceof Error && ["401", "403"].includes(cause.message) ? "accessDenied" : "changed"); }
    finally { running.current = false; if (alive.current) setPhase("idle"); }
  }

  async function sign() {
    if (!current || !checked || !ready || !stillConnected() || Date.parse(current.expiresAt) <= Date.now() || running.current || disabled) return;
    running.current = true; setPhase("signing"); setError(null);
    let saving = false;
    try {
      const signature = await signMessageAsync({ message: current.message, account: address });
      if (!alive.current) return;
      if (!stillConnected() || Date.parse(current.expiresAt) <= Date.now()) { setError("changed"); return; }
      saving = true; setPhase("saving");
      const response = await fetch(`${base}/wallet-proof`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        publicationId: reservation.id, challengeId: current.id, signature,
      }) });
      if (!response.ok) throw new Error(String(response.status));
      if (alive.current) await onVerified();
    } catch (cause) {
      if (alive.current) {
        setError(rejected(cause) ? "rejected" : saving ? "saveUncertain" : "walletError");
        if (saving) await onVerified(true); // Recover a successful write whose response was lost.
      }
    } finally { running.current = false; if (alive.current) setPhase("idle"); }
  }

  return <div className="space-y-4 text-sm">
    <p className="text-ink-muted">{t.walletHint}</p>
    {!isConnected ? <Button type="button" onClick={() => void walletAction("connect")} disabled={busy || disabled}>{busy ? t.waiting : t.connect}</Button> : <>
      <div><p className="font-medium">{t.connectedWallet}</p><code className="mt-1 block break-all">{address}</code></div>
      {!matches && <p role="alert" className="text-danger">{t.wrongWallet}</p>}
      {matches && chainId !== 97 && <div className="space-y-2"><p>{t.wrongNetwork}</p><Button type="button" onClick={() => void walletAction("switch")} disabled={busy || disabled}>{t.switchNetwork}</Button></div>}
      <Button type="button" variant="outline" size="sm" onClick={() => void walletAction("disconnect")} disabled={busy || disabled}>{t.disconnect}</Button>
      {ready && <div className="space-y-3">
        {!current || expired ? <><p>{expired ? t.expired : t.prepareHint}</p><Button type="button" onClick={() => void prepare()} disabled={busy || disabled}>{expired ? t.renew : t.prepare}</Button></> : <>
          <div className="space-y-2"><p className="font-medium">{t.message}</p><pre tabIndex={0} aria-label={t.message} className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed">{current.message}</pre><p>{t.expires}: <time dateTime={current.expiresAt}>{new Date(current.expiresAt).toLocaleTimeString(locale === "uk" ? "uk-UA" : "en-US")}</time></p></div>
          <label className="flex items-start gap-2"><input type="checkbox" checked={checked} disabled={busy || disabled} onChange={e => setChecked(e.target.checked)} className="mt-1 accent-brand-600" /><span>{t.checkMessage}</span></label>
          <Button type="button" onClick={() => void sign()} disabled={!checked || busy || disabled}>{t.sign}</Button>
        </>}
      </div>}
    </>}
    {busy && <p role="status">{phase === "signing" ? t.signing : phase === "saving" ? t.saving : t.waiting}</p>}
    {error && <p role="alert" className="text-danger">{t[error]}</p>}
  </div>;
}
