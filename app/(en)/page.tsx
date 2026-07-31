import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Hero } from "@/components/home/Hero";
import { AppShell } from "@/components/layout/AppShell";
import { isLocale, LOCALE_COOKIE, preferredLocale } from "@/lib/i18n/config";

function queryString(parameters: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (Array.isArray(value)) {
      for (const entry of value) query.append(key, entry);
    } else if (value !== undefined) {
      query.append(key, value);
    }
  }
  const result = query.toString();
  return result ? `?${result}` : "";
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cookieStore = await cookies();
  const storedLocaleValue = cookieStore.get(LOCALE_COOKIE)?.value;
  const storedLocale = isLocale(storedLocaleValue) ? storedLocaleValue : null;
  if (storedLocale === "de") redirect(`/de${queryString(await searchParams)}`);
  const requestHeaders = await headers();
  const suggestGerman = !storedLocale
    && preferredLocale(requestHeaders.get("accept-language")) === "de";
  return (
    <AppShell>
      <Hero suggestGerman={suggestGerman} />
    </AppShell>
  );
}
