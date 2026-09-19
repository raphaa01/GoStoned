"use client";

import { Calculator, CheckCheck, HelpCircle, MousePointer2, RotateCcw } from "lucide-react";
import { type RefObject, useId, useRef } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { getBeginnerGuideCopy } from "@/lib/i18n/beginnerGuide";

type ScoringHelpDialogProps = {
  finalFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onHideNextTime: () => void;
  open: boolean;
};

export function ScoringHelpDialog({
  finalFocusRef,
  onClose,
  onHideNextTime,
  open,
}: ScoringHelpDialogProps) {
  const { locale } = useI18n();
  const copy = getBeginnerGuideCopy(locale).scoring;
  const titleId = useId();
  const descriptionId = useId();
  const understoodButton = useRef<HTMLButtonElement>(null);

  return (
    <ModalDialog
      backdropClassName="modal-backdrop--scoring-help"
      className="scoring-help-modal"
      descriptionId={descriptionId}
      finalFocusRef={finalFocusRef}
      initialFocusRef={understoodButton}
      onDismiss={onClose}
      open={open}
      titleId={titleId}
    >
      <header className="scoring-help-header">
        <span>{copy.kicker}</span>
        <h2 id={titleId}>{copy.title}</h2>
        <p id={descriptionId}>{copy.intro}</p>
      </header>
      <ol className="scoring-help-steps">
        <li>
          <Calculator aria-hidden="true" size={20} />
          <div><strong>{copy.scoreTitle}</strong><p>{copy.scoreBody}</p></div>
        </li>
        <li>
          <MousePointer2 aria-hidden="true" size={20} />
          <div><strong>{copy.deadTitle}</strong><p>{copy.deadBody}</p></div>
        </li>
        <li>
          <CheckCheck aria-hidden="true" size={20} />
          <div><strong>{copy.confirmTitle}</strong><p>{copy.confirmBody}</p></div>
        </li>
        <li>
          <RotateCcw aria-hidden="true" size={20} />
          <div><strong>{copy.disputeTitle}</strong><p>{copy.disputeBody}</p></div>
        </li>
      </ol>
      <div className="scoring-help-actions">
        <button className="button button--primary" onClick={onClose} ref={understoodButton} type="button">
          {copy.understood}
        </button>
        <button className="scoring-help-hide" onClick={onHideNextTime} type="button">
          {copy.hideNextTime}
        </button>
      </div>
    </ModalDialog>
  );
}

export function ScoringHelpButton({ onClick }: { onClick: () => void }) {
  const { locale } = useI18n();
  const copy = getBeginnerGuideCopy(locale).scoring;
  return (
    <button className="scoring-help-reopen" onClick={onClick} type="button">
      <HelpCircle aria-hidden="true" size={15} />
      {copy.reopen}
    </button>
  );
}
