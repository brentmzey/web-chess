import { tryCatchAsync, type Result } from '../utils/fp';
import { logger } from '../utils/logger';

export type ArcadeRealtimeEventHandler<T = unknown> = (data: T, eventSeq: number) => void;

export interface ArcadeRealtimeConfig {
  baseUrl?: string;
  sessionCode: string;
  participantId: string;
  onOpen?: () => void;
  onError?: (err: unknown) => void;
}

export class ArcadeRealtimeClient {
  private eventSource: EventSource | null = null;
  private lastEventSeq: number = 0;
  private isConnected: boolean = false;
  private eventHandlers: Map<string, Set<ArcadeRealtimeEventHandler>> = new Map();

  constructor(private config: ArcadeRealtimeConfig) {}

  public getBaseUrl(): string {
    return this.config.baseUrl || '';
  }

  public getParticipantId(): string {
    return this.config.participantId;
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public getLastEventSeq(): number {
    return this.lastEventSeq;
  }

  public on<T = unknown>(eventType: string,
                         handler: ArcadeRealtimeEventHandler<T>): () => void {
    let handlers = this.eventHandlers.get(eventType);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(eventType, handlers);
      if (this.eventSource) {
        this.wireEventListener(this.eventSource, eventType);
      }
    }
    handlers.add(handler as ArcadeRealtimeEventHandler);

    return () => {
      handlers?.delete(handler as ArcadeRealtimeEventHandler);
    };
  }

  private wireEventListener(es: EventSource,
                            evtType: string): void {
    es.addEventListener(evtType, (e: MessageEvent) => {
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

      const handlers = this.eventHandlers.get(evtType);
      if (handlers) {
        handlers.forEach(h => {
          try {
            h(parsed, id);
          } catch (err) {
            logger.error(`[ARCADE_REALTIME] Error in ${evtType} handler:`, err);
          }
        });
      }
    });
  }

  public connect(): void {
    if (this.eventSource) {
      this.disconnect();
    }

    const base = this.getBaseUrl();
    const query = new URLSearchParams({
      participantId: this.config.participantId,
      ...(this.lastEventSeq > 0 ? { lastEventId: String(this.lastEventSeq) } : {})
    });

    const url = `${base}/api/arcade/sessions/${encodeURIComponent(this.config.sessionCode)}/events?${query.toString()}`;

    try {
      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        this.isConnected = true;
        this.config.onOpen?.();
      };

      this.eventSource.onerror = err => {
        this.isConnected = false;
        this.config.onError?.(err);
      };

      // Wire existing registered event listeners
      this.eventHandlers.forEach((_, evtType) => {
        if (this.eventSource) {
          this.wireEventListener(this.eventSource, evtType);
        }
      });
    } catch (err) {
      logger.error('[ARCADE_REALTIME] Connection failed:', err);
      this.config.onError?.(err);
    }
  }

  public disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.isConnected = false;
    }
  }

  public async claimSeat(displayName: string): Promise<Result<{ seatNumber: number; sessionCode: string }, string>> {
    return tryCatchAsync(
      async () => {
        const base = this.getBaseUrl();
        const res = await fetch(`${base}/api/arcade/sessions/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionCode: this.config.sessionCode,
            participantId: this.config.participantId,
            displayName
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to claim seat: HTTP ${res.status}`);
        }

        return await res.json();
      },
      err => (err instanceof Error ? err.message : String(err))
    );
  }

  public async leaveSeat(): Promise<Result<{ message: string }, string>> {
    return tryCatchAsync(
      async () => {
        const base = this.getBaseUrl();
        const res = await fetch(`${base}/api/arcade/sessions/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionCode: this.config.sessionCode,
            participantId: this.config.participantId
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to leave seat: HTTP ${res.status}`);
        }

        return await res.json();
      },
      err => (err instanceof Error ? err.message : String(err))
    );
  }

  public async kickPlayer(targetParticipantId: string,
                          reason?: string): Promise<Result<{ success: boolean; kickedParticipantId: string; seatNumber: number }, string>> {
    return tryCatchAsync(
      async () => {
        const base = this.getBaseUrl();
        const res = await fetch(`${base}/api/arcade/sessions/kick`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionCode: this.config.sessionCode,
            hostParticipantId: this.config.participantId,
            targetParticipantId,
            reason: reason || 'Removed by match host'
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to kick player: HTTP ${res.status}`);
        }

        return await res.json();
      },
      err => (err instanceof Error ? err.message : String(err))
    );
  }

  public async sendAction(actionType: string,
                          payload: Record<string, unknown>): Promise<Result<{ event: unknown }, string>> {
    return tryCatchAsync(
      async () => {
        const base = this.getBaseUrl();
        const res = await fetch(`${base}/api/arcade/sessions/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionCode: this.config.sessionCode,
            participantId: this.config.participantId,
            actionType,
            payload
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to send action: HTTP ${res.status}`);
        }

        return await res.json();
      },
      err => (err instanceof Error ? err.message : String(err))
    );
  }

  public async dispatchAction(actionType: string,
                              payload: Record<string, unknown> = {}): Promise<Result<{ event: unknown }, string>> {
    return this.sendAction(actionType, payload);
  }
}
