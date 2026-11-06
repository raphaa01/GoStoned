"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getTournamentsCopy } from "@/lib/i18n/tournaments";
import { classicSchedule } from "@/lib/tournaments/policy";
import type { Tournament } from "@/lib/tournaments/types";

export function ClassicSchedule({ dates }: { dates: string[] }) {
  const { locale } = useI18n();
  const copy = getTournamentsCopy(locale);
  const date = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return (
    <ol className="tournament-schedule">
      {dates.map((d, i) => (
        <li key={d}>
          <span>
            {copy.round} {i + 1}
          </span>
          <time dateTime={d}>{date.format(new Date(d))}</time>
        </li>
      ))}
    </ol>
  );
}

export function ClassicRegistration({
  events,
  busy,
  now,
  onJoin,
}: {
  events: Tournament[];
  busy: boolean;
  now: number;
  onJoin: (id: string) => void;
}) {
  const { locale } = useI18n();
  const copy = getTournamentsCopy(locale);
  const [selected, setSelected] = useState("");
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const available = events.filter(
    (t) => t.status === "lobby" && Date.parse(t.startsAt) > now,
  );
  const event = available.find((t) => t.id === selected) ?? available[0];
  if (!event) return <p>{copy.tournament_registration_closed}</p>;
  const confirmed = confirmedFor === event.id;
  const date = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return (
    <form
      className="tournament-classic-registration"
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmed) onJoin(event.id);
      }}
    >
      <label>
        {copy.slot}
        <select
          aria-label={copy.slot}
          value={event.id}
          onChange={(e) => {
            setSelected(e.target.value);
            setConfirmedFor(null);
          }}
        >
          {available
            .sort((a, b) => a.scheduleHour - b.scheduleHour)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {date.format(new Date(t.startsAt))} · {t.memberCount}{" "}
                {copy.capacity}
              </option>
            ))}
        </select>
      </label>
      <ClassicSchedule
        dates={classicSchedule(new Date(event.startsAt)).map((d) =>
          d.toISOString(),
        )}
      />
      <label className="tournament-confirm">
        <input
          type="checkbox"
          required
          checked={confirmed}
          onChange={(e) => setConfirmedFor(e.target.checked ? event.id : null)}
        />
        {copy.confirmSchedule}
      </label>
      <Button type="submit" disabled={busy || !confirmed}>
        {copy.join}
      </Button>
    </form>
  );
}
