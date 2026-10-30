import { tryCatchAsync, type Result } from '../utils/fp';
import { logger } from '../utils/logger';
import { currentEpochMs } from '../utils/dateTime';

export const POCKETHOST_URL = 'https://web-chess.pockethost.io';

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
  private clientId: string | null = null;
  private lastEventSeq: number = 0;
  private isConnected: boolean = false;
  private eventHandlers: Map<string, Set<ArcadeRealtimeEventHandler>> = new Map();

  constructor(private config: ArcadeRealtimeConfig) {}

  public getBaseUrl(): string {
    if (this.config.baseUrl !== undefined) {
      return this.config.baseUrl;
    }
    if (typeof window !== 'undefined' && window.location) {
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        return '';
      }
      return POCKETHOST_URL;
    }
    return '';
  }

  public isPocketBaseMode(): boolean {
    const base = this.getBaseUrl();
    return base.includes('pockethost.io') || base.includes('/api/realtime');
  }

  public getParticipantId(): string {
    return this.config.participantId;
  }

  public getClientId(): string | null {
    return this.clientId;
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
      if (this.eventSource && !this.isPocketBaseMode()) {
        this.wireEventListener(this.eventSource, eventType);
      }
    }
    handlers.add(handler as ArcadeRealtimeEventHandler);

    return () => {
      handlers?.delete(handler as ArcadeRealtimeEventHandler);
    };
  }

  public dispatchEvent<T = unknown>(eventType: string,
                                    data: T,
                                    eventSeq: number): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.forEach(h => {
        try {
          h(data, eventSeq);
        } catch (err) {
          logger.error(`[ARCADE_REALTIME] Error in ${eventType} handler:`, err);
        }
      });
    }
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

      this.dispatchEvent(evtType, parsed, id);
    });
  }

  public connect(): void {
    if (this.eventSource) {
      this.disconnect();
    }

    if (this.isPocketBaseMode()) {
      const baseUrl = this.getBaseUrl();
      const sseUrl = `${baseUrl}/api/realtime`;

      try {
        const es = new EventSource(sseUrl);
        this.eventSource = es;

        es.addEventListener('PB_CONNECT', async (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data) as { clientId: string };
            this.clientId = data.clientId;
            this.isConnected = true;
            this.config.onOpen?.();

            // Submit subscription for session_events
            await fetch(`${baseUrl}/api/realtime`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                clientId: data.clientId,
                subscriptions: ['session_events']
              })
            }).catch(() => {});
          } catch (err) {
            logger.warn('[ARCADE_REALTIME] PB_CONNECT parse warning:', err);
          }
        });

        const handleSessionEvent = (e: MessageEvent) => {
          try {
            const msg = JSON.parse(e.data);
            const rec = msg.record || msg;
            if (rec && (rec.session === this.config.sessionCode || rec.session_code === this.config.sessionCode)) {
              const eventType = String(rec.event_type);
              const eventSeq = Number(rec.event_seq) || ++this.lastEventSeq;
              if (eventSeq > this.lastEventSeq) {
                this.lastEventSeq = eventSeq;
              }
              const rawPayload = rec.payload || rec.payload_json;
              const payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
              this.dispatchEvent(eventType, payload, eventSeq);
            }
          } catch (err) {
            logger.warn('[ARCADE_REALTIME] Failed parsing session_events record:', err);
          }
        };

        es.addEventListener('session_events', handleSessionEvent);
        es.addEventListener('session_events/*', handleSessionEvent);

        es.onerror = err => {
          this.isConnected = false;
          this.config.onError?.(err);
        };
      } catch (err) {
        logger.error('[ARCADE_REALTIME] PocketBase SSE connection failed:', err);
        this.config.onError?.(err);
      }
      return;
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
        if (this.isPocketBaseMode()) {
          const base = this.getBaseUrl();
          await fetch(`${base}/api/collections/session_events/records`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session: this.config.sessionCode,
              event_type: 'seat_claimed',
              event_seq: currentEpochMs(),
              payload: {
                sessionCode: this.config.sessionCode,
                participantId: this.config.participantId,
                displayName,
                seatNumber: 1
              }
            })
          }).catch(() => {});
          return { seatNumber: 1, sessionCode: this.config.sessionCode };
        }

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
        if (this.isPocketBaseMode()) {
          const base = this.getBaseUrl();
          await fetch(`${base}/api/collections/session_events/records`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session: this.config.sessionCode,
              event_type: 'seat_left',
              event_seq: currentEpochMs(),
              payload: {
                sessionCode: this.config.sessionCode,
                participantId: this.config.participantId
              }
            })
          }).catch(() => {});
          return { message: 'Participant vacated' };
        }

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
        if (this.isPocketBaseMode()) {
          const base = this.getBaseUrl();
          await fetch(`${base}/api/collections/session_events/records`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session: this.config.sessionCode,
              event_type: 'player_kicked',
              event_seq: currentEpochMs(),
              payload: {
                sessionCode: this.config.sessionCode,
                targetParticipantId,
                reason: reason || 'Removed by match host'
              }
            })
          }).catch(() => {});
          return { success: true, kickedParticipantId: targetParticipantId, seatNumber: 1 };
        }

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
        if (this.isPocketBaseMode()) {
          const base = this.getBaseUrl();
          await fetch(`${base}/api/collections/session_events/records`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session: this.config.sessionCode,
              event_type: 'action_dispatched',
              event_seq: currentEpochMs(),
              payload: {
                sessionCode: this.config.sessionCode,
                participantId: this.config.participantId,
                actionType,
                payload
              }
            })
          }).catch(() => {});
          return { event: { actionType, payload } };
        }

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
