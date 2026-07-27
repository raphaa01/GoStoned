"use client";

import { KeyRound, LoaderCircle, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useAuth } from "./AuthProvider";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { user, refresh } = useAuth();
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
      const body = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Request failed.");
      await refresh();
      router.push(mode === "register" ? "/profile" : "/play");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <section className="auth-card auth-card--signed-in">
        <span className="auth-icon"><UserRound size={24} /></span>
        <h1>You are already logged in</h1>
        <p>Continue as <strong>{user.displayName}</strong>.</p>
        <Link className="button button--primary button--lg" href="/play">Find a game</Link>
      </section>
    );
  }

  const registering = mode === "register";
  return (
    <section className="auth-card">
      <span className="section-kicker">{registering ? "New player" : "Welcome back"}</span>
      <h1>{registering ? "Create your account" : "Log in"}</h1>
      <p>
        {registering
          ? "Keep your ratings and play under one username."
          : "Continue with your saved profile and ratings."}
      </p>

      <form className="auth-form" onSubmit={submit}>
        <label>
          <span>Username</span>
          <span className="input-wrap">
            <UserRound size={18} />
            <input
              autoComplete="username"
              autoFocus
              maxLength={20}
              minLength={3}
              onChange={(event) => setUsername(event.target.value)}
              pattern="[A-Za-z0-9_]+"
              placeholder="Your username"
              required
              value={username}
            />
          </span>
          {registering ? <small>3–20 letters, numbers, or underscores.</small> : null}
        </label>
        <label>
          <span>Password</span>
          <span className="input-wrap">
            <KeyRound size={18} />
            <input
              autoComplete={registering ? "new-password" : "current-password"}
              maxLength={128}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
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
            ? registering ? "Creating account…" : "Logging in…"
            : registering ? "Create account" : "Log in"}
        </button>
      </form>

      <p className="auth-switch">
        {registering ? "Already have an account?" : "New to GoStone?"}{" "}
        <Link href={registering ? "/login" : "/register"}>
          {registering ? "Log in" : "Create account"}
        </Link>
      </p>
    </section>
  );
}
