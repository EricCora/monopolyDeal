import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  MultiplayerActivityFeedItem,
  MultiplayerChatMessage,
  MultiplayerReaction,
} from '../../network/multiplayerTypes';

interface MultiplayerChatDockProps {
  messages: MultiplayerChatMessage[];
  activityFeed?: MultiplayerActivityFeedItem[];
  typingNames: string[];
  yourPlayerId: string;
  yourName: string;
  isOpen: boolean;
  unreadCount: number;
  disabled?: boolean;
  reactionsEnabled?: boolean;
  shellTone?: 'table-live' | 'lobby-live';
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

interface ChatPanelProps {
  activityFeed: MultiplayerActivityFeedItem[];
  orderedMessages: MultiplayerChatMessage[];
  typingNames: string[];
  yourPlayerId: string;
  yourName: string;
  disabled: boolean;
  reactionsEnabled: boolean;
  shellTone: 'table-live' | 'lobby-live';
  onToggle: () => void;
  onSendMessage: (text: string) => void;
  onSendReaction?: (reaction: MultiplayerReaction) => void;
  onTypingChange: (typing: boolean) => void;
  draft: string;
  setDraft: (next: string) => void;
}

function ChatPanel({
  activityFeed,
  orderedMessages,
  typingNames,
  yourPlayerId,
  yourName,
  disabled,
  reactionsEnabled,
  shellTone,
  onToggle,
  onSendMessage,
  onSendReaction,
  onTypingChange,
  draft,
  setDraft,
}: ChatPanelProps) {
  const [pinnedToRecent, setPinnedToRecent] = useState(true);
  const messageListRef = useRef<HTMLUListElement | null>(null);
  const recentActivity = activityFeed.slice(0, 4);
  const typingText = typingNames.length > 0
    ? `${typingNames.join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} typing...`
    : 'No one typing';

  useEffect(() => {
    if (!pinnedToRecent || !messageListRef.current) return;
    const list = messageListRef.current;
    if (typeof list.scrollTo === 'function') {
      list.scrollTo({ top: list.scrollHeight, behavior: 'auto' });
      return;
    }
    list.scrollTop = list.scrollHeight;
  }, [orderedMessages, pinnedToRecent]);

  return (
    <div className={`chat-panel panel card-enter shell-${shellTone}`} role="dialog" aria-label="Room chat">
      <header className="chat-panel-head">
        <div className="chat-panel-title">
          <p className="chat-panel-kicker">Live Room Rail</p>
          <h3>Room Chat</h3>
          <p className="chat-panel-note">Table talk, reactions, and room activity stay grouped here.</p>
        </div>
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

      {recentActivity.length > 0 ? (
        <div className="chat-activity-strip" aria-label="Recent room activity">
          {recentActivity.map((entry) => (
            <div
              key={entry.id}
              className={`chat-activity-chip kind-${entry.kind} ${entry.kind === 'reaction' ? 'is-reaction' : ''}`}
            >
              {entry.kind === 'reaction' ? (
                <span className="chat-activity-emoji" aria-hidden="true">{reactionEmoji(entry.reaction)}</span>
              ) : null}
              <span>{entry.message}</span>
            </div>
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
      <p className={`chat-typing ${typingNames.length > 0 ? 'is-active' : ''}`} aria-live="polite">
        <span className="chat-typing-pulse" aria-hidden="true" />
        <span>{typingText}</span>
      </p>
    </div>
  );
}

function reactionEmoji(reaction: MultiplayerReaction | undefined): string {
  if (reaction === 'nice') return '👏';
  if (reaction === 'wow') return '😮';
  if (reaction === 'gg') return '🏁';
  if (reaction === 'oops') return '😅';
  return '•';
}

export function MultiplayerChatDock({
  messages,
  activityFeed = [],
  typingNames,
  yourPlayerId,
  yourName,
  isOpen,
  unreadCount,
  disabled = false,
  reactionsEnabled = false,
  shellTone = 'table-live',
  onToggle,
  onSendMessage,
  onSendReaction,
  onTypingChange,
}: MultiplayerChatDockProps) {
  const [draft, setDraft] = useState('');
  const orderedMessages = useMemo(
    () => [...messages].sort((left, right) => left.createdAt - right.createdAt),
    [messages],
  );
  const unreadLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <section className={`multiplayer-chat-dock ${isOpen ? 'is-open' : ''} shell-${shellTone}`} aria-label="Multiplayer chat">
      <button type="button" className="chat-pill" onClick={onToggle} aria-expanded={isOpen}>
        <span className="chat-pill-dot" aria-hidden="true" />
        Chat
        {unreadCount > 0 ? <span className="chat-pill-unread" aria-label={`${unreadCount} unread messages`}>{unreadLabel}</span> : null}
      </button>

      {isOpen ? (
        <ChatPanel
          activityFeed={activityFeed}
          orderedMessages={orderedMessages}
          typingNames={typingNames}
          yourPlayerId={yourPlayerId}
          yourName={yourName}
          disabled={disabled}
          reactionsEnabled={reactionsEnabled}
          shellTone={shellTone}
          onToggle={onToggle}
          onSendMessage={onSendMessage}
          onSendReaction={onSendReaction}
          onTypingChange={onTypingChange}
          draft={draft}
          setDraft={setDraft}
        />
      ) : null}
    </section>
  );
}
