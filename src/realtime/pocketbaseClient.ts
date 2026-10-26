import {
  fromNullable,
  match,
  matchBool,
  tryCatchAsync,
  type Result
} from '../utils/fp';
import { logger } from '../utils/logger';
import { isDevMode } from '../utils/env';
import { currentEpochMs } from '../utils/dateTime';
import type { RealtimeEventHandler, RealtimeClientConfig } from './realtimeClient';

export const POCKETHOST_URL = 'https://web-chess.pockethost.io';

export const sanitizeTextInput = (text: string, maxLen: number = 32): string => {
  return text.replace(/<[^>]*>?/gm, '').trim().slice(0, maxLen);
};

export const sanitizeSessionCode = (code: string): string => {
  return code.replace(/[^a-zA-Z0-9-]/g, '').toUpperCase().trim().slice(0, 16);
};

const toError = (err: unknown): Error =>
  err instanceof Error ? err : new Error(String(err));

export const generateSecureToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};

export const hashToken = (token: string): string => {
  return token;
};

export interface PocketBaseRecord {
  id: string;
  collectionId: string;
  collectionName: string;
  [key: string]: unknown;
}

export interface PocketBaseRealtimeMessage {
  action: 'create' | 'update' | 'delete';
  record: PocketBaseRecord;
}

/**
 * Native, zero-dependency PocketBase / PocketHost Realtime Client.
 * Connects to PocketHost SSE (`/api/realtime`) and performs REST mutations
 * against canonical PocketBase collections (`game_sessions`, `session_events`, `game_moves`).
 */
export class PocketBaseChessClient {
  private eventSource: EventSource | null = null;
  private clientId: string | null = null;
  private isConnected: boolean = false;
  private lastEventSeq: number = 0;
  private seenRecordIds: Set<string> = new Set();
  private eventHandlers: Map<string, Set<RealtimeEventHandler>> = new Map();
  private lastMovePly: number = -1;

  constructor(private config: RealtimeClientConfig) {
    if (config.onMove) this.on('move_made', config.onMove as RealtimeEventHandler);
    if (config.onPlayerJoined) this.on('player_joined', config.onPlayerJoined as RealtimeEventHandler);
    if (config.onThemeChanged) this.on('theme_changed', config.onThemeChanged as RealtimeEventHandler);
    if (config.onGameOver) this.on('game_over', config.onGameOver as RealtimeEventHandler);
  }

  public static getEndpoint(baseUrl?: string): string {
    return (baseUrl || POCKETHOST_URL).replace(/\/+$/, '');
  }

  public getBaseUrl(): string {
    return (this.config.baseUrl || POCKETHOST_URL).replace(/\/+$/, '');
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public getClientId(): string | null {
    return this.clientId;
  }

  public getLastEventSeq(): number {
    return this.lastEventSeq;
  }

  public on<T = unknown>(eventType: string, handler: RealtimeEventHandler<T>): () => void {
    let handlers = this.eventHandlers.get(eventType);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(eventType, handlers);
    }
    handlers.add(handler as RealtimeEventHandler);

    return () => {
      handlers?.delete(handler as RealtimeEventHandler);
    };
  }

  private dispatchEvent<T = unknown>(eventType: string, data: T, eventSeq: number): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data, eventSeq);
        } catch (err) {
          logger.error(`Error in event listener for ${eventType}:`, err);
        }
      }
    }
  }

  /**
   * Connects to PocketHost SSE stream (/api/realtime) and activates subscriptions.
   */
  public async connect(): Promise<Result<void, Error>> {
    return tryCatchAsync(async () => {
      const baseUrl = this.getBaseUrl();
      const sseUrl = `${baseUrl}/api/realtime`;

      matchBool(isDevMode(), {
        true: () => logger.info(`[PocketBase] Connecting to real-time SSE stream at ${sseUrl}...`),
        false: () => logger.info('Connecting to live multiplayer session...')
      });

      const es = new EventSource(sseUrl);
      this.eventSource = es;

      es.addEventListener('PB_CONNECT', async (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { clientId: string };
          this.clientId = data.clientId;
          this.isConnected = true;
          matchBool(isDevMode(), {
            true: () => logger.info(`[PocketBase] Connected with clientId: ${data.clientId}`),
            false: () => logger.info('Live session connection active.')
          });

          // Submit subscription for session events and session updates
          const subRes = await fetch(`${baseUrl}/api/realtime`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientId: data.clientId,
              subscriptions: [
                'session_events',
                `game_sessions/${this.config.sessionId}`
              ]
            })
          });

          if (!subRes.ok) {
            matchBool(isDevMode(), {
              true: () => logger.warn(`[PocketBase] Subscription request returned status ${subRes.status}`),
              false: () => logger.warn('Live session connection notice.')
            });
          }

          if (this.config.onOpen) {
            this.config.onOpen();
          }
        } catch (err) {
          logger.error('[PocketBase] Failed handling PB_CONNECT:', err);
        }
      });

      const handleSessionEvent = (e: MessageEvent) => {
        try {
          const msg = JSON.parse(e.data) as PocketBaseRealtimeMessage;
          if (msg.action === 'create' && msg.record.session === this.config.sessionId) {
            const recordId = String(msg.record.id || '');
            if (recordId) {
              if (this.seenRecordIds.has(recordId)) return;
              this.seenRecordIds.add(recordId);
            }
            const eventType = String(msg.record.event_type);
            const eventSeq = Number(msg.record.event_seq) || Math.max(currentEpochMs(), this.lastEventSeq + 1);
            if (eventSeq > this.lastEventSeq) {
              this.lastEventSeq = eventSeq;
            }
            const payload = msg.record.payload;
            this.dispatchEvent(eventType, payload, eventSeq);
          }
        } catch (err) {
          logger.error('[PocketBase] Failed handling session_events SSE message:', err);
        }
      };

      es.addEventListener('session_events', handleSessionEvent);
      es.addEventListener('session_events/*', handleSessionEvent);

      const handleGameSessionUpdate = (e: MessageEvent) => {
        try {
          const msg = JSON.parse(e.data) as PocketBaseRealtimeMessage;
          if (msg.record.id === this.config.sessionId) {
            this.dispatchEvent('session_updated', msg.record, this.lastEventSeq);
          }
        } catch (err) {
          logger.error('[PocketBase] Failed handling game_sessions SSE message:', err);
        }
      };

      es.addEventListener('game_sessions', handleGameSessionUpdate);
      es.addEventListener(`game_sessions/${this.config.sessionId}`, handleGameSessionUpdate);

      es.onerror = (err) => {
        logger.warn('[PocketBase] SSE stream error / disconnected:', err);
        this.isConnected = false;
        if (this.config.onError) {
          this.config.onError(err);
        }
      };
    }, toError);
  }

  public async setDoNotDelete(doNotDelete: boolean): Promise<Result<boolean, Error>> {
    return PocketBaseChessClient.setSessionDoNotDelete(this.getBaseUrl(), this.config.sessionId, doNotDelete);
  }

  public disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.isConnected = false;
    this.clientId = null;
    this.seenRecordIds.clear();
    this.lastMovePly = -1;
  }

  /**
   * Dispatches a chess move to PocketHost.
   */
  public async makeMove(payload: {
    ply: number;
    color: 'w' | 'b';
    from: string;
    to: string;
    san: string;
    fenAfter: string;
    capturedPiece?: string | null;
    isCheck?: boolean;
    isCheckmate?: boolean;
    promotion?: string;
    timeSpentMs?: number;
  }): Promise<Result<{ success: boolean; eventSeq: number }, Error>> {
    return tryCatchAsync(async () => {
      if (!payload.san || !payload.from || !payload.to) {
        throw new Error('Invalid move payload: missing coordinates or SAN.');
      }
      if (this.lastMovePly === payload.ply) {
        throw new Error('Duplicate move submission for this turn.');
      }
      this.lastMovePly = payload.ply;

      const baseUrl = this.getBaseUrl();
      const nextSeq = Math.max(currentEpochMs(), this.lastEventSeq + 1);
      this.lastEventSeq = nextSeq;

      // 1. Record move in game_moves
      const moveRes = await fetch(`${baseUrl}/api/collections/game_moves/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: this.config.sessionId,
          ply: payload.ply,
          color: payload.color,
          from_sq: payload.from,
          to_sq: payload.to,
          san: payload.san,
          fen_after: payload.fenAfter,
          captured_piece: payload.capturedPiece || '',
          is_check: !!payload.isCheck,
          is_checkmate: !!payload.isCheckmate,
          time_spent_ms: payload.timeSpentMs || 0
        })
      });

      if (!moveRes.ok) {
        const err = await moveRes.text();
        matchBool(isDevMode(), {
          true: () => logger.warn('[PocketBase] Failed recording game_moves:', err),
          false: () => logger.warn('Match move record notice.')
        });
      }

      // 2. Publish real-time event
      const eventRes = await fetch(`${baseUrl}/api/collections/session_events/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: this.config.sessionId,
          event_type: 'move_made',
          event_seq: nextSeq,
          payload: {
            ply: payload.ply,
            moveNumber: Math.ceil(payload.ply / 2),
            color: payload.color,
            san: payload.san,
            uci: `${payload.from}${payload.to}${payload.promotion || ''}`,
            fen: payload.fenAfter,
            turn: payload.color === 'w' ? 'b' : 'w',
            status: payload.isCheckmate ? 'checkmate' : (payload.isCheck ? 'check' : 'in_progress')
          }
        })
      });

      if (!eventRes.ok) {
        const err = await eventRes.text();
        matchBool(isDevMode(), {
          true: () => logger.error('[PocketBase] Failed publishing session_events:', err),
          false: () => logger.error('Failed to broadcast move.')
        });
        throw new Error(`Failed publishing move event: ${err}`);
      }

      // 3. Update game_sessions summary
      const patchRes = await fetch(`${baseUrl}/api/collections/game_sessions/records/${this.config.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fen: payload.fenAfter,
          ply: payload.ply,
          current_turn: payload.color === 'w' ? 'b' : 'w',
          last_move_san: payload.san,
          status: payload.isCheckmate ? 'completed' : 'in_progress',
          winner: payload.isCheckmate ? payload.color : ''
        })
      });

      if (!patchRes.ok) {
        const err = await patchRes.text();
        matchBool(isDevMode(), {
          true: () => logger.warn('[PocketBase] Failed patching game_sessions:', err),
          false: () => logger.warn('Match state update notice.')
        });
      }

      return { success: true, eventSeq: nextSeq };
    }, toError);
  }

  /**
   * Convenience wrapper matching the RealtimeChessClient.submitMove signature.
   */
  public async submitMove(
    san: string,
    details?: {
      ply?: number;
      color?: 'w' | 'b';
      from?: string;
      to?: string;
      promotion?: string;
      fenAfter?: string;
      capturedPiece?: string | null;
      isCheck?: boolean;
      isCheckmate?: boolean;
      timeSpentMs?: number;
    }
  ): Promise<Result<{ success: boolean; eventSeq: number }, Error>> {
    return this.makeMove({
      ply: details?.ply || ++this.lastEventSeq,
      color: details?.color || 'w',
      from: details?.from || san.slice(0, 2),
      to: details?.to || san.slice(-2),
      promotion: details?.promotion,
      san,
      fenAfter: details?.fenAfter || '',
      capturedPiece: details?.capturedPiece,
      isCheck: details?.isCheck,
      isCheckmate: details?.isCheckmate,
      timeSpentMs: details?.timeSpentMs
    });
  }

  /**
   * Synchronizes theme changes to PocketHost.
   */
  public async changeTheme(theme: string): Promise<Result<{ success: boolean; eventSeq: number }, Error>> {
    return tryCatchAsync(async () => {
      const baseUrl = this.getBaseUrl();
      const nextSeq = Math.max(currentEpochMs(), this.lastEventSeq + 1);
      this.lastEventSeq = nextSeq;

      await fetch(`${baseUrl}/api/collections/session_events/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: this.config.sessionId,
          event_type: 'theme_changed',
          event_seq: nextSeq,
          payload: { theme }
        })
      });

      await fetch(`${baseUrl}/api/collections/game_sessions/records/${this.config.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme })
      });

      return { success: true, eventSeq: nextSeq };
    }, toError);
  }

  /**
   * Resigns the active match.
   */
  public async resign(): Promise<Result<{ success: boolean; eventSeq: number }, Error>> {
    return tryCatchAsync(async () => {
      const baseUrl = this.getBaseUrl();
      const nextSeq = Math.max(currentEpochMs(), this.lastEventSeq + 1);
      this.lastEventSeq = nextSeq;

      await fetch(`${baseUrl}/api/collections/session_events/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: this.config.sessionId,
          event_type: 'resigned',
          event_seq: nextSeq,
          payload: {
            participantId: this.config.participantId,
            reason: 'player_resigned'
          }
        })
      });

      await fetch(`${baseUrl}/api/collections/game_sessions/records/${this.config.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'completed',
          termination_reason: 'resignation'
        })
      });

      return { success: true, eventSeq: nextSeq };
    }, toError);
  }

  // --- Static REST helpers ---

  public static async createSession(
    baseUrl: string,
    options: {
      mode: string;
      theme: string;
      timerRule: string;
      strictMode: boolean;
      role: 'w' | 'b' | 'rand';
      playerName?: string;
      doNotDelete?: boolean;
    }
  ): Promise<Result<{
    sessionId: string;
    sessionCode: string;
    participantId: string;
    token: string;
    assignedRole: 'white' | 'black';
  }, Error>> {
    return tryCatchAsync(async () => {
      const url = (baseUrl || POCKETHOST_URL).replace(/\/+$/, '');

      // Generate random 6-character sanctuary session code (e.g., SANCT-7K9P)
      const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      const sessionCode = `SANCT-${randomSuffix}`;

      // Assign initial role
      const assignedRole: 'w' | 'b' = match(options.role, {
        w: () => 'w' as const,
        b: () => 'b' as const,
        rand: () => (Math.random() < 0.5 ? ('w' as const) : ('b' as const))
      });

      const cleanPlayerName = sanitizeTextInput(options.playerName || '', 32);
      const playerName = cleanPlayerName || (assignedRole === 'w' ? 'Host (White)' : 'Host (Black)');
      const hostToken = generateSecureToken();
      const hostTokenHash = hashToken(hostToken);

      // 1. Create session record
      const sessionRes = await fetch(`${url}/api/collections/game_sessions/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_code: sessionCode,
          mode: options.mode,
          theme: options.theme,
          timer_rule: options.timerRule,
          strict_mode: options.strictMode,
          do_not_delete: Boolean(options.doNotDelete),
          status: 'waiting',
          current_turn: 'w',
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          ply: 0,
          white_player_name: assignedRole === 'w' ? playerName : '',
          black_player_name: assignedRole === 'b' ? playerName : '',
          host_token_hash: hostTokenHash
        })
      });

      if (!sessionRes.ok) {
        throw new Error(`Failed creating session: ${sessionRes.statusText}`);
      }

      const sessionData = (await sessionRes.json()) as PocketBaseRecord;
      const sessionId = sessionData.id;

      // 2. Create participant record
      const participantRes = await fetch(`${url}/api/collections/session_participants/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: sessionId,
          player_name: playerName,
          role: assignedRole === 'w' ? 'white' : 'black',
          token_hash: hostTokenHash,
          status: 'connected'
        })
      });

      const participantData = (await participantRes.json()) as PocketBaseRecord;

      return {
        sessionId,
        sessionCode,
        participantId: participantData.id,
        token: hostToken,
        assignedRole: assignedRole === 'w' ? ('white' as const) : ('black' as const)
      };
    }, toError);
  }

  public static async joinSession(
    baseUrl: string,
    options: {
      sessionCode: string;
      displayName?: string;
      preferredRole?: 'w' | 'b' | 'spectator';
    }
  ): Promise<Result<{
    sessionId: string;
    sessionCode: string;
    participantId: string;
    token: string;
    assignedRole: 'white' | 'black' | 'spectator';
    fen: string;
    theme: string;
  }, Error>> {
    return tryCatchAsync(async () => {
      const url = (baseUrl || POCKETHOST_URL).replace(/\/+$/, '');
      const cleanCode = sanitizeSessionCode(options.sessionCode || '');
      if (cleanCode.length < 4) {
        throw new Error('Please enter a valid match session code.');
      }
      const code = cleanCode;

      // 1. Query session by code
      const queryRes = await fetch(
        `${url}/api/collections/game_sessions/records?filter=(session_code='${encodeURIComponent(code)}')`
      );

      if (!queryRes.ok) {
        throw new Error(`Session lookup failed: ${queryRes.statusText}`);
      }

      const queryData = (await queryRes.json()) as { items: PocketBaseRecord[] };
      const session = fromNullable(queryData.items[0]).getOrThrow(
        () => new Error(`No match found with code "${code}".`)
      );

      const sessionId = session.id;
      const whiteName = String(session.white_player_name || '');
      const blackName = String(session.black_player_name || '');

      // Determine available role
      let role: 'white' | 'black' | 'spectator' = 'spectator';
      const cleanDisplayName = sanitizeTextInput(options.displayName || '', 32);

      if (cleanDisplayName && cleanDisplayName === blackName) {
        role = 'black';
      } else if (cleanDisplayName && cleanDisplayName === whiteName) {
        role = 'white';
      } else if (options.preferredRole === 'w') {
        role = 'white';
      } else if (options.preferredRole === 'b') {
        role = 'black';
      } else if (options.preferredRole === 'spectator') {
        role = 'spectator';
      } else {
        // Auto-assign open seat (prefer Black since host typically takes White)
        if (!blackName) {
          role = 'black';
        } else if (!whiteName) {
          role = 'white';
        } else {
          role = 'spectator';
        }
      }

      const playerName = options.displayName || `Player (${role})`;
      const joinToken = generateSecureToken();
      const tokenHash = hashToken(joinToken);

      // 2. Insert participant
      const participantRes = await fetch(`${url}/api/collections/session_participants/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: sessionId,
          player_name: playerName,
          role,
          token_hash: tokenHash,
          status: 'connected'
        })
      });

      const participantData = (await participantRes.json()) as PocketBaseRecord;

      // 3. Update session if joining as player
      const patchData: Record<string, unknown> = {};
      if (role === 'white') patchData.white_player_name = playerName;
      if (role === 'black') patchData.black_player_name = playerName;
      if ((whiteName || role === 'white') && (blackName || role === 'black')) {
        patchData.status = 'in_progress';
      }

      if (Object.keys(patchData).length > 0) {
        await fetch(`${url}/api/collections/game_sessions/records/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchData)
        });
      }

      // 4. Publish player_joined event
      await fetch(`${url}/api/collections/session_events/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: sessionId,
          event_type: 'player_joined',
          event_seq: currentEpochMs(),
          payload: {
            participantId: participantData.id,
            displayName: playerName,
            role
          }
        })
      });

      return {
        sessionId,
        sessionCode: code,
        participantId: participantData.id,
        token: joinToken,
        assignedRole: role,
        fen: String(session.fen),
        theme: String(session.theme || 'gothic-basilica')
      };
    }, toError);
  }

  public static async setSessionDoNotDelete(
    baseUrl: string,
    sessionId: string,
    doNotDelete: boolean
  ): Promise<Result<boolean, Error>> {
    return tryCatchAsync(async () => {
      const url = (baseUrl || POCKETHOST_URL).replace(/\/+$/, '');
      const res = await fetch(`${url}/api/collections/game_sessions/records/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ do_not_delete: doNotDelete })
      });
      if (!res.ok) {
        throw new Error(`Failed updating do_not_delete: ${res.statusText}`);
      }
      return true;
    }, toError);
  }
}
