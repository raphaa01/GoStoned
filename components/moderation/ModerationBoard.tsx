"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getCommunityCopy } from "@/lib/i18n/community";
import { readApi } from "@/lib/client/api";
import type { ModerationCase } from "@/lib/moderation/moderationService";
import { MODERATION_ACTIONS, type ModerationAction } from "@/lib/moderation/communityContract";
import { PLAYER_REPORT_CATEGORIES } from "@/lib/moderation/playerReportContract";

export function ModerationBoard() {
  const { locale } = useI18n(); const copy = getCommunityCopy(locale);
  const [closed, setClosed] = useState(false);
  const [cases, setCases] = useState<ModerationCase[] | null>(null);
  const requestVersion = useRef(0);
  const [failed, setFailed] = useState(false); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setFailed(false);
    try { const body = await fetch(`/api/moderation${closed ? "?status=closed" : ""}`, { cache: "no-store" }).then(readApi<{ cases: ModerationCase[] }>); if (version === requestVersion.current) setCases(body.cases); }
    catch { if (version === requestVersion.current) setFailed(true); }
  }, [closed]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  async function decide(caseId: string, action: ModerationAction) {
    if (busy || !window.confirm(copy.confirm)) return;
    setBusy(true); setFailed(false);
    try { await fetch("/api/moderation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId, action }) }).then(readApi); await load(); }
    catch { setFailed(true); } finally { setBusy(false); }
  }
  return <section className="moderation-board"><header><h1>{copy.moderation}</h1><button className="button" disabled={busy} onClick={() => { ++requestVersion.current; setCases(null); setClosed(value => !value); }}>{closed ? copy.open : copy.closed}</button><button className="button" disabled={busy} onClick={() => void load()}>{copy.refresh}</button></header>
    {failed ? <p role="alert">{copy.failed}</p> : null}{cases?.length === 0 ? <p>{copy.empty}</p> : null}
    {cases?.map(item => <article key={item.id} className="moderation-case"><h2>{item.reportedName}</h2>
      <p>{copy.categories[PLAYER_REPORT_CATEGORIES.indexOf(item.category as typeof PLAYER_REPORT_CATEGORIES[number])]} · <time>{new Date(item.createdAt).toLocaleString(locale)}</time></p>
      {item.decision ? <p>{copy[item.decision]}</p> : null}
      <details><summary>{copy.evidence}</summary>{item.messages.map(message => <p key={message.id}><strong>{message.playerKey === item.reportedKey ? item.reportedName : message.playerKey}</strong>{": "}{message.message}</p>)}</details>
      <div className="community-actions">{MODERATION_ACTIONS.filter(action => closed ? action === "restore" && item.decision !== "restore" : action !== "restore").map(action => <button key={action} className="button" disabled={busy} onClick={() => void decide(item.id, action)}>{copy[action]}</button>)}</div>
    </article>)}
  </section>;
}
