"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { readApi } from "@/lib/client/api";
import type { AccountDeletionReceipt } from "@/lib/auth/accountDeletionContract";
import { accountDeletionLanguage, getAccountDeletionCopy } from "@/lib/i18n/accountDeletion";

type RequestState = { enabled: boolean; hasIdentity: boolean; request: AccountDeletionReceipt | null };

export function AccountDeletionRequest() {
  const { locale } = useI18n();
  const { user, loading: authLoading } = useAuth();
  const copy = getAccountDeletionCopy(locale);
  const [state, setState] = useState<RequestState | null>(null);
  const [email, setEmail] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    const controller = new AbortController();
    fetch("/api/account/deletion-request", { cache: "no-store", signal: controller.signal })
      .then((response) => readApi<RequestState>(response))
      .then((next) => { if (!controller.signal.aborted) { setState(next); setFailed(false); } })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [authLoading, user?.playerKey, reload]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!confirmed || sending) return;
    setSending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/account/deletion-request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed, email }),
      });
      const result = await readApi<{ request: AccountDeletionReceipt }>(response);
      setState({ enabled: true, hasIdentity: true, request: result.request });
      setEmail("");
      setConfirmed(false);
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  if (state && !state.enabled) return null;
  const request = state?.request;
  return <section className="account-deletion-flow" lang={accountDeletionLanguage(locale)} aria-labelledby="deletion-request-title">
    <h2 id="deletion-request-title">{copy.inAppTitle}</h2>
    {failed && <div role="alert"><p>{copy.failed}</p><button className="button button--secondary" type="button" onClick={() => setReload((value) => value + 1)}><RefreshCw aria-hidden="true" size={18} />{copy.retry}</button></div>}
    {!state && !failed && <p role="status">{copy.loading}</p>}
    {request ? <div role="status">
      <p>{copy[request.status]}</p>
      {request.status !== "completed" && <p>{copy.due}: <time dateTime={request.dueAt}>{new Date(request.dueAt).toLocaleDateString(accountDeletionLanguage(locale))}</time></p>}
      <p>{copy.reference}: <span className="deletion-reference">{request.id}</span></p>
    </div> : state?.enabled && <>
      <p>{copy.inAppIntro}</p>
      {!state.hasIdentity ? <p>{copy.signIn}</p> : <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="deletion-email">{copy.emailLabel}</label>
        <input id="deletion-email" type="email" autoComplete="email" maxLength={320} value={email} disabled={sending} onChange={(event) => setEmail(event.target.value)} aria-describedby="deletion-email-hint" />
        <p id="deletion-email-hint">{copy.emailHint}</p>
        <label className="deletion-confirm"><input type="checkbox" checked={confirmed} disabled={sending} onChange={(event) => setConfirmed(event.target.checked)} /><span>{copy.consent}</span></label>
        <button className="button button--secondary" type="submit" disabled={!confirmed || sending}><Trash2 aria-hidden="true" size={18} />{sending ? copy.sending : copy.action}</button>
      </form>}
    </>}
  </section>;
}
