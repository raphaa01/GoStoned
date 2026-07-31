import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";

const NON_LOCALIZED_PREFIXES = ["/api", "/_next"];

function safelyDecoded(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

export function isSafeInternalPath(pathname: string): boolean {
  if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("\\")) {
    return false;
  }
  if (/\p{Cc}/u.test(pathname)) return false;
  const decoded = safelyDecoded(pathname);
  return Boolean(
    decoded
      && decoded.startsWith("/")
      && !decoded.startsWith("//")
      && !decoded.includes("\\")
      && !/\p{Cc}/u.test(decoded),
  );
}

export function stripLocalePrefix(pathname: string): string {
  const [firstSegment = ""] = pathname.slice(1).split("/");
  if (!isLocale(firstSegment)) return pathname;
  const unprefixed = pathname.slice(firstSegment.length + 1);
  return unprefixed === "" || unprefixed === "/" ? "/" : unprefixed;
}

export function localizePathname(pathname: string, locale: Locale): string {
  if (!isSafeInternalPath(pathname)) {
    throw new Error("Only normalized same-origin paths can be localized.");
  }
  if (NON_LOCALIZED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return pathname;
  }
  const unprefixed = stripLocalePrefix(pathname);
  if (locale === DEFAULT_LOCALE) return unprefixed;
  return unprefixed === "/" ? `/${locale}` : `/${locale}${unprefixed}`;
}

export function localizeHref(href: string, locale: Locale): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const hashIndex = href.indexOf("#");
  const queryIndex = href.indexOf("?");
  const pathnameEnd = [hashIndex, queryIndex]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), href.length);
  const pathname = href.slice(0, pathnameEnd) || "/";
  if (!isSafeInternalPath(pathname)) return href;
  return `${localizePathname(pathname, locale)}${href.slice(pathnameEnd)}`;
}

export function buildLocaleSwitchHref(
  pathname: string,
  search: string,
  hash: string,
  locale: Locale,
): string {
  const localized = localizePathname(pathname, locale);
  const normalizedSearch = search ? (search.startsWith("?") ? search : `?${search}`) : "";
  const normalizedHash = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
  return `${localized}${normalizedSearch}${normalizedHash}`;
}

export function isRouteActive(pathname: string, href: string): boolean {
  const route = stripLocalePrefix(pathname);
  return route === href || route.startsWith(`${href}/`);
}
