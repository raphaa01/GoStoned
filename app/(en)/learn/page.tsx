import { AccountLearnPage } from "@/components/auth/AccountPages";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("en", "learn", "/learn");

export default function LearnPage() {
  return <AccountLearnPage locale="en" />;
}
