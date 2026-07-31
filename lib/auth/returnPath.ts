import { isSafeInternalPath, stripLocalePrefix } from "@/lib/i18n/routing";

const GAME_PATH = /^\/game\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function safeGameReturnPath(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || !isSafeInternalPath(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value, "https://gostone.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "https://gostone.invalid" || parsed.search || parsed.hash) return null;
  const logicalPath = stripLocalePrefix(parsed.pathname);
  return GAME_PATH.test(logicalPath) ? logicalPath : null;
}

export function safeReauthenticationReturnPath(
  value: string | string[] | undefined,
): string | null {
  const gamePath = safeGameReturnPath(value);
  if (gamePath) return gamePath;
  if (typeof value !== "string" || !isSafeInternalPath(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value, "https://gostone.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "https://gostone.invalid" || parsed.search || parsed.hash) return null;
  return stripLocalePrefix(parsed.pathname) === "/play" ? "/play" : null;
}
