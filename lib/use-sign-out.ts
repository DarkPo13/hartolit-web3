"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useWizardStore } from "@/lib/store";

/** Ends the server session, then clears this browser's local draft state. */
export function useSignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function signOut() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    const result = await authClient.signOut().catch(() => null);
    if (!result || result.error) {
      setFailed(true);
      setPending(false);
      return;
    }
    useWizardStore.getState().reset();
    try {
      sessionStorage.removeItem("hartolit-wizard-session");
      sessionStorage.removeItem("hartolit-draft-owner");
    } catch {
      // Browser storage may be unavailable; the server session is already closed.
    }
    router.replace("/login");
    router.refresh();
  }
  return { signOut, pending, failed };
}
