import { notFound } from "next/navigation";
import { isPrefixedLocale, type Locale } from "./config";

export function prefixedLocaleOrNotFound(value: string): Exclude<Locale, "en"> {
  if (!isPrefixedLocale(value)) notFound();
  return value;
}
