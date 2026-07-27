"use client";

import { MessageCircle, Send } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { GameMessage } from "@/lib/game/chatService";

type ChatPanelProps = {
  messages: GameMessage[];
  playerKey: string;
  disabled: boolean;
  onSend: (message: string) => Promise<void>;
};

export function ChatPanel({ messages, playerKey, disabled, onSend }: ChatPanelProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = text.trim();
    if (!message || busy || disabled) return;
    setBusy(true);
    try {
      await onSend(message);
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="chat-panel">
      <header><MessageCircle size={18} /><strong>Game chat</strong></header>
      <div className="chat-list" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <p className="chat-empty">No messages yet. Say hello to your opponent.</p>
        ) : messages.map((message) => (
          <div
            className={`chat-message ${message.playerKey === playerKey ? "is-mine" : ""}`}
            key={message.id}
          >
            <strong>{message.playerKey === playerKey ? "You" : message.playerName}</strong>
            <p>{message.message}</p>
          </div>
        ))}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input
          aria-label="Chat message"
          disabled={disabled || busy}
          maxLength={500}
          onChange={(event) => setText(event.target.value)}
          placeholder={disabled ? "Chat unavailable" : "Write a message…"}
          value={text}
        />
        <button aria-label="Send message" disabled={disabled || busy || !text.trim()} type="submit">
          <Send size={17} />
        </button>
      </form>
    </section>
  );
}
