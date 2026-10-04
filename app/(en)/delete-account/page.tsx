import { AccountDeletion } from "@/components/legal/AccountDeletion";
import { getAccountDeletionCopy } from "@/lib/i18n/accountDeletion";

export const dynamic = "force-dynamic";
export const metadata = { title: getAccountDeletionCopy("en").title };

export default function AccountDeletionPage() {
  return <AccountDeletion locale="en" />;
}
