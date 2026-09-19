"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useId, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { affectedAuthFields } from "@/lib/auth/errorFields";
import { localizedAuthError } from "@/lib/i18n/dictionary";
import type { StartingStrength } from "@/lib/rating/preferences";
import { useAuth } from "./AuthProvider";
import { BeginnerOnboardingDialog } from "./BeginnerOnboardingDialog";

export function OAuthUsernameForm({ returnTo = null }: { returnTo?: string | null }) {
  const { user, refresh } = useAuth();
  const { dictionary, href } = useI18n();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; username: boolean } | null>(null);
  const usernameHintId = useId();
  const errorId = useId();
  const usernameInput = useRef<HTMLInputElement>(null);

  async function createAccount(strength: StartingStrength): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/oauth/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          startingStrength: strength.estimate,
          knownRank: strength.knownRank,
        }),
      });
      const body = (await response.json()) as { ok: boolean; code?: string };
      if (!response.ok || !body.ok) {
        const usernameAffected = affectedAuthFields(body.code).includes("username");
        setError({
          message: localizedAuthError(dictionary, body.code, "request_failed"),
          username: usernameAffected,
        });
        if (usernameAffected) {
          window.requestAnimationFrame(() => usernameInput.current?.focus());
        }
        setOnboardingOpen(false);
        return false;
      }
      return true;
    } catch (requestError) {
      setError({
        message: requestError instanceof Error
          ? requestError.message
          : dictionary.auth.errors.request_failed,
        username: false,
      });
      setOnboardingOpen(false);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setOnboardingOpen(true);
  }

  async function finishRegistration(destination?: "/learn") {
    setBusy(true);
    try {
      await refresh();
      router.push(href(destination ?? returnTo ?? "/profile"));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <section className="auth-card auth-card--signed-in">
        <h1>{dictionary.auth.alreadyLoggedIn}</h1>
        <p>{dictionary.auth.continueAs} <strong>{user.displayName}</strong>.</p>
        <Link className="button button--primary button--lg" href={href("/profile")}>{dictionary.nav.profile}</Link>
      </section>
    );
  }

  return (
    <section className="auth-card auth-card--oauth-username">
      <header className="auth-card__header">
        <h1>{dictionary.auth.chooseUsernameTitle}</h1>
        <p>{dictionary.auth.chooseUsernameDescription}</p>
      </header>

      <form className="auth-form" onSubmit={submit}>
        <label>
          <span>{dictionary.auth.username}</span>
          <span className="input-wrap">
            <input
              aria-describedby={`${usernameHintId}${error?.username ? ` ${errorId}` : ""}`}
              aria-invalid={error?.username || undefined}
              aria-label={dictionary.auth.username}
              autoComplete="username"
              autoFocus
              maxLength={20}
              minLength={3}
              onChange={(event) => {
                setUsername(event.target.value);
                if (error) setError(null);
              }}
              pattern="[A-Za-z0-9_]+"
              placeholder={dictionary.auth.usernamePlaceholder}
              required
              ref={usernameInput}
              value={username}
            />
          </span>
          <small id={usernameHintId}>{dictionary.auth.usernameHint}</small>
        </label>

        {error ? <p className="form-error" id={errorId} role="alert">{error.message}</p> : null}
        <button className="button button--primary button--lg auth-submit" disabled={busy} type="submit">
          {busy ? <LoaderCircle className="spin" size={19} /> : null}
          {busy ? dictionary.auth.completingAccount : dictionary.auth.completeAccount}
        </button>
      </form>

      <p className="auth-switch">
        <Link href={href(returnTo ? `/register?returnTo=${encodeURIComponent(returnTo)}` : "/register")}>
          {dictionary.auth.restartSocialSignup}
        </Link>
      </p>
      {onboardingOpen ? (
        <BeginnerOnboardingDialog
          busy={busy}
          onCancel={() => setOnboardingOpen(false)}
          onCreateAccount={createAccount}
          onFinish={finishRegistration}
          open
        />
      ) : null}
    </section>
  );
}
