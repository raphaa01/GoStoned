"use client";

import {
  ArrowLeft,
  Check,
  CircleDot,
  Eye,
  Flag,
  Link2,
  LoaderCircle,
  SkipForward,
  Target,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { getBeginnerGuideCopy } from "@/lib/i18n/beginnerGuide";
import {
  KNOWN_RANK_OPTIONS,
  type StartingStrength,
} from "@/lib/rating/preferences";

type OnboardingStep = "experience" | "rank" | "tutorial-offer" | "tutorial";

type BeginnerOnboardingDialogProps = {
  busy: boolean;
  onCancel: () => void;
  onCreateAccount: (strength: StartingStrength) => Promise<boolean>;
  onFinish: (destination?: "/learn") => Promise<void>;
  open: boolean;
};

const TUTORIAL_ICONS = [Target, CircleDot, Flag, Link2, SkipForward, Eye] as const;
const KYU_OPTIONS = KNOWN_RANK_OPTIONS.filter((rank) => rank.endsWith("k"));

export function BeginnerOnboardingDialog({
  busy,
  onCancel,
  onCreateAccount,
  onFinish,
  open,
}: BeginnerOnboardingDialogProps) {
  const { locale } = useI18n();
  const copy = getBeginnerGuideCopy(locale);
  const [step, setStep] = useState<OnboardingStep>("experience");
  const [rank, setRank] = useState("");
  const [slideIndex, setSlideIndex] = useState(0);
  const [accountCreated, setAccountCreated] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => heading.current?.focus());
  }, [open, slideIndex, step]);

  async function createAccount(strength: StartingStrength) {
    if (accountCreated) return true;
    const created = await onCreateAccount(strength);
    if (created) setAccountCreated(true);
    return created;
  }

  async function finishWithStrength(strength: StartingStrength) {
    if (await createAccount(strength)) await onFinish();
  }

  async function chooseTutorial(showTutorial: boolean) {
    const created = await createAccount({ estimate: "new", knownRank: null });
    if (!created) return;
    if (showTutorial) {
      setSlideIndex(0);
      setStep("tutorial");
      return;
    }
    await onFinish();
  }

  if (!open) return null;

  const slide = copy.slides[slideIndex];
  const SlideIcon = TUTORIAL_ICONS[slideIndex];
  const isLastSlide = slideIndex === copy.slides.length - 1;
  const title = step === "experience"
    ? copy.onboarding.canPlayTitle
    : step === "rank"
      ? copy.onboarding.rankTitle
      : step === "tutorial-offer"
        ? copy.onboarding.tutorialOfferTitle
        : slide.title;
  const description = step === "experience"
    ? copy.onboarding.canPlayBody
    : step === "rank"
      ? copy.onboarding.rankBody
      : step === "tutorial-offer"
        ? copy.onboarding.tutorialOfferBody
        : slide.body;

  return (
    <ModalDialog
      backdropClassName="modal-backdrop--onboarding"
      className="beginner-onboarding-modal"
      descriptionId={descriptionId}
      initialFocusRef={firstAction}
      onDismiss={!busy && !accountCreated ? onCancel : undefined}
      open={open}
      titleId={titleId}
    >
      <div className="beginner-onboarding-header">
        <span className="beginner-onboarding-kicker">
          {step === "tutorial" ? copy.onboarding.tutorialTitle : copy.onboarding.kicker}
        </span>
        <h2 id={titleId} ref={heading} tabIndex={-1}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        {!accountCreated ? (
          <button
            aria-label={copy.onboarding.cancel}
            className="beginner-onboarding-close"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        ) : null}
      </div>

      {step === "experience" ? (
        <div className="beginner-onboarding-body beginner-choice-grid">
          <button
            className="beginner-choice"
            disabled={busy}
            onClick={() => setStep("rank")}
            ref={firstAction}
            type="button"
          >
            <Check aria-hidden="true" size={20} />
            <span>{copy.onboarding.canPlayYes}</span>
          </button>
          <button
            className="beginner-choice"
            disabled={busy}
            onClick={() => setStep("tutorial-offer")}
            type="button"
          >
            <CircleDot aria-hidden="true" size={20} />
            <span>{copy.onboarding.canPlayNo}</span>
          </button>
        </div>
      ) : null}

      {step === "rank" ? (
        <div className="beginner-onboarding-body beginner-rank-step">
          <label>
            <span>{copy.onboarding.rankLabel}</span>
            <select
              disabled={busy}
              onChange={(event) => setRank(event.target.value)}
              value={rank}
            >
              <option value="">{copy.onboarding.rankPlaceholder}</option>
              {KYU_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <button
            className="button button--primary beginner-primary-action"
            disabled={busy || !rank}
            onClick={() => void finishWithStrength({ estimate: "known", knownRank: rank })}
            ref={firstAction}
            type="button"
          >
            {busy ? <LoaderCircle aria-hidden="true" className="spin" size={18} /> : null}
            {busy ? copy.onboarding.creating : copy.onboarding.useRank}
          </button>
          <button
            className="beginner-text-action"
            disabled={busy}
            onClick={() => void finishWithStrength({ estimate: "unspecified", knownRank: null })}
            type="button"
          >
            {copy.onboarding.skipRank}
          </button>
          <button className="beginner-back-action" disabled={busy} onClick={() => setStep("experience")} type="button">
            <ArrowLeft aria-hidden="true" size={16} /> {copy.onboarding.back}
          </button>
        </div>
      ) : null}

      {step === "tutorial-offer" ? (
        <div className="beginner-onboarding-body beginner-tutorial-offer">
          <button
            className="button button--primary beginner-primary-action"
            disabled={busy}
            onClick={() => void chooseTutorial(true)}
            ref={firstAction}
            type="button"
          >
            {busy ? <LoaderCircle aria-hidden="true" className="spin" size={18} /> : null}
            {busy ? copy.onboarding.creating : copy.onboarding.startTutorial}
          </button>
          <button className="beginner-text-action" disabled={busy} onClick={() => void chooseTutorial(false)} type="button">
            {copy.onboarding.skipTutorial}
          </button>
          <button className="beginner-back-action" disabled={busy} onClick={() => setStep("experience")} type="button">
            <ArrowLeft aria-hidden="true" size={16} /> {copy.onboarding.back}
          </button>
        </div>
      ) : null}

      {step === "tutorial" ? (
        <div className="beginner-tutorial-body">
          <div className="beginner-tutorial-visual" aria-hidden="true">
            <SlideIcon size={38} strokeWidth={1.6} />
          </div>
          <p className="beginner-tutorial-note">{slide.note}</p>
          <div className="beginner-tutorial-progress" aria-label={copy.onboarding.stepLabel
            .replace("{current}", String(slideIndex + 1))
            .replace("{total}", String(copy.slides.length))}
          >
            {copy.slides.map((item, index) => (
              <span aria-current={index === slideIndex ? "step" : undefined} key={item.title} />
            ))}
          </div>
          <span className="beginner-tutorial-step-label">
            {copy.onboarding.stepLabel
              .replace("{current}", String(slideIndex + 1))
              .replace("{total}", String(copy.slides.length))}
          </span>
          <div className="beginner-tutorial-actions">
            <button
              className="beginner-back-action"
              disabled={busy || slideIndex === 0}
              onClick={() => setSlideIndex((current) => Math.max(0, current - 1))}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={16} /> {copy.onboarding.previous}
            </button>
            {isLastSlide ? (
              <div className="beginner-finish-actions">
                <button className="button button--primary" disabled={busy} onClick={() => void onFinish("/learn")} ref={firstAction} type="button">
                  {copy.onboarding.openLessons}
                </button>
                <button className="beginner-text-action" disabled={busy} onClick={() => void onFinish()} type="button">
                  {copy.onboarding.finish}
                </button>
              </div>
            ) : (
              <button
                className="button button--primary"
                disabled={busy}
                onClick={() => setSlideIndex((current) => Math.min(copy.slides.length - 1, current + 1))}
                ref={firstAction}
                type="button"
              >
                {copy.onboarding.next}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </ModalDialog>
  );
}
