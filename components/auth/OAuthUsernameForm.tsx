"use client";

import { Gauge, LoaderCircle, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useId, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { affectedAuthFields } from "@/lib/auth/errorFields";
import { localizedAuthError } from "@/lib/i18n/dictionary";
import {
  KNOWN_RANK_OPTIONS,
  type StartingStrengthEstimate,
} from "@/lib/rating/preferences";
import { useAuth } from "./AuthProvider";

export function OAuthUsernameForm({ returnTo = null }: { returnTo?: string | null }) {
  const { user, refresh } = useAuth();
  const { dictionary, href } = useI18n();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [startingStrength, setStartingStrength] = useState<StartingStrengthEstimate>("unspecified");
  const [knownRank, setKnownRank] = useState("12k");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; username: boolean } | null>(null);
  const usernameHintId = useId();
  const errorId = useId();
  const usernameInput = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/oauth/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          startingStrength,
          knownRank: startingStrength === "known" ? knownRank : null,
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
        return;
      }
      await refresh();
      router.push(href(returnTo ?? "/profile"));
      router.refresh();
    } catch (requestError) {
      setError({
        message: requestError instanceof Error
          ? requestError.message
          : dictionary.auth.errors.request_failed,
        username: false,
      });
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <section className="auth-card auth-card--signed-in">
        <span className="auth-icon"><UserRound size={24} /></span>
        <h1>{dictionary.auth.alreadyLoggedIn}</h1>
        <p>{dictionary.auth.continueAs} <strong>{user.displayName}</strong>.</p>
        <Link className="button button--primary button--lg" href={href("/profile")}>{dictionary.nav.profile}</Link>
      </section>
    );
  }

  return (
    <section className="auth-card auth-card--oauth-username">
      <span className="section-kicker">{dictionary.auth.newPlayer}</span>
      <h1>{dictionary.auth.chooseUsernameTitle}</h1>
      <p>{dictionary.auth.chooseUsernameDescription}</p>

      <form className="auth-form" onSubmit={submit}>
        <label>
          <span>{dictionary.auth.username}</span>
          <span className="input-wrap">
            <UserRound size={18} />
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

        <details className="auth-strength">
          <summary>{dictionary.auth.startingStrength}</summary>
          <div className="auth-strength-content">
            <p>{dictionary.auth.startingStrengthHint}</p>
            <label>
              <span className="sr-only">{dictionary.auth.startingStrength}</span>
              <span className="input-wrap">
                <Gauge size={18} />
                <select
                  aria-label={dictionary.auth.startingStrength}
                  onChange={(event) => setStartingStrength(event.target.value as StartingStrengthEstimate)}
                  value={startingStrength}
                >
                  <option value="unspecified">{dictionary.auth.strengthUnspecified}</option>
                  <option value="new">{dictionary.auth.strengthNew}</option>
                  <option value="beginner">{dictionary.auth.strengthBeginner}</option>
                  <option value="intermediate">{dictionary.auth.strengthIntermediate}</option>
                  <option value="experienced">{dictionary.auth.strengthExperienced}</option>
                  <option value="known">{dictionary.auth.strengthKnown}</option>
                </select>
              </span>
            </label>
            {startingStrength === "known" ? (
              <label>
                <span>{dictionary.auth.knownRank}</span>
                <select
                  aria-label={dictionary.auth.knownRank}
                  onChange={(event) => setKnownRank(event.target.value)}
                  value={knownRank}
                >
                  {KNOWN_RANK_OPTIONS.map((rank) => <option key={rank} value={rank}>{rank}</option>)}
                </select>
              </label>
            ) : null}
          </div>
        </details>

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
    </section>
  );
}
