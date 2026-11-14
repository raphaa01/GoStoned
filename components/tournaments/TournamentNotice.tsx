"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { readApi } from "@/lib/client/api";
import { getTournamentsCopy } from "@/lib/i18n/tournaments";
import "./tournaments.css";

export function TournamentNotice({
  mobile = false,
}: { mobile?: boolean } = {}) {
  const { user } = useAuth();
  return user ? (
    <TournamentNoticeForPlayer key={user.playerKey} mobile={mobile} />
  ) : null;
}

function TournamentNoticeForPlayer({ mobile }: { mobile: boolean }) {
  const { user } = useAuth();
  const { href, locale } = useI18n();
  const pathname = usePathname();
  const [notice, setNotice] = useState<{
    tournamentId: string;
    gameId: string | null;
    name: string;
    currentRapid?: boolean;
  } | null>(null);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const result = await fetch(
          `/api/tournaments?view=notice${mobile ? "&client=mobile" : ""}`,
          {
            cache: "no-store",
            headers: { [EXPECTED_PLAYER_HEADER]: user!.playerKey },
            signal: controller.signal,
          },
        ).then(readApi<{ notice: typeof notice }>);
        if (!controller.signal.aborted) setNotice(result.notice);
      } catch {
        /* The lobby remains the authority; a failed background read retries. */
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [user, mobile]);
  if (
    !user ||
    !notice ||
    pathname.endsWith(`/tournaments/${notice.tournamentId}`) ||
    (mobile && /\/tournaments\/?$/.test(pathname) && notice.currentRapid)
  )
    return null;
  const copy = getTournamentsCopy(locale);
  return (
    <aside className="tournament-notice" role="status">
      <span>
        {notice.name} · {copy.newPairing}
      </span>
      <Link
        href={href(
          notice.gameId
            ? `/game/${notice.gameId}`
            : mobile && notice.currentRapid
              ? "/tournaments"
              : `/tournaments/${notice.tournamentId}`,
        )}
      >
        {notice.gameId ? copy.play : copy.ready}
      </Link>
    </aside>
  );
}

export function TournamentGameLink({
  gameId,
  finished = false,
  mobile = false,
}: {
  gameId: string;
  finished?: boolean;
  mobile?: boolean;
}) {
  const { user } = useAuth();
  return user ? (
    <TournamentGameLinkForPlayer
      key={`${user.playerKey}:${gameId}`}
      gameId={gameId}
      finished={finished}
      mobile={mobile}
    />
  ) : null;
}

function TournamentGameLinkForPlayer({
  gameId,
  finished,
  mobile,
}: {
  gameId: string;
  finished: boolean;
  mobile: boolean;
}) {
  const { user } = useAuth();
  const { href, locale } = useI18n();
  const router = useRouter();
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void fetch(
      `/api/tournaments?view=game&gameId=${encodeURIComponent(gameId)}${mobile ? "&client=mobile" : ""}`,
      {
        headers: { [EXPECTED_PLAYER_HEADER]: user.playerKey },
        signal: controller.signal,
      },
    )
      .then(readApi<{ tournamentId: string; currentRapid?: boolean }>)
      .then((r) => {
        if (!controller.signal.aborted && r.tournamentId)
          setDestination(
            mobile && r.currentRapid
              ? "/tournaments"
              : `/tournaments/${r.tournamentId}`,
          );
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [gameId, user, mobile]);
  useEffect(() => {
    if (destination && finished) router.replace(href(destination));
  }, [destination, finished, router, href]);
  return destination ? (
    <Link className="tournament-game-link" href={href(destination)}>
      {getTournamentsCopy(locale).backLobby}
    </Link>
  ) : null;
}
