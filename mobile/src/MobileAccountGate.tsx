import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getMobileCopy } from "@/lib/i18n/mobile";

export function MobileAccountGate({ children, returnTo, title }: {
  children: ReactNode;
  returnTo: string;
  title: string;
}) {
  const { loading, user } = useAuth();
  const { href, locale } = useI18n();
  const copy = getMobileCopy(locale);

  if (loading) {
    return <div aria-label={copy.loading} className="mobile-screen-loading" role="status"><i /></div>;
  }
  if (!user) {
    const destination = `/login?returnTo=${encodeURIComponent(returnTo)}`;
    return (
      <section className="mobile-account-gate">
        <div aria-hidden="true" className="mobile-account-gate__stone" />
        <h1>{title}</h1>
        <h2>{copy.accountRequired}</h2>
        <p>{copy.accountRequiredBody}</p>
        <Link className="button button--primary" href={href(destination)}>{copy.signIn}</Link>
      </section>
    );
  }
  return children;
}
