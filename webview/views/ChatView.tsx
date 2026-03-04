import React, { useState, useRef, useEffect } from "react";
import { BackButton } from "../components/BackButton";

interface Message {
  role: string;
  content: string;
}

interface ChatViewProps {
  messages: Message[];
  onSend: (message: string) => void;
  onNavigate: (view: string) => void;
}

const SUGGESTIONS = [
  "Explain this file's purpose",
  "What are the main dependencies?",
  "How can I optimise this code?",
  "Generate unit tests",
];

function formatContent(text: string): string {
  return text
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="inline-code-block"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
}

export function ChatView({ messages, onSend, onNavigate }: ChatViewProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isLastMessageFromUser =
    messages.length > 0 && messages[messages.length - 1].role === "user";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLastMessageFromUser) return;
    setInput("");
    onSend(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="view-container chat-view-container">
      <div className="view-header">
        <BackButton onNavigate={onNavigate} />
        <span className="view-header-title">Chat</span>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <i className="codicon codicon-comment-discussion chat-welcome-icon" />
            <h3>Ask Zerly anything</h3>
            <p>Ask about your codebase, get explanations, or request improvements.</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s, i) => (
                <button key={i} className="suggestion-chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble chat-bubble-${msg.role}`}>
            <div className="chat-bubble-avatar">
              <i className={`codicon codicon-${msg.role === "user" ? "account" : "hubot"}`} />
            </div>
            <div
              className="chat-bubble-content"
              dangerouslySetInnerHTML={{ __html: formatContent(msg.content) }}
            />
          </div>
        ))}

        {isLastMessageFromUser && (
          <div className="chat-bubble chat-bubble-assistant">
            <div className="chat-bubble-avatar">
              <i className="codicon codicon-hubot" />
            </div>
            <div className="chat-bubble-content chat-typing">
              <i className="codicon codicon-loading codicon-modifier-spin" />
              <span>Thinking…</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="chat-input-form">
        <div className="chat-input-wrap">
          <textarea
            ref={inputRef}
            className="chat-textarea"
            placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
          />
          <button
            className="chat-send-btn"
            disabled={!input.trim() || isLastMessageFromUser}
            onClick={() => send(input)}
            title="Send (Enter)"
          >
            <i className="codicon codicon-send" />
          </button>
        </div>
        <div className="chat-input-footer">
          <span className="shortcut-badge">↵ Send</span>
          <span className="shortcut-badge">⇧↵ Newline</span>
        </div>
      </div>
    </div>
  );
}
