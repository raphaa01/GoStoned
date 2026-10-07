import { isLocale } from "@/lib/i18n/config";

const publicPaths = new Set(["/", "/play", "/learn", "/learn/ai", "/puzzles", "/review", "/friends", "/leaderboard", "/profile", "/profile/settings", "/login", "/register", "/register/username", "/privacy", "/impressum", "/delete-account"]);

// Keep only known routes. Never persist arbitrary paths, tokens, or game IDs.
export function analyticsPath(pathname: string): string | null {
  const segments = pathname.split("/");
  const prefix = isLocale(segments[1]) ? `/${segments[1]}` : "";
  let path = prefix ? pathname.slice(prefix.length) || "/" : pathname;
  path = path.replace(/\/$/, "") || "/";
  if (/^\/(game|review|shared-game)\/[^/]+$/.test(path)) {
    path = path.replace(/\/[^/]+$/, "/[id]");
  } else if (!publicPaths.has(path)) {
    return null;
  }
  return `${prefix}${path === "/" && prefix ? "" : path}`;
}
