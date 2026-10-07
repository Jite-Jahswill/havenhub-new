import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { createAdapter } from '@socket.io/redis-adapter';
import { UserStatus } from '@havenhub/shared';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';

import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { SessionService } from '../auth/session.service';
import { RealtimeTicketsService } from './realtime-tickets.service';

export const REALTIME_PATH = '/realtime';
const SESSION_CHECK_MS = 30_000;

export interface SocketIdentity {
  userId: string;
  sessionId: string;
}

type ClientHandler = (identity: SocketIdentity, payload: unknown, socket: Socket) => Promise<void>;

/**
 * Real-time delivery over Socket.IO, attached to the API's HTTP server.
 *
 * - Authentication happens once, in the handshake: a single-use ticket (web)
 *   or an access token (mobile). Sessions are re-checked every 30 s and
 *   sockets of revoked/expired sessions or blocked users are disconnected.
 * - Each socket joins only its own `user:<id>` room. Servers emit to the
 *   rooms of the users who may see an event (computed from the database),
 *   so there is no client-controlled room joining to authorise.
 * - The Redis adapter fans events out across API instances.
 * - Delivery is best-effort and never the source of truth: clients
 *   re-synchronise from the REST API after (re)connecting.
 */
@Injectable()
export class RealtimeGateway
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private io: Server | null = null;
  private readonly handlers = new Map<string, ClientHandler>();
  private sessionTimer: NodeJS.Timeout | null = null;
  private closing = false;
  private redisClients: { quit(): Promise<unknown>; disconnect(): void }[] = [];

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly sessions: SessionService,
    private readonly tickets: RealtimeTicketsService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    const httpServer = this.adapterHost.httpAdapter?.getHttpServer() as HttpServer | undefined;
    if (!httpServer) return;
    const io = new Server(httpServer, {
      path: REALTIME_PATH,
      cors: { origin: this.env.CORS_ORIGINS, credentials: true },
      // Clients only send tiny control events (typing); messages go over REST.
      maxHttpBufferSize: 8 * 1024,
      serveClient: false,
      // While shutting down, refuse new handshakes so reconnecting clients
      // retry (with backoff) and land on another instance.
      allowRequest: (_req, callback) => callback(null, !this.closing),
    });
    const pub = this.redis.client.duplicate({ lazyConnect: false, enableOfflineQueue: true });
    const sub = pub.duplicate();
    for (const client of [pub, sub]) {
      client.on('error', (error: Error) =>
        this.logger.warn(`Realtime Redis error: ${error.message}`),
      );
    }
    this.redisClients = [pub, sub];
    io.adapter(createAdapter(pub, sub));
    io.use((socket, next) => {
      this.authenticate(socket).then(
        (identity) => {
          if (!identity) {
            this.logger.warn(`Rejected realtime connection from ${socket.handshake.address}`);
            next(new Error('unauthorized'));
            return;
          }
          socket.data = identity;
          next();
        },
        (error: Error) => {
          this.logger.error(`Realtime authentication failed: ${error.message}`);
          next(new Error('unavailable'));
        },
      );
    });
    io.on('connection', (socket) => {
      const identity = socket.data as SocketIdentity;
      void socket.join(userRoom(identity.userId));
      for (const [event, handler] of this.handlers) {
        socket.on(event, (payload: unknown) => {
          handler(identity, payload, socket).catch((error: Error) => {
            this.logger.warn(`Realtime ${event} from ${identity.userId} failed: ${error.message}`);
          });
        });
      }
    });
    this.io = io;
    this.sessionTimer = setInterval(() => void this.revalidateSessions(), SESSION_CHECK_MS);
    this.sessionTimer.unref();
  }

  /**
   * Runs before Nest closes the HTTP server, which would otherwise wait
   * forever for open WebSockets. Ending the transports (not a Socket.IO
   * "disconnect", which tells clients to stay away) makes clients reconnect
   * by themselves — to another instance during a deploy.
   */
  beforeApplicationShutdown(): void {
    this.closing = true;
    if (this.sessionTimer) clearInterval(this.sessionTimer);
    this.io?.engine.close();
  }

  async onApplicationShutdown(): Promise<void> {
    this.io = null;
    await Promise.all(this.redisClients.map((c) => c.quit().catch(() => c.disconnect())));
  }

  /** Registers a handler for an event clients send (validated by the handler). */
  onClientEvent(event: string, handler: ClientHandler): void {
    this.handlers.set(event, handler);
  }

  /** Emits to every connected socket of each user, on any API instance. */
  emitToUser(userId: string, event: string, payload: unknown): void {
    this.io?.to(userRoom(userId)).emit(event, payload);
  }

  /** Emits to every connected socket, on every API instance (a content-free hint only). */
  emitToAll(event: string, payload: unknown): void {
    this.io?.emit(event, payload);
  }

  /**
   * Disconnects local sockets whose session was revoked or expired, or whose
   * user is no longer active. Each instance checks its own sockets.
   */
  async revalidateSessions(): Promise<number> {
    if (!this.io) return 0;
    const sockets = await this.io.local.fetchSockets();
    if (sockets.length === 0) return 0;
    const ids = [...new Set(sockets.map((s) => (s.data as SocketIdentity).sessionId))];
    const live = await this.prisma.session.findMany({
      where: {
        id: { in: ids },
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { status: UserStatus.ACTIVE },
      },
      select: { id: true },
    });
    const ok = new Set(live.map((s) => s.id));
    let dropped = 0;
    for (const socket of sockets) {
      if (!ok.has((socket.data as SocketIdentity).sessionId)) {
        socket.emit('session.ended', {});
        socket.disconnect(true);
        dropped++;
      }
    }
    return dropped;
  }

  private async authenticate(socket: Socket): Promise<SocketIdentity | null> {
    const auth = (socket.handshake.auth ?? {}) as { ticket?: unknown; token?: unknown };
    if (typeof auth.ticket === 'string') {
      const identity = await this.tickets.redeem(auth.ticket);
      if (!identity) return null;
      const session = await this.prisma.session.findFirst({
        where: {
          id: identity.sessionId,
          userId: identity.userId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { status: UserStatus.ACTIVE },
        },
        select: { id: true },
      });
      return session ? identity : null;
    }
    if (typeof auth.token === 'string' && auth.token.length < 512) {
      const session = await this.sessions.authenticate(auth.token);
      if (!session || session.user.status !== UserStatus.ACTIVE) return null;
      return { userId: session.userId, sessionId: session.id };
    }
    return null;
  }
}

export const userRoom = (userId: string) => `user:${userId}`;
