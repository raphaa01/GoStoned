"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { readApi } from "@/lib/client/api";
import { getTournamentsCopy } from "@/lib/i18n/tournaments";
import "./tournaments.css";

export function TournamentNotice() {
  const { user } = useAuth();
  const { href, locale } = useI18n();
  const pathname = usePathname();
  const [notice, setNotice] = useState<{
    tournamentId: string;
    gameId: string | null;
    name: string;
  } | null>(null);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const result = await fetch("/api/tournaments?view=notice", {
          cache: "no-store",
          headers: { [EXPECTED_PLAYER_HEADER]: user!.playerKey },
          signal: controller.signal,
        }).then(readApi<{ notice: typeof notice }>);
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
  }, [user]);
  if (
    !user ||
    !notice ||
    pathname.endsWith(`/tournaments/${notice.tournamentId}`)
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
            : `/tournaments/${notice.tournamentId}`,
        )}
      >
        {notice.gameId ? copy.play : copy.ready}
      </Link>
    </aside>
  );
}

export function TournamentGameLink({ gameId }: { gameId: string }) {
  const { user } = useAuth();
  const { href, locale } = useI18n();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void fetch(
      `/api/tournaments?view=game&gameId=${encodeURIComponent(gameId)}`,
      {
        headers: { [EXPECTED_PLAYER_HEADER]: user.playerKey },
        signal: controller.signal,
      },
    )
      .then(readApi<{ tournamentId: string }>)
      .then((r) => {
        if (!controller.signal.aborted) setId(r.tournamentId);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [gameId, user]);
  return id ? (
    <Link className="tournament-game-link" href={href(`/tournaments/${id}`)}>
      {getTournamentsCopy(locale).backLobby}
    </Link>
  ) : null;
}
