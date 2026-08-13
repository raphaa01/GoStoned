"use client";

import {
  Check,
  Clock3,
  Gamepad2,
  MessageCircle,
  Search,
  Send,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { Button } from "@/components/ui/Button";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { readApi } from "@/lib/client/api";
import type { BoardSize, TimeControlId } from "@/lib/game/types";
import type {
  FriendGameInvite,
  FriendMessage,
  FriendProfile,
  FriendRequestSummary,
  FriendsDashboard,
  FriendSummary,
  PlayerSearchResult,
} from "@/lib/friends/types";
import { formatFriendsText, getFriendsCopy } from "@/lib/i18n/friends";

type SelectedFriend = Pick<FriendSummary, "friendshipId" | "userId" | "displayName" | "avatarStyle">;

const EMPTY_DASHBOARD: FriendsDashboard = { friends: [], requests: [], invites: [] };

function displayDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
}

export function FriendsHub() {
  const { user } = useAuth();
  const { locale, href, dictionary } = useI18n();
  const copy = getFriendsCopy(locale);
  const router = useRouter();
  const [dashboard, setDashboard] = useState<FriendsDashboard>(EMPTY_DASHBOARD);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PlayerSearchResult[]>([]);
  const [selectedFriend, setSelectedFriend] = useState<SelectedFriend | null>(null);
  const [messages, setMessages] = useState<FriendMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [profile, setProfile] = useState<FriendProfile | null>(null);
  const [inviteFriend, setInviteFriend] = useState<SelectedFriend | null>(null);
  const [boardSize, setBoardSize] = useState<BoardSize>(9);
  const [timeControl, setTimeControl] = useState<TimeControlId>("rapid");
  const chatTitleId = useId();
  const profileTitleId = useId();
  const inviteTitleId = useId();
  const chatInput = useRef<HTMLInputElement>(null);
  const requestGeneration = useRef(0);
  const actorHeader = useMemo<Record<string, string>>(
    () => {
      const headers: Record<string, string> = {};
      if (user) headers[EXPECTED_PLAYER_HEADER] = user.playerKey;
      return headers;
    },
    [user],
  );

  const loadDashboard = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setError(null);
    try {
      const response = await fetch("/api/friends", { cache: "no-store", headers: actorHeader });
      const body = await readApi<{ dashboard: FriendsDashboard }>(response);
      setDashboard(body.dashboard);
      setLoaded(true);
    } catch {
      if (!silent) setError(copy.loadFailed);
    }
  }, [actorHeader, copy.loadFailed, user]);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    async function poll() {
      await loadDashboard(disposed);
      if (!disposed) timer = window.setTimeout(poll, 10_000);
    }
    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadDashboard]);

  useEffect(() => {
    const accepted = dashboard.invites.find((invite) => invite.status === "accepted" && invite.gameId);
    if (!accepted?.gameId) return;
    router.push(href(`/game/${accepted.gameId}`));
  }, [dashboard.invites, href, router]);

  useEffect(() => {
    const term = searchTerm.trim();
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    if (term.length < 2 || !user) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/friends/search?q=${encodeURIComponent(term)}`, {
          cache: "no-store",
          headers: actorHeader,
        });
        const body = await readApi<{ players: PlayerSearchResult[] }>(response);
        if (requestGeneration.current === generation) setSearchResults(body.players);
      } catch {
        if (requestGeneration.current === generation) setError(copy.actionFailed);
      } finally {
        if (requestGeneration.current === generation) setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [actorHeader, copy.actionFailed, searchTerm, user]);

  const loadMessages = useCallback(async (friend: SelectedFriend, silent = false) => {
    try {
      const response = await fetch(`/api/friends/${friend.friendshipId}/messages`, {
        cache: "no-store",
        headers: actorHeader,
      });
      const body = await readApi<{ messages: FriendMessage[] }>(response);
      setMessages(body.messages);
      if (!silent) setError(null);
    } catch {
      if (!silent) setError(copy.actionFailed);
    }
  }, [actorHeader, copy.actionFailed]);

  useEffect(() => {
    if (!selectedFriend) return;
    const friend = selectedFriend;
    let disposed = false;
    let timer: number | undefined;
    async function poll() {
      await loadMessages(friend, disposed);
      if (!disposed) timer = window.setTimeout(poll, 3_000);
    }
    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadMessages, selectedFriend]);

  async function mutate(path: string, method: "POST" | "PATCH" | "DELETE", body?: object) {
    const response = await fetch(path, {
      method,
      headers: {
        ...actorHeader,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return readApi<Record<string, unknown>>(response);
  }

  async function action(key: string, operation: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await operation();
      await loadDashboard(true);
    } catch {
      setError(copy.actionFailed);
    } finally {
      setBusy(null);
    }
  }

  async function addFriend(player: PlayerSearchResult) {
    await action(`add-${player.userId}`, async () => {
      await mutate("/api/friends/requests", "POST", { targetId: player.userId });
      setSearchResults((current) => current.map((candidate) => candidate.userId === player.userId
        ? { ...candidate, friendshipStatus: "outgoing" as const }
        : candidate));
    });
  }

  function changeSearch(value: string) {
    setSearchTerm(value);
    if (value.trim().length >= 2) {
      setSearching(true);
    } else {
      requestGeneration.current += 1;
      setSearchResults([]);
      setSearching(false);
    }
  }

  async function respond(request: FriendRequestSummary, response: "accept" | "decline") {
    await action(`request-${request.friendshipId}`, async () => {
      await mutate(`/api/friends/${request.friendshipId}`, "PATCH", { action: response });
    });
  }

  async function remove(friendshipId: string, confirmRemoval = true) {
    if (confirmRemoval && !window.confirm(copy.removeConfirm)) return;
    await action(`remove-${friendshipId}`, async () => {
      await mutate(`/api/friends/${friendshipId}`, "DELETE");
      setSelectedFriend(null);
      setProfile(null);
    });
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const friend = selectedFriend;
    const text = messageText.trim();
    if (!friend || !text) return;
    await action("send-message", async () => {
      const response = await fetch(`/api/friends/${friend.friendshipId}/messages`, {
        method: "POST",
        headers: { ...actorHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const body = await readApi<{ message: FriendMessage }>(response);
      setMessages((current) => [...current, body.message]);
      setMessageText("");
    });
  }

  async function openProfile(userId: string) {
    setBusy(`profile-${userId}`);
    setError(null);
    try {
      const response = await fetch(`/api/friends/players/${userId}`, {
        cache: "no-store",
        headers: actorHeader,
      });
      const body = await readApi<{ profile: FriendProfile }>(response);
      setProfile(body.profile);
    } catch {
      setError(copy.actionFailed);
    } finally {
      setBusy(null);
    }
  }

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    const friend = inviteFriend;
    if (!friend) return;
    await action(`invite-${friend.friendshipId}`, async () => {
      await mutate(`/api/friends/${friend.friendshipId}/invites`, "POST", { boardSize, timeControl });
      setInviteFriend(null);
    });
  }

  async function respondInvite(invite: FriendGameInvite, response: "accept" | "decline" | "cancel") {
    await action(`invite-response-${invite.id}`, async () => {
      const result = await mutate(`/api/friends/invites/${invite.id}`, "PATCH", { action: response });
      if (response === "accept" && typeof result.gameId === "string") {
        router.push(href(`/game/${result.gameId}`));
      }
    });
  }

  if (!loaded && !error) {
    return <section aria-live="polite" className="friends-loading"><Users aria-hidden="true" /> {copy.loading}</section>;
  }

  return (
    <div className="friends-page">
      <header className="friends-hero">
        <div><span className="section-kicker">{copy.kicker}</span><h1>{copy.title}</h1><p>{copy.description}</p></div>
        <div className="friends-summary" aria-label={copy.friendsTitle}>
          <strong>{dashboard.friends.length}</strong><span>{copy.friendsTitle}</span>
        </div>
      </header>

      {error ? <div className="friends-alert" role="alert"><span>{error}</span><Button onClick={() => void loadDashboard()} size="sm" variant="secondary">{copy.retry}</Button></div> : null}

      <section className="player-search" aria-labelledby="player-search-title">
        <label htmlFor="friend-search" id="player-search-title">{copy.searchLabel}</label>
        <div className="player-search__field"><Search aria-hidden="true" size={19} /><input autoComplete="off" id="friend-search" onChange={(event) => changeSearch(event.target.value)} placeholder={copy.searchPlaceholder} value={searchTerm} /></div>
        <small>{searching ? copy.searching : copy.searchHint}</small>
        {searchTerm.trim().length >= 2 ? (
          <div className="player-search__results">
            {!searching && searchResults.length === 0 ? <p>{copy.noSearchResults}</p> : searchResults.map((player) => (
              <article className="player-result" key={player.userId}>
                <ProfileAvatar size="sm" style={player.avatarStyle} />
                <div><strong>{player.displayName}</strong><span>@{player.username} · {copy[player.presence]}</span></div>
                <div className="player-result__actions">
                  <Button disabled={busy === `profile-${player.userId}`} onClick={() => void openProfile(player.userId)} size="sm" variant="ghost">{copy.profile}</Button>
                  {player.friendshipStatus === "none" ? <Button disabled={busy === `add-${player.userId}`} onClick={() => void addFriend(player)} size="sm"><UserPlus size={16} /> {copy.addFriend}</Button> : null}
                  {player.friendshipStatus === "outgoing" ? <span className="relationship-label"><Check size={15} /> {copy.requestSent}</span> : null}
                  {player.friendshipStatus === "friends" ? <span className="relationship-label"><Check size={15} /> {copy.friendsTitle}</span> : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <div className="friends-grid">
        <section className="friends-card friends-card--list" aria-labelledby="friends-list-title">
          <header><div><span className="section-kicker">{copy.online}</span><h2 id="friends-list-title">{copy.friendsTitle}</h2></div><Users aria-hidden="true" /></header>
          {dashboard.friends.length === 0 ? <p className="friends-empty">{copy.noFriends}</p> : (
            <div className="friends-list">{dashboard.friends.map((friend) => (
              <article className="friend-row" key={friend.friendshipId}>
                <button className="friend-row__identity" onClick={() => void openProfile(friend.userId)} type="button">
                  <span className={`presence-dot presence-dot--${friend.presence}`} />
                  <ProfileAvatar size="sm" style={friend.avatarStyle} />
                  <span><strong>{friend.displayName}</strong><small>{copy[friend.presence]}{friend.lastMessage ? ` · ${friend.lastMessage}` : ""}</small></span>
                </button>
                {friend.unreadCount > 0 ? <span className="unread-badge">{formatFriendsText(copy.unread, { count: friend.unreadCount })}</span> : null}
                <div className="friend-row__actions">
                  <button aria-label={`${copy.message} ${friend.displayName}`} onClick={() => setSelectedFriend(friend)} type="button"><MessageCircle size={18} /></button>
                  <button aria-label={`${copy.invite} ${friend.displayName}`} onClick={() => setInviteFriend(friend)} type="button"><Gamepad2 size={18} /></button>
                </div>
              </article>
            ))}</div>
          )}
        </section>

        <div className="friends-side-stack">
          <section className="friends-card" aria-labelledby="requests-title">
            <header><h2 id="requests-title">{copy.requestsTitle}</h2><UserPlus aria-hidden="true" /></header>
            {dashboard.requests.length === 0 ? <p className="friends-empty">{copy.noRequests}</p> : dashboard.requests.map((request) => (
              <article className="friend-request" key={request.friendshipId}>
                <ProfileAvatar size="xs" style={request.avatarStyle} />
                <div><strong>{request.displayName}</strong><span>{request.direction === "incoming" ? copy.incomingRequest : copy.requestSent}</span></div>
                <div>
                  {request.direction === "incoming" ? <><Button disabled={busy === `request-${request.friendshipId}`} onClick={() => void respond(request, "accept")} size="sm">{copy.accept}</Button><Button disabled={busy === `request-${request.friendshipId}`} onClick={() => void respond(request, "decline")} size="sm" variant="ghost">{copy.decline}</Button></> : <Button disabled={busy === `remove-${request.friendshipId}`} onClick={() => void remove(request.friendshipId, false)} size="sm" variant="ghost">{copy.cancelRequest}</Button>}
                </div>
              </article>
            ))}
          </section>

          <section className="friends-card" aria-labelledby="invites-title">
            <header><h2 id="invites-title">{copy.invitesTitle}</h2><Gamepad2 aria-hidden="true" /></header>
            {dashboard.invites.length === 0 ? <p className="friends-empty">{copy.noInvites}</p> : dashboard.invites.map((invite) => (
              <article className="game-invite" key={invite.id}>
                <div><strong>{formatFriendsText(invite.direction === "incoming" ? copy.invitedYou : copy.youInvited, { name: invite.otherPlayerName })}</strong><span>{invite.boardSize}×{invite.boardSize} · {dictionary.timeControls[invite.timeControl].shortLabel}</span><small><Clock3 size={13} /> {copy.expiresSoon}</small></div>
                <div>{invite.status === "accepted" ? <span>{copy.openingGame}</span> : invite.direction === "incoming" ? <><Button disabled={busy === `invite-response-${invite.id}`} onClick={() => void respondInvite(invite, "accept")} size="sm">{copy.acceptInvite}</Button><Button disabled={busy === `invite-response-${invite.id}`} onClick={() => void respondInvite(invite, "decline")} size="sm" variant="ghost">{copy.declineInvite}</Button></> : <Button disabled={busy === `invite-response-${invite.id}`} onClick={() => void respondInvite(invite, "cancel")} size="sm" variant="ghost">{copy.cancelInvite}</Button>}</div>
              </article>
            ))}
          </section>
        </div>
      </div>

      <ModalDialog className="friends-modal chat-modal" initialFocusRef={chatInput} onDismiss={() => setSelectedFriend(null)} open={Boolean(selectedFriend)} titleId={chatTitleId}>
        {selectedFriend ? <><header><div><span className="section-kicker">{copy.message}</span><h2 id={chatTitleId}>{formatFriendsText(copy.chatWith, { name: selectedFriend.displayName })}</h2></div><button aria-label={copy.close} onClick={() => setSelectedFriend(null)} type="button"><X /></button></header><div className="friend-chat-log">{messages.length === 0 ? <p>{copy.chatEmpty}</p> : messages.map((message) => <article className={message.senderId === user?.id ? "is-mine" : ""} key={message.id}><strong>{message.senderId === user?.id ? user.displayName : message.senderName}</strong><p>{message.message}</p><time dateTime={message.createdAt}>{new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time></article>)}</div><form className="friend-chat-form" onSubmit={sendMessage}><input aria-label={copy.messagePlaceholder} maxLength={500} onChange={(event) => setMessageText(event.target.value)} placeholder={copy.messagePlaceholder} ref={chatInput} value={messageText} /><Button aria-label={copy.send} disabled={!messageText.trim() || busy === "send-message"} type="submit"><Send size={17} /></Button></form></> : null}
      </ModalDialog>

      <ModalDialog className="friends-modal profile-preview-modal" onDismiss={() => setProfile(null)} open={Boolean(profile)} titleId={profileTitleId}>
        {profile ? <><header><span className="section-kicker">{copy.profileTitle}</span><button aria-label={copy.close} onClick={() => setProfile(null)} type="button"><X /></button></header><div className="profile-preview__identity"><ProfileAvatar size="lg" style={profile.avatarStyle} /><div><h2 id={profileTitleId}>{profile.displayName}</h2><p>@{profile.username} · {copy[profile.presence]}</p></div></div><dl className="profile-preview__stats"><div><dt>{copy.rating}</dt><dd>{profile.rating === null ? copy.provisional : Math.round(profile.rating)}</dd></div><div><dt>{copy.ratedGames}</dt><dd>{profile.ratedGames}</dd></div><div><dt>{copy.friendlyGames}</dt><dd>{profile.friendlyGames}</dd></div><div><dt>{copy.sharedGames}</dt><dd>{profile.sharedFriendlyGames}</dd></div></dl><p>{copy.joined}: {displayDate(profile.joinedAt, locale)}</p><footer>{profile.friendshipStatus === "friends" && profile.friendshipId ? <><Button onClick={() => { const friend = dashboard.friends.find(({ friendshipId }) => friendshipId === profile.friendshipId); if (friend) setSelectedFriend(friend); setProfile(null); }} variant="secondary"><MessageCircle size={17} /> {copy.message}</Button><Button onClick={() => { const friend = dashboard.friends.find(({ friendshipId }) => friendshipId === profile.friendshipId); if (friend) setInviteFriend(friend); setProfile(null); }}><Gamepad2 size={17} /> {copy.invite}</Button><Button onClick={() => void remove(profile.friendshipId!)} variant="ghost"><UserMinus size={17} /> {copy.removeFriend}</Button></> : profile.friendshipStatus === "none" ? <Button onClick={() => void addFriend({ ...profile, friendshipId: null, friendshipStatus: "none" })}><UserPlus size={17} /> {copy.addFriend}</Button> : null}</footer></> : null}
      </ModalDialog>

      <ModalDialog className="friends-modal invite-modal" onDismiss={() => setInviteFriend(null)} open={Boolean(inviteFriend)} titleId={inviteTitleId}>
        {inviteFriend ? <form onSubmit={sendInvite}><header><div><span className="section-kicker">{copy.unratedNotice}</span><h2 id={inviteTitleId}>{formatFriendsText(copy.inviteTitle, { name: inviteFriend.displayName })}</h2></div><button aria-label={copy.close} onClick={() => setInviteFriend(null)} type="button"><X /></button></header><fieldset><legend>{copy.boardSize}</legend><div className="invite-choice-grid">{([9, 13, 19] as const).map((size) => <label className={boardSize === size ? "is-selected" : ""} key={size}><input checked={boardSize === size} name="board-size" onChange={() => setBoardSize(size)} type="radio" />{copy[`board${size}`]}</label>)}</div></fieldset><label className="invite-time"><span>{copy.timeControl}</span><select onChange={(event) => setTimeControl(event.target.value as TimeControlId)} value={timeControl}>{(["blitz", "rapid", "classic"] as const).map((control) => <option key={control} value={control}>{dictionary.timeControls[control].name} · {dictionary.timeControls[control].shortLabel}</option>)}</select></label><p className="unrated-callout"><Gamepad2 size={18} /> {copy.unratedNotice}</p><footer><Button onClick={() => setInviteFriend(null)} type="button" variant="ghost">{copy.close}</Button><Button disabled={busy === `invite-${inviteFriend.friendshipId}`} type="submit">{copy.sendInvite}</Button></footer></form> : null}
      </ModalDialog>
    </div>
  );
}
