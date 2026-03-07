import type { PlayerId } from '../../../src/engine/index.ts';

export interface SocketSeatBinding {
  roomCode: string;
  seatId: PlayerId;
  sessionToken: string;
}

export function roomSeatKey(roomCode: string, seatId: PlayerId): string {
  return `${roomCode}:${seatId}`;
}

export class SocketSessionRegistry {
  private readonly roomSocketBindings = new Map<string, string>();
  private readonly socketSeatBindings = new Map<string, SocketSeatBinding>();
  private readonly serverInitiatedDisconnects = new Set<string>();

  getActiveSocketId(roomCode: string, seatId: PlayerId): string | null {
    return this.roomSocketBindings.get(roomSeatKey(roomCode, seatId)) ?? null;
  }

  hasActiveConflict(roomCode: string, seatId: PlayerId, socketId: string): boolean {
    const activeSocketId = this.getActiveSocketId(roomCode, seatId);
    return Boolean(activeSocketId && activeSocketId !== socketId);
  }

  getBinding(socketId: string): SocketSeatBinding | null {
    const binding = this.socketSeatBindings.get(socketId);
    if (!binding) return null;
    if (this.getActiveSocketId(binding.roomCode, binding.seatId) !== socketId) {
      this.socketSeatBindings.delete(socketId);
      this.serverInitiatedDisconnects.delete(socketId);
      return null;
    }
    return binding;
  }

  bind(socketId: string, binding: SocketSeatBinding): string | null {
    const key = roomSeatKey(binding.roomCode, binding.seatId);
    const previousSocketId = this.roomSocketBindings.get(key) ?? null;
    this.roomSocketBindings.set(key, socketId);
    this.socketSeatBindings.set(socketId, binding);
    return previousSocketId && previousSocketId !== socketId ? previousSocketId : null;
  }

  unbind(socketId: string): SocketSeatBinding | null {
    const binding = this.socketSeatBindings.get(socketId);
    this.serverInitiatedDisconnects.delete(socketId);
    if (!binding) return null;
    this.socketSeatBindings.delete(socketId);
    const key = roomSeatKey(binding.roomCode, binding.seatId);
    if (this.roomSocketBindings.get(key) === socketId) {
      this.roomSocketBindings.delete(key);
    }
    return binding;
  }

  markServerInitiatedDisconnect(socketId: string): void {
    this.serverInitiatedDisconnects.add(socketId);
  }

  consumeServerInitiatedDisconnect(socketId: string): boolean {
    return this.serverInitiatedDisconnects.delete(socketId);
  }

  clearRoom(roomCode: string): void {
    for (const [socketId, binding] of this.socketSeatBindings) {
      if (binding.roomCode !== roomCode) continue;
      this.socketSeatBindings.delete(socketId);
      this.serverInitiatedDisconnects.delete(socketId);
      const key = roomSeatKey(binding.roomCode, binding.seatId);
      if (this.roomSocketBindings.get(key) === socketId) {
        this.roomSocketBindings.delete(key);
      }
    }
  }
}
