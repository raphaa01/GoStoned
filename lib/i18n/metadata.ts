import type { Metadata } from "next";
import { LOCALES, localeDetails, type Locale } from "./config";
import { getDictionary } from "./dictionary";
import { getPrivacyCopy } from "./privacy";
import { localizePathname } from "./routing";

type MetadataPage = keyof ReturnType<typeof getDictionary>["metadata"];

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function openGraphImage(locale: Locale) {
  const alt = getDictionary(locale).metadata.home.title;
  return {
    url: new URL(`/og/${locale}`, APP_URL).toString(),
    width: 1200,
    height: 630,
    alt,
  };
}

function alternates(pathname: string) {
  const languages = Object.fromEntries(LOCALES.map(({ code }) => [
    code,
    new URL(localizePathname(pathname, code), APP_URL).toString(),
  ]));
  return {
    canonical: new URL(pathname, APP_URL).toString(),
    languages: {
      ...languages,
      "x-default": languages.en,
    },
  };
}

export function rootMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);
  const home = dictionary.metadata.home;
  const pathname = localizePathname("/", locale);
  return {
    metadataBase: new URL(APP_URL),
    title: { default: home.title, template: "%s · GoStone" },
    description: home.description,
    applicationName: "GoStone",
    icons: {
      icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
      shortcut: "/icon.svg",
    },
    alternates: alternates(pathname),
    openGraph: {
      title: home.title,
      description: home.openGraphDescription,
      type: "website",
      url: pathname,
      locale: localeDetails(locale).openGraphLocale,
      alternateLocale: LOCALES
        .filter(({ code }) => code !== locale)
        .map(({ openGraphLocale }) => openGraphLocale),
      images: [openGraphImage(locale)],
    },
    twitter: {
      card: "summary_large_image",
      title: home.title,
      description: home.openGraphDescription,
      images: [openGraphImage(locale).url],
    },
  };
}

export function pageMetadata(
  locale: Locale,
  page: Exclude<MetadataPage, "home">,
  pathname: string,
  options: { noIndex?: boolean } = {},
): Metadata {
  const content = getDictionary(locale).metadata[page];
  const localizedPath = localizePathname(pathname, locale);
  return {
    title: content.title,
    description: content.description,
    alternates: options.noIndex ? undefined : alternates(localizedPath),
    openGraph: options.noIndex ? undefined : {
      title: content.title,
      description: content.description,
      type: "website",
      url: localizedPath,
      locale: localeDetails(locale).openGraphLocale,
      alternateLocale: LOCALES
        .filter(({ code }) => code !== locale)
        .map(({ openGraphLocale }) => openGraphLocale),
      images: [openGraphImage(locale)],
    },
    twitter: options.noIndex ? undefined : {
      card: "summary_large_image",
      title: content.title,
      description: content.description,
      images: [openGraphImage(locale).url],
    },
    robots: options.noIndex ? { index: false, follow: false } : undefined,
  };
}

export function privacyPageMetadata(locale: Locale): Metadata {
  const copy = getPrivacyCopy(locale);
  const localizedPath = localizePathname("/privacy", locale);
  return {
    title: copy.title,
    description: copy.metadataDescription,
    alternates: alternates(localizedPath),
    openGraph: {
      title: copy.title,
      description: copy.metadataDescription,
      type: "website",
      url: localizedPath,
      locale: localeDetails(locale).openGraphLocale,
      alternateLocale: LOCALES
        .filter(({ code }) => code !== locale)
        .map(({ openGraphLocale }) => openGraphLocale),
      images: [openGraphImage(locale)],
    },
    twitter: {
      card: "summary_large_image",
      title: copy.title,
      description: copy.metadataDescription,
      images: [openGraphImage(locale).url],
    },
  };
}
