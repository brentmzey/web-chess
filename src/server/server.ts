import { logger } from '../utils/logger';
import { currentEpochMs, epochMsToIso } from '../utils/dateTime';
import { SanctuaryDatabase } from './db/database';
import { SessionRepository } from './db/sessionRepository';
import { RealtimeChessService } from './services/realtimeChessService';
import { SSEManager } from './sse/sseManager';
import { ArcadeRealtimeService } from './services/arcadeRealtimeService';
import { MultiGameService } from './services/multiGameService';
import { ArcadeGameEnum } from '../constants/gameEnums';

export interface SanctuaryServerOptions {
  readonly port?: number;
  readonly dbPath?: string;
}

const fallbackEmpty = (): Record<string, unknown> => ({});

export class SanctuaryRealtimeServer {
  public db: SanctuaryDatabase;
  public repository: SessionRepository;
  public sseManager: SSEManager;
  public service: RealtimeChessService;
  public arcadeService: ArcadeRealtimeService;
  public multiGameService: MultiGameService;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private port: number;

  constructor(options: SanctuaryServerOptions = {}) {
    this.port = options.port ?? 3001;
    this.db = new SanctuaryDatabase(options.dbPath || ':memory:');
    this.repository = new SessionRepository(this.db);
    this.sseManager = new SSEManager(this.repository);
    this.service = new RealtimeChessService(this.repository, this.sseManager);
    this.arcadeService = new ArcadeRealtimeService();
    this.multiGameService = new MultiGameService(this.db.getRawDb());
  }

  public runStaleCleanupSweep(olderThanDays: number = 3,
                              referenceTimeMs: number = currentEpochMs()): {
    readonly deletedChessSessions: number;
    readonly deletedArcadeSessions: number;
    readonly totalDeleted: number;
    readonly traceId: string;
  } {
    const startMs = currentEpochMs();
    const cutoffMs = referenceTimeMs - olderThanDays * 86_400_000;
    const thirtyDaysAgoMs = referenceTimeMs - 30 * 86_400_000;

    const chessRes = this.repository.pruneStaleSessions(cutoffMs);
    const deletedChessSessions = chessRes.match({
      Ok: r => r.deletedSessions,
      Err: () => 0
    });

    const arcadeRes = this.multiGameService.pruneAllStaleArcadeGames(olderThanDays, referenceTimeMs);
    const arcadeReport = arcadeRes.match({
      Ok: r => r,
      Err: () => ({ totalPruned: 0, prunedByGame: {} as Record<string, string[]> })
    });

    const prunedCodes = Object.values(arcadeReport.prunedByGame).flat();
    const totalDeleted = deletedChessSessions + arcadeReport.totalPruned;
    const traceId = `trc_srv_cron_${startMs}_${Math.random().toString(36).slice(2, 8)}`;

    this.repository.recordCleanupAudit({
      traceId,
      triggerSource: 'cron_hook',
      deletedSessions: totalDeleted,
      cutoffTimestamp: epochMsToIso(cutoffMs),
      prunedCodes,
      durationMs: Math.max(1, currentEpochMs() - startMs),
      success: true
    });

    this.repository.archiveCleanupAudits(thirtyDaysAgoMs);
    this.repository.archiveOldSnapshots(thirtyDaysAgoMs);

    return {
      deletedChessSessions,
      deletedArcadeSessions: arcadeReport.totalPruned,
      totalDeleted,
      traceId
    };
  }

  public startCleanupCron(intervalMs: number = 12 * 60 * 60 * 1000): void {
    this.stopCleanupCron();
    this.cleanupTimer = setInterval(() => {
      this.runStaleCleanupSweep(3);
    }, intervalMs);
  }

  public stopCleanupCron(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  public async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const pathname = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Last-Event-ID'
    };

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // JSON Helper
    const json = (data: unknown, status: number = 200): Response =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    const badRequest = (err: string): Response => json({ error: err }, 400);

    // Extract Bearer token from header or query param
    const extractToken = (): string => {
      const auth = req.headers.get('Authorization') || '';
      if (auth.startsWith('Bearer ')) {
        return auth.slice(7).trim();
      }
      return url.searchParams.get('token') || '';
    };

    try {
      // 1. POST /api/sessions -> Create session
      if (method === 'POST' && pathname === '/api/sessions') {
        const body = (await req.json().catch(fallbackEmpty)) as Record<string, unknown>;
        const res = this.service.createSession({
          theme: typeof body.theme === 'string' ? body.theme : undefined,
          allowUndo: typeof body.allowUndo === 'boolean' ? body.allowUndo : undefined,
          timeControlInitialSec:
            typeof body.timeControlInitialSec === 'number'
              ? body.timeControlInitialSec
              : undefined,
          timeControlIncrementSec:
            typeof body.timeControlIncrementSec === 'number'
              ? body.timeControlIncrementSec
              : undefined,
          creatorDisplayName:
            typeof body.creatorDisplayName === 'string'
              ? body.creatorDisplayName
              : undefined,
          creatorRole:
            body.creatorRole === 'white' || body.creatorRole === 'black'
              ? body.creatorRole
              : undefined
        });

        return res.match({
          Ok: auth => json(auth, 201),
          Err: badRequest
        });
      }

      // 2. POST /api/sessions/join -> Join session by code
      if (method === 'POST' && pathname === '/api/sessions/join') {
        const body = (await req.json().catch(fallbackEmpty)) as Record<string, unknown>;
        if (typeof body.sessionCode !== 'string' || typeof body.displayName !== 'string') {
          return badRequest('Missing sessionCode or displayName');
        }

        const res = this.service.joinSession({
          sessionCode: body.sessionCode,
          displayName: body.displayName,
          role:
            body.role === 'white' || body.role === 'black' || body.role === 'spectator'
              ? body.role
              : undefined
        });

        return res.match({
          Ok: auth => json(auth, 200),
          Err: badRequest
        });
      }

      // 3. GET /api/sessions/:id -> Get session details and move history
      const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (method === 'GET' && sessionMatch) {
        const sessionId = sessionMatch[1]!;
        const sessionOpt = this.repository.getSessionById(sessionId);

        return sessionOpt.match({
          Some: s => {
            const moves = this.repository.getMovesBySession(sessionId);
            const participants = this.repository.getParticipantsBySession(sessionId);
            return json({ session: s, moves, participants }, 200);
          },
          None: () => json({ error: `Session '${sessionId}' not found` }, 404)
        });
      }

      // 4. GET /api/sessions/:id/events -> Server-Sent Events stream
      const eventsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
      if (method === 'GET' && eventsMatch) {
        const sessionId = eventsMatch[1]!;
        const sessionOpt = this.repository.getSessionById(sessionId);
        if (sessionOpt.isNone()) {
          return json({ error: `Session '${sessionId}' not found` }, 404);
        }

        const participantId = url.searchParams.get('participantId') || 'anon-' + Math.random().toString(36).slice(2, 9);
        const lastEventHeader = req.headers.get('Last-Event-ID');
        const lastEventParam = url.searchParams.get('lastEventId');
        const lastEventId = lastEventHeader
          ? parseInt(lastEventHeader, 10)
          : lastEventParam
            ? parseInt(lastEventParam, 10)
            : undefined;

        let cleanup: (() => void) | null = null;

        const stream = new ReadableStream<Uint8Array>({
          start: controller => {
            this.sseManager.subscribe(sessionId, participantId, controller, lastEventId);
            cleanup = () => this.sseManager.unsubscribe(sessionId, participantId);
          },
          cancel: () => {
            if (cleanup) cleanup();
          }
        });

        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
            ...corsHeaders
          }
        });
      }

      // 5. POST /api/sessions/:id/moves -> Submit a move
      const movesMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/moves$/);
      if (method === 'POST' && movesMatch) {
        const sessionId = movesMatch[1]!;
        const token = extractToken();
        const body = (await req.json().catch(fallbackEmpty)) as Record<string, unknown>;

        if (typeof body.sanOrUci !== 'string') {
          return badRequest('Missing sanOrUci move parameter');
        }

        const res = this.service.submitMove({
          sessionId,
          token,
          sanOrUci: body.sanOrUci
        });

        return res.match({
          Ok: move => json({ move }, 200),
          Err: badRequest
        });
      }

      // 6. POST /api/sessions/:id/resign -> Resign game
      const resignMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/resign$/);
      if (method === 'POST' && resignMatch) {
        const sessionId = resignMatch[1]!;
        const token = extractToken();
        const res = this.service.resign(sessionId, token);

        return res.match({
          Ok: session => json({ session }, 200),
          Err: badRequest
        });
      }

      // 7. POST /api/sessions/:id/theme -> Sync theme across players
      const themeMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/theme$/);
      if (method === 'POST' && themeMatch) {
        const sessionId = themeMatch[1]!;
        const token = extractToken();
        const body = (await req.json().catch(fallbackEmpty)) as Record<string, unknown>;

        if (typeof body.theme !== 'string') {
          return badRequest('Missing theme parameter');
        }

        const res = this.service.changeTheme(sessionId, token, body.theme);
        return res.match({
          Ok: session => json({ session }, 200),
          Err: badRequest
        });
      }

      // 8. POST /api/arcade/sessions -> Create arcade game session
      if (method === 'POST' && pathname === '/api/arcade/sessions') {
        const body = (await req.json().catch(fallbackEmpty)) as Record<string, unknown>;
        const game = body.game as ArcadeGameEnum;
        const sessionCode = body.sessionCode as string;
        const requestedSeats = typeof body.maxSeats === 'number' ? body.maxSeats : undefined;
        const creatorName = typeof body.creatorName === 'string' ? body.creatorName : 'Host Player';

        if (!game || !sessionCode) {
          return badRequest('Missing game or sessionCode parameter');
        }

        const res = this.arcadeService.createSession(game, sessionCode, requestedSeats, creatorName);
        return res.match({
          Ok: s => json({ id: s.id, sessionCode: s.sessionCode, game: s.game, maxSeats: s.maxSeats }, 201),
          Err: badRequest
        });
      }

      // 9. POST /api/arcade/sessions/join -> Join arcade session & claim seat
      if (method === 'POST' && pathname === '/api/arcade/sessions/join') {
        const body = (await req.json().catch(fallbackEmpty)) as Record<string, unknown>;
        const sessionCode = body.sessionCode as string;
        const participantId = body.participantId as string;
        const displayName = body.displayName as string;

        if (!sessionCode || !participantId || !displayName) {
          return badRequest('Missing sessionCode, participantId, or displayName');
        }

        const res = this.arcadeService.joinSession(sessionCode, participantId, displayName);
        return res.match({
          Ok: data => json({ seatNumber: data.seatNumber, sessionCode: data.session.sessionCode, maxSeats: data.session.maxSeats }, 200),
          Err: badRequest
        });
      }

      // 10. POST /api/arcade/sessions/leave -> Leave arcade session & restore bot
      if (method === 'POST' && pathname === '/api/arcade/sessions/leave') {
        const body = (await req.json().catch(fallbackEmpty)) as Record<string, unknown>;
        const sessionCode = body.sessionCode as string;
        const participantId = body.participantId as string;

        if (!sessionCode || !participantId) {
          return badRequest('Missing sessionCode or participantId');
        }

        const res = this.arcadeService.leaveSession(sessionCode, participantId);
        return res.match({
          Ok: msg => json({ message: msg }, 200),
          Err: badRequest
        });
      }

      // 11. POST /api/arcade/sessions/action -> Dispatch real-time game action
      if (method === 'POST' && pathname === '/api/arcade/sessions/action') {
        const body = (await req.json().catch(fallbackEmpty)) as Record<string, unknown>;
        const sessionCode = body.sessionCode as string;
        const participantId = body.participantId as string;
        const actionType = body.actionType as string;
        const payload = (body.payload as Record<string, unknown>) || {};

        if (!sessionCode || !participantId || !actionType) {
          return badRequest('Missing sessionCode, participantId, or actionType');
        }

        const res = this.arcadeService.dispatchAction(sessionCode, participantId, actionType, payload);
        return res.match({
          Ok: event => json({ event }, 200),
          Err: badRequest
        });
      }

      // 12. GET /api/arcade/sessions/:sessionCode -> Get arcade session details & seats
      const arcadeSessionMatch = pathname.match(/^\/api\/arcade\/sessions\/([^/]+)$/);
      if (method === 'GET' && arcadeSessionMatch) {
        const code = arcadeSessionMatch[1]!;
        const sOpt = this.arcadeService.getSession(code);
        return sOpt.match({
          Some: s => json({
            id: s.id,
            sessionCode: s.sessionCode,
            game: s.game,
            maxSeats: s.maxSeats,
            seats: s.seatManager.getAllSeats().map(seat => ({
              seatNumber: seat.seatNumber,
              isOccupied: seat.isOccupied,
              isBot: seat.isBot,
              playerId: seat.playerId,
              playerName: seat.playerName
            })),
            totalHumans: s.seatManager.getHumanCount(),
            totalBots: s.seatManager.getBotCount()
          }, 200),
          None: () => json({ error: `Arcade session '${code}' not found` }, 404)
        });
      }

      // 13. GET /api/arcade/sessions/:sessionCode/events -> SSE stream for arcade session
      const arcadeEventsMatch = pathname.match(/^\/api\/arcade\/sessions\/([^/]+)\/events$/);
      if (method === 'GET' && arcadeEventsMatch) {
        const code = arcadeEventsMatch[1]!;
        const sOpt = this.arcadeService.getSession(code);
        if (sOpt.isNone()) {
          return json({ error: `Arcade session '${code}' not found` }, 404);
        }

        const participantId = url.searchParams.get('participantId') || 'anon-' + Math.random().toString(36).slice(2, 9);
        const lastEventHeader = req.headers.get('Last-Event-ID');
        const lastEventParam = url.searchParams.get('lastEventId');
        const lastEventId = lastEventHeader
          ? parseInt(lastEventHeader, 10)
          : lastEventParam
            ? parseInt(lastEventParam, 10)
            : undefined;

        let cleanup: (() => void) | null = null;

        const stream = new ReadableStream<Uint8Array>({
          start: controller => {
            this.arcadeService.subscribe(code, participantId, controller, lastEventId);
            cleanup = () => this.arcadeService.unsubscribe(code, participantId);
          },
          cancel: () => {
            if (cleanup) cleanup();
          }
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            ...corsHeaders
          }
        });
      }

      // 14. POST /api/maintenance/cleanup -> Trigger stale session cleanup sweep
      if (method === 'POST' && pathname === '/api/maintenance/cleanup') {
        const body = (await req.json().catch(fallbackEmpty)) as Record<string, unknown>;
        const days = typeof body.olderThanDays === 'number' ? body.olderThanDays : 3;
        const report = this.runStaleCleanupSweep(days);
        return json(report, 200);
      }

      return json({ error: 'Not Found' }, 404);
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      logger.error('[SERVER] Internal Server Error:', { error: err });
      return json({ error: 'Internal Server Error', details: err }, 500);
    }
  }

  public start(): ReturnType<typeof Bun.serve> {
    if (this.server) return this.server;

    this.sseManager.startHeartbeat(15000);
    this.startCleanupCron();
    this.server = Bun.serve({
      port: this.port,
      fetch: req => this.handleRequest(req)
    });

    logger.info(`[SERVER] Sanctuary Real-Time Chess SSE Server listening on http://localhost:${this.server.port}`);
    return this.server;
  }

  public stop(): void {
    this.stopCleanupCron();
    this.sseManager.stopHeartbeat();
    if (this.server) {
      this.server.stop(true);
      this.server = null;
    }
    this.db.close();
  }
}
