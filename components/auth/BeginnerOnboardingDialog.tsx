"use client";

import {
  ArrowLeft,
  Check,
  CircleDot,
  LoaderCircle,
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

const KYU_OPTIONS = KNOWN_RANK_OPTIONS.filter((rank) => rank.endsWith("k"));

type TutorialVisual = 0 | 1 | 2 | 3 | "rank" | 4 | 5;

const TUTORIAL_STONES: Record<Exclude<TutorialVisual, "rank">, Array<[number, number, "black" | "white"]>> = {
  0: [[1, 1, "black"], [3, 1, "white"], [1, 3, "white"], [3, 3, "black"]],
  1: [[2, 2, "black"]],
  2: [[2, 2, "white"], [2, 1, "black"], [1, 2, "black"], [3, 2, "black"]],
  3: [[1, 1, "black"], [2, 1, "black"], [3, 1, "black"], [1, 2, "black"], [3, 2, "black"], [1, 3, "black"], [2, 3, "black"], [3, 3, "black"]],
  4: [[1, 1, "black"], [3, 1, "white"], [1, 3, "white"], [3, 3, "black"]],
  5: [[0, 1, "black"], [1, 1, "black"], [0, 2, "black"], [3, 2, "white"], [4, 2, "white"], [3, 3, "white"]],
};

function TutorialPosition({ visual }: { visual: TutorialVisual }) {
  if (visual === "rank") {
    return (
      <div aria-hidden="true" className="beginner-rank-track">
        {["30k", "20k", "10k", "1k"].map((rank, index) => (
          <span className={index === 3 ? "is-current" : undefined} key={rank}>{rank}</span>
        ))}
      </div>
    );
  }

  const points = [18, 34, 50, 66, 82];
  return (
    <svg aria-hidden="true" className="beginner-tutorial-board" viewBox="0 0 100 100">
      <rect className="beginner-tutorial-board__wood" height="96" rx="4" width="96" x="2" y="2" />
      {points.map((point) => (
        <g className="beginner-tutorial-board__line" key={point}>
          <path d={`M18 ${point}H82`} />
          <path d={`M${point} 18V82`} />
        </g>
      ))}
      {TUTORIAL_STONES[visual].map(([x, y, color], index) => (
        <circle className={`beginner-tutorial-board__stone is-${color}`} cx={points[x]} cy={points[y]} key={`${x}-${y}-${index}`} r="7" />
      ))}
      {visual === 2 ? <circle className="beginner-tutorial-board__target" cx={points[2]} cy={points[3]} r="8.5" /> : null}
    </svg>
  );
}

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

  const tutorialSlides = [
    ...copy.slides.slice(0, 4).map((item, index) => ({ ...item, visual: index as TutorialVisual })),
    {
      title: copy.onboarding.rankTutorialTitle ?? copy.onboarding.rankTitle,
      body: copy.onboarding.rankTutorialBody ?? copy.onboarding.rankBody,
      note: copy.onboarding.rankTutorialNote ?? "30k → 20k → 10k → 1k",
      visual: "rank" as const,
    },
    ...copy.slides.slice(4).map((item, index) => ({ ...item, visual: (index + 4) as TutorialVisual })),
  ];
  const slide = tutorialSlides[slideIndex];
  const isLastSlide = slideIndex === tutorialSlides.length - 1;
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
          <div className="beginner-tutorial-example">
            <TutorialPosition visual={slide.visual} />
            <p className="beginner-tutorial-note">{slide.note}</p>
          </div>
          <div className="beginner-tutorial-progress" aria-label={copy.onboarding.stepLabel
            .replace("{current}", String(slideIndex + 1))
            .replace("{total}", String(tutorialSlides.length))}
          >
            {tutorialSlides.map((item, index) => (
              <span aria-current={index === slideIndex ? "step" : undefined} key={item.title} />
            ))}
          </div>
          <span className="beginner-tutorial-step-label">
            {copy.onboarding.stepLabel
              .replace("{current}", String(slideIndex + 1))
              .replace("{total}", String(tutorialSlides.length))}
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
                onClick={() => setSlideIndex((current) => Math.min(tutorialSlides.length - 1, current + 1))}
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
