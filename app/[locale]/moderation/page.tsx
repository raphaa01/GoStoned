import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { ModerationBoard } from "@/components/moderation/ModerationBoard";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { isModerator } from "@/lib/moderation/moderationService";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page() {
  const user = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user || !await isModerator(user.id)) notFound();
  return <AppShell><ModerationBoard /></AppShell>;
}
