"use client";

import { KeyRound, LoaderCircle, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { localizedAuthError } from "@/lib/i18n/dictionary";
import { useAuth } from "./AuthProvider";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { user, refresh } = useAuth();
  const { dictionary, href } = useI18n();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = (await response.json()) as { ok: boolean; code?: string };
      if (!response.ok || !body.ok) {
        throw new Error(localizedAuthError(dictionary, body.code, "request_failed"));
      }
      await refresh();
      router.push(href(mode === "register" ? "/profile" : "/play"));
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : dictionary.auth.errors.request_failed,
      );
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
              autoComplete="username"
              autoFocus
              maxLength={20}
              minLength={3}
              onChange={(event) => setUsername(event.target.value)}
              pattern="[A-Za-z0-9_]+"
              placeholder={dictionary.auth.usernamePlaceholder}
              required
              value={username}
            />
          </span>
          {registering ? <small>{dictionary.auth.usernameHint}</small> : null}
        </label>
        <label>
          <span>{dictionary.auth.password}</span>
          <span className="input-wrap">
            <KeyRound size={18} />
            <input
              autoComplete={registering ? "new-password" : "current-password"}
              maxLength={128}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={dictionary.auth.passwordPlaceholder}
              required
              type="password"
              value={password}
            />
          </span>
        </label>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
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
