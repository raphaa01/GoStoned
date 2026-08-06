import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Locale } from "@/lib/i18n/config";
import { localizeHref } from "@/lib/i18n/routing";
import { accountRegistrationPath, safeAccountReturnPath } from "./returnPath";
import { getSessionUser, SESSION_COOKIE } from "./session";

export async function requireAccountPage(returnTo: string, locale: Locale): Promise<void> {
  const safeReturnTo = safeAccountReturnPath(returnTo);
  if (!safeReturnTo) throw new Error("Account pages require a supported return path.");

  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) {
    redirect(localizeHref(accountRegistrationPath(safeReturnTo), locale));
  }
}
