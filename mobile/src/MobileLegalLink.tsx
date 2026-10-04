import { useState, type ReactNode } from "react";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { useI18n } from "@/components/i18n/I18nProvider";

export type MobileLegalPath = "/privacy" | "/impressum" | "/delete-account";

export function MobileLegalLink({ pathname, children, className }: {
  pathname: MobileLegalPath;
  children: ReactNode;
  className?: string;
}) {
  const { href, locale } = useI18n();
  const [failed, setFailed] = useState(false);
  const url = `https://gostone.app${href(pathname)}`;
  return <>
    <a className={className} href={url} target="_blank" rel="noopener noreferrer" onClick={(event) => {
      if (!Capacitor.isNativePlatform() || failed) return;
      event.preventDefault();
      void Browser.open({ url }).catch(() => setFailed(true));
    }}>{children}</a>
    {failed ? <p role="alert" lang={locale === "de" ? "de" : "en"}>
      {locale === "de" ? "Die Seite konnte nicht geöffnet werden. Tippe erneut auf den Link oder öffne diese Adresse in deinem Browser:" : "The page could not be opened. Tap the link again or open this address in your browser:"} {url}
    </p> : null}
  </>;
}
