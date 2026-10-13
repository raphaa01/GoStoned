"use client";

import { Check, Copy, ExternalLink, Share2 } from "lucide-react";
import { useRef, useState } from "react";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { readApi } from "@/lib/client/api";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getSharedGameCopy } from "@/lib/i18n/sharedGame";
import { shareGameLink } from "@/lib/client/share";

export function FinishedGameShareButton({ gameId, playerKey, compact = false }: { gameId: string; playerKey: string; compact?: boolean }) {
  return <ShareButton key={`${gameId}:${playerKey}`} gameId={gameId} playerKey={playerKey} compact={compact} />;
}

function ShareButton({ gameId, playerKey, compact }: { gameId: string; playerKey: string; compact: boolean }) {
  const { locale, href } = useI18n();
  const [state, setState] = useState<"idle" | "busy" | "copied">("idle");
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const sharing = useRef(false);
  const copy = getSharedGameCopy(locale);

  async function share() {
    if (sharing.current) return;
    sharing.current = true;
    setState("busy");
    setError(null);
    try {
      let url = shareUrl;
      if (!url) {
        const response = await fetch(`/api/games/${gameId}/share`, {
          method: "POST",
          headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
        });
        const shared = await readApi<{ url: string; path?: string }>(response);
        url = new URL(href(shared.path ?? new URL(shared.url).pathname), shared.url).toString();
        setShareUrl(url);
      }
      const outcome = await shareGameLink({ title: copy.brand, text: copy.shareText, url });
      setState(outcome === "copied" ? "copied" : "idle");
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        setState("idle");
        return;
      }
      setState("idle");
      setError(copy.shareFailed);
    } finally {
      sharing.current = false;
    }
  }

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setState("copied");
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
    }
  }

  return (
    <div className={`finished-game-share${compact ? " finished-game-share--compact" : ""}`}>
      <button className={compact ? "result-share-action" : "button button--secondary"} disabled={state === "busy"} onClick={() => void share()} type="button">
        {state === "copied" ? <Check size={18} /> : <Share2 size={18} />}
        {state === "busy" ? copy.sharing : state === "copied" ? copy.copied : copy.share}
      </button>
      {shareUrl ? <div className="finished-game-link">
        <input ref={linkInput} aria-label={copy.share} onFocus={(event) => event.currentTarget.select()} readOnly type="url" value={shareUrl} />
        <button type="button" aria-label={copy.copyLink} title={copy.copyLink} onClick={() => void copyLink()}><Copy size={17} /></button>
        <a href={shareUrl} target="_blank" rel="noopener noreferrer" aria-label={copy.openLink} title={copy.openLink}><ExternalLink size={17} /></a>
      </div> : null}
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}
