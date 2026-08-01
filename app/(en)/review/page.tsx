import { AccountReviewPage } from "@/components/auth/AccountPages";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("en", "review", "/review");

export default function ReviewPage() {
  return <AccountReviewPage locale="en" />;
}
