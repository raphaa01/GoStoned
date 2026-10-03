import { AccountSettingsPage } from "@/components/auth/AccountPages";
import { getSettingsCopy } from "@/lib/i18n/settings";

export const metadata = { title: getSettingsCopy("en").title, robots: { index: false, follow: false } };

export default function SettingsPage() {
  return <AccountSettingsPage locale="en" />;
}
