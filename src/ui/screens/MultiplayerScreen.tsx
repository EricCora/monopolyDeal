import { useEffect, useMemo, useState } from 'react';
import type {
  MultiplayerConnectionState,
  MultiplayerPushState,
  MultiplayerRoomView,
  MultiplayerSession,
} from '../../network/multiplayerTypes';

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
  errorCode?: string | null;
  recoveryNotice?: { roomCode: string; reason: 'room_not_found' | 'reconnect_expired' } | null;
  connectionState: MultiplayerConnectionState;
  pushState: MultiplayerPushState;
  isHost: boolean;
  onPlayerNameChange: (value: string) => void;
  onJoinCodeChange: (value: string) => void;
  onHostRoom: () => void;
  onJoinRoom: () => void;
  onStartMatch: (checkpointId?: string) => void;
  onRunAction: (index: number) => void;
  onSetReady: (ready: boolean) => void;
  onCopyInviteLink: () => void;
  onRefresh: () => void;
  onLeaveRoom: () => void;
  onClearRecoveryNotice?: () => void;
  onBack: () => void;
}

function connectionLabel(state: MultiplayerConnectionState): string {
  if (state === 'connected') return 'Connected';
  if (state === 'connecting') return 'Connecting';
  if (state === 'reconnecting') return 'Reconnecting';
  if (state === 'disconnected') return 'Disconnected';
  return 'Idle';
}

function pushLabel(state: MultiplayerPushState): string {
  if (state === 'connected') return 'Live updates active';
  if (state === 'connecting') return 'Connecting live updates';
  if (state === 'fallback') return 'Live updates unavailable, using polling';
  if (state === 'unsupported') return 'Live updates unsupported on this browser';
  return 'Live updates disabled';
}

function connectionTone(state: MultiplayerConnectionState): 'is-positive' | 'is-neutral' | 'is-warning' | 'is-danger' {
  if (state === 'connected') return 'is-positive';
  if (state === 'connecting') return 'is-neutral';
  if (state === 'reconnecting') return 'is-warning';
  if (state === 'disconnected') return 'is-danger';
  return 'is-neutral';
}

function pushTone(state: MultiplayerPushState): 'is-positive' | 'is-neutral' | 'is-warning' {
  if (state === 'connected') return 'is-positive';
  if (state === 'connecting') return 'is-neutral';
  if (state === 'fallback' || state === 'unsupported') return 'is-warning';
  return 'is-neutral';
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

function reactionEmoji(reaction: string | undefined): string {
  if (reaction === 'nice') return '👏';
  if (reaction === 'wow') return '😮';
  if (reaction === 'gg') return '🏁';
  if (reaction === 'oops') return '😅';
  return '💬';
}

function recoveryReasonText(reason: 'room_not_found' | 'reconnect_expired'): string {
  if (reason === 'reconnect_expired') {
    return 'Your reconnect window expired for that room.';
  }
  return 'That room no longer exists on the server.';
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
  errorCode = null,
  recoveryNotice = null,
  connectionState,
  pushState,
  isHost,
  onPlayerNameChange,
  onJoinCodeChange,
  onHostRoom,
  onJoinRoom,
  onStartMatch,
  onRunAction,
  onSetReady,
  onCopyInviteLink,
  onRefresh,
  onLeaveRoom,
  onClearRecoveryNotice,
  onBack,
}: MultiplayerScreenProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 450);
    return () => window.clearInterval(timer);
  }, []);

  const copyRoomCode = () => {
    if (!session) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(session.roomCode);
  };

  const copyInviteLink = () => {
    if (!session) return;
    if (typeof window === 'undefined') return;
    const inviteLink = `${window.location.origin}/join/${session.roomCode}`;
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(inviteLink);
    onCopyInviteLink();
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

  const you = session && roomView
    ? roomView.players.find((player) => player.id === session.playerId) ?? null
    : null;
  const staleRoomNotice = useMemo<{ roomCode: string; reason: 'room_not_found' | 'reconnect_expired' } | null>(() => {
    if (recoveryNotice) return recoveryNotice;
    if (!session) return null;
    if (errorCode === 'room_not_found' || errorCode === 'reconnect_expired') {
      return { roomCode: session.roomCode, reason: errorCode };
    }
    return null;
  }, [errorCode, recoveryNotice, session]);
  const recentReactionsByPlayerId = useMemo(() => {
    if (!roomView) return new Map<string, string>();
    const map = new Map<string, string>();
    roomView.activityFeed
      .filter((item) => item.kind === 'reaction' && item.playerId && now - item.createdAt <= 2_400)
      .sort((left, right) => right.createdAt - left.createdAt)
      .forEach((item) => {
        if (!item.playerId || map.has(item.playerId)) return;
        map.set(item.playerId, reactionEmoji(item.reaction));
      });
    return map;
  }, [now, roomView]);

  return (
    <section className="panel setup-screen multiplayer-screen card-enter">
      <h2>Multiplayer</h2>
      <p className="setup-subtitle">
        {isLocalDevApi
          ? 'Local testing uses a local multiplayer service.'
          : 'Create or join with a private room code or invite link.'}
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
          {staleRoomNotice ? (
            <section className="multiplayer-recovery-shell" aria-label="Previous room recovery">
              <h3>Previous Room Unavailable</h3>
              <p>
                Room <strong>{staleRoomNotice.roomCode}</strong> is no longer active. {recoveryReasonText(staleRoomNotice.reason)}
              </p>
              <p>You can host a new room or rejoin with another room code below.</p>
              {onClearRecoveryNotice ? (
                <div className="actions multiplayer-primary-actions">
                  <button type="button" onClick={onClearRecoveryNotice}>
                    Dismiss Notice
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="multiplayer-entry-grid">
            <section className="multiplayer-entry-card" aria-label="Host room">
              <h3>Host Room</h3>
              <p>Create a private table and share the invite link with your group.</p>
              <label>
                Your Name
                <input value={playerName} onChange={(event) => onPlayerNameChange(event.target.value)} />
              </label>
              <div className="actions multiplayer-primary-actions">
                <button type="button" className="cta-primary" onClick={onHostRoom} disabled={loading}>
                  Host Multiplayer Game
                </button>
              </div>
            </section>

            <section className="multiplayer-entry-card" aria-label="Join room">
              <h3>Join Room</h3>
              <p>Use a room code or invite URL to jump straight into the lobby.</p>
              <label>
                Join Code
                <input
                  value={joinCode}
                  onChange={(event) => onJoinCodeChange(event.target.value)}
                  placeholder="Enter room code"
                />
              </label>
              <div className="actions multiplayer-primary-actions">
                <button type="button" onClick={onJoinRoom} disabled={loading || joinCode.trim().length < 4}>
                  Join Multiplayer Game
                </button>
              </div>
            </section>
          </div>
        </>
      ) : (
        <div className="multiplayer-room-shell">
          <section className="multiplayer-room-hero" aria-label="Room session">
            <div className="multiplayer-room-heading">
              <h3>Room {session.roomCode}</h3>
              <div className="multiplayer-status-strip" aria-label="Room connection status">
                <span className={`multiplayer-status-pill ${connectionTone(connectionState)}`}>
                  {connectionLabel(connectionState)}
                </span>
                <span className={`multiplayer-status-pill ${pushTone(pushState)}`}>
                  {pushLabel(pushState)}
                </span>
              </div>
            </div>
            <p className="multiplayer-room-rejoin">Rejoin window: {deadlineLabel(session.reconnectDeadlineMs)}</p>
            <div className="actions multiplayer-room-actions">
              <button type="button" onClick={copyRoomCode} disabled={loading}>
                Copy Room Code
              </button>
              <button type="button" className="cta-primary" onClick={copyInviteLink} disabled={loading}>
                Copy Invite Link
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
            <section className="multiplayer-lobby-shell" aria-label="Room state">
              <header className="multiplayer-lobby-header">
                <h3>{roomView.started ? 'Match Live' : 'Lobby'}</h3>
                <p className="multiplayer-lobby-status">
                  {roomView.winnerId
                    ? `Winner: ${roomView.winnerId}`
                    : roomView.promptPlayerId
                      ? `Turn: ${roomView.promptPlayerId}`
                      : 'Waiting for players.'}
                </p>
              </header>
              {!roomView.started && you ? (
                <div className="actions multiplayer-ready-actions">
                  <button type="button" className="cta-primary" onClick={() => onSetReady(!you.ready)} disabled={loading}>
                    {you.ready ? 'Mark Not Ready' : 'Mark Ready'}
                  </button>
                </div>
              ) : null}

              <div className="multiplayer-roster-wrap">
                <table className="multiplayer-roster-table">
                  <caption className="sr-only">Room roster</caption>
                  <thead>
                    <tr>
                      <th scope="col">Player</th>
                      <th scope="col">Status</th>
                      <th scope="col">Hand</th>
                      <th scope="col">Bank</th>
                      <th scope="col">Sets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roomView.players.map((player) => (
                      <tr key={player.id} className={player.id === session.playerId ? 'is-self' : undefined}>
                        <td className="multiplayer-player-cell">
                          <span className="multiplayer-player-name">{player.name}</span>
                          <span className="multiplayer-player-tags">
                            {player.id === session.playerId ? <span className="multiplayer-player-tag is-self">You</span> : null}
                            {player.isHost ? <span className="multiplayer-player-tag">Host</span> : null}
                            {player.ready ? <span className="multiplayer-player-tag is-ready">Ready</span> : null}
                          </span>
                          {recentReactionsByPlayerId.get(player.id) ? (
                            <span className="multiplayer-reaction-burst" aria-label={`${player.name} sent a reaction`}>
                              {recentReactionsByPlayerId.get(player.id)}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <span className={`multiplayer-connection-chip ${player.connected ? 'is-online' : 'is-offline'}`}>
                            {playerConnectionLabel(player.connected, player.lastSeenAt)}
                          </span>
                        </td>
                        <td>{player.handCount}</td>
                        <td>{player.bankCount}</td>
                        <td>{player.completeSets}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {roomView.legalActions.length > 0 ? (
                <div className="actions multiplayer-lobby-legal-actions">
                  {roomView.legalActions.map((item, index) => (
                    <button key={`multiplayer-action-${index}`} type="button" onClick={() => onRunAction(index)} disabled={loading}>
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="multiplayer-lobby-waiting">Waiting for your turn or for the host to start.</p>
              )}

              {roomView.activityFeed.length > 0 ? (
                <section className="multiplayer-activity-panel" aria-label="Recent room activity">
                  <h4>Recent Activity</h4>
                  <ul className="multiplayer-activity-feed">
                    {roomView.activityFeed.slice(0, 8).map((item) => (
                      <li key={item.id} className={item.kind === 'reaction' ? 'is-reaction' : undefined}>
                        {item.kind === 'reaction' ? <span className="multiplayer-activity-emoji">{reactionEmoji(item.reaction)}</span> : null}
                        <span>{item.message}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </section>
          ) : (
            staleRoomNotice ? (
              <section className="multiplayer-lobby-shell multiplayer-recovery-shell" aria-label="Room recovery">
                <header className="multiplayer-lobby-header">
                  <h3>Room Session Ended</h3>
                  <p className="multiplayer-lobby-status">Could not restore room {staleRoomNotice.roomCode}.</p>
                </header>
                <p>{recoveryReasonText(staleRoomNotice.reason)} Use host/join to continue.</p>
                {onClearRecoveryNotice ? (
                  <div className="actions multiplayer-primary-actions">
                    <button type="button" onClick={onClearRecoveryNotice}>Dismiss Notice</button>
                  </div>
                ) : null}
              </section>
            ) : (
              <section className="multiplayer-lobby-shell is-loading" aria-label="Loading room state">
                <header className="multiplayer-lobby-header">
                  <h3>Syncing Room...</h3>
                  <p className="multiplayer-lobby-status">Fetching latest players and state.</p>
                </header>
                <div className="multiplayer-skeleton-row" />
                <div className="multiplayer-skeleton-row" />
                <div className="multiplayer-skeleton-row is-wide" />
                <div className="multiplayer-skeleton-grid">
                  <div className="multiplayer-skeleton-cell" />
                  <div className="multiplayer-skeleton-cell" />
                  <div className="multiplayer-skeleton-cell" />
                  <div className="multiplayer-skeleton-cell" />
                </div>
              </section>
            )
          )}
        </div>
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
