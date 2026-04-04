import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MultiplayerChatDock } from '../ui/components/MultiplayerChatDock';

describe('MultiplayerChatDock', () => {
  it('shows unread count on the collapsed chat pill', () => {
    render(
      <MultiplayerChatDock
        messages={[]}
        typingNames={[]}
        yourPlayerId="p1"
        yourName="Host"
        isOpen={false}
        unreadCount={3}
        onToggle={() => undefined}
        onSendMessage={() => undefined}
        onTypingChange={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: /chat/i })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders mention-highlighted messages and typing indicator', () => {
    render(
      <MultiplayerChatDock
        messages={[
          { id: 1, createdAt: 10, playerId: 'p2', playerName: 'Beta', text: 'hey @host your turn' },
          { id: 2, createdAt: 11, playerId: 'p1', playerName: 'Host', text: 'on it' },
        ]}
        typingNames={['Beta']}
        yourPlayerId="p1"
        yourName="Host"
        isOpen={true}
        unreadCount={0}
        onToggle={() => undefined}
        onSendMessage={() => undefined}
        onTypingChange={() => undefined}
      />,
    );

    const mentionMessage = screen.getByText(/hey @host your turn/i).closest('li');
    expect(mentionMessage).toHaveClass('is-mention');
    expect(screen.getByText(/beta is typing/i)).toBeInTheDocument();
    expect(screen.getByText(/beta is typing/i).closest('.chat-typing')).toHaveClass('is-active');
  });

  it('renders recent room activity inside the open dock shell', () => {
    render(
      <MultiplayerChatDock
        messages={[]}
        activityFeed={[
          { id: 4, createdAt: 12, kind: 'reaction', message: 'Beta reacted wow', playerId: 'p2', reaction: 'wow' },
          { id: 5, createdAt: 13, kind: 'system', message: 'Checkpoint saved' },
        ]}
        typingNames={[]}
        yourPlayerId="p1"
        yourName="Host"
        isOpen={true}
        unreadCount={0}
        shellTone="table-live"
        onToggle={() => undefined}
        onSendMessage={() => undefined}
        onTypingChange={() => undefined}
      />,
    );

    expect(screen.getByLabelText(/recent room activity/i)).toBeInTheDocument();
    expect(screen.getByText(/checkpoint saved/i)).toBeInTheDocument();
    expect(screen.getByText(/beta reacted wow/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/multiplayer chat/i)).toHaveClass('is-open', 'shell-table-live');
    expect(screen.getByRole('dialog', { name: /room chat/i })).toHaveClass('shell-table-live');
  });

  it('sends messages and clears typing state after submit', () => {
    const onSendMessage = vi.fn();
    const onTypingChange = vi.fn();

    render(
      <MultiplayerChatDock
        messages={[]}
        typingNames={[]}
        yourPlayerId="p1"
        yourName="Host"
        isOpen={true}
        unreadCount={0}
        onToggle={() => undefined}
        onSendMessage={onSendMessage}
        onTypingChange={onTypingChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/type a message/i), { target: { value: 'Hello all' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(onSendMessage).toHaveBeenCalledWith('Hello all');
    expect(onTypingChange).toHaveBeenCalledWith(false);
  });

  it('renders quick reaction tray and sends mapped reactions', () => {
    const onSendReaction = vi.fn();

    render(
      <MultiplayerChatDock
        messages={[]}
        typingNames={[]}
        yourPlayerId="p1"
        yourName="Host"
        isOpen={true}
        unreadCount={0}
        reactionsEnabled={true}
        onToggle={() => undefined}
        onSendMessage={() => undefined}
        onSendReaction={onSendReaction}
        onTypingChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /send wow reaction/i }));
    expect(onSendReaction).toHaveBeenCalledWith('wow');
  });

  it('shows jump-to-recent when reading history and hides after jumping back', () => {
    render(
      <MultiplayerChatDock
        messages={[
          { id: 1, createdAt: 10, playerId: 'p2', playerName: 'Beta', text: 'older message' },
          { id: 2, createdAt: 11, playerId: 'p2', playerName: 'Beta', text: 'newer message' },
        ]}
        typingNames={[]}
        yourPlayerId="p1"
        yourName="Host"
        isOpen={true}
        unreadCount={0}
        onToggle={() => undefined}
        onSendMessage={() => undefined}
        onTypingChange={() => undefined}
      />,
    );

    const log = screen.getByRole('log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 520 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(log, 'scrollTop', { configurable: true, writable: true, value: 20 });
    Object.defineProperty(log, 'scrollTo', {
      configurable: true,
      value: vi.fn(({ top }: { top: number }) => {
        (log as HTMLElement).scrollTop = top;
      }),
    });

    fireEvent.scroll(log);
    expect(screen.getByRole('button', { name: /jump to recent/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /jump to recent/i }));
    expect(screen.queryByRole('button', { name: /jump to recent/i })).not.toBeInTheDocument();
  });
});
