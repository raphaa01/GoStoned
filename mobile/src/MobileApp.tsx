import { useMemo } from "react";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { FriendsHub } from "@/components/friends/FriendsHub";
import { GameRoom } from "@/components/game/GameRoom";
import { PlayWorkspace } from "@/components/game/PlayWorkspace";
import { Hero } from "@/components/home/Hero";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import { LeaderboardView } from "@/components/leaderboard/LeaderboardView";
import { LearningGuide } from "@/components/learn/LearningGuide";
import { TrainingGame } from "@/components/learn/TrainingGame";
import { AppShell } from "@/components/layout/AppShell";
import { ProfileView } from "@/components/profile/ProfileView";
import { PuzzleWorkspace } from "@/components/puzzles/PuzzleWorkspace";
import { AnalysisReview } from "@/components/review/AnalysisReview";
import { ReviewGuide } from "@/components/review/ReviewGuide";
import { getDictionary } from "@/lib/i18n/dictionary";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/config";
import { usePathname, useSearchParams } from "./next-navigation";

function routeFor(pathname: string): { locale: Locale; route: string } {
  const parts = pathname.split("/").filter(Boolean);
  const locale = isLocale(parts[0]) ? parts.shift()! as Locale : DEFAULT_LOCALE;
  return { locale, route: `/${parts.join("/")}` };
}

function MobileRoute() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { route } = routeFor(pathname);
  const game = route.match(/^\/game\/([0-9a-f-]+)$/i);
  const review = route.match(/^\/review\/([0-9a-f-]+)$/i);
  const size = Number(search.get("size"));

  if (game) return <GameRoom gameId={game[1]} />;
  if (review) return <AnalysisReview gameId={review[1]} />;

  let content: React.ReactNode;
  switch (route) {
    case "/": content = <Hero />; break;
    case "/play": content = <PlayWorkspace initialSize={size === 13 || size === 19 ? size : 9} />; break;
    case "/login": content = <AuthForm mode="login" returnTo={search.get("returnTo")} />; break;
    case "/register": content = <AuthForm mode="register" returnTo={search.get("returnTo")} />; break;
    case "/profile": content = <ProfileView />; break;
    case "/friends": content = <FriendsHub />; break;
    case "/learn": content = <LearningGuide />; break;
    case "/learn/ai": content = <TrainingGame />; break;
    case "/review": content = <ReviewGuide />; break;
    case "/puzzles": content = <PuzzleWorkspace initialMode={search.get("mode") === "practice" ? "practice" : "daily"} />; break;
    case "/leaderboard": content = <LeaderboardView />; break;
    default:
      content = (
        <section className="mobile-not-found">
          <h1>GoStone</h1>
          <p>This page is not available in the mobile bundle yet.</p>
        </section>
      );
  }
  return <AppShell>{content}</AppShell>;
}

export function MobileApp() {
  const pathname = usePathname();
  const locale = useMemo(() => routeFor(pathname).locale, [pathname]);
  return (
    <I18nProvider dictionary={getDictionary(locale)} locale={locale}>
      <AuthProvider>
        <MobileRoute />
      </AuthProvider>
    </I18nProvider>
  );
}
