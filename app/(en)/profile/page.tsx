import { AccountProfilePage } from "@/components/auth/AccountPages";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("en", "profile", "/profile");

export default function ProfilePage() {
  return <AccountProfilePage locale="en" />;
}
