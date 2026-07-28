import type { Metadata } from "next";
import type { Locale } from "./config";
import { getDictionary } from "./dictionary";
import { localizePathname } from "./routing";

type MetadataPage = keyof ReturnType<typeof getDictionary>["metadata"];

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function openGraphImage(locale: Locale) {
  return {
    url: new URL(`/og/${locale}`, APP_URL).toString(),
    width: 1200,
    height: 630,
    alt: locale === "de" ? "GoStone — Go online spielen" : "GoStone — Play Go Online",
  };
}

function alternates(pathname: string) {
  const english = new URL(localizePathname(pathname, "en"), APP_URL).toString();
  const german = new URL(localizePathname(pathname, "de"), APP_URL).toString();
  return {
    canonical: new URL(pathname, APP_URL).toString(),
    languages: {
      en: english,
      de: german,
      "x-default": english,
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
    alternates: alternates(pathname),
    openGraph: {
      title: home.title,
      description: home.openGraphDescription,
      type: "website",
      url: pathname,
      locale: locale === "de" ? "de_DE" : "en_US",
      alternateLocale: [locale === "de" ? "en_US" : "de_DE"],
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
      locale: locale === "de" ? "de_DE" : "en_US",
      alternateLocale: [locale === "de" ? "en_US" : "de_DE"],
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
