"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { readApi } from "@/lib/client/api";
import type { AccountDeletionReceipt } from "@/lib/auth/accountDeletionContract";
import { accountDeletionLanguage, getAccountDeletionCopy } from "@/lib/i18n/accountDeletion";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";

type RequestState = { enabled: boolean; hasIdentity: boolean; actor?: string; request: AccountDeletionReceipt | null };

export function AccountDeletionRequest() {
  const { locale, href } = useI18n();
  const { user, loading: authLoading, clearSession } = useAuth();
  const router = useRouter();
  const copy = getAccountDeletionCopy(locale);
  const [state, setState] = useState<RequestState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const pending = useRef(false);
  const completed = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (authLoading || completed.current) return;
    const controller = new AbortController();
    fetch("/api/account/deletion-request", { cache: "no-store", signal: controller.signal })
      .then((response) => readApi<RequestState>(response))
      .then((next) => { if (!controller.signal.aborted) { setState(next); setFailed(false); } })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [authLoading, user?.playerKey, reload]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!confirmed || pending.current) return;
    pending.current = true;
    setSending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/account/deletion-request", {
        method: "POST", headers: { "Content-Type": "application/json",
          ...((state?.actor ?? user?.playerKey) ? { [EXPECTED_PLAYER_HEADER]: state?.actor ?? user!.playerKey } : {}),
        },
        body: JSON.stringify({ confirmed }),
      });
      const result = await readApi<{ request: AccountDeletionReceipt }>(response);
      completed.current = result.request.status === "completed";
      setState({ enabled: true, hasIdentity: !completed.current, request: result.request });
      setConfirmed(false);
      if (completed.current) {
        try {
          localStorage.removeItem(`gostone.learn.path.v1:${user?.id ?? "guest"}`);
          if (user) localStorage.removeItem(`gostone:scoring-help:v1:hidden:${user.playerKey}`);
          sessionStorage.removeItem("gostone-mobile-oauth-v1");
        } catch { /* Restricted device storage must not hide completed deletion. */ }
        router.replace(href("/delete-account"));
        clearSession();
      }
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
      pending.current = false;
    }
  }

  if (state && !state.enabled) return null;
  const request = state?.request;
  return <section className="settings-section account-deletion-flow" lang={accountDeletionLanguage(locale)} aria-labelledby="deletion-request-title">
    <h2 id="deletion-request-title">{copy.inAppTitle}</h2>
    {failed && <div role="alert"><p>{copy.failed}</p><button className="button button--secondary" type="button" onClick={() => setReload((value) => value + 1)}><RefreshCw aria-hidden="true" size={18} />{copy.retry}</button></div>}
    {!state && !failed && <p role="status">{copy.loading}</p>}
    {request?.status === "completed" ? <div role="status">
      <p>{copy[request.status]}</p>
      <p>{copy.appleNote}</p>
      <p>{copy.reference}: <span className="deletion-reference">{request.id}</span></p>
    </div> : state?.enabled && <>
      <p>{copy.inAppIntro}</p>
      {!state.hasIdentity ? <p>{copy.signIn} <Link className="button button--secondary" href={href("/login?returnTo=%2Fdelete-account")}>{copy.signInAction}</Link></p>
        : !confirming ? <button className="button button--secondary" type="button" onClick={() => setConfirming(true)}><Trash2 aria-hidden="true" size={18} />{copy.action}</button>
        : <form onSubmit={(event) => void submit(event)}>
        <p>{copy.data}</p>
        <label className="deletion-confirm"><input type="checkbox" checked={confirmed} disabled={sending} onChange={(event) => setConfirmed(event.target.checked)} /><span>{copy.consent}</span></label>
        <button className="button button--secondary" type="submit" disabled={!confirmed || sending}><Trash2 aria-hidden="true" size={18} />{sending ? copy.sending : copy.action}</button>
        <button className="button" type="button" disabled={sending} onClick={() => { setConfirming(false); setConfirmed(false); }}>{copy.cancel}</button>
      </form>}
    </>}
  </section>;
}
