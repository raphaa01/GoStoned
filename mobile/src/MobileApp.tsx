import { ChevronLeft } from "lucide-react";
import { useEffect, useMemo } from "react";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { OAuthUsernameForm } from "@/components/auth/OAuthUsernameForm";
import { FriendsHub } from "@/components/friends/FriendsHub";
import { GameRoom } from "@/components/game/GameRoom";
import { BoardPlacementProvider } from "@/components/game/BoardPlacementProvider";
import { SharedGameView } from "@/components/game/SharedGameView";
import { PlayWorkspace } from "@/components/game/PlayWorkspace";
import { I18nProvider, useI18n } from "@/components/i18n/I18nProvider";
import { LeaderboardView } from "@/components/leaderboard/LeaderboardView";
import { LearningGuide } from "@/components/learn/LearningGuide";
import { TrainingGame } from "@/components/learn/TrainingGame";
import { LegalNotice } from "@/components/legal/LegalNotice";
import { PrivacyPolicy } from "@/components/legal/PrivacyPolicy";
import { PuzzleWorkspace } from "@/components/puzzles/PuzzleWorkspace";
import { AnalysisReview } from "@/components/review/AnalysisReview";
import { ReviewGuide } from "@/components/review/ReviewGuide";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getMobileCopy } from "@/lib/i18n/mobile";
import { MobileAccountGate } from "./MobileAccountGate";
import { MobileAuthScreen } from "./MobileAuthScreen";
import { MobileHome } from "./MobileHome";
import { MobileSettings } from "./MobileSettings";
import { getSettingsCopy } from "@/lib/i18n/settings";
import { MobileProfile } from "./MobileProfile";
import { MobileShell } from "./MobileShell";
import { MobileSplash } from "./MobileSplash";
import { updateNativeChrome } from "./nativeChrome";
import { usePathname, useRouter, useSearchParams } from "./next-navigation";
import { MobileThemeProvider } from "./theme";

function routeFor(pathname: string): { locale: Locale; route: string } {
  const parts = pathname.split("/").filter(Boolean);
  const locale = isLocale(parts[0]) ? parts.shift()! as Locale : DEFAULT_LOCALE;
  return { locale, route: `/${parts.join("/")}` };
}

function PushedScreen({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { locale } = useI18n();
  const copy = getMobileCopy(locale);
  return (
    <div className="mobile-pushed-screen">
      <button aria-label={copy.back} className="mobile-back-button" onClick={() => router.back()} type="button">
        <ChevronLeft aria-hidden="true" size={23} />
        <span>{copy.back}</span>
      </button>
      {children}
    </div>
  );
}

function NativeChromeHidden({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    updateNativeChrome({ activeRoute: null, tabs: [], type: "state", visible: false });
  }, []);
  return children;
}

function MobileRoute() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { locale, route } = routeFor(pathname);
  const { dictionary } = useI18n();
  const copy = getMobileCopy(locale);
  const game = route.match(/^\/game\/([0-9a-f-]+)$/i);
  const review = route.match(/^\/review\/([0-9a-f-]+)$/i);
  const sharedGame = route.match(/^\/shared-game\/([0-9a-f-]+)$/i);
  const size = Number(search.get("size"));

  if (game) return <NativeChromeHidden><GameRoom gameId={game[1]} /></NativeChromeHidden>;
  if (sharedGame) return <NativeChromeHidden><SharedGameView token={sharedGame[1]} /></NativeChromeHidden>;
  if (route === "/login" || route === "/register") {
    return <NativeChromeHidden><MobileAuthScreen mode={route === "/login" ? "login" : "register"} returnTo={search.get("returnTo")} oauthError={search.get("oauthError")} /></NativeChromeHidden>;
  }
  if (route === "/register/username") {
    return <NativeChromeHidden><main className="mobile-auth-screen" id="main-content"><OAuthUsernameForm returnTo={search.get("returnTo")} /></main></NativeChromeHidden>;
  }
  if (review) {
    return <MobileShell><div className="mobile-tab-screen mobile-review-screen"><AnalysisReview gameId={review[1]} /></div></MobileShell>;
  }

  let content: React.ReactNode;
  let showPlayAction = false;
  switch (route) {
    case "/":
      content = <MobileHome />;
      showPlayAction = true;
      break;
    case "/play": content = <PushedScreen><PlayWorkspace initialSize={size === 13 || size === 19 ? size : 9} /></PushedScreen>; break;
    case "/profile": content = <PushedScreen><MobileAccountGate returnTo="/profile" title={copy.profile}><MobileProfile /></MobileAccountGate></PushedScreen>; break;
    case "/profile/settings": content = <PushedScreen><MobileAccountGate returnTo="/profile/settings" title={getSettingsCopy(locale).title}><MobileSettings /></MobileAccountGate></PushedScreen>; break;
    case "/friends": content = <PushedScreen><MobileAccountGate returnTo="/friends" title={copy.friends}><FriendsHub /></MobileAccountGate></PushedScreen>; break;
    case "/learn": content = <div className="mobile-tab-screen mobile-learn-screen"><MobileAccountGate returnTo="/learn" title={dictionary.nav.learn}><LearningGuide /></MobileAccountGate></div>; break;
    case "/learn/ai": content = <PushedScreen><TrainingGame /></PushedScreen>; break;
    case "/review": content = <div className="mobile-tab-screen mobile-review-screen"><MobileAccountGate returnTo="/review" title={dictionary.nav.review}><ReviewGuide /></MobileAccountGate></div>; break;
    case "/puzzles": content = <div className="mobile-tab-screen mobile-puzzle-screen"><PuzzleWorkspace initialMode={search.get("mode") === "practice" ? "practice" : "daily"} /></div>; break;
    case "/leaderboard": content = <div className="mobile-tab-screen mobile-leaderboard-screen"><LeaderboardView /></div>; break;
    case "/privacy": content = <PushedScreen><PrivacyPolicy locale={locale} /></PushedScreen>; break;
    case "/impressum": content = <PushedScreen><LegalNotice locale={locale} /></PushedScreen>; break;
    default: content = <section className="mobile-not-found"><h1>GoStone</h1><p>404</p></section>;
  }
  return <MobileShell showPlayAction={showPlayAction}>{content}</MobileShell>;
}

function MobileRoot() {
  return <><MobileRoute /><MobileSplash /></>;
}

export function MobileApp() {
  const pathname = usePathname();
  const locale = useMemo(() => routeFor(pathname).locale, [pathname]);
  return (
    <I18nProvider dictionary={getDictionary(locale)} locale={locale}>
      <AuthProvider>
        <BoardPlacementProvider><MobileThemeProvider><MobileRoot /></MobileThemeProvider></BoardPlacementProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
