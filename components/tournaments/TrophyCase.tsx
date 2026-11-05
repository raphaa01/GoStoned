"use client";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { readApi } from "@/lib/client/api";
import { getTournamentsCopy } from "@/lib/i18n/tournaments";
import { CATEGORY_LABELS } from "@/lib/tournaments/policy";
import type { TournamentTrophy } from "@/lib/tournaments/types";
import "./tournaments.css";

export function TrophyCase({ userId }: { userId?: string }) {
  const { user } = useAuth();
  const { locale, href } = useI18n();
  const copy = getTournamentsCopy(locale);
  const [trophies, setTrophies] = useState<TournamentTrophy[]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const own = !userId || userId === user?.id;
  const identity = user?.playerKey;
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!identity) return;
      const result = await fetch(
        `/api/tournaments?view=trophies${userId ? `&userId=${encodeURIComponent(userId)}` : ""}`,
        {
          cache: "no-store",
          headers: { [EXPECTED_PLAYER_HEADER]: identity },
          signal,
        },
      ).then(readApi<{ trophies: TournamentTrophy[] }>);
      if (!signal?.aborted) {
        setTrophies(result.trophies);
        setError(false);
      }
    },
    [identity, userId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => load(controller.signal))
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [load]);
  if (!identity) return null;
  if (error)
    return (
      <p role="alert" className="tournament-error">
        {copy.trophies}{" "}
        <button
          type="button"
          onClick={() => void load().catch(() => setError(true))}
        >
          {copy.retry}
        </button>
      </p>
    );
  if (!trophies.length) return null;
  async function toggle(t: TournamentTrophy) {
    if (!identity || busy) return;
    setBusy(true);
    try {
      await fetch("/api/tournaments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [EXPECTED_PLAYER_HEADER]: identity,
        },
        body: JSON.stringify({
          action: "trophy",
          id: t.tournamentId,
          displayed: !t.displayed,
        }),
      }).then(readApi);
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="tournament-trophies">
      <h2>{copy.trophies}</h2>
      <div className="tournament-trophies__items">
        {trophies.map((t) => (
          <div className="tournament-trophy" key={t.tournamentId}>
            <Trophy aria-hidden="true" size={26} />
            <div>
              <Link href={href(`/tournaments/${t.tournamentId}`)}>
                <strong>
                  #{t.place} · {t.name}
                </strong>
              </Link>
              <small>
                {t.category !== null ? CATEGORY_LABELS[t.category] : null}
              </small>
              {own ? (
                <button
                  disabled={busy}
                  onClick={() => void toggle(t)}
                  type="button"
                >
                  {t.displayed ? copy.hide : copy.display}
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
