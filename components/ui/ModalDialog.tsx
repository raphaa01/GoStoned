"use client";

import { createPortal } from "react-dom";
import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";

type BackgroundState = {
  element: HTMLElement;
  inert: boolean;
  ariaHidden: string | null;
};

const modalStack: HTMLElement[] = [];
const backgroundStates = new Map<HTMLElement, BackgroundState>();
let originalBodyOverflow: string | null = null;

function restoreElement({ element, inert, ariaHidden }: BackgroundState) {
  element.inert = inert;
  if (ariaHidden === null) element.removeAttribute("aria-hidden");
  else element.setAttribute("aria-hidden", ariaHidden);
}

function synchronizeBackground() {
  const topModal = modalStack.at(-1) ?? null;
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (!backgroundStates.has(child)) {
      backgroundStates.set(child, {
        element: child,
        inert: child.inert,
        ariaHidden: child.getAttribute("aria-hidden"),
      });
    }
    const original = backgroundStates.get(child);
    if (!original) continue;
    if (child === topModal) restoreElement(original);
    else {
      child.inert = true;
      child.setAttribute("aria-hidden", "true");
    }
  }
}

function registerModal(backdrop: HTMLElement) {
  if (modalStack.length === 0) {
    originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  modalStack.push(backdrop);
}

function unregisterModal(backdrop: HTMLElement) {
  const index = modalStack.lastIndexOf(backdrop);
  if (index >= 0) modalStack.splice(index, 1);
  if (modalStack.length > 0) {
    synchronizeBackground();
    return;
  }
  for (const state of backgroundStates.values()) restoreElement(state);
  backgroundStates.clear();
  document.body.style.overflow = originalBodyOverflow ?? "";
  originalBodyOverflow = null;
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
    ),
  ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

type ModalDialogProps = {
  backdropClassName?: string;
  children: ReactNode;
  className: string;
  descriptionId?: string;
  finalFocusRef?: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onDismiss?: () => void;
  open: boolean;
  role?: "dialog" | "alertdialog";
  titleId: string;
};

export function ModalDialog({
  backdropClassName = "",
  children,
  className,
  descriptionId,
  finalFocusRef,
  initialFocusRef,
  onDismiss,
  open,
  role = "dialog",
  titleId,
}: ModalDialogProps) {
  const backdrop = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onDismissRef = useRef(onDismiss);

  useLayoutEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useLayoutEffect(() => {
    if (!open || !backdrop.current || !dialog.current) return;
    const currentBackdrop = backdrop.current;
    const currentDialog = dialog.current;
    const finalFocus = finalFocusRef;
    const activeElement = document.activeElement;
    previousFocus.current = activeElement instanceof HTMLElement
      && activeElement !== document.body
      && activeElement !== document.documentElement
      ? activeElement
      : null;
    registerModal(currentBackdrop);

    const focusInside = (fromEnd = false) => {
      const focusable = focusableElements(currentDialog);
      const initial = initialFocusRef?.current;
      const target = initial && currentDialog.contains(initial)
        ? initial
        : fromEnd
          ? focusable.at(-1)
          : focusable[0];
      (target ?? currentDialog).focus();
    };
    focusInside();
    synchronizeBackground();

    function handleKeyDown(event: KeyboardEvent) {
      if (modalStack.at(-1) !== currentBackdrop) return;
      if (event.key === "Escape" && onDismissRef.current) {
        event.preventDefault();
        onDismissRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(currentDialog);
      if (focusable.length === 0) {
        event.preventDefault();
        currentDialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!currentDialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function containFocus(event: FocusEvent) {
      if (modalStack.at(-1) !== currentBackdrop || currentDialog.contains(event.target as Node)) return;
      focusInside();
    }

    document.addEventListener("focusin", containFocus);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("focusin", containFocus);
      window.removeEventListener("keydown", handleKeyDown);
      unregisterModal(currentBackdrop);
      const restoreTarget = previousFocus.current?.isConnected
        ? previousFocus.current
        : finalFocus?.current;
      if (restoreTarget?.isConnected) restoreTarget.focus();
    };
  }, [finalFocusRef, initialFocusRef, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`modal-backdrop ${backdropClassName}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismissRef.current?.();
      }}
      ref={backdrop}
    >
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={className}
        ref={dialog}
        role={role}
        tabIndex={-1}
      >
        {children}
      </section>
    </div>,
    document.body,
  );
}
