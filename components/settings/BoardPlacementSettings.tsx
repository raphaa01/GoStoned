"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useBoardPlacement } from "@/components/game/BoardPlacementProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { readApi } from "@/lib/client/api";
import { getSettingsCopy } from "@/lib/i18n/settings";
import { getBoardPlacementCopy } from "@/lib/i18n/boardPlacement";
import type { BoardPlacementPreference } from "@/lib/boardPlacement";
import type { RatingPreferences } from "@/lib/rating/preferences";

export function BoardPlacementSettings() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const settingsCopy = getSettingsCopy(locale);
  const placementCopy = getBoardPlacementCopy(locale);
  const { setPreference: applyBoardPlacement } = useBoardPlacement();
  const [preferences, setPreferences] = useState<RatingPreferences | null>(null);
  const [selectedBoardPlacement, setSelectedBoardPlacement] = useState<BoardPlacementPreference>("zoom");
  const [placementSaving, setPlacementSaving] = useState(false);
  const [placementStatus, setPlacementStatus] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const playerKey = user?.playerKey;

  useEffect(() => {
    if (!playerKey) return;
    const controller = new AbortController();
    void fetch("/api/profile/preferences", { cache: "no-store", signal: controller.signal })
      .then((response) => readApi<{ preferences: RatingPreferences }>(response))
      .then((body) => {
        setPreferences(body.preferences);
        setSelectedBoardPlacement(body.preferences.boardPlacement);
        setLoadFailed(false);
      })
      .catch(() => { if (!controller.signal.aborted) setLoadFailed(true); });
    return () => controller.abort();
  }, [playerKey, loadAttempt]);

  const saveBoardPlacement = async () => {
    if (!preferences || placementSaving || selectedBoardPlacement === preferences.boardPlacement) return;
    setPlacementSaving(true);
    setPlacementStatus(null);
    try {
      const response = await fetch("/api/profile/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayPreference: preferences.displayPreference,
          botMatchPreference: preferences.botMatchPreference,
          boardPlacement: selectedBoardPlacement,
        }),
      });
      const body = await readApi<{
        preferences: RatingPreferences & { preferenceRevision: number };
      }>(response);
      setPreferences(body.preferences);
      setSelectedBoardPlacement(body.preferences.boardPlacement);
      applyBoardPlacement(body.preferences.boardPlacement);
      setPlacementStatus(placementCopy.saved);
    } catch {
      setPlacementStatus(placementCopy.failed);
    } finally {
      setPlacementSaving(false);
    }
  };

  if (!preferences) return <section aria-labelledby="board-placement-title" className="settings-section">
    <h2 id="board-placement-title">{placementCopy.settingsTitle}</h2>
    <p role={loadFailed ? "alert" : "status"}>{loadFailed ? settingsCopy.loadFailed : settingsCopy.loading}</p>
    {loadFailed ? <button className="button button--secondary" onClick={() => { setLoadFailed(false); setLoadAttempt((attempt) => attempt + 1); }} type="button">{settingsCopy.retry}</button> : null}
  </section>;

  return (
      <section aria-labelledby="board-placement-title" className="profile-board-placement">
        <header>
          <h2 id="board-placement-title">{placementCopy.settingsTitle}</h2>
          <p>{placementCopy.settingsBody}</p>
        </header>
        <fieldset disabled={placementSaving}>
          <legend className="sr-only">{placementCopy.settingsTitle}</legend>
          <label>
            <input checked={selectedBoardPlacement === "zoom"} name="board-placement" onChange={() => { setSelectedBoardPlacement("zoom"); setPlacementStatus(null); }} type="radio" value="zoom" />
            <span><strong>{placementCopy.zoom}</strong><small>{placementCopy.zoomBody}</small></span>
          </label>
          <label>
            <input checked={selectedBoardPlacement === "direct"} name="board-placement" onChange={() => { setSelectedBoardPlacement("direct"); setPlacementStatus(null); }} type="radio" value="direct" />
            <span><strong>{placementCopy.direct}</strong><small>{placementCopy.directBody}</small></span>
          </label>
        </fieldset>
        <div className="profile-board-placement__actions">
          <button className="button button--secondary" disabled={placementSaving || selectedBoardPlacement === preferences.boardPlacement} onClick={() => void saveBoardPlacement()} type="button">
            {placementSaving ? placementCopy.saving : placementCopy.save}
          </button>
          <span aria-live="polite" role="status">{placementStatus}</span>
        </div>
      </section>
  );
}
