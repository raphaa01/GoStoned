"use client";

import { Clock3 } from "lucide-react";
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
  return (
    <div aria-label="Time control" className="time-selector" role="group">
      {TIME_CONTROLS.map((control) => (
        <button
          aria-pressed={value === control.id}
          className={value === control.id ? "is-selected" : ""}
          disabled={disabled}
          key={control.id}
          onClick={() => onChange(control.id)}
          type="button"
        >
          <span className="time-selector-heading">
            <Clock3 size={14} />
            <strong>{control.name}</strong>
          </span>
          <span>{control.shortLabel}</span>
          <small>{control.description}</small>
        </button>
      ))}
    </div>
  );
}
