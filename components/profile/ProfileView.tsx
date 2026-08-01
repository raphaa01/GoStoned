"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Gamepad2,
  LogIn,
  Minus,
  Trophy,
  UserRoundPlus,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { RatingHistoryChart } from "@/components/profile/RatingHistoryChart";
import { RatingDetails } from "@/components/rating/RatingDetails";
import { RatingLabel } from "@/components/rating/RatingLabel";
import { readApi } from "@/lib/client/api";
import type { Locale } from "@/lib/i18n/config";
import { localizedApiError } from "@/lib/i18n/dictionary";
import type { BotMatchPreference } from "@/lib/rating/preferences";
import type { RatingDisplayPreference } from "@/lib/rating/rankPolicy";
import type {
  GlobalRatingSummary,
  PublicRatingPreferences,
  RatingHistoryEntry,
  RecentGame,
} from "@/lib/stats/statsService";
import { getRecentGameRatingPresentation } from "@/lib/stats/ratingPresentation";

type ProfileResponse = {
  rating?: GlobalRatingSummary;
  preferences?: PublicRatingPreferences;
  history?: RatingHistoryEntry[];
  recentGames?: RecentGame[];
};

function signedRating(value: number) {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function ProfileView() {
  const { user, loading } = useAuth();
  const { dictionary, href, locale } = useI18n();
  const copy = dictionary.profile;
  const [rating, setRating] = useState<GlobalRatingSummary | null>(null);
  const [preferences, setPreferences] = useState<PublicRatingPreferences | null>(null);
  const [history, setHistory] = useState<RatingHistoryEntry[]>([]);
  const [recentGames, setRecentGames] = useState<RecentGame[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      const timeout = window.setTimeout(() => setLoaded(true), 0);
      return () => window.clearTimeout(timeout);
    }
    const controller = new AbortController();
    void fetch("/api/profile", { cache: "no-store", signal: controller.signal })
      .then((response) => readApi<ProfileResponse>(response))
      .then((body) => {
        setRating(body.rating ?? null);
        setPreferences(body.preferences ?? null);
        setHistory(body.history ?? []);
        setRecentGames(body.recentGames ?? []);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(localizedApiError(dictionary, requestError, copy.loadFailed));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, [copy.loadFailed, dictionary, user]);

  const savePreferences = async () => {
    if (!preferences || saving) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const response = await fetch("/api/profile/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayPreference: preferences.displayPreference,
          botMatchPreference: preferences.botMatchPreference,
        }),
      });
      const body = await readApi<{ preferences: Pick<PublicRatingPreferences,
        "displayPreference" | "botMatchPreference" | "preferenceRevision"> }>(response);
      setPreferences((current) => current ? { ...current, ...body.preferences } : current);
      setSaveStatus(copy.preferencesSaved);
    } catch (requestError) {
      setSaveStatus(localizedApiError(dictionary, requestError, copy.preferencesFailed));
    } finally {
      setSaving(false);
    }
  };

  const profileStatus = (
    <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
      {loading || !loaded ? copy.loading : copy.loadComplete}
    </p>
  );
  if (loading || !loaded) return <>{profileStatus}<div aria-hidden="true" className="profile-loading">{copy.loading}</div></>;
  if (!user) {
    return <>{profileStatus}<section className="profile-guest">
      <span className="profile-avatar"><UserRoundPlus size={34} /></span>
      <h1>{copy.guestTitle}</h1><p>{copy.guestDescription}</p>
      <div><Link className="button button--primary button--lg" href={href("/register")}>{copy.createAccount}</Link>
      <Link className="button button--secondary button--lg" href={href("/login")}><LogIn size={18} /> {copy.login}</Link></div>
    </section></>;
  }

  const recentForm = recentGames.slice(0, 10);
  const change = rating?.ratingChange30Days ?? 0;
  return <>
    {profileStatus}
    <header className="profile-header">
      <span className="profile-avatar">{user.displayName.slice(0, 2).toUpperCase()}</span>
      <div><span className="section-kicker">{copy.playerProfile}</span><h1>{user.displayName}</h1><p>@{user.username}</p></div>
      <Link className="button button--primary" href={href("/play")}><Gamepad2 size={18} /> {copy.play}</Link>
    </header>
    {error ? <div className="profile-error" role="alert">{error}</div> : null}

    {rating && preferences ? <>
      <section aria-label={copy.ratingsLabel} className="rating-grid rating-grid--global">
        <article className="rating-card rating-card--selected">
          <span>{copy.globalRating}</span>
          <RatingLabel rating={rating.rating} preference={preferences.displayPreference} locale={locale} />
          <small>{rating.isProvisional ? copy.provisional : copy.established} · {rating.ratedGameCount} {copy.games}</small>
          <RatingDetails
            labels={{
              algorithm: copy.ratingAlgorithm,
              ratingDeviation: copy.ratingDeviation,
              ratedGames: copy.ratedGames,
              volatility: copy.ratingVolatility,
            }}
            rating={rating}
            summary={copy.ratingDetails}
          />
        </article>
        <fieldset className="rating-preferences">
          <legend>{copy.ratingPreferences}</legend>
          <label>{copy.displayPreference}
            <select value={preferences.displayPreference} onChange={(event) => setPreferences({ ...preferences, displayPreference: event.target.value as RatingDisplayPreference })}>
              <option value="both">{copy.displayBoth}</option>
              <option value="rank-primary">{copy.displayRank}</option>
              <option value="rating-primary">{copy.displayNumber}</option>
            </select>
          </label>
          <label>{copy.botPreference}
            <select value={preferences.botMatchPreference} onChange={(event) => setPreferences({ ...preferences, botMatchPreference: event.target.value as BotMatchPreference })}>
              <option value="never">{copy.botNever}</option>
              <option value="calibrated-rated-after-wait">{copy.botCalibrated}</option>
            </select>
          </label>
          <p>{copy.botCalibrationNotice}</p>
          <button className="button button--secondary" disabled={saving} onClick={() => void savePreferences()} type="button">{saving ? copy.saving : copy.savePreferences}</button>
          <span aria-live="polite" role="status">{saveStatus}</span>
        </fieldset>
      </section>

      <section className="profile-statistics">
        <div className="profile-statistics__heading"><div><span className="section-kicker">{copy.globalPerformance}</span><h2>{copy.ratingOverTime}</h2></div><div className="profile-period">{copy.last30Days}</div></div>
        <div className="profile-metrics">
          <article><Activity size={18} /><span>{copy.currentRating}</span><RatingLabel rating={rating.rating} preference={preferences.displayPreference} locale={locale} /></article>
          <article><Trophy size={18} /><span>{copy.personalBest}</span><RatingLabel rating={rating.highestRating} preference={preferences.displayPreference} locale={locale} /></article>
          <article>{change > 0 ? <ArrowUpRight size={18} /> : change < 0 ? <ArrowDownRight size={18} /> : <Minus size={18} />}<span>{copy.ratingChange}</span><strong className={change > 0 ? "is-positive" : change < 0 ? "is-negative" : ""}>{signedRating(change)}</strong></article>
          <article><CalendarDays size={18} /><span>{copy.recentForm}</span><div className="recent-form" aria-label={copy.recentFormLabel}>{recentForm.length ? recentForm.map((game) => <i className={`result-dot result-dot--${game.result}`} key={game.gameId}>{game.result === "win" ? copy.winShort : game.result === "loss" ? copy.lossShort : game.result === "draw" ? copy.drawShort : copy.noResultShort}</i>) : <strong>—</strong>}</div></article>
        </div>
        <RatingHistoryChart currentRating={rating.rating} history={history} preference={preferences.displayPreference} />
      </section>
    </> : null}

    <section className="profile-history" id="game-history">
      <div className="profile-history__heading"><div><span className="section-kicker">{copy.history}</span><h2>{copy.recentGames}</h2></div><span>{recentGames.length} {copy.shown}</span></div>
      {recentGames.length ? <div className="profile-history__list">{recentGames.slice(0, 12).map((game) => {
        const resultLabel = game.result === "win" ? copy.victory : game.result === "loss" ? copy.defeat : game.result === "draw" ? copy.draw : copy.noResult;
        const presented = getRecentGameRatingPresentation(game);
        const label = presented.kind === "unrated" ? copy.unrated : presented.kind === "rated" ? copy.rated : signedRating(presented.value);
        return <Link className="history-game" href={href(`/game/${game.gameId}`)} key={game.gameId}>
          <span className={`history-game__result history-game__result--${game.result}`}>{game.result === "win" ? copy.winShort : game.result === "loss" ? copy.lossShort : game.result === "draw" ? copy.drawShort : copy.noResultShort}</span>
          <div><strong>{resultLabel} {copy.versus} {game.opponentName}{game.opponentIsBot ? ` · ${copy.botBadge}` : ""}</strong><span>{formatDate(game.finishedAt, locale)} · {game.boardSize}×{game.boardSize} · {dictionary.timeControls[game.timeControl].name} · {game.gameResult ?? copy.completed}</span></div>
          <strong className={presented.kind === "change" && presented.value > 0 ? "is-positive" : presented.kind === "change" && presented.value < 0 ? "is-negative" : ""}>{label}</strong>
        </Link>;
      })}</div> : <div className="profile-history__empty">{copy.historyEmptyPrefix} {copy.historyEmptySuffix}</div>}
    </section>
  </>;
}
