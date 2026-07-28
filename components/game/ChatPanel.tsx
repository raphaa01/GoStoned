"use client";

import { MessageCircle, Send } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { GameMessage } from "@/lib/game/chatService";
import { localizedApiError } from "@/lib/i18n/dictionary";

type ChatPanelProps = {
  messages: GameMessage[];
  playerKey: string;
  disabled: boolean;
  onSend: (message: string) => Promise<void>;
};

export function ChatPanel({ messages, playerKey, disabled, onSend }: ChatPanelProps) {
  const { dictionary } = useI18n();
  const copy = dictionary.game;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = text.trim();
    if (!message || busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(message);
      setText("");
    } catch (sendError) {
      setError(localizedApiError(dictionary, sendError, copy.sendFailed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="chat-panel">
      <header><MessageCircle size={18} /><strong>{copy.chatTitle}</strong></header>
      <div className="chat-list" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
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
      <form className="chat-form" onSubmit={submit}>
        <input
          aria-label={copy.chatMessage}
          disabled={disabled || busy}
          maxLength={500}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError(null);
          }}
          placeholder={disabled ? copy.chatUnavailable : copy.writeMessage}
          value={text}
        />
        <button aria-label={copy.sendMessage} disabled={disabled || busy || !text.trim()} type="submit">
          <Send size={17} />
        </button>
      </form>
      {error ? <p className="chat-error" role="alert">{error}</p> : null}
    </section>
  );
}
