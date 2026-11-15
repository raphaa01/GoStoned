import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { normalizeMobileApiOrigin, resolveMobileRequestUrl } from "@/lib/mobile/apiOrigin";
import { ACCOUNT_SECURITY_HEADER, ACCOUNT_SECURITY_VERSION } from "@/lib/auth/clientContract";
import { withDeadline } from "@/lib/mobile/withDeadline";

const NATIVE_REQUEST_TIMEOUT_MS = 20_000;

async function fetchNativeApi(request: Request): Promise<Response> {
  const { signal, method, url } = request;
  signal.throwIfAborted();
  const data = request.body ? await request.text() : undefined;
  signal.throwIfAborted();
  const headers = Object.fromEntries(request.headers);
  const response = await withDeadline(CapacitorHttp.request({
    url,
    method,
    data,
    headers,
    disableRedirects: true,
    connectTimeout: NATIVE_REQUEST_TIMEOUT_MS,
    readTimeout: NATIVE_REQUEST_TIMEOUT_MS,
    responseType: "text",
  }), NATIVE_REQUEST_TIMEOUT_MS, "GoStone API request timed out.", signal);
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("set-cookie");
  responseHeaders.delete("set-cookie2");
  const noBody = method === "HEAD" || [204, 205, 304].includes(response.status);
  const payload = responseHeaders.get("content-type")?.toLowerCase().includes("application/json")
    ? JSON.stringify(response.data)
    : response.data;
  return new Response(noBody ? null : payload, { status: response.status, headers: responseHeaders });
}

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
      if (options.credentials !== "omit" && Capacitor.isPluginAvailable("CapacitorHttp") && Capacitor.isNativePlatform()) {
        // The patched fetch uses a WebView scheme proxy for GET and a native
        // HTTP request for mutations. Use one path for both, including cookies.
        const request = input instanceof Request
          ? new Request(resolved, input)
          : resolved;
        return fetchNativeApi(new Request(request, options));
      }
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
