import { AppShell } from "@/components/layout/AppShell";
import { ProfileView } from "@/components/profile/ProfileView";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("de", "profile", "/profile");

export default function GermanProfilePage() {
  return <AppShell><ProfileView /></AppShell>;
}
