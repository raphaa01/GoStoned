"use client";

import { useI18n } from "@/components/i18n/I18nProvider";
import type { BoardSize } from "@/lib/game/types";
import { BoardSizeGlyph } from "./BoardPreview";

type BoardSizeSelectorProps = {
  value: BoardSize;
  onChange: (size: BoardSize) => void;
  disabled?: boolean;
};

export function BoardSizeSelector({ value, onChange, disabled = false }: BoardSizeSelectorProps) {
  const { dictionary } = useI18n();
  const sizes: Array<{ value: BoardSize; label: string }> = [
    { value: 9, label: "9×9" },
    { value: 13, label: "13×13" },
    { value: 19, label: "19×19" },
  ];
  return (
    <div
      aria-label={dictionary.play.boardSelectorLabel}
      className="size-selector"
      role="group"
    >
      {sizes.map((size) => (
        <button
          className={value === size.value ? "is-selected" : ""}
          aria-pressed={value === size.value}
          disabled={disabled}
          key={size.value}
          onClick={() => onChange(size.value)}
          type="button"
        >
          <BoardSizeGlyph boardSize={size.value} />
          <strong>{size.label}</strong>
        </button>
      ))}
    </div>
  );
}
