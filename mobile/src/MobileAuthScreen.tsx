import { useEffect, useState } from "react";
import { AuthForm } from "@/components/auth/AuthForm";
import type { OAuthProvider } from "@/lib/auth/oauthAccountService";
import { readApi } from "@/lib/client/api";
import { startNativeOAuth } from "./nativeOAuth";

export function MobileAuthScreen({ mode, returnTo, oauthError }: {
  mode: "login" | "register";
  returnTo: string | null;
  oauthError?: string | null;
}) {
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  const destination = returnTo ?? "/";

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/providers", { cache: "no-store", signal: controller.signal })
      .then((response) => readApi<{ providers: OAuthProvider[] }>(response))
      .then((body) => setProviders(body.providers))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <main className="mobile-auth-screen" id="main-content">
      <div aria-hidden="true" className="mobile-auth-mark"><i /><i /><span /></div>
      <AuthForm configuredOAuthProviders={providers} mode={mode} returnTo={destination} oauthError={oauthError}
        onOAuthStart={(_provider, href) => {
          void startNativeOAuth(href).catch(() => {
            const location = new URL(window.location.href);
            location.searchParams.set("oauthError", "oauth_failed");
            window.history.replaceState({}, "", location.href);
            window.dispatchEvent(new Event("gostone:navigation"));
          });
        }} />
    </main>
  );
}
