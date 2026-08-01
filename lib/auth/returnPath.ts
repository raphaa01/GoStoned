import { isSafeInternalPath, stripLocalePrefix } from "@/lib/i18n/routing";

const GAME_PATH = /^\/game\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVIEW_GAME_PATH = /^\/review\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERSONAL_PUZZLES_PATH = "/puzzles?mode=practice";

function safeLogicalPath(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || !isSafeInternalPath(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value, "https://gostone.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "https://gostone.invalid" || parsed.search || parsed.hash) return null;
  return stripLocalePrefix(parsed.pathname);
}

export function safeGameReturnPath(value: string | string[] | undefined): string | null {
  const logicalPath = safeLogicalPath(value);
  if (!logicalPath) return null;
  return GAME_PATH.test(logicalPath) ? logicalPath : null;
}

export function safeAccountReturnPath(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string" && isSafeInternalPath(value)) {
    try {
      const parsed = new URL(value, "https://gostone.invalid");
      if (
        parsed.origin === "https://gostone.invalid"
        && !parsed.hash
        && stripLocalePrefix(parsed.pathname) === "/puzzles"
        && parsed.search === "?mode=practice"
      ) return PERSONAL_PUZZLES_PATH;
    } catch {
      return null;
    }
  }
  const logicalPath = safeLogicalPath(value);
  if (!logicalPath) return null;
  return logicalPath === "/learn"
    || logicalPath === "/profile"
    || logicalPath === "/review"
    || REVIEW_GAME_PATH.test(logicalPath)
    ? logicalPath
    : null;
}

export function safeReauthenticationReturnPath(
  value: string | string[] | undefined,
): string | null {
  const gamePath = safeGameReturnPath(value);
  if (gamePath) return gamePath;
  return safeLogicalPath(value) === "/play" ? "/play" : null;
}

export function safeAuthReturnPath(
  value: string | string[] | undefined,
): string | null {
  return safeAccountReturnPath(value) ?? safeReauthenticationReturnPath(value);
}

export function accountRegistrationPath(returnTo: string): string {
  const safeReturnTo = safeAccountReturnPath(returnTo);
  if (!safeReturnTo) return "/register";
  return `/register?returnTo=${encodeURIComponent(safeReturnTo)}`;
}
