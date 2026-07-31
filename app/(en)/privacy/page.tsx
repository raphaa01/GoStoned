import { PrivacyPolicy } from "@/components/legal/PrivacyPolicy";
import { privacyPageMetadata } from "@/lib/i18n/metadata";

export const metadata = privacyPageMetadata("en");

export default function EnglishPrivacyPolicyPage() {
  return <PrivacyPolicy locale="en" />;
}
