import { useI18n } from "@/components/i18n/I18nProvider";
import { getCommunityCopy } from "@/lib/i18n/community";
import { MobileLegalLink } from "./MobileLegalLink";
export function MobilePublicLegal() {
  const { locale } = useI18n(); const copy = getCommunityCopy(locale);
  return <nav className="mobile-public-legal" aria-label={copy.contact}>
    <MobileLegalLink pathname="/privacy">{copy.privacy}</MobileLegalLink>
    <MobileLegalLink pathname="/community-rules">{copy.rules}</MobileLegalLink>
    <MobileLegalLink pathname="/impressum">{copy.contact}</MobileLegalLink>
  </nav>;
}
