"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { Check, Lock, Palette } from "lucide-react";
import { useBoardDesign } from "@/components/game/BoardDesignProvider";
import { BoardPreview } from "@/components/game/BoardPreview";
import { useI18n } from "@/components/i18n/I18nProvider";
import { BOARD_DESIGNS, isBoardDesignUnlocked, type BoardDesignId } from "@/lib/boardDesign";
import { getBoardDesignCopy } from "@/lib/i18n/boardDesign";

function DesignImage({ design }: { design: BoardDesignId }) {
  const entry = BOARD_DESIGNS.find((item) => item.id === design)!;
  return <span className="board-design-image">{entry.preview
    ? <Image alt="" height={240} src={`/images/board-designs/${entry.preview}`} unoptimized width={240} />
    : <BoardPreview boardSize={19} />}</span>;
}

export function BoardDesignPicker() {
  const { locale } = useI18n();
  const copy = getBoardDesignCopy(locale);
  const { design, wins, ready, loadFailed, reload, select } = useBoardDesign();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const firstOption = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => firstOption.current?.focus());
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    window.addEventListener("keydown", escape);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", escape); };
  }, [open]);

  async function choose(id: BoardDesignId) {
    if (saving || !ready || !isBoardDesignUnlocked(id, wins)) return;
    setSaving(true);
    setStatus("");
    try { await select(id); setStatus(copy.saved); }
    catch { setStatus(copy.failed); }
    finally { setSaving(false); }
  }

  return <section className="profile-board-design" aria-label={copy.title}>
    <button aria-controls={panelId} aria-expanded={open} className="board-design-trigger" onClick={() => {
      setOpen(!open); setStatus(""); if (!open) void reload();
    }} ref={trigger} type="button">
      <span className="board-design-trigger__title"><Palette aria-hidden="true" size={18} />{copy.title}</span>
      <span className="board-design-current"><DesignImage design={design} /><span>{copy.names[design]}</span></span>
    </button>
    {open ? <div className="board-design-picker" id={panelId}>
      <div className="board-design-picker__heading"><span>{copy.progress(wins)}</span><button className="button button--secondary" onClick={() => { setOpen(false); trigger.current?.focus(); }} type="button">{copy.close}</button></div>
      {loadFailed ? <p role="alert">{copy.loadFailed} <button className="button button--secondary" onClick={() => void reload()} type="button">{copy.retry}</button></p> : !ready ? <p role="status">{copy.loading}</p> : null}
      <div className="board-design-options" aria-label={copy.title}>
        {BOARD_DESIGNS.map((entry, index) => {
          const unlocked = isBoardDesignUnlocked(entry.id, wins);
          const selected = entry.id === design;
          return <button aria-pressed={selected} className="board-design-option" data-locked={!unlocked} disabled={saving || !ready || !unlocked} key={entry.id} onClick={() => void choose(entry.id)} ref={index === 0 ? firstOption : undefined} type="button">
            <DesignImage design={entry.id} />
            <strong>{copy.names[entry.id]}</strong>
            <span className="board-design-state">{entry.wins === null ? copy.soon : !unlocked ? <><Lock aria-hidden="true" size={13} />{copy.unlock(entry.wins)}</> : selected ? <><Check aria-hidden="true" size={13} />{copy.selected}</> : copy.available}</span>
          </button>;
        })}
      </div>
      <p aria-live="polite" role="status">{saving ? copy.saving : status}</p>
    </div> : null}
  </section>;
}
