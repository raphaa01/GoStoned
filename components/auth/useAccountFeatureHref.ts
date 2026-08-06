"use client";

import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { accountRegistrationPath } from "@/lib/auth/returnPath";

export function useAccountFeatureHref(returnTo: string): string {
  const { loading, user } = useAuth();
  const { href } = useI18n();
  return href(!loading && !user ? accountRegistrationPath(returnTo) : returnTo);
}
