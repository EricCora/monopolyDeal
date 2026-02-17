import type { MultiplayerConnectionState, MultiplayerRoomView, MultiplayerSession } from '../../network/multiplayerTypes';

interface MultiplayerScreenProps {
  playerName: string;
  joinCode: string;
  session: MultiplayerSession | null;
  roomView: MultiplayerRoomView | null;
  loading: boolean;
  healthOk: boolean | null;
  apiBase: string;
  isLocalDevApi: boolean;
  error: string | null;
  connectionState: MultiplayerConnectionState;
  isHost: boolean;
  onPlayerNameChange: (value: string) => void;
  onJoinCodeChange: (value: string) => void;
  onHostRoom: () => void;
  onJoinRoom: () => void;
  onStartMatch: (checkpointId?: string) => void;
  onRunAction: (index: number) => void;
  onRefresh: () => void;
  onLeaveRoom: () => void;
  onBack: () => void;
}

function connectionLabel(state: MultiplayerConnectionState): string {
  if (state === 'connected') return 'Connected';
  if (state === 'connecting') return 'Connecting';
  if (state === 'reconnecting') return 'Reconnecting';
  if (state === 'disconnected') return 'Disconnected';
  return 'Idle';
}

function deadlineLabel(deadlineMs: number): string {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now()) return 'expired';
  const seconds = Math.max(0, Math.floor((deadlineMs - Date.now()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function playerConnectionLabel(connected: boolean, lastSeenAt: number): string {
  if (connected) return 'Connected';
  const secondsAgo = Math.max(0, Math.floor((Date.now() - lastSeenAt) / 1000));
  if (secondsAgo < 60) return `Disconnected (${secondsAgo}s ago)`;
  const minutesAgo = Math.floor(secondsAgo / 60);
  return `Disconnected (${minutesAgo}m ago)`;
}

export function MultiplayerScreen({
  playerName,
  joinCode,
  session,
  roomView,
  loading,
  healthOk,
  apiBase,
  isLocalDevApi,
  error,
  connectionState,
  isHost,
  onPlayerNameChange,
  onJoinCodeChange,
  onHostRoom,
  onJoinRoom,
  onStartMatch,
  onRunAction,
  onRefresh,
  onLeaveRoom,
  onBack,
}: MultiplayerScreenProps) {
  const copyRoomCode = () => {
    if (!session) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(session.roomCode);
  };

  const startFromCheckpoint = () => {
    if (!roomView || roomView.checkpointSlots.length === 0) {
      onStartMatch();
      return;
    }
    if (typeof window === 'undefined') {
      onStartMatch(roomView.checkpointSlots[0].id);
      return;
    }
    const options = roomView.checkpointSlots.map((slot, index) => `${index + 1}. ${slot.name}`).join('\n');
    const chosen = window.prompt(`Resume from which checkpoint?\n${options}`, '1');
    const index = Number(chosen) - 1;
    if (!Number.isFinite(index) || index < 0 || index >= roomView.checkpointSlots.length) return;
    onStartMatch(roomView.checkpointSlots[index].id);
  };

  return (
    <section className="panel setup-screen card-enter">
      <h2>Multiplayer</h2>
      <p className="setup-subtitle">
        {isLocalDevApi
          ? 'Local testing uses a local multiplayer service.'
          : 'Create or join with a private room code.'}
      </p>

      {healthOk === false ? (
        <p className="error">
          {isLocalDevApi
            ? `Multiplayer server not reachable at ${apiBase}. For two-device LAN play run npm run dev:lan:all.`
            : 'Multiplayer service is currently unreachable. Please try again in a moment.'}
        </p>
      ) : null}
      {import.meta.env.DEV ? <p className="setup-subtitle">Multiplayer API: {apiBase}</p> : null}

      {!session ? (
        <>
          <label>
            Your Name
            <input value={playerName} onChange={(event) => onPlayerNameChange(event.target.value)} />
          </label>
          <div className="actions">
            <button type="button" onClick={onHostRoom} disabled={loading}>
              Host Multiplayer Game
            </button>
          </div>

          <label>
            Join Code
            <input
              value={joinCode}
              onChange={(event) => onJoinCodeChange(event.target.value)}
              placeholder="Enter room code"
            />
          </label>
          <div className="actions">
            <button type="button" onClick={onJoinRoom} disabled={loading || joinCode.trim().length < 4}>
              Join Multiplayer Game
            </button>
          </div>
        </>
      ) : (
        <>
          <section className="settings-section" aria-label="Room session">
            <h3>Room {session.roomCode}</h3>
            <p>Status: {connectionLabel(connectionState)}</p>
            <p>Rejoin window: {deadlineLabel(session.reconnectDeadlineMs)}</p>
            <div className="actions">
              <button type="button" onClick={copyRoomCode} disabled={loading}>
                Copy Room Code
              </button>
              <button type="button" onClick={onRefresh} disabled={loading}>
                Refresh
              </button>
              <button type="button" onClick={onLeaveRoom} disabled={loading}>
                Forget Room
              </button>
              {roomView && roomView.canStart && isHost ? (
                <button type="button" onClick={() => onStartMatch()} disabled={loading}>
                  Start Match
                </button>
              ) : null}
              {roomView && roomView.canStart && isHost && roomView.checkpointSlots.length > 0 ? (
                <button type="button" onClick={startFromCheckpoint} disabled={loading}>
                  Start From Checkpoint
                </button>
              ) : null}
            </div>
          </section>

          {roomView ? (
            <section className="settings-section" aria-label="Room state">
              <h3>{roomView.started ? 'Match Live' : 'Lobby'}</h3>
              <p>
                {roomView.winnerId
                  ? `Winner: ${roomView.winnerId}`
                  : roomView.promptPlayerId
                    ? `Turn: ${roomView.promptPlayerId}`
                    : 'Waiting for players.'}
              </p>
              <ul>
                {roomView.players.map((player) => (
                  <li key={player.id}>
                    {player.name}
                    {player.isHost ? ' (Host)' : ''} | {playerConnectionLabel(player.connected, player.lastSeenAt)} | hand {player.handCount} | bank {player.bankCount} | sets {player.completeSets}
                  </li>
                ))}
              </ul>
              {roomView.legalActions.length > 0 ? (
                <div className="actions">
                  {roomView.legalActions.map((item, index) => (
                    <button key={`multiplayer-action-${index}`} type="button" onClick={() => onRunAction(index)} disabled={loading}>
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p>Waiting for your turn or for the host to start.</p>
              )}
            </section>
          ) : null}
        </>
      )}

      {error ? <p className="error">{error}</p> : null}

      <div className="actions">
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </section>
  );
}
