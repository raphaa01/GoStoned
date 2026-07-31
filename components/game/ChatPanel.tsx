"use client";

import { Ban, MessageCircle, Send, Undo2 } from "lucide-react";
import {
  FormEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ApiRequestError } from "@/lib/client/api";
import type { GameMessage } from "@/lib/game/chatService";
import { localizedApiError } from "@/lib/i18n/dictionary";

type ChatPanelProps = {
  blockActionRef: RefObject<HTMLButtonElement | null>;
  blockedByYou: boolean | null;
  blockBusy: boolean;
  blockError: string | null;
  blockReconciling: boolean;
  chatPolicyUnavailable: boolean;
  messages: GameMessage[];
  opponentName: string;
  opponentIsBot: boolean;
  playerKey: string;
  disabled: boolean;
  onBlock: () => void;
  onReloadBlock: () => void;
  onSend: (message: string) => Promise<void>;
  onUnblock: () => void;
};

export function ChatPanel({
  blockActionRef,
  blockedByYou,
  blockBusy,
  blockError,
  blockReconciling,
  chatPolicyUnavailable,
  messages,
  opponentName,
  opponentIsBot,
  playerKey,
  disabled,
  onBlock,
  onReloadBlock,
  onSend,
  onUnblock,
}: ChatPanelProps) {
  const { dictionary } = useI18n();
  const copy = dictionary.game;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const unavailableStatus = useRef<HTMLParagraphElement>(null);
  const wasPolicyUnavailable = useRef(chatPolicyUnavailable);
  const titleId = useId();
  const unavailableId = useId();
  const chatUnavailable = chatPolicyUnavailable || opponentIsBot;

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (
      chatPolicyUnavailable
      && !wasPolicyUnavailable.current
      && formRef.current?.contains(document.activeElement)
    ) {
      unavailableStatus.current?.focus();
    }
    wasPolicyUnavailable.current = chatPolicyUnavailable;
  }, [chatPolicyUnavailable]);

  const blockActionUnavailable = blockBusy
    || blockReconciling
    || opponentIsBot
    || (blockedByYou === null && !blockError);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = text.trim();
    if (!message || busy || disabled || chatUnavailable) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(message);
      setText("");
    } catch (sendError) {
      if (
        !(sendError instanceof ApiRequestError)
        || sendError.code !== "chat_unavailable"
      ) {
        setError(localizedApiError(dictionary, sendError, copy.sendFailed));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={titleId} className="chat-panel">
      <header>
        <span className="chat-title">
          <MessageCircle aria-hidden="true" size={18} />
          <h2 id={titleId}>{copy.chatTitle}</h2>
        </span>
        {!opponentIsBot ? <button
          aria-disabled={blockActionUnavailable}
          aria-label={
            blockedByYou === null
              ? blockError && !blockReconciling
                ? copy.retrySafetyLabel
                : copy.safetyLoadingLabel
              : blockedByYou
              ? copy.unblockOpponentLabel.replace("{name}", opponentName)
              : copy.blockOpponentLabel.replace("{name}", opponentName)
          }
          aria-pressed={blockedByYou === null ? undefined : blockedByYou}
          className="chat-safety-action"
          disabled={blockActionUnavailable && !blockReconciling}
          onClick={() => {
            if (blockActionUnavailable) return;
            if (blockedByYou === null) onReloadBlock();
            else if (blockedByYou) onUnblock();
            else onBlock();
          }}
          ref={blockActionRef}
          type="button"
        >
          {blockedByYou ? <Undo2 aria-hidden="true" size={15} /> : <Ban aria-hidden="true" size={15} />}
          {blockedByYou === null
            ? blockError && !blockReconciling ? copy.retrySafety : copy.safetyLoading
            : blockBusy
              ? blockedByYou ? copy.unblockingOpponent : copy.blockingOpponent
              : blockedByYou ? copy.unblockOpponent : copy.blockOpponent}
        </button> : null}
      </header>
      <div
        aria-atomic="false"
        aria-live="polite"
        aria-relevant="additions"
        className="chat-list"
        ref={listRef}
        role="log"
      >
        {chatUnavailable ? (
          <p
            className="chat-empty"
            id={unavailableId}
            ref={unavailableStatus}
            role="status"
            tabIndex={-1}
          >
            {copy.chatPolicyUnavailable}
          </p>
        ) : messages.length === 0 ? (
          <p className="chat-empty">{copy.chatEmpty}</p>
        ) : messages.map((message) => (
          <div
            className={`chat-message ${message.playerKey === playerKey ? "is-mine" : ""}`}
            key={message.id}
          >
            <strong>{message.playerKey === playerKey ? copy.you : message.playerName}</strong>
            <p>{message.message}</p>
          </div>
        ))}
      </div>
      <form className="chat-form" onSubmit={submit} ref={formRef}>
        <input
          aria-describedby={chatUnavailable ? unavailableId : undefined}
          aria-label={copy.chatMessage}
          disabled={disabled || busy || chatUnavailable}
          maxLength={500}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError(null);
          }}
          placeholder={chatUnavailable || disabled ? copy.chatUnavailable : copy.writeMessage}
          value={text}
        />
        <button aria-label={copy.sendMessage} disabled={disabled || busy || chatUnavailable || !text.trim()} type="submit">
          <Send aria-hidden="true" size={17} />
        </button>
      </form>
      {error ? <p className="chat-error" role="alert">{error}</p> : null}
      {blockError && !opponentIsBot ? <p className="chat-error" role="alert">{blockError}</p> : null}
    </section>
  );
}
