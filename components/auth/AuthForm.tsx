"use client";

import { Gauge, KeyRound, LoaderCircle, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useId, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { affectedAuthFields, type AuthField } from "@/lib/auth/errorFields";
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
  mode: "login" | "register";
  reauthenticate?: boolean;
  returnTo?: string | null;
};

export function AuthForm({ mode, reauthenticate = false, returnTo = null }: AuthFormProps) {
  const { user, refresh } = useAuth();
  const { dictionary, href } = useI18n();
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
  return (
    <section className="auth-card">
      <span className="section-kicker">{registering ? dictionary.auth.newPlayer : dictionary.auth.welcomeBack}</span>
      <h1>{registering ? dictionary.auth.createTitle : dictionary.auth.loginTitle}</h1>
      <p>
        {registering
          ? dictionary.auth.createDescription
          : dictionary.auth.loginDescription}
      </p>

      <form className="auth-form" onSubmit={submit}>
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
          <fieldset className="auth-strength">
            <legend>{dictionary.auth.startingStrength}</legend>
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
          </fieldset>
        ) : null}

        {error ? <p className="form-error" id={errorId} role="alert">{error.message}</p> : null}
        <button className="button button--primary button--lg auth-submit" disabled={busy} type="submit">
          {busy ? <LoaderCircle className="spin" size={19} /> : null}
          {busy
            ? registering ? dictionary.auth.creating : dictionary.auth.loggingIn
            : registering ? dictionary.auth.createAccount : dictionary.auth.login}
        </button>
      </form>

      <p className="auth-switch">
        {registering ? dictionary.auth.haveAccount : dictionary.auth.newToGoStone}{" "}
        <Link href={href(registering ? "/login" : "/register")}>
          {registering ? dictionary.auth.login : dictionary.auth.createAccount}
        </Link>
      </p>
    </section>
  );
}
