import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { safeAuthReturnPath } from "@/lib/auth/returnPath";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/config";
import { localizeHref } from "@/lib/i18n/routing";
import { mobileApiOrigin } from "./runtime";

const STORAGE_KEY = "gostone-mobile-oauth-v1";
const NATIVE_CALLBACK = "com.gostone.app://oauth";
let handledCallbackUrl: string | null = null;

type PendingOAuth = Readonly<{
  verifier: string;
  mode: "login" | "register";
  locale: Locale;
  returnTo: string | null;
  expiresAt: number;
}>;

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function navigate(href: string): void {
  window.history.replaceState({}, "", href);
  window.dispatchEvent(new Event("gostone:navigation"));
}

function readPending(): PendingOAuth | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingOAuth>;
    if (typeof value.verifier !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.verifier)
      || (value.mode !== "login" && value.mode !== "register")
      || !isLocale(value.locale)
      || typeof value.expiresAt !== "number" || value.expiresAt <= Date.now()) return null;
    return {
      verifier: value.verifier,
      mode: value.mode,
      locale: value.locale,
      returnTo: safeAuthReturnPath(value.returnTo ?? undefined),
      expiresAt: value.expiresAt,
    };
  } catch {
    return null;
  }
}

function authError(pending: PendingOAuth | null, code = "oauth_failed"): void {
  const mode = pending?.mode ?? "login";
  const locale = pending?.locale ?? DEFAULT_LOCALE;
  const parameters = new URLSearchParams({ oauthError: code });
  if (pending?.returnTo) parameters.set("returnTo", pending.returnTo);
  navigate(`${localizeHref(`/${mode}`, locale)}?${parameters}`);
}

export async function startNativeOAuth(href: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    window.location.assign(href);
    return;
  }
  const requested = new URL(href, mobileApiOrigin());
  if (requested.origin !== "https://gostone.app"
    || !/^\/api\/auth\/oauth\/(google|apple)$/.test(requested.pathname)) {
    throw new Error("Invalid OAuth destination.");
  }
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  requested.searchParams.set("mobileChallenge", base64url(new Uint8Array(digest)));
  const localeValue = requested.searchParams.get("locale");
  const pending: PendingOAuth = {
    verifier,
    mode: requested.searchParams.get("mode") === "register" ? "register" : "login",
    locale: localeValue && isLocale(localeValue) ? localeValue : DEFAULT_LOCALE,
    returnTo: safeAuthReturnPath(requested.searchParams.get("returnTo") ?? undefined),
    expiresAt: Date.now() + 10 * 60_000,
  };
  handledCallbackUrl = null;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  try {
    await Browser.open({ url: requested.href });
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    authError(pending);
  }
}

async function finishNativeOAuth(url: URL): Promise<void> {
  const pending = readPending();
  sessionStorage.removeItem(STORAGE_KEY);
  try { await Browser.close(); } catch { /* Android closes its Custom Tab on return. */ }
  if (!pending) {
    authError(null);
    return;
  }
  if (url.searchParams.has("error")) {
    const code = url.searchParams.get("error");
    authError(pending, code === "access_denied" || code === "provider_unavailable" ? code : "oauth_failed");
    return;
  }
  const code = url.searchParams.get("code");
  if (!code || !/^[A-Za-z0-9_-]{43}$/.test(code)) {
    authError(pending);
    return;
  }
  try {
    const response = await fetch("/api/auth/oauth/mobile/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code, verifier: pending.verifier }),
    });
    const body = await response.json() as { ok?: boolean; kind?: string };
    if (!response.ok || !body.ok) throw new Error("OAuth handoff failed.");
    if (body.kind === "registration_required") {
      const parameters = new URLSearchParams();
      if (pending.returnTo) parameters.set("returnTo", pending.returnTo);
      const base = localizeHref("/register/username", pending.locale);
      navigate(parameters.size ? `${base}?${parameters}` : base);
      return;
    }
    if (body.kind !== "authenticated") throw new Error("Invalid OAuth result.");
    window.dispatchEvent(new Event("gostone:auth-change"));
    navigate(localizeHref(pending.returnTo ?? (pending.mode === "register" ? "/profile" : "/play"), pending.locale));
  } catch {
    authError(pending);
  }
}

export function handleNativeOAuthUrl(rawUrl: string): boolean {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return false; }
  if (url.protocol !== new URL(NATIVE_CALLBACK).protocol || url.hostname !== "oauth") return false;
  // A cold launch may deliver the same link through both getLaunchUrl and
  // appUrlOpen. Consume its one-use code only once.
  if (handledCallbackUrl === url.href) return true;
  handledCallbackUrl = url.href;
  void finishNativeOAuth(url);
  return true;
}
