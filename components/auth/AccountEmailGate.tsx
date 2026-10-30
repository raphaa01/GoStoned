"use client";

import { useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getAccountSecurityCopy } from "@/lib/i18n/accountSecurity";
import { localizedAuthError } from "@/lib/i18n/dictionary";
import { useAuth } from "./AuthProvider";
import { AccountDeletionRequest } from "@/components/legal/AccountDeletionRequest";

export function AccountEmailGate() {
  const { refresh, logout } = useAuth();
  const { locale, dictionary } = useI18n();
  const copy = getAccountSecurityCopy(locale);
  const requestPending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestPending.current) return;
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    requestPending.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/email", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
      });
      const body = await response.json() as { ok: boolean; code?: string };
      if (!response.ok || !body.ok) {
        setError(copy.errors[body.code as keyof typeof copy.errors] ?? localizedAuthError(dictionary, body.code, "request_failed"));
        return;
      }
      await refresh();
    } catch {
      setError(dictionary.auth.errors.request_failed);
    } finally {
      requestPending.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="account-email-gate" id="main-content">
      <section className="auth-card" aria-labelledby="account-email-title">
        <h1 id="account-email-title">{copy.emailTitle}</h1>
        <p>{copy.emailIntro}</p>
        <form className="auth-form" onSubmit={submit} method="post">
          <label><span>{copy.email}</span><span className="input-wrap">
            <input type="email" name="email" aria-label={copy.email} autoComplete="email" autoCapitalize="none" spellCheck={false} autoFocus required maxLength={254}
              readOnly={busy} onChange={() => setError(null)} />
          </span><small>{copy.emailHint}</small></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button button--primary auth-submit" type="submit" disabled={busy}>
            {busy ? copy.busy : copy.saveEmail}
          </button>
        </form>
        <button className="button auth-submit" type="button" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await logout(); } catch { setError(dictionary.auth.errors.logout_failed); }
          finally { setBusy(false); }
        }}>{copy.logout}</button>
        <AccountDeletionRequest />
      </section>
    </main>
  );
}
