import { MobilePublicLegal } from "./MobilePublicLegal";
import { ArrowRight, CircleUserRound, UsersRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { HomeAccountOverview } from "@/components/home/HomeAccountOverview";
import { HomeShortcuts } from "@/components/home/HomeShortcuts";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { readApi } from "@/lib/client/api";
import type { MatchmakingQueueState } from "@/lib/client/matchmaking";
import type { FriendsDashboard } from "@/lib/friends/types";
import { getMobileCopy } from "@/lib/i18n/mobile";
import { puzzleRouteKey, readRouteData } from "@/lib/client/routeCache";
import { assertResponseActor } from "@/lib/client/identityAuthority";
import type { PuzzleHub } from "@/lib/puzzles/types";
import { parsePublicLeaderboardSnapshot } from "@/lib/stats/leaderboardContract";

type HomeData = {
  playerKey: string | null;
  friends: FriendsDashboard | null;
  matchmaking: MatchmakingQueueState | null;
};

const EMPTY_DATA: HomeData = { playerKey: null, friends: null, matchmaking: null };

export function MobileHome() {
  const { user } = useAuth();
  const { dictionary, href, locale } = useI18n();
  const copy = getMobileCopy(locale);
  const playerKey = user?.playerKey ?? null;
  const [data, setData] = useState<HomeData>(EMPTY_DATA);

  useEffect(() => {
    if (!playerKey) return;
    // Share pending reads with the destination. Leaving Home must not abort
    // a request that the newly opened tab is already waiting for.
    const timer = window.setTimeout(() => {
      if (document.hidden || !navigator.onLine) return;
      void Promise.allSettled([
        readRouteData(puzzleRouteKey("daily", playerKey), async () => {
          const response = await fetch("/api/puzzles?mode=daily", {
            cache: "no-store",
            headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
            signal: AbortSignal.timeout(20_000),
          });
          const body = await readApi<PuzzleHub & { actor: string }>(response);
          assertResponseActor(body.actor, playerKey);
          return body;
        }),
        readRouteData("public:leaderboard", async () => {
          const response = await fetch("/api/stats", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
          return parsePublicLeaderboardSnapshot(await readApi<unknown>(response));
        }),
      ]);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [playerKey]);

  useEffect(() => {
    if (!playerKey) return;
    const controller = new AbortController();
    const headers = { [EXPECTED_PLAYER_HEADER]: playerKey };
    void Promise.allSettled([
      fetch("/api/friends", { cache: "no-store", headers, signal: controller.signal })
        .then((response) => readApi<{ dashboard: FriendsDashboard }>(response))
        .then((body) => body.dashboard),
      fetch("/api/matchmaking", { cache: "no-store", headers, signal: controller.signal })
        .then((response) => readApi<{ matchmaking: MatchmakingQueueState }>(response))
        .then((body) => body.matchmaking),
    ]).then(([friends, matchmaking]) => {
      if (controller.signal.aborted) return;
      setData({
        playerKey,
        friends: friends.status === "fulfilled" ? friends.value : null,
        matchmaking: matchmaking.status === "fulfilled" ? matchmaking.value : null,
      });
    });
    return () => controller.abort();
  }, [playerKey]);

  const currentData = user && data.playerKey === user.playerKey ? data : EMPTY_DATA;
  const onlineFriends = currentData.friends?.friends.filter((friend) => friend.presence !== "offline") ?? [];
  const incomingRequests = currentData.friends?.requests.filter((request) => request.direction === "incoming") ?? [];
  const activeGame = currentData.matchmaking?.status === "matched" && currentData.matchmaking.gameId
    ? currentData.matchmaking
    : null;

  return (
    <div className="mobile-home">
      <header className="mobile-home-header">
        <Link aria-label={user ? copy.profile : copy.signIn} className="mobile-profile-button" href={href(user ? "/profile" : "/login")}>
          {user ? <ProfileAvatar size="sm" style={user.avatarStyle} /> : <CircleUserRound aria-hidden="true" size={27} />}
          <span>{user?.displayName ?? copy.signIn}</span>
        </Link>
        <span aria-hidden="true" className="mobile-wordmark"><i />GoStone</span>
        <Link aria-label={copy.friends} className="mobile-friends-button" href={href(user ? "/friends" : "/login?returnTo=/friends")}>
          <UsersRound aria-hidden="true" size={23} />
          {incomingRequests.length ? <b>{incomingRequests.length}</b> : null}
        </Link>
      </header>

      {!user ? (
        <section className="mobile-home-intro">
          <div>
            <Link className="button button--primary" href={href("/login")}>{copy.signIn}</Link>
            <Link className="button button--secondary" href={href("/register")}>{copy.createAccount}</Link>
          </div>
        </section>
      ) : null}

      {activeGame ? (
        <section className="mobile-active-game">
          <div>
            <small>{copy.activeGame}</small>
            <strong>{activeGame.boardSize}×{activeGame.boardSize} · {activeGame.timeControl ? dictionary.timeControls[activeGame.timeControl].name : ""}</strong>
          </div>
          <Link href={href(`/game/${activeGame.gameId}`)}>{copy.continueGame}<ArrowRight aria-hidden="true" size={17} /></Link>
        </section>
      ) : null}

      <HomeShortcuts />
      {playerKey ? <HomeAccountOverview key={playerKey} playerKey={playerKey} /> : null}

      {incomingRequests.length || onlineFriends.length ? (
        <section className="mobile-friends-summary">
          <header className="home-section__heading"><h2><Link href={href("/friends")}>{copy.friends}</Link></h2></header>
          <div>
            {incomingRequests.length ? <span><strong>{incomingRequests.length}</strong>{copy.friendRequests}</span> : null}
            {onlineFriends.length ? <span><strong>{onlineFriends.length}</strong>{copy.onlineFriends}</span> : null}
          </div>
        </section>
      ) : null}
      {!user ? <MobilePublicLegal /> : null}
    </div>
  );
}
