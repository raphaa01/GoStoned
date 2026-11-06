"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ArrowLeft, Check, Copy, Trophy } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { GoBoard } from "@/components/game/GoBoard";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { ApiRequestError, readApi } from "@/lib/client/api";
import { getTournamentsCopy } from "@/lib/i18n/tournaments";
import { CATEGORY_LABELS, MONTHLY_GAMES } from "@/lib/tournaments/policy";
import { TIME_CONTROLS } from "@/lib/game/timeControls";
import type { GameState } from "@/lib/game/types";
import type { FriendSummary, FriendsDashboard } from "@/lib/friends/types";
import type {
  Tournament,
  TournamentDashboard,
  TournamentDetail,
  TournamentSettings,
} from "@/lib/tournaments/types";
import { ClassicRegistration, ClassicSchedule } from "./ClassicRegistration";
import "./tournaments.css";

const DEFAULT_SETTINGS: TournamentSettings = {
  name: "",
  boardSize: 13,
  timeControl: "rapid",
  maxPlayers: 8,
  format: "round_robin",
};
type CopyText = ReturnType<typeof getTournamentsCopy>;
function errorText(error: unknown, copy: CopyText): string {
  return error instanceof ApiRequestError && error.code && error.code in copy
    ? copy[error.code as keyof CopyText]
    : copy.error;
}
function dateRange(t: Tournament, locale: string) {
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return `${date.format(new Date(t.startsAt))} – ${date.format(new Date(new Date(t.endsAt!).getTime() - 1))} · UTC`;
}

function SettingsForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
}: {
  initial: TournamentSettings;
  submitLabel: string;
  busy: boolean;
  onSubmit: (settings: TournamentSettings) => void;
}) {
  const { locale } = useI18n();
  const copy = getTournamentsCopy(locale);
  const [value, setValue] = useState(initial);
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(value);
  }
  return (
    <form className="tournament-settings" onSubmit={submit}>
      <label className="tournament-settings__name">
        {copy.name}
        <input
          required
          maxLength={60}
          value={value.name}
          onChange={(e) => setValue({ ...value, name: e.target.value })}
        />
      </label>
      <label>
        {copy.board}
        <select
          value={value.boardSize}
          onChange={(e) =>
            setValue({
              ...value,
              boardSize: Number(
                e.target.value,
              ) as TournamentSettings["boardSize"],
            })
          }
        >
          {[9, 13, 19].map((n) => (
            <option key={n} value={n}>
              {n}×{n}
            </option>
          ))}
        </select>
      </label>
      <label>
        {copy.time}
        <select
          value={value.timeControl}
          onChange={(e) =>
            setValue({
              ...value,
              timeControl: e.target.value as TournamentSettings["timeControl"],
            })
          }
        >
          {TIME_CONTROLS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.shortLabel}
            </option>
          ))}
        </select>
      </label>
      <label>
        {copy.capacity}
        <input
          type="number"
          required
          min={2}
          max={32}
          value={value.maxPlayers}
          onChange={(e) =>
            setValue({ ...value, maxPlayers: Number(e.target.value) })
          }
        />
      </label>
      <label>
        {copy.format}
        <select
          value={value.format}
          onChange={(e) =>
            setValue({
              ...value,
              format: e.target.value as TournamentSettings["format"],
            })
          }
        >
          <option value="round_robin">{copy.round_robin}</option>
          <option value="knockout">{copy.knockout}</option>
        </select>
      </label>
      <Button disabled={busy} type="submit">
        {submitLabel}
      </Button>
    </form>
  );
}

export function TournamentHub({ id }: { id?: string }) {
  const { user } = useAuth();
  return (
    <TournamentHubBody
      key={`${user?.playerKey ?? "none"}:${id ?? "index"}`}
      id={id}
    />
  );
}

function TournamentHubBody({ id }: { id?: string }) {
  const { user } = useAuth();
  const { locale, href } = useI18n();
  const router = useRouter();
  const copy = getTournamentsCopy(locale);
  const [dashboard, setDashboard] = useState<TournamentDashboard | null>(null);
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [friends, setFriends] = useState<FriendSummary[] | null>(null);
  const [invited, setInvited] = useState<string[]>([]);
  const [watchId, setWatchId] = useState<string | null>(null);
  const [watchGame, setWatchGame] = useState<GameState | null>(null);
  const [now, setNow] = useState(Date.now);
  const mutation = useRef(false);
  const identity = user?.playerKey;
  const identityRef = useRef(identity);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);
  const headers = useCallback(
    () => (identity ? { [EXPECTED_PLAYER_HEADER]: identity } : undefined),
    [identity],
  );
  const load = useCallback(async () => {
    if (!identity) return;
    const result = await fetch(
      `/api/tournaments${id ? `?id=${encodeURIComponent(id)}` : ""}`,
      { cache: "no-store", headers: headers() },
    ).then(
      readApi<{ dashboard?: TournamentDashboard; detail?: TournamentDetail }>,
    );
    if (identityRef.current !== identity) return;
    if (result.detail) setDetail(result.detail);
    if (result.dashboard) setDashboard(result.dashboard);
    setError(null);
  }, [id, identity, headers, setError]);
  const post = useCallback(
    async (body: Record<string, unknown>) => {
      return fetch("/api/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify(body),
      }).then(readApi<{ id?: string; gameId?: string | null }>);
    },
    [headers],
  );
  useEffect(() => {
    let stopped = false;
    let pending = false;
    const refresh = async () => {
      if (pending || document.hidden || mutation.current) return;
      pending = true;
      try {
        await load();
      } catch (e) {
        if (!stopped) setError(e);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), id ? 3000 : 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, id]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!waiting || !id) return;
    let pending = false;
    const renew = async () => {
      if (pending || document.hidden || mutation.current) return;
      pending = true;
      try {
        await post({ action: "queue", id, waiting: true });
        await load();
      } catch (e) {
        setWaiting(false);
        setError(e);
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => void renew(), 10000);
    return () => clearInterval(timer);
  }, [waiting, id, post, load]);
  const ownMatch = detail?.matches.find(
    (m) =>
      (m.blackId === detail.userId || m.whiteId === detail.userId) &&
      (m.status === "playing" || (m.status === "pending" && m.readyDeadline)),
  );
  const pendingReadyId = ownMatch?.status === "pending" ? ownMatch.id : null;
  useEffect(() => {
    if (!pendingReadyId) return;
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`tournament-ready-${pendingReadyId}`)
        ?.scrollIntoView({
          block: "center",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingReadyId]);
  useEffect(() => {
    if (ownMatch) {
      if (ownMatch.gameId && ownMatch.status === "playing")
        router.replace(href(`/game/${ownMatch.gameId}`));
    }
  }, [ownMatch, router, href]);
  useEffect(() => {
    if (!watchId) return;
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const result = await fetch(
          `/api/tournaments?view=watch&gameId=${encodeURIComponent(watchId)}`,
          { cache: "no-store", headers: headers(), signal: controller.signal },
        ).then(readApi<{ game: GameState }>);
        setWatchGame(result.game);
      } catch (e) {
        if (!controller.signal.aborted) setError(e);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [watchId, headers]);
  async function act(
    body: Record<string, unknown>,
    options: { navigate?: boolean; queue?: boolean } = {},
  ) {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await post(body);
      if (identityRef.current !== identity) return;
      if (options.queue !== undefined) setWaiting(options.queue);
      if (result.gameId) router.push(href(`/game/${result.gameId}`));
      else if (options.navigate && result.id)
        router.push(href(`/tournaments/${result.id}`));
      else await load();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  function eventRow(t: Tournament) {
    return (
      <Link
        className="tournament-row"
        href={href(`/tournaments/${t.id}`)}
        key={t.id}
      >
        <span>
          <strong>{t.name}</strong>
          <small>
            {t.boardSize}×{t.boardSize} · {copy[t.format]} · {t.memberCount}{" "}
            {copy.capacity.toLocaleLowerCase(locale)}
          </small>
        </span>
        <span className="tournament-state" data-state={t.status}>
          {copy[t.status]}
        </span>
      </Link>
    );
  }
  const errorNotice = error ? (
    <p className="tournament-error" role="alert">
      {errorText(error, copy)}{" "}
      <button type="button" onClick={() => void load().catch(setError)}>
        {copy.retry}
      </button>
    </p>
  ) : null;
  if (!dashboard && !detail)
    return (
      <section className="tournaments">
        <h1>{copy.title}</h1>
        {errorNotice ?? <p role="status">{copy.loading}</p>}
      </section>
    );
  if (!id && dashboard) {
    const monthly = dashboard.monthly.find(
      (t) => t.category === dashboard.category && t.monthlyMode === "rapid",
    );
    const joinedMonthly = dashboard.mine.find(
      (t) =>
        t.kind === "monthly" &&
        t.month === monthly?.month &&
        t.monthlyMode === "rapid",
    );
    const classic = dashboard.monthly.filter(
      (t) => t.category === dashboard.category && t.monthlyMode === "classic",
    );
    const joinedClassic = dashboard.mine.find(
      (t) =>
        t.kind === "monthly" &&
        t.month === monthly?.month &&
        t.monthlyMode === "classic",
    );
    return (
      <section className="tournaments">
        <header className="tournament-heading">
          <h1>{copy.title}</h1>
        </header>
        {errorNotice}
        {!dashboard.eligible ? (
          <div className="tournament-qualification">
            <h2>{copy.requirement}</h2>
            <p>
              {dashboard.ratedGames} / 10 {copy.progress}
            </p>
            <progress max={10} value={dashboard.ratedGames} />
          </div>
        ) : (
          <>
            <section className="tournament-monthly">
              <div>
                <span className="section-kicker">{copy.rapid}</span>
                <h2>
                  {new Intl.DateTimeFormat(locale, {
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(now)}
                </h2>
                <p>{copy.monthlyRules}</p>
                {monthly ? (
                  <p>
                    {dateRange(monthly, locale)} ·{" "}
                    {
                      CATEGORY_LABELS[
                        joinedMonthly?.category ?? dashboard.category
                      ]
                    }
                  </p>
                ) : null}
              </div>
              {joinedMonthly ? (
                <Link
                  className="button button--primary"
                  href={href(`/tournaments/${joinedMonthly.id}`)}
                >
                  {copy.view}
                </Link>
              ) : monthly ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act(
                      { action: "join", id: monthly.id },
                      { navigate: true },
                    )
                  }
                >
                  {copy.join}
                </Button>
              ) : null}
              <details className="tournament-rules">
                <summary>{copy.format}</summary>
                <p>{copy.monthlyDetails}</p>
              </details>
            </section>
            <section className="tournament-monthly">
              <div>
                <h2>{copy.classic}</h2>
                <p>{copy.classicRules}</p>
              </div>
              {joinedClassic ? (
                <Link
                  className="button button--primary"
                  href={href(`/tournaments/${joinedClassic.id}`)}
                >
                  {copy.view}
                </Link>
              ) : !dashboard.classicEligible ? (
                <p>{copy.tournament_classic_rank_required}</p>
              ) : dashboard.classicBlockedMonth ? (
                <p>{copy.tournament_classic_suspended}</p>
              ) : (
                <ClassicRegistration
                  events={classic}
                  busy={busy}
                  now={now}
                  onJoin={(id) =>
                    void act(
                      { action: "join", id, acceptSchedule: true },
                      { navigate: true },
                    )
                  }
                />
              )}
              <p>{copy.classicMinimum}</p>
              <details className="tournament-rules">
                <summary>{copy.format}</summary>
                <p>{copy.classicDetails}</p>
              </details>
            </section>
            <section className="tournament-private">
              <header className="tournament-heading">
                <h2>{copy.private}</h2>
                <Button
                  disabled={!dashboard.canHost}
                  variant="secondary"
                  title={!dashboard.canHost ? copy.premium : undefined}
                  onClick={() => setCreating(!creating)}
                >
                  {copy.create}
                </Button>
              </header>
              <form
                className="tournament-code"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act({ action: "joinCode", code }, { navigate: true });
                }}
              >
                <input
                  aria-label={copy.code}
                  placeholder={copy.code}
                  autoCapitalize="characters"
                  autoComplete="off"
                  maxLength={10}
                  minLength={10}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
                <Button type="submit" disabled={busy} variant="secondary">
                  {copy.enterCode}
                </Button>
              </form>
              {creating ? (
                <SettingsForm
                  initial={DEFAULT_SETTINGS}
                  submitLabel={copy.create}
                  busy={busy}
                  onSubmit={(settings) =>
                    void act(
                      { action: "create", ...settings },
                      { navigate: true },
                    )
                  }
                />
              ) : null}
              {dashboard.mine.filter((t) => t.kind === "private").map(eventRow)}
              {!dashboard.mine.some((t) => t.kind === "private") ? (
                <p className="tournament-empty">{copy.noEvents}</p>
              ) : null}
            </section>
            {dashboard.invitations.length ? (
              <section>
                <h2>{copy.invites}</h2>
                {dashboard.invitations.map((t) => (
                  <div className="tournament-row" key={t.id}>
                    <strong>{t.name}</strong>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void act(
                          { action: "join", id: t.id },
                          { navigate: true },
                        )
                      }
                    >
                      {copy.join}
                    </Button>
                  </div>
                ))}
              </section>
            ) : null}
            {dashboard.mine.some(
              (t) =>
                t.kind === "monthly" &&
                t.id !== joinedMonthly?.id &&
                t.id !== joinedClassic?.id,
            ) ? (
              <section>
                <h2>{copy.monthly}</h2>
                {dashboard.mine
                  .filter(
                    (t) =>
                      t.kind === "monthly" &&
                      t.id !== joinedMonthly?.id &&
                      t.id !== joinedClassic?.id,
                  )
                  .map(eventRow)}
              </section>
            ) : null}
          </>
        )}
      </section>
    );
  }
  if (!detail)
    return (
      <section className="tournaments">{errorNotice ?? copy.loading}</section>
    );
  const t = detail.tournament;
  const own = detail.standings.find((r) => r.userId === detail.userId);
  const isHost = t.hostId === detail.userId;
  const ready =
    ownMatch &&
    (ownMatch.blackId === detail.userId
      ? ownMatch.blackReady
      : ownMatch.whiteReady);
  const remaining = ownMatch?.readyDeadline
    ? Math.max(
        0,
        Math.ceil((new Date(ownMatch.readyDeadline).getTime() - now) / 1000),
      )
    : 0;
  const settings: TournamentSettings = {
    name: t.name,
    boardSize: t.boardSize,
    timeControl: t.timeControl,
    maxPlayers: t.maxPlayers,
    format: t.format === "knockout" ? "knockout" : "round_robin",
  };
  return (
    <section className="tournaments">
      <Link className="tournament-back" href={href("/tournaments")}>
        <ArrowLeft size={16} />
        {copy.back}
      </Link>
      <header className="tournament-heading">
        <div>
          <h1>{t.name}</h1>
          <p>
            {t.boardSize}×{t.boardSize} ·{" "}
            {t.monthlyMode === "classic"
              ? copy.classicTime
              : TIME_CONTROLS.find((v) => v.id === t.timeControl)
                  ?.shortLabel}{" "}
            · {copy[t.format]} ·{" "}
            {t.kind === "private" ? copy.unranked : copy.rated}
          </p>
        </div>
        <span className="tournament-state" data-state={t.status}>
          {copy[t.status]}
        </span>
      </header>
      {errorNotice}
      {t.kind === "monthly" ? (
        <div className="tournament-meta">
          <span>
            {CATEGORY_LABELS[t.category!]} · {copy.group} {detail.group} ·{" "}
            {dateRange(t, locale)}
          </span>
          <span>
            {own?.played ?? 0} / {MONTHLY_GAMES} {copy.games}
          </span>
          <details className="tournament-rules">
            <summary>{copy.format}</summary>
            <p>
              {t.monthlyMode === "classic"
                ? copy.classicDetails
                : copy.monthlyDetails}
            </p>
          </details>
        </div>
      ) : null}
      {t.monthlyMode === "classic" ? (
        <>
          <ClassicSchedule dates={detail.schedule} />
          {detail.withdrawn ? (
            <p role="status">{copy.withdrawn}</p>
          ) : detail.noShows > 0 ? (
            <p role="status">{copy.firstNoShow}</p>
          ) : null}
          {t.status === "cancelled" ? <p>{copy.classicCancelled}</p> : null}
          {detail.joined && t.status === "lobby" ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void act({ action: "leave", id: t.id })}
            >
              {copy.leave}
            </Button>
          ) : null}
        </>
      ) : null}
      {ownMatch?.status === "pending" ? (
        <section
          className="tournament-ready"
          id={`tournament-ready-${ownMatch.id}`}
          aria-live="polite"
        >
          <div>
            <strong>{copy.newPairing}</strong>
            <p>
              {ownMatch.blackName} — {ownMatch.whiteName}
            </p>
            <span>
              {copy.readyWindow} {remaining}
              {copy.seconds}
            </span>
          </div>
          <Button
            disabled={busy || Boolean(ready) || remaining === 0}
            onClick={() =>
              void act({ action: "ready", id: t.id, matchId: ownMatch.id })
            }
          >
            {ready ? (
              <>
                <Check size={16} />
                {copy.waitingReady}
              </>
            ) : (
              copy.ready
            )}
          </Button>
        </section>
      ) : null}
      {t.kind === "monthly" &&
      t.monthlyMode === "rapid" &&
      t.status === "running" &&
      !ownMatch &&
      detail.joined ? (
        <div className="tournament-search">
          {(own?.played ?? 0) >= MONTHLY_GAMES ? (
            <p>{copy.completed}</p>
          ) : (
            <>
              <Button
                disabled={busy}
                variant={waiting ? "secondary" : "primary"}
                onClick={() =>
                  void act(
                    { action: "queue", id: t.id, waiting: !waiting },
                    { queue: !waiting },
                  )
                }
              >
                {waiting ? copy.stop : copy.findGame}
              </Button>
              <span role="status">{waiting ? copy.searching : null}</span>
              {waiting ? <small>{copy.opponentGone}</small> : null}
            </>
          )}
        </div>
      ) : null}
      {!detail.joined &&
      t.kind === "monthly" &&
      ["lobby", "running"].includes(t.status) ? (
        t.monthlyMode === "classic" ? (
          <ClassicRegistration
            events={[t]}
            busy={busy}
            now={now}
            onJoin={(id) =>
              void act({ action: "join", id, acceptSchedule: true })
            }
          />
        ) : (
          <Button
            disabled={busy}
            onClick={() => void act({ action: "join", id: t.id })}
          >
            {copy.join}
          </Button>
        )
      ) : null}
      {t.kind === "private" && t.status === "lobby" ? (
        <section className="tournament-lobby">
          <div className="tournament-heading">
            <div className="tournament-invite-code">
              <span>{copy.code}</span>
              <strong>{t.code}</strong>
              <button
                aria-label={copy.copy}
                title={copied ? copy.copied : copy.copy}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(t.code!)
                    .then(() => setCopied(true))
                    .catch(setError);
                }}
                type="button"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <span>
              {t.memberCount} / {t.maxPlayers}
            </span>
          </div>
          {isHost ? (
            <>
              <SettingsForm
                key={`${t.name}:${t.boardSize}:${t.timeControl}:${t.maxPlayers}:${t.format}`}
                initial={settings}
                busy={busy}
                submitLabel={copy.save}
                onSubmit={(v) =>
                  void act({ action: "settings", id: t.id, ...v })
                }
              />
              <div className="tournament-actions">
                <Button
                  disabled={busy || t.memberCount < 2}
                  onClick={() => void act({ action: "start", id: t.id })}
                >
                  {copy.start}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    void fetch("/api/friends", {
                      cache: "no-store",
                      headers: headers(),
                    })
                      .then(readApi<{ dashboard: FriendsDashboard }>)
                      .then((r) => setFriends(r.dashboard.friends))
                      .catch(setError);
                  }}
                >
                  {copy.invite}
                </Button>
              </div>
              {friends ? (
                <div className="tournament-friends">
                  {friends
                    .filter(
                      (f) =>
                        !detail.standings.some((s) => s.userId === f.userId),
                    )
                    .map((f) => (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || invited.includes(f.userId)}
                        key={f.userId}
                        onClick={() => {
                          void act({
                            action: "invite",
                            id: t.id,
                            friendId: f.userId,
                          }).then((ok) => {
                            if (ok) setInvited((v) => [...v, f.userId]);
                          });
                        }}
                      >
                        {f.displayName}
                        {invited.includes(f.userId)
                          ? ` · ${copy.inviteSent}`
                          : ""}
                      </Button>
                    ))}
                </div>
              ) : null}
            </>
          ) : null}
          <button
            className="tournament-text-button"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(isHost ? copy.cancelConfirm : copy.leaveConfirm)
              ) {
                void post({ action: "leave", id: t.id })
                  .then(() => router.push(href("/tournaments")))
                  .catch(setError);
              }
            }}
            type="button"
          >
            {isHost ? copy.cancel : copy.leave}
          </button>
        </section>
      ) : null}
      {t.status === "finished" && own ? (
        <div className="tournament-result">
          <Trophy aria-hidden="true" size={24} />
          <strong>
            #{own.place} · {own.points} {copy.points}
          </strong>
          <span>
            {own.wins} {copy.wins} · {own.losses} {copy.losses} · {own.draws}{" "}
            {copy.draws}
          </span>
        </div>
      ) : null}
      <section className="tournament-standings">
        <h2>{copy.standings}</h2>
        <div className="tournament-table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{copy.player}</th>
                <th scope="col">{copy.points}</th>
                <th scope="col">{copy.wins}</th>
                <th scope="col">{copy.losses}</th>
                <th scope="col">{copy.draws}</th>
                <th scope="col">{copy.games}</th>
                <th scope="col" title={copy.tiebreak}>
                  {copy.tiebreak}
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.standings.map((p) => (
                <tr key={p.userId} data-self={p.userId === detail.userId}>
                  <td>{p.place}</td>
                  <th scope="row">
                    {p.name}
                    {p.userId === t.hostId ? <small>{copy.host}</small> : null}
                  </th>
                  <td>{p.points}</td>
                  <td>{p.wins}</td>
                  <td>{p.losses}</td>
                  <td>{p.draws}</td>
                  <td>{p.played}</td>
                  <td>{p.tiebreak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!detail.standings.length ? (
          <p className="tournament-empty">{copy.noPlayers}</p>
        ) : null}
      </section>
      {watchId ? (
        <section className="tournament-watch">
          <header className="tournament-heading">
            <h2>{copy.watch}</h2>
            <Button
              variant="ghost"
              onClick={() => {
                setWatchId(null);
                setWatchGame(null);
              }}
            >
              {copy.backLobby}
            </Button>
          </header>
          {watchGame?.id === watchId ? (
            <>
              <p>
                {watchGame.blackPlayerName} — {watchGame.whitePlayerName}
                {watchGame.result ? ` · ${watchGame.result}` : ""}
              </p>
              <GoBoard
                boardSize={watchGame.boardSize}
                boardState={watchGame.board}
                onIntersectionClick={() => undefined}
                disabled
                precisionRevision={`${watchGame.id}:${watchGame.version}`}
                deadStones={watchGame.scoring?.deadStones}
                territory={watchGame.scoring?.territory}
              />
            </>
          ) : (
            <p role="status">{copy.loading}</p>
          )}
        </section>
      ) : null}
      <section>
        <h2>
          {copy.matches}
          {t.round ? ` · ${copy.round} ${t.round}` : ""}
        </h2>
        {detail.matches.map((m) => (
          <div className="tournament-row" key={m.id}>
            <span>
              <strong>
                {m.blackName} — {m.whiteName}
              </strong>
              <small>
                {copy.round} {m.round}
                {m.result
                  ? ` · ${m.result === "forfeit" ? copy.forfeit : m.result === "no_show" ? copy.no_show : m.result === "bye" ? copy.bye : m.result === "deadline" ? copy.deadlineResult : m.result}`
                  : ""}
              </small>
            </span>
            {m.gameId ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setWatchGame(null);
                  setWatchId(m.gameId);
                }}
              >
                {copy.watch}
              </Button>
            ) : null}
          </div>
        ))}
        {!detail.matches.length ? (
          <p className="tournament-empty">{copy.noMatches}</p>
        ) : null}
      </section>
    </section>
  );
}
