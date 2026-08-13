import type { Metadata } from "next";
import { AccountFriendsPage } from "@/components/auth/AccountPages";
import { getFriendsCopy } from "@/lib/i18n/friends";

const copy = getFriendsCopy("en");
export const metadata: Metadata = {
  title: copy.metadataTitle,
  description: copy.metadataDescription,
};

export default function FriendsPage() {
  return <AccountFriendsPage locale="en" />;
}
