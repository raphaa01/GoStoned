"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { readApi } from "@/lib/client/api";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getSharedGameCopy } from "@/lib/i18n/sharedGame";
import { shareGameLink } from "@/lib/client/share";

export function FinishedGameShareButton({ gameId, playerKey, compact = false }: { gameId: string; playerKey: string; compact?: boolean }) {
  const { locale } = useI18n();
  const [state, setState] = useState<"idle" | "busy" | "copied">("idle");
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const copy = getSharedGameCopy(locale);

  async function share() {
    if (state === "busy") return;
    setState("busy");
    setError(null);
    try {
      const response = await fetch(`/api/games/${gameId}/share`, {
        method: "POST",
        headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
      });
      const { url } = await readApi<{ url: string }>(response);
      setShareUrl(url);
      const outcome = await shareGameLink({ title: copy.brand, text: copy.shareText, url });
      setState(outcome === "copied" ? "copied" : "idle");
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        setState("idle");
        return;
      }
      setState("idle");
      setError(copy.shareFailed);
    }
  }

  return (
    <div className={`finished-game-share${compact ? " finished-game-share--compact" : ""}`}>
      <button className={compact ? "result-share-action" : "button button--secondary"} disabled={state === "busy"} onClick={() => void share()} type="button">
        {state === "copied" ? <Check size={18} /> : <Share2 size={18} />}
        {state === "busy" ? copy.sharing : state === "copied" ? copy.copied : copy.share}
      </button>
      {shareUrl ? <input aria-label={copy.share} onFocus={(event) => event.currentTarget.select()} readOnly type="url" value={shareUrl} /> : null}
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}
