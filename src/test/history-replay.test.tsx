import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { chooseHeuristicAction } from '../ai';
import { applyAction, createGame, getLegalActions, getNextPrompt, isGameOver, type Action, type GameState } from '../engine';
import type { StoredReplay } from '../persistence/replays';
import { buildMatchRecord } from '../stats';
import { loadGrowthMetrics as defaultGrowthMetrics } from '../persistence/storage';
import { StatsScreen } from '../ui/screens/StatsScreen';

function played(): { record: ReturnType<typeof buildMatchRecord>; replay: StoredReplay } {
  const initial = createGame({ seed: 4, players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bo' }] });
  let state: GameState = initial;
  const actions: Action[] = [];
  while (!isGameOver(state).done) {
    const actor = getNextPrompt(state).playerId;
    const legal = getLegalActions(state, actor);
    const action = chooseHeuristicAction(state, actor, legal)?.action ?? legal[0].action;
    state = applyAction(state, action).state;
    actions.push(action);
  }
  const record = buildMatchRecord(state, { mode: 'practice', surface: 'local' });
  return { record, replay: { id: record.id, endedAt: record.endedAt, title: 'Game', initial, actions } };
}

describe('a match in the history', () => {
  it('opens its game log and its replay', async () => {
    const { record, replay } = played();
    const onWatchReplay = vi.fn();
    render(
      <StatsScreen history={[record]} lifetime={{ version: 1, players: {} } as never} growthMetrics={defaultGrowthMetrics()} replays={[replay]} onWatchReplay={onWatchReplay} onBack={() => undefined} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }, { timeout: 5000 }));
    expect(screen.getByRole('region', { name: 'Game log' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /watch replay/i }));
    expect(onWatchReplay).toHaveBeenCalledWith(replay);
  });

  it('has nothing to open without a saved replay', async () => {
    const { record } = played();
    render(
      <StatsScreen history={[record]} lifetime={{ version: 1, players: {} } as never} growthMetrics={defaultGrowthMetrics()} replays={[]} onWatchReplay={() => undefined} onBack={() => undefined} />,
    );
    await screen.findByRole('heading', { name: /match history/i }, { timeout: 5000 });
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
  });
});
