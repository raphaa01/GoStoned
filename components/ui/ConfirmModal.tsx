"use client";

import { AlertTriangle, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

type ConfirmModalProps = {
  busy?: boolean;
  cancelLabel?: string;
  confirmLabel: string;
  description: string;
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmModal({
  busy = false,
  cancelLabel = "Cancel",
  confirmLabel,
  description,
  open,
  title,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  const titleId = useId();
  const confirmButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    confirmButton.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [busy, onCancel, open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="confirm-modal"
        role="dialog"
      >
        <button
          aria-label="Close dialog"
          className="modal-close"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          <X size={18} />
        </button>
        <span className="confirm-modal-icon"><AlertTriangle size={24} /></span>
        <h2 id={titleId}>{title}</h2>
        <p>{description}</p>
        <div className="confirm-modal-actions">
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="button button--danger"
            disabled={busy}
            onClick={onConfirm}
            ref={confirmButton}
            type="button"
          >
            {busy ? "Please wait…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
