"use client";

import { AlertTriangle, X } from "lucide-react";
import { type RefObject, useId, useRef } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ModalDialog } from "./ModalDialog";

type ConfirmModalProps = {
  busy?: boolean;
  cancelLabel?: string;
  confirmLabel: string;
  description: string;
  error?: string | null;
  finalFocusRef?: RefObject<HTMLElement | null>;
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmModal({
  busy = false,
  cancelLabel,
  confirmLabel,
  description,
  error,
  finalFocusRef,
  open,
  title,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  const { dictionary } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const cancelButton = useRef<HTMLButtonElement>(null);

  return (
    <ModalDialog
      className="confirm-modal"
      descriptionId={descriptionId}
      finalFocusRef={finalFocusRef}
      initialFocusRef={cancelButton}
      onDismiss={busy ? undefined : onCancel}
      open={open}
      role="alertdialog"
      titleId={titleId}
    >
        <button
          aria-label={dictionary.common.closeDialog}
          className="modal-close"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          <X size={18} />
        </button>
        <span className="confirm-modal-icon"><AlertTriangle size={24} /></span>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        {error ? <p className="confirm-modal-error" role="alert">{error}</p> : null}
        <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
          {busy ? dictionary.common.pleaseWait : ""}
        </span>
        <div aria-busy={busy || undefined} className="confirm-modal-actions">
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={onCancel}
            ref={cancelButton}
            type="button"
          >
            {cancelLabel ?? dictionary.common.cancel}
          </button>
          <button
            className="button button--danger"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? dictionary.common.pleaseWait : confirmLabel}
          </button>
        </div>
    </ModalDialog>
  );
}
