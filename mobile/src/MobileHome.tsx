import {
  ArrowRight,
  BookOpen,
  CircleUserRound,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { RatingLabel } from "@/components/rating/RatingLabel";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { readApi } from "@/lib/client/api";
import type { MatchmakingQueueState } from "@/lib/client/matchmaking";
import type { FriendsDashboard } from "@/lib/friends/types";
import { getMobileCopy } from "@/lib/i18n/mobile";
import { useLearnProgress } from "@/components/learn/useLearnProgress";
import { LEARN_LESSON_IDS } from "@/lib/learn/progress";
import { getRecentGameRatingPresentation } from "@/lib/stats/ratingPresentation";

import type { ProfileResponse } from "@/components/profile/ProfileView";
import { useRouteResource } from "@/components/useRouteResource";
import { puzzleRouteKey, readRouteData, routeCacheKey } from "@/lib/client/routeCache";
import { assertResponseActor } from "@/lib/client/identityAuthority";
import type { PuzzleHub } from "@/lib/puzzles/types";
import { parsePublicLeaderboardSnapshot } from "@/lib/stats/leaderboardContract";

type HomeData = {
  playerKey: string | null;
  friends: FriendsDashboard | null;
  matchmaking: MatchmakingQueueState | null;
};

const EMPTY_DATA: HomeData = { playerKey: null, friends: null, matchmaking: null };

function signed(value: number) {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

export function MobileHome() {
  const { user } = useAuth();
  const { dictionary, href, locale } = useI18n();
  const copy = getMobileCopy(locale);
  const playerKey = user?.playerKey ?? null;
  const [data, setData] = useState<HomeData>(EMPTY_DATA);
  const loadProfile = useCallback(() => fetch("/api/profile", { cache: "no-store" }).then(readApi<ProfileResponse>), []);
  const profile = useRouteResource(playerKey ? routeCacheKey("profile", playerKey) : null, loadProfile);
  const { progress } = useLearnProgress();
  const learned = progress.completedLessonIds.length;

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
  const recentGames = profile.data?.recentGames?.slice(0, 3) ?? [];
  const onlineFriends = currentData.friends?.friends.filter((friend) => friend.presence !== "offline") ?? [];
  const incomingRequests = currentData.friends?.requests.filter((request) => request.direction === "incoming") ?? [];
  const totalLessons = LEARN_LESSON_IDS.length;
  const learningPercent = Math.min(100, Math.round((learned / totalLessons) * 100));
  const learningTitle = learned === 0 ? copy.startLearning : copy.continueLearning;
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
          <div aria-hidden="true" className="mobile-home-stone"><i /><i /><span /></div>
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

      <div className="mobile-home-actions">
        <Link className="mobile-home-action mobile-puzzle-entry" href={href("/puzzles")}>
          <div aria-hidden="true" className="mobile-mini-board"><i /><i /><i /><span /><b /></div>
          <span><strong>{copy.dailyPuzzle}</strong><ArrowRight aria-hidden="true" size={18} /></span>
        </Link>
        <Link className="mobile-home-action mobile-learning-entry" href={href("/learn")}>
          <BookOpen aria-hidden="true" className="mobile-learning-icon" size={32} strokeWidth={1.6} />
          <span><strong>{learningTitle}</strong><ArrowRight aria-hidden="true" size={18} /></span>
          <div className="mobile-progress-track" aria-label={copy.lessonsComplete.replace("{done}", String(learned)).replace("{total}", String(totalLessons))}><i style={{ width: `${learningPercent}%` }} /></div>
          <small>{learned} / {totalLessons}</small>
        </Link>
      </div>

      {profile.data?.rating && profile.data.preferences ? (
        <section className="mobile-home-section">
          <header className="mobile-section-heading"><h2>{copy.statistics}</h2></header>
          <dl className="mobile-stat-row">
            <div><dt>{copy.rating}</dt><dd><RatingLabel locale={locale} preference={profile.data.preferences.displayPreference} rating={profile.data.rating.rating} /></dd></div>
            <div><dt>{copy.ratedGames}</dt><dd>{profile.data.rating.ratedGameCount}</dd></div>
            <div><dt>{copy.lastThirtyDays}</dt><dd className={profile.data.rating.ratingChange30Days > 0 ? "is-positive" : profile.data.rating.ratingChange30Days < 0 ? "is-negative" : ""}>{signed(profile.data.rating.ratingChange30Days)}</dd></div>
          </dl>
        </section>
      ) : null}

      {user ? (
        <section className="mobile-home-section">
          <header className="mobile-section-heading">
            <h2>{copy.recentGames}</h2>
            <Link href={href("/profile#game-history")}>{copy.allGames}</Link>
          </header>
          {recentGames.length ? <div className="mobile-game-list">{recentGames.map((game) => {
            const presented = getRecentGameRatingPresentation(game);
            const result = game.result === "win" ? copy.won : game.result === "loss" ? copy.lost : game.result === "draw" ? copy.draw : copy.noResult;
            return (
              <Link href={href(`/game/${game.gameId}`)} key={game.gameId}>
                <span className={`mobile-result-mark is-${game.result}`}>{game.result === "win" ? "W" : game.result === "loss" ? "L" : "–"}</span>
                <span><strong>{game.opponentName}</strong><small>{game.boardSize}×{game.boardSize} · {dictionary.timeControls[game.timeControl].name} · {result}</small></span>
                <b className={presented.kind === "change" && presented.value > 0 ? "is-positive" : presented.kind === "change" && presented.value < 0 ? "is-negative" : ""}>{presented.kind === "change" ? signed(presented.value) : ""}</b>
              </Link>
            );
          })}</div> : <p className="mobile-empty-state">{copy.noRecentGames}</p>}
        </section>
      ) : null}

      {incomingRequests.length || onlineFriends.length ? (
        <section className="mobile-home-section mobile-friends-summary">
          <header className="mobile-section-heading"><h2>{copy.friends}</h2><Link href={href("/friends")}>{copy.friends}</Link></header>
          <div>
            {incomingRequests.length ? <span><strong>{incomingRequests.length}</strong>{copy.friendRequests}</span> : null}
            {onlineFriends.length ? <span><strong>{onlineFriends.length}</strong>{copy.onlineFriends}</span> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
