import { tryCatch, tryCatchAsync, fromNullable, none, some, matchBool, type Option, type Result } from '../utils/fp';
import { logger } from '../utils/logger';
import { currentEpochMs } from '../utils/dateTime';
import type { ArcadeGameEnum } from '../constants/gameEnums';

export const POCKETHOST_URL = 'https://web-chess.pockethost.io';
export const ARCADE_EVENTS_COLLECTION = 'tbl_arcade_events';

export type ArcadeRealtimeEventHandler<T = unknown> = (data: T, eventSeq: number) => void;

export type ArcadeConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface ArcadeRealtimeConfig {
  readonly baseUrl?: string;
  readonly sessionCode: string;
  readonly participantId: string;
  readonly game?: ArcadeGameEnum;
  readonly onOpen?: () => void;
  readonly onError?: (err: unknown) => void;
  readonly onStatusChange?: (status: ArcadeConnectionStatus) => void;
}

/** A `tbl_arcade_events` record as delivered by PocketBase REST and realtime. */
export interface ArcadeEventRecord {
  readonly id?: string;
  readonly session_code?: string;
  readonly participant_id?: string;
  readonly event_type?: string;
  readonly event_seq?: number;
  readonly payload?: unknown;
}

const toMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const parseJson = (raw: string): unknown => tryCatch(() => JSON.parse(raw) as unknown).getOrElse(raw);

/**
 * Builds the filtered PocketBase realtime topic for one arcade table. PocketBase delivers matching
 * records under an SSE event whose name is exactly this topic string.
 */
export const arcadeSubscriptionTopic = (sessionCode: string): string =>
  `${ARCADE_EVENTS_COLLECTION}?options=${encodeURIComponent(JSON.stringify({ query: { filter: `session_code="${sessionCode}"` } }))}`;

/**
 * Reads a failed response into a readable message, preferring PocketBase field validation details.
 */
const describeHttpFailure = async (res: Response,
                                   fallback: string): Promise<string> => {
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string; data?: Record<string, { message?: string }> };
  const fieldErrors = Object.entries(body.data ?? {})
    .map(([field, detail]) => `${field}: ${detail?.message ?? 'invalid'}`)
    .join(', ');
  const detail = [body.message, fieldErrors].filter(Boolean).join(' ').trim();
  return body.error ?? (detail || `${fallback}: HTTP ${res.status}`);
};

/**
 * Client-side adapter for arcade table synchronization.
 *
 * Outside localhost it publishes and subscribes through PocketHost (`tbl_arcade_events` with a
 * per-table filtered realtime topic). On localhost it uses the Bun server's arcade SSE endpoints.
 * In both modes, events a participant sent themselves are not delivered back to them, and missed
 * events are replayed after a reconnect.
 */
export class ArcadeRealtimeClient {
  private eventSource: Option<EventSource> = none();
  private clientId: Option<string> = none();
  private lastEventSeq: number = 0;
  private lastSentSeq: number = 0;
  private isConnected: boolean = false;
  private hasConnectedOnce: boolean = false;
  private readonly seenRecordIds: Set<string> = new Set();
  private readonly eventHandlers: Map<string, Set<ArcadeRealtimeEventHandler>> = new Map();

  constructor(private readonly config: ArcadeRealtimeConfig) {}

  public getBaseUrl(): string {
    return fromNullable(this.config.baseUrl).getOrElse(
      typeof window !== 'undefined' && window.location
        ? matchBool(['localhost', '127.0.0.1'].includes(window.location.hostname), {
            true: () => '',
            false: () => POCKETHOST_URL
          })
        : ''
    );
  }

  public isPocketBaseMode(): boolean {
    const base = this.getBaseUrl();
    return base.includes('pockethost.io') || base.includes('/api/realtime');
  }

  public getParticipantId(): string {
    return this.config.participantId;
  }

  public getSessionCode(): string {
    return this.config.sessionCode;
  }

  public getClientId(): Option<string> {
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
    const handlers = fromNullable(this.eventHandlers.get(eventType)).getOrElse(new Set());
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, handlers);
      this.eventSource
        .filter(() => !this.isPocketBaseMode())
        .map(es => this.wireLocalEventListener(es, eventType));
    }
    handlers.add(handler as ArcadeRealtimeEventHandler);

    return () => {
      handlers.delete(handler as ArcadeRealtimeEventHandler);
    };
  }

  public dispatchEvent<T = unknown>(eventType: string,
                                    data: T,
                                    eventSeq: number): void {
    fromNullable(this.eventHandlers.get(eventType)).map(handlers =>
      handlers.forEach(h => {
        tryCatch(() => h(data, eventSeq)).match({
          Ok: () => undefined,
          Err: err => logger.error(`[ARCADE_REALTIME] Error in ${eventType} handler:`, err)
        });
      })
    );
  }

  private setStatus(status: ArcadeConnectionStatus): void {
    this.config.onStatusChange?.(status);
  }

  private isOwnEvent(senderId: unknown): boolean {
    return typeof senderId === 'string' && senderId === this.config.participantId;
  }

  private wireLocalEventListener(es: EventSource,
                                 evtType: string): void {
    es.addEventListener(evtType, (e: MessageEvent) => {
      const id = parseInt(e.lastEventId, 10) || 0;
      this.lastEventSeq = Math.max(this.lastEventSeq, id);

      const parsed = parseJson(e.data);
      const sender = typeof parsed === 'object' && parsed !== null ? (parsed as { participantId?: unknown }).participantId : undefined;
      matchBool(this.isOwnEvent(sender), {
        true: () => undefined,
        false: () => this.dispatchEvent(evtType, parsed, id)
      });
    });
  }

  /**
   * Delivers one `tbl_arcade_events` record to handlers, skipping duplicates, other tables and own echoes.
   */
  public ingestRecord(rec: ArcadeEventRecord): void {
    const recordId = fromNullable(rec.id).getOrElse('');
    const isDuplicate = recordId !== '' && this.seenRecordIds.has(recordId);
    const isOtherTable = rec.session_code !== this.config.sessionCode;
    if (isDuplicate || isOtherTable) return;
    if (recordId !== '') this.seenRecordIds.add(recordId);

    const eventSeq = Number(rec.event_seq) || this.lastEventSeq + 1;
    this.lastEventSeq = Math.max(this.lastEventSeq, eventSeq);
    if (this.isOwnEvent(rec.participant_id)) return;

    const payload = typeof rec.payload === 'string' ? parseJson(rec.payload) : rec.payload;
    this.dispatchEvent(String(rec.event_type), payload, eventSeq);
  }

  /**
   * Fetches events published while this client was disconnected and replays them in order.
   */
  public async replayMissedEvents(): Promise<Result<number, string>> {
    const base = this.getBaseUrl();
    const filter = `session_code="${this.config.sessionCode}" && event_seq > ${this.lastEventSeq}`;
    return tryCatchAsync(async () => {
      const res = await fetch(
        `${base}/api/collections/${ARCADE_EVENTS_COLLECTION}/records?perPage=200&sort=event_seq&filter=${encodeURIComponent(filter)}`
      );
      if (!res.ok) {
        throw new Error(await describeHttpFailure(res, 'Failed to replay missed events'));
      }
      const body = (await res.json()) as { items?: ArcadeEventRecord[] };
      const items = fromNullable(body.items).getOrElse([]);
      items.forEach(rec => this.ingestRecord(rec));
      return items.length;
    }, toMessage);
  }

  private connectPocketBase(): void {
    const baseUrl = this.getBaseUrl();
    const topic = arcadeSubscriptionTopic(this.config.sessionCode);
    const es = new EventSource(`${baseUrl}/api/realtime`);
    this.eventSource = some(es);

    // PocketBase issues a new clientId on every (re)connect, so the subscription must be re-sent each time
    es.addEventListener('PB_CONNECT', (e: MessageEvent) => {
      void tryCatchAsync(async () => {
        const data = JSON.parse(e.data) as { clientId: string };
        this.clientId = some(data.clientId);

        const subRes = await fetch(`${baseUrl}/api/realtime`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: data.clientId, subscriptions: [topic] })
        });
        if (!subRes.ok) {
          throw new Error(await describeHttpFailure(subRes, 'Realtime subscription rejected'));
        }

        const isReconnect = this.hasConnectedOnce;
        this.hasConnectedOnce = true;
        this.isConnected = true;
        this.setStatus('live');
        this.config.onOpen?.();
        if (isReconnect) {
          (await this.replayMissedEvents()).match({
            Ok: count => count > 0 && logger.info(`[ARCADE_REALTIME] Replayed ${count} missed table events.`),
            Err: err => logger.warn('[ARCADE_REALTIME] Missed event replay failed:', err)
          });
        }
      }, toMessage).then(res =>
        res.match({
          Ok: () => undefined,
          Err: err => {
            logger.warn('[ARCADE_REALTIME] PocketBase subscription failed:', err);
            this.config.onError?.(err);
          }
        })
      );
    });

    es.addEventListener(topic, (e: MessageEvent) => {
      const msg = parseJson(e.data) as { action?: string; record?: ArcadeEventRecord } | string;
      matchBool(typeof msg === 'object' && msg !== null && msg.action !== 'delete' && msg.record !== undefined, {
        true: () => this.ingestRecord((msg as { record: ArcadeEventRecord }).record),
        false: () => {
          logger.warn('[ARCADE_REALTIME] Ignoring malformed arcade event message.');
        }
      });
    });

    es.onerror = err => {
      this.isConnected = false;
      this.setStatus(this.hasConnectedOnce ? 'reconnecting' : 'offline');
      this.config.onError?.(err);
    };
  }

  private connectLocal(): void {
    const base = this.getBaseUrl();
    const query = new URLSearchParams({
      participantId: this.config.participantId,
      ...(this.lastEventSeq > 0 ? { lastEventId: String(this.lastEventSeq) } : {})
    });
    const es = new EventSource(`${base}/api/arcade/sessions/${encodeURIComponent(this.config.sessionCode)}/events?${query.toString()}`);
    this.eventSource = some(es);

    es.onopen = () => {
      this.hasConnectedOnce = true;
      this.isConnected = true;
      this.setStatus('live');
      this.config.onOpen?.();
    };

    es.onerror = err => {
      this.isConnected = false;
      this.setStatus(this.hasConnectedOnce ? 'reconnecting' : 'offline');
      this.config.onError?.(err);
    };

    this.eventHandlers.forEach((_, evtType) => this.wireLocalEventListener(es, evtType));
  }

  public connect(): void {
    this.disconnect();
    this.setStatus('connecting');

    tryCatch(() => matchBool(this.isPocketBaseMode(), {
      true: () => this.connectPocketBase(),
      false: () => this.connectLocal()
    })).match({
      Ok: () => undefined,
      Err: err => {
        logger.error('[ARCADE_REALTIME] Connection failed:', err);
        this.setStatus('offline');
        this.config.onError?.(err);
      }
    });
  }

  public disconnect(): void {
    this.eventSource.map(es => es.close());
    this.eventSource = none();
    this.clientId = none();
    this.isConnected = false;
  }

  private nextSendSeq(): number {
    this.lastSentSeq = Math.max(currentEpochMs(), this.lastSentSeq + 1);
    return this.lastSentSeq;
  }

  /**
   * Publishes one event record to PocketHost. The sender id travels both as a column (for echo
   * filtering) and inside the payload (so handlers know who acted).
   */
  private async publishPocketBase(eventType: string,
                                  payload: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.getBaseUrl()}/api/collections/${ARCADE_EVENTS_COLLECTION}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_code: this.config.sessionCode,
        game_key: fromNullable(this.config.game).getOrElse('' as ArcadeGameEnum),
        participant_id: this.config.participantId,
        event_type: eventType,
        event_seq: this.nextSendSeq(),
        payload: { sessionCode: this.config.sessionCode, participantId: this.config.participantId, ...payload }
      })
    });
    if (!res.ok) {
      throw new Error(await describeHttpFailure(res, `Failed to publish ${eventType}`));
    }
  }

  private async postLocal<T>(path: string,
                             body: Record<string, unknown>,
                             failureLabel: string): Promise<T> {
    const res = await fetch(`${this.getBaseUrl()}/api/arcade/sessions/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw new Error(await describeHttpFailure(res, failureLabel));
    }
    return (await res.json()) as T;
  }

  public async claimSeat(displayName: string): Promise<Result<{ seatNumber: number; sessionCode: string }, string>> {
    return tryCatchAsync(async () => {
      if (this.isPocketBaseMode()) {
        await this.publishPocketBase('seat_claimed', { displayName });
        return { seatNumber: 1, sessionCode: this.config.sessionCode };
      }
      return this.postLocal<{ seatNumber: number; sessionCode: string }>('join', {
        sessionCode: this.config.sessionCode,
        participantId: this.config.participantId,
        displayName,
        ...(this.config.game ? { game: this.config.game } : {})
      }, 'Failed to claim seat');
    }, toMessage);
  }

  public async leaveSeat(): Promise<Result<{ message: string }, string>> {
    return tryCatchAsync(async () => {
      if (this.isPocketBaseMode()) {
        await this.publishPocketBase('seat_left', {});
        return { message: 'Participant vacated' };
      }
      return this.postLocal<{ message: string }>('leave', {
        sessionCode: this.config.sessionCode,
        participantId: this.config.participantId
      }, 'Failed to leave seat');
    }, toMessage);
  }

  public async kickPlayer(targetParticipantId: string,
                          reason?: string): Promise<Result<{ success: boolean; kickedParticipantId: string; seatNumber: number }, string>> {
    const resolvedReason = fromNullable(reason).getOrElse('Removed by match host');
    return tryCatchAsync(async () => {
      if (this.isPocketBaseMode()) {
        await this.publishPocketBase('player_kicked', { targetParticipantId, reason: resolvedReason });
        return { success: true, kickedParticipantId: targetParticipantId, seatNumber: 1 };
      }
      return this.postLocal<{ success: boolean; kickedParticipantId: string; seatNumber: number }>('kick', {
        sessionCode: this.config.sessionCode,
        hostParticipantId: this.config.participantId,
        targetParticipantId,
        reason: resolvedReason
      }, 'Failed to kick player');
    }, toMessage);
  }

  public async sendAction(actionType: string,
                          payload: Record<string, unknown>): Promise<Result<{ event: unknown }, string>> {
    return tryCatchAsync(async () => {
      if (this.isPocketBaseMode()) {
        await this.publishPocketBase('action_dispatched', { actionType, payload });
        return { event: { actionType, payload } };
      }
      return this.postLocal<{ event: unknown }>('action', {
        sessionCode: this.config.sessionCode,
        participantId: this.config.participantId,
        actionType,
        payload
      }, 'Failed to send action');
    }, toMessage);
  }

  public async dispatchAction(actionType: string,
                              payload: Record<string, unknown> = {}): Promise<Result<{ event: unknown }, string>> {
    return this.sendAction(actionType, payload);
  }
}
