"use client";

import { useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getAccountSecurityCopy } from "@/lib/i18n/accountSecurity";
import { localizedAuthError } from "@/lib/i18n/dictionary";

export function PasswordResetForm({ onBack }: { onBack: () => void }) {
  const { locale, dictionary } = useI18n();
  const copy = getAccountSecurityCopy(locale);
  const [email, setEmail] = useState("");
  const [requestedEmail, setRequestedEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: "request" | "reset") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "request"
          ? { action, email: requestedEmail ?? email }
          : { action, email: requestedEmail, code, password }),
      });
      const body = await response.json() as { ok: boolean; code?: string };
      if (!response.ok || !body.ok) {
        setError(copy.errors[body.code as keyof typeof copy.errors] ?? localizedAuthError(dictionary, body.code, "request_failed"));
        return;
      }
      if (action === "request") { setRequestedEmail(requestedEmail ?? email); setCode(""); }
      else { setDone(true); setPassword(""); setCode(""); }
    } catch {
      setError(dictionary.auth.errors.request_failed);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(requestedEmail ? "reset" : "request");
  }

  return <section className="auth-card">
    <header className="auth-card__header"><h1>{copy.resetTitle}</h1></header>
    {done ? <p role="status">{copy.resetDone}</p> : <>
      <p>{requestedEmail ? copy.codeSent : copy.resetIntro}</p>
      <form className="auth-form" onSubmit={submit}>
        <label><span>{copy.email}</span><span className="input-wrap">
          <input type="email" aria-label={copy.email} autoComplete="email" required maxLength={254} autoFocus
            disabled={busy || requestedEmail !== null} value={requestedEmail ?? email}
            onChange={(event) => setEmail(event.target.value)} />
        </span></label>
        {requestedEmail ? <>
          <label><span>{copy.code}</span><span className="input-wrap">
            <input aria-label={copy.code} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{8}" required maxLength={8}
              value={code} onChange={(event) => setCode(event.target.value)} />
          </span></label>
          <label><span>{copy.newPassword}</span><span className="input-wrap">
            <input type="password" aria-label={copy.newPassword} autoComplete="new-password" required minLength={8} maxLength={128}
              value={password} onChange={(event) => setPassword(event.target.value)} />
          </span></label>
        </> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button button--primary button--lg auth-submit" disabled={busy} type="submit">
          {busy ? copy.busy : requestedEmail ? copy.reset : copy.sendCode}
        </button>
        {requestedEmail ? <button className="button" type="button" disabled={busy} onClick={() => void send("request")}>{copy.resendCode}</button> : null}
      </form>
    </>}
    <button className="button" style={{ marginTop: 16 }} type="button" disabled={busy} onClick={onBack}>{copy.back}</button>
  </section>;
}
