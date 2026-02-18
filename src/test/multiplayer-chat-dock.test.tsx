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
});
