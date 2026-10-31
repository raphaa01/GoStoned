"use client";
import { Flag } from "lucide-react";
import { useId, useRef, useState } from "react";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getCommunityCopy } from "@/lib/i18n/community";
import { PLAYER_REPORT_CATEGORIES } from "@/lib/moderation/playerReportContract";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { readApi } from "@/lib/client/api";
import { assertResponseActor } from "@/lib/client/identityAuthority";

export function PlayerReport({ gameId, friendshipId, playerKey }: { gameId?: string; friendshipId?: string; playerKey: string }) {
  const { locale } = useI18n(); const copy = getCommunityCopy(locale); const title = useId();
  const [open, setOpen] = useState(false); const [sent, setSent] = useState(false);
  const [category, setCategory] = useState<string>(PLAYER_REPORT_CATEGORIES[0]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const pending = useRef(false); const action = useRef<HTMLButtonElement>(null);
  async function submit() {
    if (pending.current) return; pending.current = true; setBusy(true); setError(false);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(friendshipId ? `/api/friends/${friendshipId}/report` : `/api/games/${gameId}/report`, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", [EXPECTED_PLAYER_HEADER]: playerKey }, body: JSON.stringify({ category }) });
      const body = await readApi<{ actor: string; reported: boolean }>(response); assertResponseActor(body.actor, playerKey);
      if (body.reported !== true) throw new Error(); setSent(true); setOpen(false);
    } catch { setError(true); } finally { window.clearTimeout(timeout); pending.current = false; setBusy(false); }
  }
  return <><button className="chat-safety-action" type="button" ref={action} onClick={() => setOpen(true)} disabled={sent} aria-label={sent ? copy.sent : copy.reportTitle}>
    <Flag aria-hidden="true" size={15} />{sent ? copy.sent : copy.report}
  </button>
    <ModalDialog open={open} onDismiss={() => setOpen(false)} titleId={title} finalFocusRef={action} className="community-report-dialog">
      <h2 id={title}>{copy.reportTitle}</h2><label>{copy.category}<select aria-label={copy.category} value={category} disabled={busy} onChange={e => setCategory(e.target.value)}>
        {PLAYER_REPORT_CATEGORIES.map((value, index) => <option key={value} value={value}>{copy.categories[index]}</option>)}
      </select></label>{error ? <p role="alert">{copy.failed}</p> : null}
      <div className="community-actions"><button type="button" className="button" onClick={() => setOpen(false)}>{copy.cancel}</button>
        <button type="button" className="button button--primary" disabled={busy} onClick={() => void submit()}>{busy ? copy.pending : copy.send}</button></div>
    </ModalDialog>
    {sent ? <span className="sr-only" role="status">{copy.sent}</span> : null}
  </>;
}
