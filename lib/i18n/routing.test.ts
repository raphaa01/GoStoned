import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as setLocale } from "@/app/api/locale/route";
import { createRateLimitKey, RATE_LIMIT_POLICIES } from "@/lib/auth/rateLimit";
import { de } from "./catalogs/de";
import { en } from "./catalogs/en";
import { isLocale, preferredLocale } from "./config";
import { localizedApiError } from "./dictionary";
import { localizedRulesSummary } from "./gameTerms";
import { pageMetadata, rootMetadata } from "./metadata";
import { localizedNotFoundResponse } from "./notFoundResponse";
import {
  buildLocaleSwitchHref,
  isRouteActive,
  isSafeInternalPath,
  localizeHref,
  localizePathname,
  stripLocalePrefix,
} from "./routing";

test("recognizes only supported locale values", () => {
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("de"), true);
  assert.equal(isLocale("fr"), false);
  assert.equal(isLocale("../de"), false);
});

test("uses Accept-Language quality values only as an initial locale hint", () => {
  assert.equal(preferredLocale("de-DE,de;q=0.9,en;q=0.8"), "de");
  assert.equal(preferredLocale("de;q=0.5,en;q=0.9"), "en");
  assert.equal(preferredLocale("fr;q=1,de;q=0"), "en");
  assert.equal(preferredLocale("de;q=broken,en;q=0.7"), "en");
  assert.equal(preferredLocale(null), "en");
});

test("adds and removes only the exact German route prefix", () => {
  assert.equal(stripLocalePrefix("/de"), "/");
  assert.equal(stripLocalePrefix("/de/play"), "/play");
  assert.equal(stripLocalePrefix("/debug"), "/debug");
  assert.equal(stripLocalePrefix("/deevil"), "/deevil");
  assert.equal(localizePathname("/", "de"), "/de");
  assert.equal(localizePathname("/play", "de"), "/de/play");
  assert.equal(localizePathname("/de/game/abc", "en"), "/game/abc");
  assert.equal(localizePathname("/api/health", "de"), "/api/health");
});

test("preserves repeated query parameters and fragments across locale switches", () => {
  assert.equal(
    buildLocaleSwitchHref(
      "/play",
      "?size=19&tag=a&tag=b",
      "#matching",
      "de",
    ),
    "/de/play?size=19&tag=a&tag=b#matching",
  );
  assert.equal(
    buildLocaleSwitchHref(
      "/de/play",
      "size=19&tag=a&tag=b",
      "matching",
      "en",
    ),
    "/play?size=19&tag=a&tag=b#matching",
  );
  assert.equal(localizeHref("/play?size=19#queue", "de"), "/de/play?size=19#queue");
  assert.equal(localizeHref("/learn?topic=ko#glossary", "de"), "/de/learn?topic=ko#glossary");
  assert.equal(localizeHref("/de/review#questions", "en"), "/review#questions");
});

test("rejects scheme-relative, encoded scheme-relative, and backslash paths", () => {
  for (const unsafe of ["//evil.example", "/%2F%2Fevil.example", "/\\evil.example"]) {
    assert.equal(isSafeInternalPath(unsafe), false, unsafe);
    assert.throws(() => localizePathname(unsafe, "de"), /same-origin/);
  }
  assert.equal(localizeHref("https://example.com/play", "de"), "https://example.com/play");
  assert.equal(localizeHref("mailto:hello@example.com", "de"), "mailto:hello@example.com");
});

test("active navigation compares exact route segment boundaries", () => {
  assert.equal(isRouteActive("/de/play", "/play"), true);
  assert.equal(isRouteActive("/play/quick", "/play"), true);
  assert.equal(isRouteActive("/player", "/play"), false);
});

test("English and German catalogues retain the same key shape", () => {
  function keys(value: unknown, prefix = ""): string[] {
    if (!value || typeof value !== "object") return [prefix];
    return Object.entries(value)
      .flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key))
      .sort();
  }
  assert.deepEqual(keys(de), keys(en));
});

test("English and German distinguish rated account games and disclose leaderboard eligibility", () => {
  assert.match(en.game.ratedResultSaved, /rating changes/);
  assert.match(en.game.unratedResultSaved, /did not affect ratings/);
  assert.match(de.game.ratedResultSaved, /Wertungsänderungen/);
  assert.match(de.game.unratedResultSaved, /Wertungen nicht verändert/);
  assert.equal(en.profile.rated, "Rated");
  assert.equal(en.profile.unrated, "Unrated");
  assert.equal(de.profile.rated, "Gewertet");
  assert.equal(de.profile.unrated, "Ungewertet");
  assert.match(en.leaderboard.description, /fully backed/);
  assert.match(en.leaderboard.description, /other registered accounts/);
  assert.match(de.leaderboard.description, /vollständig/);
  assert.match(de.leaderboard.description, /andere registrierte Konten/);
  assert.match(en.leaderboard.ratingMethod, /start at 1200/);
  assert.match(en.leaderboard.ratingMethod, /16 points/);
  assert.match(en.leaderboard.ratingMethod, /100-point floor/);
  assert.match(de.leaderboard.ratingMethod, /bei 1200/);
  assert.match(de.leaderboard.ratingMethod, /16 Punkte/);
  assert.match(de.leaderboard.ratingMethod, /Untergrenze liegt bei 100/);
  assert.match(en.auth.usernameHint, /visible to other players and on leaderboards/);
  assert.match(de.auth.usernameHint, /für andere Spieler und in Ranglisten sichtbar/);
  assert.match(en.apiErrors.invalid_stats_request, /exactly one/);
  assert.match(de.apiErrors.invalid_stats_request, /genau eine/);
});

test("API error codes resolve through the active catalogue without exposing unknown server copy", () => {
  assert.equal(
    localizedApiError(de, { code: "not_your_turn" }, "fallback"),
    "Du bist nicht am Zug.",
  );
  assert.equal(localizedApiError(en, { code: "unknown_code" }, "Safe fallback"), "Safe fallback");
});

test("localized root and page metadata include stable social images", () => {
  for (const [locale, expectedPath] of [["en", "/og/en"], ["de", "/og/de"]] as const) {
    for (const metadata of [
      rootMetadata(locale),
      pageMetadata(locale, "play", "/play"),
      pageMetadata(locale, "learn", "/learn"),
      pageMetadata(locale, "review", "/review"),
    ]) {
      const openGraph = metadata.openGraph as { images?: Array<{ url?: string }> } | undefined;
      const twitter = metadata.twitter as { images?: string[] } | undefined;
      assert.match(openGraph?.images?.[0]?.url ?? "", new RegExp(`${expectedPath}$`));
      assert.match(twitter?.images?.[0] ?? "", new RegExp(`${expectedPath}$`));
    }
  }
});

test("rules summaries use persisted game parameters and localized labels", () => {
  const parameters = {
    ruleset: "chinese",
    rulesProfile: "chinese-2002-gostone-v1",
    scoringMethod: "area",
    komi: 7.5,
    handicap: 2,
  } as const;
  assert.equal(
    localizedRulesSummary(parameters, en),
    "Chinese 2002 · GoStone v1 · area · 7.5 komi · Handicap 2",
  );
  assert.equal(
    localizedRulesSummary(parameters, de),
    "Chinesisch 2002 · GoStone v1 · Fläche · 7.5 Komi · Vorgabe 2",
  );
});

test("locale preference endpoint rejects tampering and sets an isolated hardened cookie", async () => {
  globalThis.goStoneEphemeralRateLimits = new Map();
  const rejected = await setLocale(new NextRequest("https://gostone.test/api/locale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale: "//evil.example" }),
  }));
  assert.equal(rejected.status, 400);
  assert.equal(rejected.headers.get("set-cookie"), null);

  const accepted = await setLocale(new NextRequest("https://gostone.test/api/locale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale: "de" }),
  }));
  assert.equal(accepted.status, 200);
  const cookie = accepted.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^gostone_locale=de;/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=31536000/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=lax/i);
  assert.doesNotMatch(cookie, /gostoned_session|gostone_guest_session/);
});

test("locale preference endpoint rejects cross-site, non-JSON, and malformed requests", async () => {
  globalThis.goStoneEphemeralRateLimits = new Map();
  const crossSite = await setLocale(new NextRequest("https://gostone.test/api/locale", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Origin: "https://evil.example",
      "Sec-Fetch-Site": "cross-site",
    },
    body: JSON.stringify({ locale: "de" }),
  }));
  assert.equal(crossSite.status, 403);
  assert.equal(crossSite.headers.get("set-cookie"), null);

  const wrongOrigin = await setLocale(new NextRequest("https://gostone.test/api/locale", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://evil.example",
    },
    body: JSON.stringify({ locale: "de" }),
  }));
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.headers.get("set-cookie"), null);

  const malformed = await setLocale(new NextRequest("https://gostone.test/api/locale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "null",
  }));
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get("set-cookie"), null);
});

test("locale preference endpoint rejects excess input without mutating an existing preference", async () => {
  globalThis.goStoneEphemeralRateLimits = new Map();
  for (const [url, body] of [
    ["https://gostone.test/api/locale", JSON.stringify({ locale: "en", padding: "x" })],
    ["https://gostone.test/api/locale", JSON.stringify({
      locale: "en",
      padding: "x".repeat(1_024),
    })],
    ["https://gostone.test/api/locale?cache-bust=1", JSON.stringify({ locale: "en" })],
  ] as const) {
    const response = await setLocale(new NextRequest(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "gostone_locale=de",
        "x-real-ip": "203.0.113.210",
      },
      body,
    }));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await response.json()).code, "invalid_locale");
  }
});

test("locale preference rate denial happens before a stalled body is read", async () => {
  const policy = RATE_LIMIT_POLICIES.localePreference;
  const address = "203.0.113.211";
  const key = createRateLimitKey(policy.scope, "ip", address);
  globalThis.goStoneEphemeralRateLimits = new Map([[key, {
    attempts: policy.limit,
    windowStartedAt: Date.now(),
    blockedUntil: null,
  }]]);
  const stalled = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => undefined);
    },
  });
  const request = new NextRequest("https://gostone.test/api/locale", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-real-ip": address,
    },
    body: stalled,
    duplex: "half",
  });
  assert.equal(request.bodyUsed, false);
  const response = await setLocale(request);
  assert.equal(response.status, 429);
  assert.equal(request.bodyUsed, false);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.ok(Number(response.headers.get("retry-after")) > 0);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await response.json()).code, "rate_limited");
});

test("localized catch-all responses are real, pre-hydration-safe 404 documents", async () => {
  for (const [locale, title] of [
    ["en", "This page is not on the board."],
    ["de", "Diese Seite liegt nicht auf dem Brett."],
  ] as const) {
    const response = localizedNotFoundResponse(locale);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("content-language"), locale);
    assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
    const html = await response.text();
    assert.match(html, new RegExp(`<html lang="${locale}">`));
    assert.match(html, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, /name="robots" content="noindex, nofollow"/);
  }
});
