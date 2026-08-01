"use client";

import { Gauge, KeyRound, LoaderCircle, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useId, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { affectedAuthFields, type AuthField } from "@/lib/auth/errorFields";
import type { OAuthProvider } from "@/lib/auth/oauthAccountService";
import { localizedAuthError } from "@/lib/i18n/dictionary";
import { useAuth } from "./AuthProvider";
import {
  KNOWN_RANK_OPTIONS,
  type StartingStrengthEstimate,
} from "@/lib/rating/preferences";

type FormError = {
  message: string;
  fields: AuthField[];
};

type AuthFormProps = {
  configuredOAuthProviders?: readonly OAuthProvider[];
  mode: "login" | "register";
  oauthError?: string | null;
  reauthenticate?: boolean;
  returnTo?: string | null;
};

export function AuthForm({
  configuredOAuthProviders = [],
  mode,
  oauthError = null,
  reauthenticate = false,
  returnTo = null,
}: AuthFormProps) {
  const { user, refresh } = useAuth();
  const { dictionary, href, locale } = useI18n();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [startingStrength, setStartingStrength] = useState<StartingStrengthEstimate>("unspecified");
  const [knownRank, setKnownRank] = useState("12k");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const usernameHintId = useId();
  const errorId = useId();
  const usernameInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  function socialHref(provider: "google" | "apple") {
    const parameters = new URLSearchParams({ mode, locale });
    if (returnTo) parameters.set("returnTo", returnTo);
    return `/api/auth/oauth/${provider}?${parameters.toString()}`;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "register"
          ? {
              username,
              password,
              startingStrength,
              knownRank: startingStrength === "known" ? knownRank : null,
            }
          : { username, password }),
      });
      const body = (await response.json()) as { ok: boolean; code?: string };
      if (!response.ok || !body.ok) {
        const fields = affectedAuthFields(body.code);
        setError({
          message: localizedAuthError(dictionary, body.code, "request_failed"),
          fields,
        });
        window.requestAnimationFrame(() => {
          if (fields[0] === "username") usernameInput.current?.focus();
          else if (fields[0] === "password") passwordInput.current?.focus();
        });
        return;
      }
      await refresh();
      router.push(href(returnTo ?? (mode === "register" ? "/profile" : "/play")));
      router.refresh();
    } catch (requestError) {
      setError({
        message: requestError instanceof Error
          ? requestError.message
          : dictionary.auth.errors.request_failed,
        fields: [],
      });
    } finally {
      setBusy(false);
    }
  }

  if (user && !reauthenticate) {
    return (
      <section className="auth-card auth-card--signed-in">
        <span className="auth-icon"><UserRound size={24} /></span>
        <h1>{dictionary.auth.alreadyLoggedIn}</h1>
        <p>{dictionary.auth.continueAs} <strong>{user.displayName}</strong>.</p>
        <Link className="button button--primary button--lg" href={href("/play")}>{dictionary.auth.findGame}</Link>
      </section>
    );
  }

  const registering = mode === "register";
  const oauthErrorMessage = oauthError === "access_denied"
    ? dictionary.auth.socialCancelled
    : oauthError === "provider_unavailable"
      ? dictionary.auth.socialUnavailable
      : oauthError
        ? dictionary.auth.socialFailed
        : null;
  const socialOptions = configuredOAuthProviders.length ? (
    <div className={`auth-social${registering ? " auth-social--register" : ""}`} aria-label={dictionary.auth.socialOptions}>
      {configuredOAuthProviders.includes("google") ? (
        <a className="auth-social-button" href={socialHref("google")}>
          <GoogleIcon />
          <span>{dictionary.auth.continueWithGoogle}</span>
        </a>
      ) : null}
      {configuredOAuthProviders.includes("apple") ? (
        <a className="auth-social-button" href={socialHref("apple")}>
          <AppleIcon />
          <span>{dictionary.auth.continueWithApple}</span>
        </a>
      ) : null}
    </div>
  ) : null;
  return (
    <section className="auth-card">
      <span className="section-kicker">{registering ? dictionary.auth.newPlayer : dictionary.auth.welcomeBack}</span>
      <h1>{registering ? dictionary.auth.createTitle : dictionary.auth.loginTitle}</h1>
      <p>
        {registering
          ? dictionary.auth.createDescription
          : dictionary.auth.loginDescription}
      </p>

      {registering && socialOptions ? (
        <>
          {socialOptions}
          {oauthErrorMessage ? <p className="form-error auth-social-error" role="alert">{oauthErrorMessage}</p> : null}
          <div className="auth-divider"><span>{dictionary.auth.orContinueWithUsername}</span></div>
        </>
      ) : null}

      <form className={`auth-form${registering && socialOptions ? " auth-form--social-first" : ""}`} onSubmit={submit}>
        <label>
          <span>{dictionary.auth.username}</span>
          <span className="input-wrap">
            <UserRound size={18} />
            <input
              aria-describedby={registering
                ? `${usernameHintId}${error?.fields.includes("username") ? ` ${errorId}` : ""}`
                : error?.fields.includes("username") ? errorId : undefined}
              aria-invalid={error?.fields.includes("username") || undefined}
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
          {registering ? <small id={usernameHintId}>{dictionary.auth.usernameHint}</small> : null}
        </label>
        <label>
          <span>{dictionary.auth.password}</span>
          <span className="input-wrap">
            <KeyRound size={18} />
            <input
              aria-describedby={error?.fields.includes("password") ? errorId : undefined}
              aria-invalid={error?.fields.includes("password") || undefined}
              aria-label={dictionary.auth.password}
              autoComplete={registering ? "new-password" : "current-password"}
              maxLength={128}
              minLength={8}
              onChange={(event) => {
                setPassword(event.target.value);
                if (error) setError(null);
              }}
              placeholder={dictionary.auth.passwordPlaceholder}
              required
              ref={passwordInput}
              type="password"
              value={password}
            />
          </span>
        </label>

        {registering ? (
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
        ) : null}

        {error ? <p className="form-error" id={errorId} role="alert">{error.message}</p> : null}
        <button className="button button--primary button--lg auth-submit" disabled={busy} type="submit">
          {busy ? <LoaderCircle className="spin" size={19} /> : null}
          {busy
            ? registering ? dictionary.auth.creating : dictionary.auth.loggingIn
            : registering ? dictionary.auth.createAccount : dictionary.auth.login}
        </button>
      </form>

      {!registering && socialOptions ? (
        <>
          <div className="auth-divider"><span>{dictionary.auth.orContinueWithSocial}</span></div>
          {socialOptions}
        </>
      ) : null}

      {oauthErrorMessage && (!registering || !socialOptions)
        ? <p className="form-error auth-social-error" role="alert">{oauthErrorMessage}</p>
        : null}

      <p className="auth-switch">
        {registering ? dictionary.auth.haveAccount : dictionary.auth.newToGoStone}{" "}
        <Link href={href(registering ? "/login" : "/register")}>
          {registering ? dictionary.auth.login : dictionary.auth.createAccount}
        </Link>
      </p>
    </section>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="auth-provider-icon" viewBox="0 0 24 24">
      <path d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.53h3.25c1.9-1.75 2.97-4.33 2.97-7.39Z" fill="#4285F4" />
      <path d="M12 22c2.7 0 4.98-.9 6.63-2.38l-3.25-2.53c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.77-5.61-4.14H3.03v2.61A10 10 0 0 0 12 22Z" fill="#34A853" />
      <path d="M6.39 13.91A6.02 6.02 0 0 1 6.07 12c0-.66.11-1.31.32-1.91V7.48H3.03A10 10 0 0 0 2 12c0 1.61.39 3.14 1.03 4.52l3.36-2.61Z" fill="#FBBC05" />
      <path d="M12 5.95c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.97 5.48l3.36 2.61C7.18 7.72 9.39 5.95 12 5.95Z" fill="#EA4335" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg aria-hidden="true" className="auth-provider-icon" viewBox="0 0 24 24">
      <path d="M17.05 12.54c-.02-2.22 1.81-3.3 1.89-3.35a4.06 4.06 0 0 0-3.2-1.73c-1.35-.14-2.66.81-3.35.81-.7 0-1.76-.8-2.91-.77a4.24 4.24 0 0 0-3.57 2.18c-1.55 2.68-.4 6.62 1.09 8.79.74 1.06 1.6 2.25 2.74 2.21 1.11-.05 1.53-.71 2.87-.71 1.33 0 1.72.71 2.88.68 1.2-.02 1.95-1.06 2.66-2.13a8.76 8.76 0 0 0 1.22-2.48 3.84 3.84 0 0 1-2.32-3.5ZM14.86 6.03a3.89 3.89 0 0 0 .89-2.81 3.95 3.95 0 0 0-2.56 1.34 3.7 3.7 0 0 0-.91 2.71 3.26 3.26 0 0 0 2.58-1.24Z" fill="currentColor" />
    </svg>
  );
}
