import { LearningGuide } from "@/components/learn/LearningGuide";
import { AppShell } from "@/components/layout/AppShell";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("de", "learn", "/learn");

export default function GermanLearnPage() {
  return <AppShell><LearningGuide /></AppShell>;
}
