"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PlayerReport } from "@/components/game/PlayerReport";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { assertResponseActor } from "@/lib/client/identityAuthority";
import { readApi } from "@/lib/client/api";

export function FriendSafetyActions({ friendshipId, playerKey, onBlocked }: { friendshipId: string; playerKey: string; onBlocked: () => void }) {
  const { dictionary } = useI18n(); const copy = dictionary.game;
  const [blocked, setBlocked] = useState<boolean | null>(null); const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false); const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/friends/${friendshipId}/block`, { cache: "no-store", signal: controller.signal, headers: { [EXPECTED_PLAYER_HEADER]: playerKey } })
      .then(readApi<{ actor: string; blocked: boolean }>).then(body => {
        assertResponseActor(body.actor, playerKey);
        if (typeof body.blocked !== "boolean") throw new Error();
        if (!controller.signal.aborted) { setBlocked(body.blocked); setFailed(false); }
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [friendshipId, playerKey, retry]);
  async function toggle() {
    if (blocked === null || busy) return; setBusy(true); setFailed(false);
    try {
      const body = await fetch(`/api/friends/${friendshipId}/block`, { method: "POST", headers: { "Content-Type": "application/json", [EXPECTED_PLAYER_HEADER]: playerKey }, body: JSON.stringify({ blocked: !blocked }) }).then(readApi<{ actor: string; blocked: boolean }>);
      assertResponseActor(body.actor, playerKey); if (body.blocked !== !blocked) throw new Error(); setBlocked(body.blocked); if (body.blocked) onBlocked();
    } catch { setFailed(true); } finally { setBusy(false); }
  }
  return <div className="friend-safety-actions"><PlayerReport friendshipId={friendshipId} playerKey={playerKey} />
    <button className="chat-safety-action" disabled={busy || (blocked === null && !failed)} type="button" onClick={() => blocked === null ? setRetry(value => value + 1) : void toggle()}>{blocked === null ? failed ? copy.retrySafety : copy.safetyLoading : blocked ? copy.unblockOpponent : copy.blockOpponent}</button>
    {failed ? <span role="alert">{copy.blockFailed}</span> : null}
  </div>;
}
