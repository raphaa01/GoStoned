import { AccountTrainingGamePage } from "@/components/auth/AccountPages";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("en", "learn", "/learn/ai");

export default function TrainingGamePage() {
  return <AccountTrainingGamePage locale="en" />;
}
