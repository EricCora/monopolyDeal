import type { LanRoomView, RoomSession } from '../../network/types';

interface LanPlayScreenProps {
  serverUrl: string;
  playerName: string;
  joinCode: string;
  session: RoomSession | null;
  roomView: LanRoomView | null;
  loading: boolean;
  error: string | null;
  onServerUrlChange: (value: string) => void;
  onPlayerNameChange: (value: string) => void;
  onJoinCodeChange: (value: string) => void;
  onHostRoom: () => void;
  onJoinRoom: () => void;
  onStartRoom: () => void;
  onRefresh: () => void;
  onRunAction: (index: number) => void;
  onBack: () => void;
}

export function LanPlayScreen({
  serverUrl,
  playerName,
  joinCode,
  session,
  roomView,
  loading,
  error,
  onServerUrlChange,
  onPlayerNameChange,
  onJoinCodeChange,
  onHostRoom,
  onJoinRoom,
  onStartRoom,
  onRefresh,
  onRunAction,
  onBack,
}: LanPlayScreenProps) {
  return (
    <section className="panel setup-screen card-enter">
      <h2>LAN Multiplayer (Beta)</h2>
      <p className="setup-subtitle">Play over home Wi-Fi using a local room code and an authoritative host server.</p>

      <label>
        Server URL
        <input value={serverUrl} onChange={(event) => onServerUrlChange(event.target.value)} />
      </label>
      <label>
        Your Name
        <input value={playerName} onChange={(event) => onPlayerNameChange(event.target.value)} />
      </label>

      <div className="actions">
        <button type="button" onClick={onHostRoom} disabled={loading}>
          Host Room
        </button>
      </div>

      <label>
        Room Code
        <input value={joinCode} onChange={(event) => onJoinCodeChange(event.target.value.toUpperCase())} />
      </label>
      <div className="actions">
        <button type="button" onClick={onJoinRoom} disabled={loading}>
          Join Room
        </button>
      </div>

      {session ? (
        <section className="settings-section" aria-label="LAN room session">
          <h3>Room {session.roomCode}</h3>
          <p>Player id: {session.playerId}</p>
          <div className="actions">
            <button type="button" onClick={onRefresh} disabled={loading}>
              Refresh
            </button>
            <button type="button" onClick={onStartRoom} disabled={loading}>
              Start Match
            </button>
          </div>
        </section>
      ) : null}

      {roomView ? (
        <section className="settings-section" aria-label="LAN room state">
          <h3>{roomView.started ? 'Match Live' : 'Lobby'}</h3>
          <p>{roomView.winnerId ? `Winner: ${roomView.winnerId}` : roomView.promptPlayerId ? `Prompt: ${roomView.promptPlayerId}` : 'Waiting to start.'}</p>
          <ul>
            {roomView.players.map((player) => (
              <li key={player.id}>
                {player.name} ({player.id}) - hand {player.handCount}, bank {player.bankCount}, sets {player.completeSets}
              </li>
            ))}
          </ul>
          {roomView.legalActions.length > 0 ? (
            <div className="actions">
              {roomView.legalActions.map((item, index) => (
                <button key={`lan-action-${index}`} type="button" onClick={() => onRunAction(index)} disabled={loading}>
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      <div className="actions">
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </section>
  );
}
