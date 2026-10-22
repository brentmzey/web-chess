import {
  fromNullable,
  tryCatchAsync,
  type Result
} from '../utils/fp';
import { logger } from '../utils/logger';

export const toErrorString = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export type RealtimeEventHandler<T = unknown> = (data: T, eventSeq: number) => void;

export interface RealtimeClientConfig {
  baseUrl?: string;
  sessionId: string;
  participantId: string;
  token: string;
  onOpen?: () => void;
  onError?: (err: unknown) => void;
  onMove?: RealtimeEventHandler<{
    ply: number;
    moveNumber: number;
    color: 'w' | 'b';
    san: string;
    uci: string;
    fen: string;
    turn: 'w' | 'b';
    status: string;
  }>;
  onPlayerJoined?: RealtimeEventHandler<{
    participantId: string;
    displayName: string;
    role: string;
  }>;
  onThemeChanged?: RealtimeEventHandler<{
    theme: string;
  }>;
  onGameOver?: RealtimeEventHandler<{
    status: string;
    winner: string | null;
    reason: string;
  }>;
}

/**
 * Client-Side Real-Time Chess SSE Subscriber and Action Dispatcher.
 * Uses native browser EventSource with automatic reconnection and Last-Event-ID tracking.
 */
export class RealtimeChessClient {
  private eventSource: EventSource | null = null;
  private lastEventSeq: number = 0;
  private isConnected: boolean = false;
  private eventHandlers: Map<string, Set<RealtimeEventHandler>> = new Map();

  constructor(private config: RealtimeClientConfig) {
    if (config.onMove) this.on('move_made', config.onMove as RealtimeEventHandler);
    if (config.onPlayerJoined) this.on('player_joined', config.onPlayerJoined as RealtimeEventHandler);
    if (config.onThemeChanged) this.on('theme_changed', config.onThemeChanged as RealtimeEventHandler);
    if (config.onGameOver) this.on('game_over', config.onGameOver as RealtimeEventHandler);
  }

  public getBaseUrl(): string {
    return this.config.baseUrl || '';
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public getLastEventSeq(): number {
    return this.lastEventSeq;
  }

  /**
   * Subscribes a typed event listener. Returns an unsubscribe function.
   */
  public on<T = unknown>(eventType: string, handler: RealtimeEventHandler<T>): () => void {
    let handlers = this.eventHandlers.get(eventType);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(eventType, handlers);
      if (this.eventSource) {
        this.wireEventListener(this.eventSource, eventType);
      }
    }
    handlers.add(handler as RealtimeEventHandler);

    return () => {
      handlers?.delete(handler as RealtimeEventHandler);
    };
  }

  private wireEventListener(es: any, evtType: string): void {
    es.addEventListener(evtType, (e: any) => {
      const id = parseInt(e.lastEventId, 10) || 0;
      if (id > this.lastEventSeq) {
        this.lastEventSeq = id;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(e.data);
      } catch {
        parsed = e.data;
      }

      this.dispatch(evtType, parsed, id);
    });
  }

  /**
   * Connects to the SSE stream endpoint.
   */
  public connect(): void {
    if (this.eventSource) {
      this.disconnect();
    }

    const base = this.getBaseUrl();
    const query = new URLSearchParams({
      participantId: this.config.participantId,
      token: this.config.token
    });

    if (this.lastEventSeq > 0) {
      query.set('lastEventId', String(this.lastEventSeq));
    }

    const url = `${base}/api/sessions/${this.config.sessionId}/events?${query.toString()}`;
    const ES = (typeof window !== 'undefined' ? window.EventSource : undefined) || (globalThis as any).EventSource;

    if (!ES) {
      logger.warn('[SSE CLIENT] EventSource not available in current environment');
      return;
    }

    const es = new ES(url);
    this.eventSource = es;

    es.onopen = () => {
      this.isConnected = true;
      logger.info(`[SSE CLIENT] Connected to session stream: ${this.config.sessionId}`);
      this.config.onOpen?.();
    };

    es.onerror = (e: unknown) => {
      this.isConnected = false;
      this.config.onError?.(e);
    };

    // Wire listeners for server event types and any registered custom events
    const eventsToListen = new Set([
      'session_created',
      'player_joined',
      'player_left',
      'move_made',
      'theme_changed',
      'draw_offered',
      'draw_accepted',
      'draw_declined',
      'resigned',
      'game_over',
      ...this.eventHandlers.keys()
    ]);

    eventsToListen.forEach(evtType => {
      this.wireEventListener(es, evtType);
    });
  }

  private dispatch(eventType: string, data: unknown, seq: number): void {
    const handlers = this.eventHandlers.get(eventType);
    fromNullable(handlers).map(hSet => {
      hSet.forEach(handler => {
        try {
          handler(data, seq);
        } catch (err) {
          logger.error(`[SSE CLIENT] Handler error for '${eventType}':`, { err });
        }
      });
    });
  }

  /**
   * Closes the active SSE connection.
   */
  public disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.isConnected = false;
      logger.info('[SSE CLIENT] Disconnected from session stream');
    }
  }

  // ==========================================================================
  // Client REST Mutations
  // ==========================================================================

  public async submitMove(sanOrUci: string): Promise<Result<{ move: unknown }, string>> {
    const base = this.getBaseUrl();
    return tryCatchAsync(
      async () => {
        const resp = await fetch(`${base}/api/sessions/${this.config.sessionId}/moves`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.token}`
          },
          body: JSON.stringify({ sanOrUci })
        });

        const body = (await resp.json()) as any;
        if (!resp.ok) {
          throw new Error(body.error || 'Failed to submit move');
        }
        return body;
      },
      toErrorString
    );
  }

  public async resign(): Promise<Result<{ session: unknown }, string>> {
    const base = this.getBaseUrl();
    return tryCatchAsync(
      async () => {
        const resp = await fetch(`${base}/api/sessions/${this.config.sessionId}/resign`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.token}`
          }
        });

        const body = (await resp.json()) as any;
        if (!resp.ok) {
          throw new Error(body.error || 'Failed to resign');
        }
        return body;
      },
      toErrorString
    );
  }

  public async changeTheme(theme: string): Promise<Result<{ session: unknown }, string>> {
    const base = this.getBaseUrl();
    return tryCatchAsync(
      async () => {
        const resp = await fetch(`${base}/api/sessions/${this.config.sessionId}/theme`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.token}`
          },
          body: JSON.stringify({ theme })
        });

        const body = (await resp.json()) as any;
        if (!resp.ok) {
          throw new Error(body.error || 'Failed to change theme');
        }
        return body;
      },
      toErrorString
    );
  }

  // ==========================================================================
  // Static Factory Methods
  // ==========================================================================

  public static async createSession(
    options: {
      theme?: string;
      allowUndo?: boolean;
      creatorDisplayName?: string;
      creatorRole?: 'white' | 'black';
    } = {},
    baseUrl: string = ''
  ): Promise<Result<{ session: any; participant: any; token: string }, string>> {
    return tryCatchAsync(
      async () => {
        const resp = await fetch(`${baseUrl}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options)
        });
        const body = (await resp.json()) as any;
        if (!resp.ok) throw new Error(body.error || 'Failed to create session');
        return body;
      },
      toErrorString
    );
  }

  public static async joinSession(
    options: {
      sessionCode: string;
      displayName: string;
      role?: 'white' | 'black' | 'spectator';
    },
    baseUrl: string = ''
  ): Promise<Result<{ session: any; participant: any; token: string }, string>> {
    return tryCatchAsync(
      async () => {
        const resp = await fetch(`${baseUrl}/api/sessions/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options)
        });
        const body = (await resp.json()) as any;
        if (!resp.ok) throw new Error(body.error || 'Failed to join session');
        return body;
      },
      toErrorString
    );
  }

  public static async fetchSession(
    sessionId: string,
    baseUrl: string = ''
  ): Promise<Result<{ session: any; moves: any[]; participants: any[] }, string>> {
    return tryCatchAsync(
      async () => {
        const resp = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
        const body = (await resp.json()) as any;
        if (!resp.ok) throw new Error(body.error || 'Failed to fetch session');
        return body;
      },
      toErrorString
    );
  }
}
