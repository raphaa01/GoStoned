"use client";

import { Clock3 } from "lucide-react";
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
  return (
    <div aria-label={dictionary.play.timeControl} className="time-selector" role="group">
      {TIME_CONTROLS.map((control) => {
        const copy = dictionary.timeControls[control.id];
        return <button
          aria-pressed={value === control.id}
          className={value === control.id ? "is-selected" : ""}
          disabled={disabled}
          key={control.id}
          onClick={() => onChange(control.id)}
          type="button"
        >
          <span className="time-selector-heading">
            <Clock3 size={14} />
            <strong>{copy.name}</strong>
          </span>
          <span>{copy.shortLabel}</span>
          <small>{copy.description}</small>
        </button>
      })}
    </div>
  );
}
