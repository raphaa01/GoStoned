import { LegalNotice } from "@/components/legal/LegalNotice";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("en", "legal", "/impressum");

export default function EnglishLegalNoticePage() {
  return <LegalNotice locale="en" />;
}
