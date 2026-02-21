import { useEffect, useMemo, useRef, useState } from 'react';
import type { MultiplayerChatMessage, MultiplayerReaction } from '../../network/multiplayerTypes';

interface MultiplayerChatDockProps {
  messages: MultiplayerChatMessage[];
  typingNames: string[];
  yourPlayerId: string;
  yourName: string;
  isOpen: boolean;
  unreadCount: number;
  disabled?: boolean;
  reactionsEnabled?: boolean;
  onToggle: () => void;
  onSendMessage: (text: string) => void;
  onSendReaction?: (reaction: MultiplayerReaction) => void;
  onTypingChange: (typing: boolean) => void;
}

const QUICK_REACTIONS: Array<{ id: MultiplayerReaction; emoji: string; label: string }> = [
  { id: 'nice', emoji: '👏', label: 'Nice' },
  { id: 'wow', emoji: '😮', label: 'Wow' },
  { id: 'gg', emoji: '🏁', label: 'GG' },
  { id: 'oops', emoji: '😅', label: 'Oops' },
];

function isMentioned(message: string, yourName: string): boolean {
  const normalized = yourName.trim().toLowerCase();
  if (!normalized) return false;
  return message.toLowerCase().includes(`@${normalized}`);
}

export function MultiplayerChatDock({
  messages,
  typingNames,
  yourPlayerId,
  yourName,
  isOpen,
  unreadCount,
  disabled = false,
  reactionsEnabled = false,
  onToggle,
  onSendMessage,
  onSendReaction,
  onTypingChange,
}: MultiplayerChatDockProps) {
  const [draft, setDraft] = useState('');
  const [pinnedToRecent, setPinnedToRecent] = useState(true);
  const messageListRef = useRef<HTMLUListElement | null>(null);
  const orderedMessages = useMemo(
    () => [...messages].sort((left, right) => left.createdAt - right.createdAt),
    [messages],
  );
  const unreadLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  useEffect(() => {
    if (!isOpen || !pinnedToRecent || !messageListRef.current) return;
    const list = messageListRef.current;
    if (typeof list.scrollTo === 'function') {
      list.scrollTo({ top: list.scrollHeight, behavior: 'auto' });
      return;
    }
    list.scrollTop = list.scrollHeight;
  }, [isOpen, orderedMessages, pinnedToRecent]);

  useEffect(() => {
    if (!isOpen) return;
    setPinnedToRecent(true);
  }, [isOpen]);

  return (
    <section className={`multiplayer-chat-dock ${isOpen ? 'is-open' : ''}`} aria-label="Multiplayer chat">
      <button type="button" className="chat-pill" onClick={onToggle} aria-expanded={isOpen}>
        Chat
        {unreadCount > 0 ? <span className="chat-pill-unread" aria-label={`${unreadCount} unread messages`}>{unreadLabel}</span> : null}
      </button>

      {isOpen ? (
        <div className="chat-panel panel card-enter" role="dialog" aria-label="Room chat">
          <header className="chat-panel-head">
            <h3>Room Chat</h3>
            <button type="button" onClick={onToggle}>Close</button>
          </header>

          {reactionsEnabled && onSendReaction ? (
            <div className="chat-reaction-tray" aria-label="Quick reactions">
              {QUICK_REACTIONS.map((reaction) => (
                <button
                  key={reaction.id}
                  type="button"
                  className="chat-reaction-chip"
                  disabled={disabled}
                  onClick={() => onSendReaction(reaction.id)}
                  aria-label={`Send ${reaction.label} reaction`}
                >
                  <span aria-hidden="true">{reaction.emoji}</span>
                  <span>{reaction.label}</span>
                </button>
              ))}
            </div>
          ) : null}

          <ul
            ref={messageListRef}
            className="chat-message-list"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            onScroll={() => {
              if (!messageListRef.current) return;
              const list = messageListRef.current;
              const distanceFromBottom = list.scrollHeight - (list.scrollTop + list.clientHeight);
              setPinnedToRecent(distanceFromBottom <= 16);
            }}
          >
            {orderedMessages.length > 0 ? (
              orderedMessages.map((message) => {
                const own = message.playerId === yourPlayerId;
                const mentioned = !own && isMentioned(message.text, yourName);
                return (
                  <li
                    key={message.id}
                    className={`chat-message ${own ? 'is-own' : ''} ${mentioned ? 'is-mention' : ''}`}
                  >
                    <p className="chat-message-meta">
                      <strong>{own ? 'You' : message.playerName}</strong>
                      <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                    </p>
                    <p className="chat-message-text">{message.text}</p>
                  </li>
                );
              })
            ) : (
              <li className="chat-message-empty">No messages yet. Start the table talk.</li>
            )}
          </ul>

          {!pinnedToRecent && orderedMessages.length > 0 ? (
            <button
              type="button"
              className="chat-recent-jump"
              onClick={() => {
                setPinnedToRecent(true);
                const list = messageListRef.current;
                if (!list) return;
                if (typeof list.scrollTo === 'function') {
                  list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
                  return;
                }
                list.scrollTop = list.scrollHeight;
              }}
            >
              Jump to Recent
            </button>
          ) : null}

          <p className="chat-typing" aria-live="polite">
            {typingNames.length > 0 ? `${typingNames.join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} typing...` : ' '}
          </p>

          <form
            className="chat-compose"
            onSubmit={(event) => {
              event.preventDefault();
              if (disabled) return;
              const message = draft.trim();
              if (!message) return;
              onSendMessage(message);
              setDraft('');
              onTypingChange(false);
            }}
          >
            <input
              type="text"
              value={draft}
              maxLength={280}
              placeholder="Type a message"
              onChange={(event) => {
                const next = event.target.value;
                setDraft(next);
                onTypingChange(next.trim().length > 0);
              }}
              onBlur={() => onTypingChange(false)}
              disabled={disabled}
            />
            <button type="submit" disabled={disabled || draft.trim().length === 0}>Send</button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
