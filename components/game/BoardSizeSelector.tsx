import type { BoardSize } from "@/lib/game/types";

type BoardSizeSelectorProps = {
  value: BoardSize;
  onChange: (size: BoardSize) => void;
  disabled?: boolean;
};

const sizes: Array<{ value: BoardSize; label: string; pace: string }> = [
  { value: 9, label: "9×9", pace: "Quick" },
  { value: 13, label: "13×13", pace: "Balanced" },
  { value: 19, label: "19×19", pace: "Classic" },
];

export function BoardSizeSelector({ value, onChange, disabled = false }: BoardSizeSelectorProps) {
  return (
    <div className="size-selector" aria-label="Choose board size">
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
