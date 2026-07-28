import { en, type Dictionary } from "./catalogs/en";
import { de } from "./catalogs/de";
import type { Locale } from "./config";

export type { Dictionary } from "./catalogs/en";

export function getDictionary(locale: Locale): Dictionary {
  return locale === "de" ? de : en;
}

export type AuthErrorCode = keyof Dictionary["auth"]["errors"];
export type ApiErrorCode = keyof Dictionary["apiErrors"];

export function localizedAuthError(
  dictionary: Dictionary,
  code: string | undefined,
  fallback: AuthErrorCode,
): string {
  if (code && Object.prototype.hasOwnProperty.call(dictionary.auth.errors, code)) {
    return dictionary.auth.errors[code as AuthErrorCode];
  }
  return dictionary.auth.errors[fallback];
}

export function localizedApiError(
  dictionary: Dictionary,
  error: unknown,
  fallback: string,
): string {
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : null;
  if (
    typeof code === "string"
    && Object.prototype.hasOwnProperty.call(dictionary.apiErrors, code)
  ) {
    return dictionary.apiErrors[code as ApiErrorCode];
  }
  return fallback;
}
