const PRODUCTION_API_ORIGIN = "https://gostone.app";

export function normalizeMobileApiOrigin(
  configured: string | undefined,
  nativePlatform: boolean,
): string {
  const value = configured?.trim() || PRODUCTION_API_ORIGIN;
  const parsed = new URL(value);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error("VITE_GOSTONE_API_URL must contain only the GoStone origin.");
  }
  if (nativePlatform && parsed.protocol !== "https:") {
    throw new Error("Native GoStone builds require an HTTPS API origin.");
  }
  return parsed.origin;
}

export function resolveMobileRequestUrl(original: string, apiOrigin: string, appUrl?: string): string {
  if (original.startsWith("/api/")) return `${apiOrigin}${original}`;
  if (appUrl) {
    try {
      const target = new URL(original);
      const app = new URL(appUrl);
      if (target.protocol === app.protocol && target.host === app.host && target.pathname.startsWith("/api/")) {
        return `${apiOrigin}${target.pathname}${target.search}${target.hash}`;
      }
    } catch { /* Leave unrelated and relative asset URLs to the platform fetch. */ }
  }
  return original;
}
