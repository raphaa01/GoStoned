"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { readApi } from "@/lib/client/api";
import { assertResponseActor } from "@/lib/client/identityAuthority";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { COMMUNITY_RULES_HEADER, COMMUNITY_RULES_VERSION } from "@/lib/moderation/communityContract";
export function useCommunityConsent(playerKey: string) {
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const active = useRef(playerKey);
  useEffect(() => {
    active.current = playerKey;
    if (!playerKey) return;
    const controller = new AbortController();
    void fetch("/api/community-rules", { cache: "no-store", signal: controller.signal, headers: { [EXPECTED_PLAYER_HEADER]: playerKey } })
      .then(readApi<{ actor: string; accepted: boolean }>)
      .then(body => { assertResponseActor(body.actor, playerKey); if (!controller.signal.aborted) { setOwner(body.accepted ? playerKey : null); setLoadedOwner(playerKey); } })
      .catch(() => { if (!controller.signal.aborted) setLoadedOwner(playerKey); });
    return () => { controller.abort(); active.current = ""; };
  }, [playerKey]);
  const accept = useCallback(async (form: HTMLFormElement) => {
    if (owner === playerKey) return;
    if (new FormData(form).get("communityRules") !== "on") throw new Error("community_rules_required");
    const response = await fetch("/api/community-rules", { method: "POST", headers: { "Content-Type": "application/json", [EXPECTED_PLAYER_HEADER]: playerKey, [COMMUNITY_RULES_HEADER]: COMMUNITY_RULES_VERSION }, body: "{}" });
    const body = await readApi<{ actor: string; accepted: boolean }>(response); assertResponseActor(body.actor, playerKey);
    if (!body.accepted || active.current !== playerKey) throw new Error("identity_changed");
    setOwner(playerKey);
  }, [owner, playerKey]);
  return { accepted: owner === playerKey, loaded: loadedOwner === playerKey, accept };
}
