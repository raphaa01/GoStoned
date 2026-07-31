import { LegalNotice } from "@/components/legal/LegalNotice";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("de", "legal", "/impressum");

export default function GermanLegalNoticePage() {
  return <LegalNotice locale="de" />;
}
