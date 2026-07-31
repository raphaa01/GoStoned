import { AppShell } from "@/components/layout/AppShell";
import { ProfileView } from "@/components/profile/ProfileView";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("en", "profile", "/profile");

export default function ProfilePage() {
  return <AppShell><ProfileView /></AppShell>;
}
