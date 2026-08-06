"use client";

import { Hourglass, Timer, Zap } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { TIME_CONTROLS } from "@/lib/game/timeControls";
import type { TimeControlId } from "@/lib/game/types";

type TimeControlSelectorProps = {
  value: TimeControlId;
  onChange: (value: TimeControlId) => void;
  disabled?: boolean;
};

export function TimeControlSelector({
  value,
  onChange,
  disabled = false,
}: TimeControlSelectorProps) {
  const { dictionary } = useI18n();
  const icons = {
    blitz: Zap,
    rapid: Timer,
    classic: Hourglass,
  } satisfies Record<TimeControlId, typeof Zap>;

  return (
    <div aria-label={dictionary.play.timeControl} className="time-selector" role="group">
      {TIME_CONTROLS.map((control) => {
        const copy = dictionary.timeControls[control.id];
        const Icon = icons[control.id];
        return <button
          aria-pressed={value === control.id}
          className={value === control.id ? "is-selected" : ""}
          disabled={disabled}
          key={control.id}
          onClick={() => onChange(control.id)}
          type="button"
        >
          <span aria-hidden="true" className="time-selector-icon">
            <Icon size={30} strokeWidth={1.7} />
          </span>
          <span className="time-selector-copy">
            <strong>{copy.name}</strong>
            <span>{copy.shortLabel}</span>
          </span>
          <span aria-hidden="true" className="time-selector-mark" />
        </button>
      })}
    </div>
  );
}
