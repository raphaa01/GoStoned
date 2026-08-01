import { AppShell } from "@/components/layout/AppShell";
import { LearningGuide } from "@/components/learn/LearningGuide";
import { ProfileView } from "@/components/profile/ProfileView";
import { AnalysisReview } from "@/components/review/AnalysisReview";
import { ReviewGuide } from "@/components/review/ReviewGuide";
import { requireAccountPage } from "@/lib/auth/pageAccess";
import { safeAccountReturnPath } from "@/lib/auth/returnPath";
import type { Locale } from "@/lib/i18n/config";

export async function AccountProfilePage({ locale }: { locale: Locale }) {
  await requireAccountPage("/profile", locale);
  return <AppShell><ProfileView /></AppShell>;
}

export async function AccountLearnPage({ locale }: { locale: Locale }) {
  await requireAccountPage("/learn", locale);
  return <AppShell><LearningGuide /></AppShell>;
}

export async function AccountReviewPage({ locale }: { locale: Locale }) {
  await requireAccountPage("/review", locale);
  return <AppShell><ReviewGuide /></AppShell>;
}

export async function AccountGameReviewPage({
  gameId,
  locale,
}: {
  gameId: string;
  locale: Locale;
}) {
  const returnTo = safeAccountReturnPath(`/review/${gameId}`) ?? "/review";
  await requireAccountPage(returnTo, locale);
  return <AnalysisReview gameId={gameId} />;
}
