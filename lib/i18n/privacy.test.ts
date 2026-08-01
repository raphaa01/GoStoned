import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { LOCALES } from "./config";
import { privacyPageMetadata } from "./metadata";
import { getPrivacyCopy } from "./privacy";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("privacy copy is complete for every supported locale", () => {
  for (const { code: locale } of LOCALES) {
    const copy = getPrivacyCopy(locale);
    assert.ok(copy.title.length > 0, locale);
    assert.ok(copy.metadataDescription.length > 0, locale);
    assert.equal(copy.sections.length, 11, locale);
    assert.ok(copy.sections.every((section) => (
      section.title.length > 0
      && section.paragraphs.length + section.items.length > 0
    )), locale);
    assert.equal(copy.cookies.rows.length, 4, locale);
    assert.deepEqual(
      copy.cookies.rows.map(({ name }) => name),
      [
        "gostoned_session",
        "gostone_guest_session",
        "gostone_oauth_google / gostone_oauth_apple",
        "gostone_locale",
      ],
      locale,
    );
    assert.deepEqual(
      copy.processors.entries.map(({ name }) => name),
      ["Vercel Inc.", "Supabase", "Modal Labs, Inc."],
      locale,
    );
    assert.equal(copy.rights.items.length, 8, locale);
  }
});

test("privacy metadata and footer use the localized canonical route", () => {
  for (const { code: locale } of LOCALES) {
    const metadata = privacyPageMetadata(locale);
    assert.equal(metadata.title, getPrivacyCopy(locale).title);
    const canonical = metadata.alternates?.canonical?.toString() ?? "";
    const expectedSuffix = locale === "en" ? "/privacy" : `/${locale}/privacy`;
    assert.match(canonical, new RegExp(`${expectedSuffix}$`));
  }

  const footer = source("components/layout/AppFooter.tsx");
  assert.match(footer, /href\("\/privacy"\)/);
  assert.match(footer, /privacy\.navLabel/);
});

test("privacy policy discloses only the currently implemented storage technologies", () => {
  const english = getPrivacyCopy("en");
  assert.match(english.cookies.closing, /No analytics, advertising, cross-site tracking/);
  assert.match(english.sections.map(({ paragraphs, items }) => (
    [...paragraphs, ...items].join(" ")
  )).join(" "), /Article 22 GDPR/);
  assert.match(english.processors.transfer, /Standard Contractual Clauses/);
  assert.match(
    english.sections.flatMap(({ paragraphs }) => paragraphs).join(" "),
    /do not store provider access or refresh tokens/,
  );
});
