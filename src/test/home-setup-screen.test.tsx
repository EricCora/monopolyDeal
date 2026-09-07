import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeScreen } from '../ui/screens/HomeScreen';
import { SetupScreen } from '../ui/screens/SetupScreen';

describe('Home and setup screens', () => {
  it('keeps the flagship hero actions and utility tools visible on the home screen', () => {
    render(
      <HomeScreen
        error={null}
        showDailyChallenge
        dailyChallenge={{
          targetTurns: 5,
          completed: false,
          attempts: 2,
          bestTurnCount: 6,
        }}
        showAchievements
        achievementSummary={{ unlocked: 4, total: 10 }}
        showMultiplayer
        onNewGame={vi.fn()}
        onStartPracticeGame={vi.fn()}
        onStartDailyChallenge={vi.fn()}
        onResumeGame={vi.fn()}
        onOpenSavedGames={vi.fn()}
        onOpenStats={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenMultiplayer={vi.fn()}
      />,
    );

    expect(screen.getByText(/premium tabletop match night/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start hot seat/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open live room/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/quick match facts/i)).toBeInTheDocument();
    expect(screen.getByText(/2-5/i)).toBeInTheDocument();
    expect(screen.getByText(/jump back into active tables/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resume saved game/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/daily challenge summary/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/achievements summary/i)).toBeInTheDocument();
  });

  it('shows the setup snapshot and preserves start flow controls', () => {
    const onPlayerCountChange = vi.fn();
    const onStartMatch = vi.fn();

    render(
      <SetupScreen
        setup={{
          playerCount: 3,
          playerNames: ['Player 1', 'Player 2', 'Player 3', 'Player 4'],
          playerControllers: ['human', 'human', 'bot', 'human'],
          botDifficulties: ['easy', 'easy', 'hard', 'easy'],
          customRules: {
            winCompleteSets: 3,
            maxHandAtEndTurn: 7,
            maxPlaysPerTurn: 3,
          },
        }}
        allowAiOpponents
        allowCustomRules
        onPlayerCountChange={onPlayerCountChange}
        onPlayerNameChange={vi.fn()}
        onPlayerControllerChange={vi.fn()}
        onPlayerDifficultyChange={vi.fn()}
        onChangeCustomRule={vi.fn()}
        onStartMatch={onStartMatch}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText(/set the table/i)).toBeInTheDocument();
    expect(screen.getByText(/3 seats · 3 sets to win/i)).toBeInTheDocument();
    expect(screen.getByText(/house rules/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/total players/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));

    expect(onPlayerCountChange).toHaveBeenCalledWith(5);
    expect(onStartMatch).toHaveBeenCalledTimes(1);
  });
});
