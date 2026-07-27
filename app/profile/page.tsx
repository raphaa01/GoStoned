import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { ProfileView } from "@/components/profile/ProfileView";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return <AppShell><ProfileView /></AppShell>;
}
