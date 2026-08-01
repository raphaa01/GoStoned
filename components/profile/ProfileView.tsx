"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Gamepad2,
  LogIn,
  Minus,
  Pencil,
  Trophy,
  UserRoundPlus,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { RatingHistoryChart } from "@/components/profile/RatingHistoryChart";
import { RatingLabel } from "@/components/rating/RatingLabel";
import { readApi } from "@/lib/client/api";
import type { Locale } from "@/lib/i18n/config";
import { localizedApiError } from "@/lib/i18n/dictionary";
import {
  DEFAULT_PROFILE_AVATAR_STYLE,
  type ProfileAvatarStyle,
} from "@/lib/profileAvatar";
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
  const { user, loading, refresh } = useAuth();
  const { dictionary, href, locale } = useI18n();
  const copy = dictionary.profile;
  const [rating, setRating] = useState<GlobalRatingSummary | null>(null);
  const [preferences, setPreferences] = useState<PublicRatingPreferences | null>(null);
  const [history, setHistory] = useState<RatingHistoryEntry[]>([]);
  const [recentGames, setRecentGames] = useState<RecentGame[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [selectedAvatarStyle, setSelectedAvatarStyle] = useState<ProfileAvatarStyle>(DEFAULT_PROFILE_AVATAR_STYLE);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState<string | null>(null);
  const avatarPickerId = useId();
  const avatarPickerTitleId = useId();
  const avatarTriggerRef = useRef<HTMLButtonElement>(null);
  const firstAvatarOptionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!avatarPickerOpen) return;
    const frame = window.requestAnimationFrame(() => firstAvatarOptionRef.current?.focus());
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSelectedAvatarStyle(user?.avatarStyle ?? DEFAULT_PROFILE_AVATAR_STYLE);
      setAvatarPickerOpen(false);
      avatarTriggerRef.current?.focus();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [avatarPickerOpen, user?.avatarStyle]);

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

  const saveAvatar = async () => {
    if (!user || avatarSaving || selectedAvatarStyle === user.avatarStyle) return;
    setAvatarSaving(true);
    setAvatarStatus(null);
    try {
      const response = await fetch("/api/profile/avatar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarStyle: selectedAvatarStyle }),
      });
      const body = await readApi<{ avatarStyle: ProfileAvatarStyle }>(response);
      setSelectedAvatarStyle(body.avatarStyle);
      await refresh({ silent: true });
      setAvatarPickerOpen(false);
      setAvatarStatus(copy.avatarSaved);
      avatarTriggerRef.current?.focus();
    } catch (requestError) {
      setAvatarStatus(localizedApiError(dictionary, requestError, copy.avatarSaveFailed));
    } finally {
      setAvatarSaving(false);
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
  const hasDistinctHandle = user.displayName.trim().toLocaleLowerCase()
    !== user.username.trim().toLocaleLowerCase();
  return <>
    {profileStatus}
    <header className="profile-header">
      <div className="profile-header__primary">
        <button
          aria-controls={avatarPickerId}
          aria-expanded={avatarPickerOpen}
          aria-label={copy.changeAvatar}
          className="profile-avatar-trigger"
          onClick={() => {
            setAvatarStatus(null);
            setSelectedAvatarStyle(user.avatarStyle);
            setAvatarPickerOpen((current) => !current);
          }}
          ref={avatarTriggerRef}
          type="button"
        >
          <ProfileAvatar size="lg" style={user.avatarStyle} />
          <span aria-hidden="true" className="profile-avatar-trigger__edit"><Pencil size={12} strokeWidth={2.2} /></span>
        </button>
        <div className="profile-header__identity">
          <span className="section-kicker">{copy.playerProfile}</span>
          <h1>{user.displayName}</h1>
          {hasDistinctHandle ? <p className="profile-header__handle">@{user.username}</p> : null}
        </div>
      </div>
      <div className="profile-header__actions">
        <Link className="button button--primary" href={href("/play")}><Gamepad2 size={18} /> {copy.play}</Link>
      </div>
    </header>
    <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">{avatarStatus}</span>
    {avatarPickerOpen ? (
      <section aria-labelledby={avatarPickerTitleId} className="profile-avatar-picker" id={avatarPickerId}>
        <div className="profile-avatar-picker__heading">
          <span className="section-kicker">{copy.changeAvatar}</span>
          <h2 id={avatarPickerTitleId}>{copy.avatarPickerTitle}</h2>
          <p>{copy.avatarPickerDescription}</p>
        </div>
        <fieldset className="profile-avatar-options">
          <legend className="sr-only">{copy.avatarPickerTitle}</legend>
          <label className="profile-avatar-option">
            <input
              checked={selectedAvatarStyle === "kifu-classic"}
              name="profile-avatar-style"
              onChange={() => setSelectedAvatarStyle("kifu-classic")}
              ref={firstAvatarOptionRef}
              type="radio"
              value="kifu-classic"
            />
            <ProfileAvatar size="md" style="kifu-classic" />
            <span className="profile-avatar-option__copy"><strong>{copy.avatarKifuName}</strong><small>{copy.avatarKifuDescription}</small></span>
          </label>
          <label className="profile-avatar-option">
            <input
              checked={selectedAvatarStyle === "urushi-mon"}
              name="profile-avatar-style"
              onChange={() => setSelectedAvatarStyle("urushi-mon")}
              type="radio"
              value="urushi-mon"
            />
            <ProfileAvatar size="md" style="urushi-mon" />
            <span className="profile-avatar-option__copy"><strong>{copy.avatarUrushiName}</strong><small>{copy.avatarUrushiDescription}</small></span>
          </label>
        </fieldset>
        <div className="profile-avatar-picker__actions">
          <button
            className="button button--primary"
            disabled={avatarSaving || selectedAvatarStyle === user.avatarStyle}
            onClick={() => void saveAvatar()}
            type="button"
          >
            {avatarSaving ? copy.avatarSaving : copy.saveAvatar}
          </button>
          <button
            className="button button--secondary"
            disabled={avatarSaving}
            onClick={() => {
              setSelectedAvatarStyle(user.avatarStyle);
              setAvatarPickerOpen(false);
              setAvatarStatus(null);
              avatarTriggerRef.current?.focus();
            }}
            type="button"
          >
            {copy.cancelAvatar}
          </button>
          <span aria-live="polite" className="profile-avatar-picker__status" role="status">{avatarStatus}</span>
        </div>
      </section>
    ) : null}
    {error ? <div className="profile-error" role="alert">{error}</div> : null}

    {rating && preferences ? <>
      <section aria-label={copy.ratingsLabel} className="profile-performance">
        <div className="profile-performance__main">
          <article className="profile-rating-band">
            <span className="profile-rating-band__eyebrow"><Activity aria-hidden="true" size={16} /> {copy.globalRating}</span>
            <RatingLabel
              locale={locale}
              preference={preferences.displayPreference}
              rating={rating.rating}
              variant="hero"
            />
            <p>{rating.ratedGameCount} {copy.games}</p>
            <strong className={change > 0 ? "is-positive" : change < 0 ? "is-negative" : ""}>
              {signedRating(change)} <small>{copy.last30Days}</small>
            </strong>
          </article>
          <div className="profile-rating-plot">
            <header>
              <div><span className="section-kicker">{copy.globalPerformance}</span><h2>{copy.ratingOverTime}</h2></div>
              <span className="profile-period">{copy.last30Days}</span>
            </header>
            <RatingHistoryChart currentRating={rating.rating} history={history} preference={preferences.displayPreference} />
          </div>
        </div>
        <div className="profile-metrics">
          <article><Trophy size={18} /><span>{copy.personalBest}</span><RatingLabel rating={rating.highestRating} preference={preferences.displayPreference} locale={locale} /></article>
          <article>{change > 0 ? <ArrowUpRight size={18} /> : change < 0 ? <ArrowDownRight size={18} /> : <Minus size={18} />}<span>{copy.ratingChange}</span><strong className={change > 0 ? "is-positive" : change < 0 ? "is-negative" : ""}>{signedRating(change)}</strong></article>
          <article><CalendarDays size={18} /><span>{copy.recentForm}</span><div className="recent-form" aria-label={copy.recentFormLabel}>{recentForm.length ? recentForm.map((game) => <i className={`result-dot result-dot--${game.result}`} key={game.gameId}>{game.result === "win" ? copy.winShort : game.result === "loss" ? copy.lossShort : game.result === "draw" ? copy.drawShort : copy.noResultShort}</i>) : <strong>—</strong>}</div></article>
        </div>
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
          <div><strong>{resultLabel} {copy.versus} {game.opponentName}</strong><span>{formatDate(game.finishedAt, locale)} · {game.boardSize}×{game.boardSize} · {dictionary.timeControls[game.timeControl].name} · {game.gameResult ?? copy.completed}</span></div>
          <strong className={presented.kind === "change" && presented.value > 0 ? "is-positive" : presented.kind === "change" && presented.value < 0 ? "is-negative" : ""}>{label}</strong>
        </Link>;
      })}</div> : <div className="profile-history__empty">{copy.historyEmptyPrefix} {copy.historyEmptySuffix}</div>}
    </section>
  </>;
}
