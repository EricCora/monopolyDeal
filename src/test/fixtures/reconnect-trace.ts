export interface ReconnectTraceSnapshot {
  roomCode: string;
  seatId: string;
  revision: number;
  eventSequence: string[];
  stateSequence: string[];
}

export function formatReconnectTrace(trace: ReconnectTraceSnapshot): string {
  return [
    `room=${trace.roomCode}`,
    `seat=${trace.seatId}`,
    `revision=${trace.revision}`,
    `events=${trace.eventSequence.join(' -> ')}`,
    `states=${trace.stateSequence.join(' -> ')}`,
  ].join(' | ');
}
