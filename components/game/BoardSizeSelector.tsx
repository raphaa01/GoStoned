"use client";

import { useI18n } from "@/components/i18n/I18nProvider";
import type { BoardSize } from "@/lib/game/types";

type BoardSizeSelectorProps = {
  value: BoardSize;
  onChange: (size: BoardSize) => void;
  disabled?: boolean;
};

export function BoardSizeSelector({ value, onChange, disabled = false }: BoardSizeSelectorProps) {
  const { dictionary } = useI18n();
  const sizes: Array<{ value: BoardSize; label: string; pace: string }> = [
    { value: 9, label: "9×9", pace: dictionary.play.boardQuick },
    { value: 13, label: "13×13", pace: dictionary.play.boardBalanced },
    { value: 19, label: "19×19", pace: dictionary.play.boardClassic },
  ];
  return (
    <div className="size-selector" aria-label={dictionary.play.boardSelectorLabel}>
      {sizes.map((size) => (
        <button
          className={value === size.value ? "is-selected" : ""}
          disabled={disabled}
          key={size.value}
          onClick={() => onChange(size.value)}
          type="button"
        >
          <strong>{size.label}</strong>
          <span>{size.pace}</span>
        </button>
      ))}
    </div>
  );
}
