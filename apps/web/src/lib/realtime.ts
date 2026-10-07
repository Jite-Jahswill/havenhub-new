'use client';

import type { RealtimeEventPayloads, RealtimeTicketView } from '@havenhub/shared';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';

import { api } from './api/client';

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? 'http://localhost:4000';

/**
 * One shared Socket.IO connection per tab, opened while any component needs
 * it. Every (re)connection asks the API for a fresh single-use ticket using
 * the cookie session, so cookies never cross to the API origin. Events are
 * a delivery hint only: listeners re-sync from REST on every reconnect.
 */
class RealtimeClient {
  private socket: Socket | null = null;
  private users = 0;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private status: RealtimeStatus = 'offline';
  private readonly statusListeners = new Set<() => void>();
  private readonly reconnectListeners = new Set<() => void>();

  acquire(): () => void {
    this.users++;
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    if (!this.socket) this.open();
    return () => {
      this.users--;
      if (this.users > 0) return;
      // A short grace period: navigating between pages (or React's development
      // double-mount) re-acquires immediately and keeps the same connection.
      this.closeTimer = setTimeout(() => {
        this.closeTimer = null;
        if (this.users > 0) return;
        this.socket?.disconnect();
        this.socket = null;
        this.setStatus('offline');
      }, 3000);
    };
  }

  on<E extends keyof RealtimeEventPayloads>(
    event: E,
    handler: (payload: RealtimeEventPayloads[E]) => void,
  ) {
    const socket = this.socket;
    socket?.on(event, handler as never);
    return () => {
      socket?.off(event, handler as never);
    };
  }

  emit(event: string, payload: unknown) {
    if (this.socket?.connected) this.socket.emit(event, payload);
  }

  onReconnect(listener: () => void) {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  subscribe = (listener: () => void) => {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  };

  getStatus = () => this.status;

  private open() {
    this.setStatus('connecting');
    const socket = io(REALTIME_URL, {
      path: '/realtime',
      transports: ['websocket'],
      withCredentials: false,
      auth: (cb) => {
        void api<RealtimeTicketView>('POST', '/realtime/ticket').then((res) =>
          cb(res.success ? { ticket: res.data.ticket } : {}),
        );
      },
    });
    let connectedBefore = false;
    socket.on('connect', () => {
      this.setStatus('live');
      if (connectedBefore) for (const l of this.reconnectListeners) l();
      connectedBefore = true;
    });
    // The server ends sessions with an explicit disconnect (no automatic
    // retry); anything else — a deploy, a network drop — reconnects by itself.
    socket.on('disconnect', (reason) =>
      this.setStatus(reason === 'io server disconnect' ? 'offline' : 'connecting'),
    );
    socket.on('connect_error', () => this.setStatus('offline'));
    socket.io.on('reconnect_attempt', () => this.setStatus('connecting'));
    this.socket = socket;
  }

  private setStatus(status: RealtimeStatus) {
    if (status === this.status) return;
    this.status = status;
    for (const l of this.statusListeners) l();
  }
}

export const realtime = new RealtimeClient();

/** Keeps the shared connection open while mounted and returns its status. */
export function useRealtimeConnection(): RealtimeStatus {
  useEffect(() => realtime.acquire(), []);
  return useSyncExternalStore(realtime.subscribe, realtime.getStatus, () => 'offline' as const);
}

/** Subscribes to a server event while mounted (handler may change between renders). */
export function useRealtimeEvent<E extends keyof RealtimeEventPayloads>(
  event: E,
  handler: (payload: RealtimeEventPayloads[E]) => void,
  status: RealtimeStatus,
) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (status === 'offline') return;
    return realtime.on(event, (p) => ref.current(p));
  }, [event, status]);
}

export function useReconnect(listener: () => void) {
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  });
  useEffect(() => {
    const off = realtime.onReconnect(() => ref.current());
    return () => {
      off();
    };
  }, []);
}
