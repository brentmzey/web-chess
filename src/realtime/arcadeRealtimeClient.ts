import { failure, success, tryCatch, tryCatchAsync, fromNullable, fromResult, none, some, matchBool, type Option, type Result } from '../utils/fp';
import { logger } from '../utils/logger';
import { currentEpochMs } from '../utils/dateTime';
import type { ArcadeGameEnum } from '../constants/gameEnums';
import {
  ArcadeEventRecordSchema,
  ArcadePrivateRecordSchema,
  ArcadeTableRecordSchema,
  ListResponseSchema,
  RealtimeRecordMessageSchema,
  parseWith,
  type ArcadeEventRecord
} from '../validation/realtimeSchemas';

export const POCKETHOST_URL = 'https://web-chess.pockethost.io';
export const ARCADE_EVENTS_COLLECTION = 'tbl_arcade_events';
export const ARCADE_TABLES_COLLECTION = 'tbl_arcade_tables';
export const ARCADE_PRIVATE_COLLECTION = 'tbl_arcade_private';
export const RECONNECT_BASE_DELAY_MS = 1000;
export const RECONNECT_MAX_DELAY_MS = 30000;
const EVENT_SOURCE_CLOSED = 2;
/** Sender id used for state loaded from the server-kept table snapshot rather than a live peer. */
export const TABLE_SNAPSHOT_SENDER = '__table_snapshot__';

export type { ArcadeEventRecord };

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
  /** PocketBase auth token of this browser's guest player; required for writes and private records. */
  readonly authToken?: string;
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
 * Filtered realtime topic for this table's private records. PocketBase only streams the records the
 * subscriber may view (`owner = @request.auth.id`), so each player receives only their own secrets.
 */
export const arcadePrivateTopic = (sessionCode: string): string =>
  `${ARCADE_PRIVATE_COLLECTION}?options=${encodeURIComponent(JSON.stringify({ query: { filter: `session_code="${sessionCode}"` } }))}`;

/**
 * Deterministic 15-character PocketBase record id for one player's private record at one table, so the
 * host updates a single record per player instead of appending.
 */
export const privateRecordId = (sessionCode: string,
                                ownerId: string): string => {
  const hash = (seed: number): number =>
    [...`${sessionCode}|${ownerId}`].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, seed);
  return (hash(2166136261).toString(36) + hash(0x811c9dc5 ^ 0x5bd1e995).toString(36) + 'p'.repeat(15)).slice(0, 15);
};

/** One seat's secrets as delivered to its owner. */
export interface PrivateSeatState {
  readonly seatKey: string;
  readonly stateSeq: number;
  readonly secrets: Readonly<Record<string, unknown>>;
}

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
  private reconnectAttempts: number = 0;
  private reconnectTimer: Option<ReturnType<typeof setTimeout>> = none();
  private isClosedByUser: boolean = false;
  private cachedTableId: Option<string> = none();
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

  private jsonHeaders(): Record<string, string> {
    return fromNullable(this.config.authToken)
      .filter(token => token.length > 0)
      .map((token): Record<string, string> => ({ 'Content-Type': 'application/json', Authorization: token }))
      .getOrElse({ 'Content-Type': 'application/json' });
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
      const envelope = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as { participantId?: unknown; replayed?: unknown };
      // Replayed snapshots are delivered even when this participant sent them before a reload
      matchBool(this.isOwnEvent(envelope.participantId) && envelope.replayed !== true, {
        true: () => undefined,
        false: () => this.dispatchEvent(evtType, parsed, id)
      });
    });
  }

  /**
   * Delivers one `tbl_arcade_events` record to handlers after validating it, skipping duplicates,
   * other tables and own echoes.
   */
  public ingestRecord(raw: unknown): void {
    parseWith(ArcadeEventRecordSchema, raw, 'arcade event').match({
      Ok: rec => this.ingestValidRecord(rec),
      Err: err => {
        logger.warn(`[ARCADE_REALTIME] ${err}`);
      }
    });
  }

  private ingestValidRecord(rec: ArcadeEventRecord): void {
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
      const items = parseWith(ListResponseSchema, await res.json(), 'event list').map(list => list.items).getOrElse([]);
      items.forEach(rec => this.ingestRecord(rec));
      return items.length;
    }, toMessage);
  }

  /**
   * Loads the latest full table state the server kept in `tbl_arcade_tables`, so a player joining
   * while the host is away still sees the current table. Delivered as a `state_sync` action.
   */
  public async hydrateFromTableSnapshot(): Promise<Result<boolean, string>> {
    const filter = `session_code="${this.config.sessionCode}"`;
    return tryCatchAsync(async () => {
      const res = await fetch(
        `${this.getBaseUrl()}/api/collections/${ARCADE_TABLES_COLLECTION}/records?perPage=1&filter=${encodeURIComponent(filter)}`
      );
      if (!res.ok) {
        throw new Error(await describeHttpFailure(res, 'Failed to load table'));
      }
      const items = parseWith(ListResponseSchema, await res.json(), 'table list').map(list => list.items).getOrElse([]);
      return fromNullable(items[0])
        .flatMap(item => fromResult(parseWith(ArcadeTableRecordSchema, item, 'arcade table')))
        .flatMap(table => fromNullable(table.json_last_snapshot))
        .map(snapshot => {
          this.dispatchEvent('action_dispatched', {
            sessionCode: this.config.sessionCode,
            participantId: TABLE_SNAPSHOT_SENDER,
            actionType: 'state_sync',
            payload: snapshot
          }, this.lastEventSeq);
          return true;
        })
        .getOrElse(false);
    }, toMessage);
  }

  /** Validates one private record and delivers it to this player as `private_state`. */
  public ingestPrivateRecord(raw: unknown): void {
    parseWith(ArcadePrivateRecordSchema, raw, 'private seat record')
      .flatMap(rec => rec.session_code === this.config.sessionCode && rec.owner === this.config.participantId
        ? success<typeof rec, string>(rec)
        : failure<typeof rec, string>('Ignoring a private record for another table or player.'))
      .match({
        Ok: rec => this.dispatchEvent<PrivateSeatState>('private_state', {
          seatKey: rec.seat_key,
          stateSeq: rec.int_state_seq,
          secrets: rec.json_secrets
        }, rec.int_state_seq),
        Err: err => {
          logger.warn(`[ARCADE_REALTIME] ${err}`);
        }
      });
  }

  /** Loads this player's own secrets at this table (e.g. after a reload). Only PocketHost has private records. */
  public async hydratePrivateState(): Promise<Result<boolean, string>> {
    if (!this.isPocketBaseMode() || !this.config.authToken) return success(false);
    const filter = `session_code="${this.config.sessionCode}"`;
    return tryCatchAsync(async () => {
      const res = await fetch(
        `${this.getBaseUrl()}/api/collections/${ARCADE_PRIVATE_COLLECTION}/records?perPage=1&filter=${encodeURIComponent(filter)}`,
        { headers: this.jsonHeaders() }
      );
      if (!res.ok) {
        throw new Error(await describeHttpFailure(res, 'Failed to load private seat state'));
      }
      const items = parseWith(ListResponseSchema, await res.json(), 'private list').map(list => list.items).getOrElse([]);
      items.forEach(item => this.ingestPrivateRecord(item));
      return items.length > 0;
    }, toMessage);
  }

  private async tableRecordId(): Promise<string> {
    return this.cachedTableId.match({
      Some: async id => id,
      None: async () => {
        const filter = `session_code="${this.config.sessionCode}"`;
        const res = await fetch(
          `${this.getBaseUrl()}/api/collections/${ARCADE_TABLES_COLLECTION}/records?perPage=1&fields=id,session_code,status&filter=${encodeURIComponent(filter)}`
        );
        if (!res.ok) throw new Error(await describeHttpFailure(res, 'Failed to find table'));
        const items = parseWith(ListResponseSchema, await res.json(), 'table list').map(list => list.items).getOrElse([]);
        const id = fromNullable(items[0] as { id?: unknown } | undefined)
          .flatMap(item => fromNullable(typeof item.id === 'string' ? item.id : undefined))
          .getOrThrow('This live table is not registered yet.');
        this.cachedTableId = some(id);
        return id;
      }
    });
  }

  /**
   * Host only: writes one player's secrets to their private record (created on first use, then updated).
   * PocketBase rules let only the table's host write it and only its owner read it.
   */
  public async publishPrivate(ownerId: string,
                              seatKey: string,
                              stateSeq: number,
                              secrets: Readonly<Record<string, unknown>>): Promise<Result<void, string>> {
    if (!this.isPocketBaseMode()) return success(undefined);
    return tryCatchAsync(async () => {
      const id = privateRecordId(this.config.sessionCode, ownerId);
      const body = { seat_key: seatKey, int_state_seq: stateSeq, json_secrets: secrets };
      const base = `${this.getBaseUrl()}/api/collections/${ARCADE_PRIVATE_COLLECTION}/records`;
      const updated = await fetch(`${base}/${id}`, { method: 'PATCH', headers: this.jsonHeaders(), body: JSON.stringify(body) });
      if (updated.ok) return;
      if (updated.status !== 404) {
        throw new Error(await describeHttpFailure(updated, 'Failed to update private seat state'));
      }
      const created = await fetch(base, {
        method: 'POST',
        headers: this.jsonHeaders(),
        body: JSON.stringify({ id, table: await this.tableRecordId(), owner: ownerId, session_code: this.config.sessionCode, ...body })
      });
      if (!created.ok) {
        throw new Error(await describeHttpFailure(created, 'Failed to create private seat state'));
      }
    }, toMessage);
  }

  private connectPocketBase(): void {
    const baseUrl = this.getBaseUrl();
    const topic = arcadeSubscriptionTopic(this.config.sessionCode);
    const privateTopic = arcadePrivateTopic(this.config.sessionCode);
    const es = new EventSource(`${baseUrl}/api/realtime`);
    this.eventSource = some(es);

    // PocketBase issues a new clientId on every (re)connect, so the subscription must be re-sent each time
    es.addEventListener('PB_CONNECT', (e: MessageEvent) => {
      void tryCatchAsync(async () => {
        const data = JSON.parse(e.data) as { clientId: string };
        this.clientId = some(data.clientId);

        const subRes = await fetch(`${baseUrl}/api/realtime`, {
          method: 'POST',
          headers: this.jsonHeaders(),
          body: JSON.stringify({ clientId: data.clientId, subscriptions: [topic, privateTopic] })
        });
        if (!subRes.ok) {
          throw new Error(await describeHttpFailure(subRes, 'Realtime subscription rejected'));
        }

        const isReconnect = this.hasConnectedOnce;
        this.reconnectAttempts = 0;
        this.hasConnectedOnce = true;
        this.isConnected = true;
        this.setStatus('live');
        this.config.onOpen?.();
        if (!isReconnect) {
          (await this.hydrateFromTableSnapshot()).match({
            Ok: () => undefined,
            Err: err => logger.warn('[ARCADE_REALTIME] Table snapshot unavailable:', err)
          });
        }
        (await this.hydratePrivateState()).match({
          Ok: () => undefined,
          Err: err => logger.warn('[ARCADE_REALTIME] Private seat state unavailable:', err)
        });
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

    es.addEventListener(privateTopic, (e: MessageEvent) => {
      parseWith(RealtimeRecordMessageSchema, parseJson(e.data), 'realtime message').match({
        Ok: msg => {
          if (msg.action !== 'delete') this.ingestPrivateRecord(msg.record);
        },
        Err: () => {
          logger.warn('[ARCADE_REALTIME] Ignoring malformed private seat message.');
        }
      });
    });

    es.addEventListener(topic, (e: MessageEvent) => {
      parseWith(RealtimeRecordMessageSchema, parseJson(e.data), 'realtime message').match({
        Ok: msg => {
          // Events are append-only; deletes only happen during server cleanup
          if (msg.action !== 'delete') this.ingestRecord(msg.record);
        },
        Err: () => {
          logger.warn('[ARCADE_REALTIME] Ignoring malformed arcade event message.');
        }
      });
    });

    es.onerror = err => this.handleStreamError(es, err);
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
      this.reconnectAttempts = 0;
      this.hasConnectedOnce = true;
      this.isConnected = true;
      this.setStatus('live');
      this.config.onOpen?.();
    };

    es.onerror = err => this.handleStreamError(es, err);

    this.eventHandlers.forEach((_, evtType) => this.wireLocalEventListener(es, evtType));
  }

  public connect(): void {
    this.isClosedByUser = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer.map(timer => clearTimeout(timer));
    this.reconnectTimer = none();
    this.openStream();
  }

  private openStream(): void {
    this.closeStream();
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

  /**
   * The browser retries dropped streams by itself, but gives up for good (readyState CLOSED) when a
   * proxy answers with a non-SSE error. Then this client reconnects with capped exponential backoff;
   * replay and table hydration catch up on anything missed.
   */
  private handleStreamError(es: EventSource,
                            err: unknown): void {
    this.isConnected = false;
    this.setStatus(this.hasConnectedOnce ? 'reconnecting' : 'offline');
    this.config.onError?.(err);
    const browserGaveUp = es.readyState === EVENT_SOURCE_CLOSED;
    if (!browserGaveUp || this.isClosedByUser || this.reconnectTimer.isSome()) return;
    const delayMs = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = some(setTimeout(() => {
      this.reconnectTimer = none();
      if (!this.isClosedByUser) this.openStream();
    }, delayMs));
  }

  public disconnect(): void {
    this.isClosedByUser = true;
    this.reconnectTimer.map(timer => clearTimeout(timer));
    this.reconnectTimer = none();
    this.closeStream();
  }

  private closeStream(): void {
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
      headers: this.jsonHeaders(),
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
