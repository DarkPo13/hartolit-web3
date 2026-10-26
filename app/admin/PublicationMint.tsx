"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useConfig, useConnect, useConnection, useConnectors, useDisconnect, useSendTransaction, useSwitchChain } from "wagmi";
import { getConnection } from "wagmi/actions";
import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n/context";
import { publisherConfig, rejectedByWallet } from "./publisher-wallet-config";

type Request = { chainId: number; from: string; to: string; data: string; value: string };
type Described = { intent: { sha256: string; contractAddress: string; recipientWallet: string; publisherWallet: string; ipfsCid: string; requiredConfirmations: number }; request: Request };
type MintState = {
  configured: boolean;
  walletChanged: boolean;
  publication: { id: string; status: string; confirmationId: string; passportVersion: number; payloadHash: string } | null;
  candidate: Described | null;
  preparation: (Described & { id: string; intentSha256: string }) | null;
  attempt: { id: string; status: string; nonce: string; transactionHashes: string[]; quarantined: boolean; failureStatus: string | null;
    latestDiscovery: { id: string; status: string; transactionHash: string | null } | null } | null;
};
type Review = { discoveryId: string; intentSha256: string; walletStateSha256: string; observationVersion: number; discoveryVersion: number; transactionHash: string; nonce: string };
type Props = { passportId: string; canWrite: boolean; disabled: boolean; onChanged: () => Promise<unknown> };
type ErrorKey = "loadError" | "changed" | "accessDenied" | "uncertain" | "permissionUsed" | "walletError" | "pending" | "checkedRecently" | "blocked" | "unavailable" | "closeNotReady";

/** D68: review, prepare, receive one permission, send from the publisher's wallet,
 * report the hash and check the result. The server never signs.
 */
export function PublicationMint(props: Props) {
  const [queryClient] = useState(() => new QueryClient());
  useEffect(() => () => { queryClient.clear(); }, [queryClient]);
  return <WagmiProvider config={publisherConfig} reconnectOnMount={false}><QueryClientProvider client={queryClient}><MintControls {...props} /></QueryClientProvider></WagmiProvider>;
}

function MintControls({ passportId, canWrite, disabled, onChanged }: Props) {
  const t = useT().publicationMint;
  const heading = useId();
  const base = `/api/admin/passports/${encodeURIComponent(passportId)}/publication/mint`;
  const config = useConfig();
  const { address, chainId, isConnected, connector } = useConnection();
  const { mutateAsync: connectAsync } = useConnect();
  const connectors = useConnectors();
  const { mutateAsync: disconnectAsync } = useDisconnect();
  const { mutateAsync: switchChainAsync } = useSwitchChain();
  const { mutateAsync: sendTransactionAsync } = useSendTransaction();
  const [state, setState] = useState<MintState | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewChecked, setReviewChecked] = useState(false);
  const [sendChecked, setSendChecked] = useState(false);
  const [cancelChecked, setCancelChecked] = useState(false);
  const [closeChecked, setCloseChecked] = useState(false);
  const [cancelHash, setCancelHash] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const alive = useRef(true), running = useRef(false), requests = useRef<{ preparation?: string; dispatch?: string; close?: string }>({});

  const load = useCallback(async () => {
    try {
      const response = await fetch(base, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const value: MintState = (await response.json()).mint;
      if (alive.current) setState(value);
      return value;
    } catch { if (alive.current) setError("loadError"); return null; }
  }, [base]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);

  const wallet = (state?.preparation ?? state?.candidate)?.intent.publisherWallet;
  const matches = !!wallet && address?.toLowerCase() === wallet;
  const ready = isConnected && matches && chainId === 97;
  const stillReady = () => { const now = getConnection(config); return now.isConnected && now.address?.toLowerCase() === wallet && now.chainId === 97 && now.connector?.uid === connector?.uid; };

  async function run(action: () => Promise<void>) {
    if (running.current || disabled) return;
    running.current = true; setBusy(true); setError(null);
    try { await action(); } finally { running.current = false; if (alive.current) setBusy(false); }
  }
  const failure = (status: number): ErrorKey => [401, 403].includes(status) ? "accessDenied" : [409, 422, 503].includes(status) ? "changed" : "uncertain";

  const prepare = () => run(async () => {
    if (!state?.candidate || !state.publication || !reviewChecked) return;
    requests.current.preparation ??= crypto.randomUUID();
    const response = await fetch(`${base}/preparation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      publicationId: state.publication.id, requestId: requests.current.preparation, confirmationId: state.publication.confirmationId,
      passportVersion: state.publication.passportVersion, expectedSha256: state.publication.payloadHash,
      expectedIntentSha256: state.candidate.intent.sha256, acknowledgement: "PREPARE_EXACT_MINT" }) }).catch(() => null);
    const after = await load();
    if (alive.current && !after?.preparation) setError(response ? failure(response.status) : "uncertain");
    setReviewChecked(false);
  });

  const walletAction = (action: "connect" | "switch" | "disconnect") => run(async () => {
    try {
      if (action === "connect") { if (!connectors[0]) throw new Error(); await connectAsync({ connector: connectors[0] }); }
      else if (action === "switch") await switchChainAsync({ chainId: 97 });
      else await disconnectAsync();
    } catch (cause) { if (alive.current && !rejectedByWallet(cause)) setError("walletError"); }
  });

  // Wallet and network are checked before the single-use permission is requested.
  const send = () => run(async () => {
    const prepared = state?.preparation;
    if (!prepared || state?.attempt || !sendChecked || !ready || !stillReady()) return;
    setSendChecked(false);
    requests.current.dispatch ??= crypto.randomUUID();
    const response = await fetch(`${base}/dispatch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      preparationId: prepared.id, requestId: requests.current.dispatch, expectedIntentSha256: prepared.intentSha256, acknowledgement: "SEND_EXACT_MINT" }) }).catch(() => null);
    if (!response?.ok) { await load(); if (alive.current) setError(response ? failure(response.status) : "uncertain"); return; }
    const command: { attemptId: string; request: Request & { nonce: number } } = (await response.json()).command;
    const reviewed = prepared.request;
    if (!stillReady() || command.request.to !== reviewed.to || command.request.data !== reviewed.data || command.request.value !== "0" ||
      command.request.chainId !== 97 || command.request.from !== wallet) { await load(); if (alive.current) setError("permissionUsed"); return; }
    let hash: string;
    try {
      hash = await sendTransactionAsync({ to: command.request.to as `0x${string}`, data: command.request.data as `0x${string}`, value: 0n,
        nonce: command.request.nonce, chainId: 97 });
    } catch { await load(); if (alive.current) setError("permissionUsed"); return; }
    const report = await fetch(`${base}/report`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId: command.attemptId, transactionHash: hash.toLowerCase() }) }).catch(() => null);
    await load();
    if (alive.current && !report?.ok) setError("uncertain");
  });

  const check = () => run(async () => {
    if (!state?.attempt) return;
    const response = await fetch(`${base}/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId: state.attempt.id }) }).catch(() => null);
    const status: string | undefined = response?.ok ? (await response.json()).check?.status : undefined;
    const after = await load();
    if (after?.attempt?.status === "FINALIZED") { await onChanged(); return; }
    if (!alive.current) return;
    setError(!response ? "uncertain" : !response.ok ? failure(response.status) : status === "SKIPPED" ? "checkedRecently" :
      status === "BLOCKED" ? "blocked" : status === "UNAVAILABLE" ? "unavailable" : "pending");
  });

  // D46/D48: a same-nonce self-send makes the original mint impossible; after it is
  // confirmed at depth, the reviewed closure releases only this wallet slot.
  const open = !!state?.attempt && ["DISPATCHING", "UNKNOWN"].includes(state.attempt.status);
  const conflict = open && state?.attempt?.latestDiscovery?.status === "CONFLICT" ? state.attempt.latestDiscovery : null;
  // Offered only when the wallet reported no transaction (refused or failed); a sent mint is checked, not cancelled.
  const cancellable = open && !state?.attempt?.transactionHashes.length && !conflict;
  const loadReview = useCallback(async (attemptId: string, discoveryId: string) => {
    const response = await fetch(`${base}/cancellation?attemptId=${encodeURIComponent(attemptId)}&discoveryId=${encodeURIComponent(discoveryId)}`, { cache: "no-store" }).catch(() => null);
    const value: Review | null = response?.ok ? (await response.json()).review : null;
    if (alive.current) setReview(value);
    return value;
  }, [base]);
  const attemptId = state?.attempt?.id, conflictId = conflict?.id;
  useEffect(() => { if (canWrite && attemptId && conflictId) void loadReview(attemptId, conflictId); }, [canWrite, attemptId, conflictId, loadReview]);

  const sendCancellation = () => run(async () => {
    const attempt = state?.attempt;
    if (!attempt || !cancellable || !cancelChecked || !ready || !stillReady() || !wallet) return;
    setCancelChecked(false);
    try {
      const hash = await sendTransactionAsync({ to: wallet as `0x${string}`, value: 0n, nonce: Number(attempt.nonce), chainId: 97 });
      if (alive.current) setCancelHash(hash.toLowerCase());
    } catch (cause) { if (alive.current && !rejectedByWallet(cause)) setError("walletError"); }
  });

  const close = () => run(async () => {
    const attempt = state?.attempt;
    if (!attempt || !conflict || !review || !closeChecked) return;
    requests.current.close ??= crypto.randomUUID();
    const response = await fetch(`${base}/cancellation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      attemptId: attempt.id, requestId: requests.current.close, discoveryId: review.discoveryId, expectedIntentSha256: review.intentSha256,
      expectedWalletStateSha256: review.walletStateSha256, expectedObservationVersion: review.observationVersion,
      expectedDiscoveryVersion: review.discoveryVersion, acknowledgement: "CLOSE_CANCELLED_MINT" }) }).catch(() => null);
    const after = await load();
    if (after?.attempt?.status === "FAILED_TERMINAL") { setCloseChecked(false); await onChanged(); return; }
    // A changed review needs a new request; the old one stays bound to what was reviewed.
    requests.current.close = undefined;
    if (after?.attempt && conflict) await loadReview(after.attempt.id, conflict.id);
    if (alive.current) { setCloseChecked(false); setError(!response ? "uncertain" : [401, 403].includes(response.status) ? "accessDenied" : response.status === 503 ? "unavailable" : "closeNotReady"); }
  });

  const described = state?.preparation ?? state?.candidate;
  const statusText: Record<string, string> = { DISPATCHING: t.statusDispatching, UNKNOWN: t.statusUnknown, FINALIZED: t.statusFinalized, FAILED_TERMINAL: t.statusFailed };
  return <section aria-labelledby={heading} className="space-y-3 rounded-xl border border-border bg-surface p-4 text-sm">
    <h5 id={heading} className="font-semibold">{t.title}</h5>
    <p className="text-ink-muted">{t.hint}</p>
    {!state && !error && <p role="status">{t.loading}</p>}
    {state && !state.configured && <p role="status">{t.notConfigured}</p>}
    {state?.walletChanged && !state.preparation && <p role="alert" className="text-danger">{t.walletChanged}</p>}
    {described && <dl className="space-y-2">
      <div><dt className="font-medium">{t.contract}</dt><dd className="break-all font-mono text-xs">{described.intent.contractAddress}</dd></div>
      <div><dt className="font-medium">{t.recipient}</dt><dd className="break-all font-mono text-xs">{described.intent.recipientWallet}</dd></div>
      <div><dt className="font-medium">{t.cid}</dt><dd className="break-all font-mono text-xs">{described.intent.ipfsCid}</dd></div>
      <div><dt className="font-medium">{t.depth}</dt><dd>{described.intent.requiredConfirmations}</dd></div>
      <div><dt className="font-medium">{t.intentHash}</dt><dd className="break-all font-mono text-xs">{described.intent.sha256}</dd></div>
    </dl>}
    {state?.configured && !canWrite && !state.attempt && <p>{t.readOnly}</p>}
    {canWrite && state?.candidate && !state.preparation && <div className="space-y-3">
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 accent-brand-600" checked={reviewChecked} disabled={busy || disabled}
        onChange={event => setReviewChecked(event.target.checked)} /><span>{t.reviewConsent}</span></label>
      <Button type="button" onClick={() => void prepare()} disabled={!reviewChecked || busy || disabled}>{t.prepare}</Button>
    </div>}
    {canWrite && state?.preparation && !state.attempt && <div className="space-y-3 rounded-lg border border-border p-3">
      <p role="status" className="font-medium">{t.prepared}</p>
      <p className="font-medium">{t.sendTitle}</p><p>{t.sendNotice}</p>
      {!isConnected ? <Button type="button" onClick={() => void walletAction("connect")} disabled={busy || disabled}>{t.connect}</Button> : <>
        <div><p className="font-medium">{t.connectedWallet}</p><code className="mt-1 block break-all">{address}</code></div>
        {!matches && <p role="alert" className="text-danger">{t.wrongWallet}</p>}
        {matches && chainId !== 97 && <Button type="button" onClick={() => void walletAction("switch")} disabled={busy || disabled}>{t.switchNetwork}</Button>}
        {ready && <>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 accent-brand-600" checked={sendChecked} disabled={busy || disabled}
            onChange={event => setSendChecked(event.target.checked)} /><span>{t.sendConsent}</span></label>
          <Button type="button" onClick={() => void send()} disabled={!sendChecked || busy || disabled}>{t.send}</Button>
        </>}
        <Button type="button" variant="outline" size="sm" onClick={() => void walletAction("disconnect")} disabled={busy || disabled}>{t.disconnect}</Button>
      </>}
      {busy && <p role="status">{t.waitingWallet}</p>}
    </div>}
    {state?.attempt && <div className="space-y-2">
      <p className="font-medium">{t.attempt}</p>
      <p role="status">{statusText[state.attempt.status] ?? state.attempt.status}</p>
      <p>{t.nonce}: <span className="font-mono">{state.attempt.nonce}</span></p>
      {!!state.attempt.transactionHashes.length && <div><p>{t.transactions}</p>{state.attempt.transactionHashes.map(hash => <code key={hash} className="block break-all text-xs">{hash}</code>)}</div>}
      {["DISPATCHING", "UNKNOWN"].includes(state.attempt.status) && <Button type="button" variant="outline" size="sm" onClick={() => void check()} disabled={busy || disabled}>{t.checkResult}</Button>}
      {state.attempt.failureStatus === "CANCELLED" && <p role="status" className="font-medium">{t.cancelledDone}</p>}
    </div>}
    {canWrite && cancellable && <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="font-medium">{t.cancelTitle}</p>
      <p className="text-ink-muted">{t.cancelHint}</p>
      {!isConnected ? <Button type="button" variant="outline" onClick={() => void walletAction("connect")} disabled={busy || disabled}>{t.connect}</Button> : <>
        <div><p className="font-medium">{t.connectedWallet}</p><code className="mt-1 block break-all">{address}</code></div>
        {!matches && <p role="alert" className="text-danger">{t.wrongWallet}</p>}
        {matches && chainId !== 97 && <Button type="button" variant="outline" onClick={() => void walletAction("switch")} disabled={busy || disabled}>{t.switchNetwork}</Button>}
        {ready && <>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 accent-brand-600" checked={cancelChecked} disabled={busy || disabled}
            onChange={event => setCancelChecked(event.target.checked)} /><span>{t.cancelConsent}</span></label>
          <Button type="button" variant="outline" onClick={() => void sendCancellation()} disabled={!cancelChecked || busy || disabled}>{t.cancelSend}</Button>
        </>}
      </>}
      {cancelHash && <div role="status"><p>{t.cancelSent}</p><code className="mt-1 block break-all text-xs">{cancelHash}</code></div>}
    </div>}
    {canWrite && conflict && <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="font-medium">{t.cancelTitle}</p>
      <p role="status">{t.cancelFound}</p>
      {review && <dl className="space-y-1">
        <div><dt className="font-medium">{t.nonce}</dt><dd className="font-mono">{review.nonce}</dd></div>
        <div><dt className="font-medium">{t.transactions}</dt><dd className="break-all font-mono text-xs">{review.transactionHash}</dd></div>
      </dl>}
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 accent-brand-600" checked={closeChecked} disabled={busy || disabled || !review}
        onChange={event => setCloseChecked(event.target.checked)} /><span>{t.closeConsent}</span></label>
      <Button type="button" onClick={() => void close()} disabled={!closeChecked || !review || busy || disabled}>{t.close}</Button>
    </div>}
    {error && <p role="alert" className="text-danger">{t[error]}</p>}
  </section>;
}
