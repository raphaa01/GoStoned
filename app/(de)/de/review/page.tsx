import { AppShell } from "@/components/layout/AppShell";
import { ReviewGuide } from "@/components/review/ReviewGuide";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("de", "review", "/review");

export default function GermanReviewPage() {
  return <AppShell><ReviewGuide /></AppShell>;
}
