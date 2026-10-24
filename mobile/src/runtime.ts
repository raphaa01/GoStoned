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
    if (input instanceof Request) {
      if (resolved === original) return platformFetch(input, options);
      const request = new Request(resolved, input);
      // Passing Request as RequestInit exposes a ReadableStream body. Materialize
      // it for WebView/native HTTP bridges, while preserving explicit init bodies.
      if (input.body && init?.body == null) {
        return input.clone().arrayBuffer().then(body => platformFetch(request, { ...options, body }));
      }
      return platformFetch(request, options);
    }
    return platformFetch(resolved, options);
  };
}

export function isNativeMobileApp(): boolean {
  return Capacitor.isNativePlatform();
}
