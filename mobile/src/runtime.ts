import { Capacitor } from "@capacitor/core";
import { normalizeMobileApiOrigin, resolveMobileRequestUrl } from "@/lib/mobile/apiOrigin";
import { ACCOUNT_SECURITY_HEADER, ACCOUNT_SECURITY_VERSION } from "@/lib/auth/clientContract";

export function mobileApiOrigin(): string {
  if (!Capacitor.isNativePlatform() && import.meta.env.DEV && !import.meta.env.VITE_GOSTONE_API_URL) {
    return window.location.origin;
  }
  return normalizeMobileApiOrigin(
    import.meta.env.VITE_GOSTONE_API_URL,
    Capacitor.isNativePlatform(),
  );
}

export function installMobileFetchBridge(): void {
  const apiOrigin = mobileApiOrigin();
  const platformFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const original = input instanceof Request ? input.url : String(input);
    const resolved = resolveMobileRequestUrl(original, apiOrigin, window.location.href);
    const options: RequestInit = { ...init };
    const target = new URL(resolved, window.location.href);
    if (target.origin === apiOrigin && target.pathname.startsWith("/api/")) {
      options.credentials = init?.credentials ?? (input instanceof Request && input.credentials === "omit" ? "omit" : "include");
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set(ACCOUNT_SECURITY_HEADER, ACCOUNT_SECURITY_VERSION);
      options.headers = headers;
    }
    if (input instanceof Request) return platformFetch(new Request(resolved, input), options);
    return platformFetch(resolved, options);
  };
}

export function isNativeMobileApp(): boolean {
  return Capacitor.isNativePlatform();
}
