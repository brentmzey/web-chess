import { describe, expect, it, mock } from 'bun:test';
import {
  SanctuaryError,
  AppError,
  NamespacedError,
  DatabaseError,
  GameEngineError,
  RealtimeError,
  ValidationError,
  StorageError,
  SessionError,
  AudioError,
  ConfigError,
  NetworkError,
  SystemError,
  ErrorNamespaceEnum,
  failureWith,
  tryCatchWithSanctuaryError,
  tryCatchAsyncWithSanctuaryError
} from '../src/errors/sanctuaryError';
import {
  success,
  failure,
  type Result
} from '../src/utils/fp';
import { generateTraceId, isValidUuidV4 } from '../src/utils/uuid';

describe('Sanctuary Namespaced Error Architecture & Result<T, E> Integration', () => {
  it('instantiates SanctuaryError with namespace, code, contextual data, and traceId', () => {
    const error = new SanctuaryError({
      namespace: ErrorNamespaceEnum.Database,
      code: 'ERR_SQLITE_BUSY',
      message: 'Database locked during move submission',
      data: {
        sessionId: 'SANCT-ALPHA',
        seatNumber: 1,
        retries: 3
      },
      traceId: 'trc_move_987654'
    });

    expect(error.name).toBe('SanctuaryError');
    expect(error.namespace).toBe('DATABASE');
    expect(error.code).toBe('ERR_SQLITE_BUSY');
    expect(error.message).toBe('Database locked during move submission');
    expect(error.data).toEqual({
      sessionId: 'SANCT-ALPHA',
      seatNumber: 1,
      retries: 3
    });
    expect(error.context).toEqual(error.data);
    expect(error.traceId).toBe('trc_move_987654');
    expect(error.timestamp).toBeGreaterThan(0);

    // Formatted representations
    const logStr = error.toLogString();
    expect(logStr).toContain('[DATABASE::ERR_SQLITE_BUSY]');
    expect(logStr).toContain('Database locked during move submission');
    expect(logStr).toContain('[traceId=trc_move_987654]');
    expect(logStr).toContain('"sessionId":"SANCT-ALPHA"');

    const logObj = error.toLogObject();
    expect(logObj.namespace).toBe('DATABASE');
    expect(logObj.code).toBe('ERR_SQLITE_BUSY');
    expect(logObj.data.retries).toBe(3);
    expect(logObj.traceId).toBe('trc_move_987654');

    expect(error.toJSON()).toEqual(logObj);
    expect(error.toString()).toBe(logStr);
    expect(error.details.code).toBe('ERR_SQLITE_BUSY');
  });

  it('supports immutable updates with withData, withTraceId, and withCause', () => {
    const baseError = new SanctuaryError({
      namespace: ErrorNamespaceEnum.Realtime,
      code: 'ERR_SEAT_CLAIM_FAILED',
      message: 'Failed to claim seat',
      data: { seatNumber: 2 }
    });

    const enriched = baseError
      .withData({ playerName: 'Sir Galahad', isBot: false })
      .withTraceId('trc_seat_123')
      .withCause(new Error('Seat conflict detected in Redis'));

    expect(baseError.data).toEqual({ seatNumber: 2 });
    expect(baseError.traceId).toBeUndefined();

    expect(enriched.data).toEqual({
      seatNumber: 2,
      playerName: 'Sir Galahad',
      isBot: false
    });
    expect(enriched.traceId).toBe('trc_seat_123');
    expect(enriched.cause).toBeDefined();
    expect((enriched.cause as Error).message).toBe('Seat conflict detected in Redis');
  });

  it('provides concrete namespaced subclasses and aliases', () => {
    const dbErr = new DatabaseError('DB_CONN_TIMEOUT', 'Connection timed out', { host: 'pockethost.io' });
    expect(dbErr.name).toBe('DatabaseError');
    expect(dbErr.namespace).toBe(ErrorNamespaceEnum.Database);
    expect(dbErr.code).toBe('DB_CONN_TIMEOUT');

    const engineErr = new GameEngineError('INVALID_STACK', 'Cannot place Red 10 on Red 9', { rank: '10' });
    expect(engineErr.name).toBe('GameEngineError');
    expect(engineErr.namespace).toBe(ErrorNamespaceEnum.Engine);

    const rtErr = new RealtimeError('PLAYER_DISCONNECTED', 'Heartbeat expired', { participantId: 'p_1' });
    expect(rtErr.name).toBe('RealtimeError');
    expect(rtErr.namespace).toBe(ErrorNamespaceEnum.Realtime);

    const valErr = new ValidationError('PROFANE_NAME', 'Name contains disallowed terms', { name: 'badword' });
    expect(valErr.name).toBe('ValidationError');
    expect(valErr.namespace).toBe(ErrorNamespaceEnum.Validation);

    const storeErr = new StorageError('STORAGE_QUOTA', 'IndexedDB quota exceeded', { bytesNeeded: 4096 });
    expect(storeErr.name).toBe('StorageError');
    expect(storeErr.namespace).toBe(ErrorNamespaceEnum.Storage);

    const sessErr = new SessionError('SESSION_EXPIRED', 'Session timed out after 3 days', { sessionCode: 'SANCT-OLD' });
    expect(sessErr.name).toBe('SessionError');
    expect(sessErr.namespace).toBe(ErrorNamespaceEnum.Session);

    const audioErr = new AudioError('AUDIO_SUSPENDED', 'AudioContext failed to resume', { state: 'suspended' });
    expect(audioErr.name).toBe('AudioError');
    expect(audioErr.namespace).toBe(ErrorNamespaceEnum.Audio);

    const cfgErr = new ConfigError('CFG_NOT_FOUND', 'Missing configuration record', { key: 'ui.theme' });
    expect(cfgErr.name).toBe('ConfigError');
    expect(cfgErr.namespace).toBe(ErrorNamespaceEnum.Config);

    const netErr = new NetworkError('FETCH_FAILED', 'Network disconnected', { url: 'https://example.com' });
    expect(netErr.name).toBe('NetworkError');
    expect(netErr.namespace).toBe(ErrorNamespaceEnum.Network);

    const sysErr = new SystemError('UNHANDLED_EXCEPTION', 'Fatal crash', { exitCode: 1 });
    expect(sysErr.name).toBe('SystemError');
    expect(sysErr.namespace).toBe(ErrorNamespaceEnum.System);

    // Verify AppError and NamespacedError aliases
    expect(AppError).toBe(SanctuaryError);
    expect(NamespacedError).toBe(SanctuaryError);

    // Verify options object constructors on all subclasses
    const subclasses = [
      DatabaseError, GameEngineError, RealtimeError, ValidationError, StorageError,
      SessionError, AudioError, ConfigError, NetworkError, SystemError
    ];
    for (const Cls of subclasses) {
      const err = new Cls({ message: 'Options object constructor test', code: 'OPTS_TEST', data: { flag: true } });
      expect(err.message).toBe('Options object constructor test');
      expect(err.code).toBe('OPTS_TEST');
      expect(err.data.flag).toBe(true);
    }
  });

  it('creates namespaced errors via static factory constructors', () => {
    const db = SanctuaryError.database('DB_ERR', 'DB failed', { query: 'SELECT 1' });
    expect(db.namespace).toBe('DATABASE');
    expect(db.data.query).toBe('SELECT 1');

    const eng = SanctuaryError.engine('ENG_ERR', 'Engine failed', { move: 'e2e4' });
    expect(eng.namespace).toBe('ENGINE');

    const rt = SanctuaryError.realtime('RT_ERR', 'Realtime failed', { room: 'POKER-1' });
    expect(rt.namespace).toBe('REALTIME');

    const val = SanctuaryError.validation('VAL_ERR', 'Validation failed', { field: 'name' });
    expect(val.namespace).toBe('VALIDATION');

    const st = SanctuaryError.storage('ST_ERR', 'Storage failed', { table: 'chess' });
    expect(st.namespace).toBe('STORAGE');

    const sess = SanctuaryError.session('SESS_ERR', 'Session failed', { code: 'SOL-1' });
    expect(sess.namespace).toBe('SESSION');

    const aud = SanctuaryError.audio('AUD_ERR', 'Audio failed', { freq: 440 });
    expect(aud.namespace).toBe('AUDIO');

    const cfg = SanctuaryError.config('CFG_ERR', 'Config failed', { version: 2 });
    expect(cfg.namespace).toBe('CONFIG');

    const net = SanctuaryError.network('NET_ERR', 'Net failed', { status: 500 });
    expect(net.namespace).toBe('NETWORK');

    const sys = SanctuaryError.system('SYS_ERR', 'Sys failed', { pid: 1234 });
    expect(sys.namespace).toBe('SYSTEM');
  });

  it('safely converts foreign errors or strings via SanctuaryError.from', () => {
    // Standard Error object
    const rawError = new Error('Disk read failure');
    const fromErr = SanctuaryError.from(rawError, ErrorNamespaceEnum.Storage, 'ERR_DISK', { path: '/tmp' });
    expect(fromErr.namespace).toBe('STORAGE');
    expect(fromErr.code).toBe('ERR_DISK');
    expect(fromErr.message).toBe('Disk read failure');
    expect(fromErr.data.path).toBe('/tmp');
    expect(fromErr.cause).toBe(rawError);

    // Plain string error
    const fromStr = SanctuaryError.from('Something went wrong');
    expect(fromStr.namespace).toBe('SYSTEM');
    expect(fromStr.code).toBe('ERR_UNKNOWN');
    expect(fromStr.message).toBe('Something went wrong');

    // Passing SanctuaryError directly returns it (or attaches extra data)
    const existing = new DatabaseError('DB_ERR', 'Failed');
    const adapted = SanctuaryError.from(existing, 'STORAGE', 'IGNORED', { extra: true });
    expect(adapted).toBeInstanceOf(DatabaseError);
    expect(adapted.data.extra).toBe(true);
  });

  it('emits structured logs to a logger instance via log()', () => {
    const error = new SanctuaryError({
      namespace: ErrorNamespaceEnum.Validation,
      code: 'ERR_INVALID_CODE',
      message: 'Game session code not found',
      data: { code: 'BJK-INVALID' }
    });

    const mockLogger = {
      error: mock((_msg: string, _ctx: any) => {}),
      warn: mock((_msg: string, _ctx: any) => {}),
      info: mock((_msg: string, _ctx: any) => {}),
      debug: mock((_msg: string, _ctx: any) => {})
    } as any;

    error.log(mockLogger, 'error');
    expect(mockLogger.error).toHaveBeenCalled();
    expect(mockLogger.error.mock.calls[0][0]).toContain('[VALIDATION::ERR_INVALID_CODE]');
    expect(mockLogger.error.mock.calls[0][1].code).toBe('ERR_INVALID_CODE');

    error.log(mockLogger, 'warn');
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('creates Failure results via failureWith helper', () => {
    const failResult = failureWith<{ id: string }>(
      ErrorNamespaceEnum.Session,
      'ERR_SESSION_FULL',
      'Table capacity reached for Cathedral Poker',
      { maxSeats: 9, currentSeats: 9 }
    );

    expect(failResult.isFailure()).toBe(true);
    expect(failResult.isSuccess()).toBe(false);

    const err = failResult.match({
      Ok: () => null as any,
      Err: e => e
    });

    expect(err).toBeInstanceOf(SanctuaryError);
    expect(err.namespace).toBe('SESSION');
    expect(err.code).toBe('ERR_SESSION_FULL');
    expect(err.data.maxSeats).toBe(9);
  });

  it('evaluates tryCatchWithSanctuaryError and tryCatchAsyncWithSanctuaryError', async () => {
    // Synchronous success
    const syncOk = tryCatchWithSanctuaryError(() => 42 * 2);
    expect(syncOk.isSuccess()).toBe(true);
    expect(syncOk.getOrThrow()).toBe(84);

    // Synchronous failure
    const syncFail = tryCatchWithSanctuaryError(
      () => {
        throw new Error('SQLite locked');
      },
      ErrorNamespaceEnum.Database,
      'ERR_LOCKED',
      { table: 'tbl_chess_moves' }
    );
    expect(syncFail.isFailure()).toBe(true);
    const syncErr = syncFail.match({ Ok: () => null as any, Err: e => e });
    expect(syncErr.namespace).toBe('DATABASE');
    expect(syncErr.code).toBe('ERR_LOCKED');
    expect(syncErr.data.table).toBe('tbl_chess_moves');

    // Asynchronous success
    const asyncOk = await tryCatchAsyncWithSanctuaryError(async () => 'hello sanctuary');
    expect(asyncOk.isSuccess()).toBe(true);
    expect(asyncOk.getOrThrow()).toBe('hello sanctuary');

    // Asynchronous failure
    const asyncFail = await tryCatchAsyncWithSanctuaryError(
      async () => {
        throw new Error('Web Audio oscillator error');
      },
      ErrorNamespaceEnum.Audio,
      'ERR_AUDIO_NODE',
      { frequency: 440 }
    );
    expect(asyncFail.isFailure()).toBe(true);
    const asyncErr = asyncFail.match({ Ok: () => null as any, Err: e => e });
    expect(asyncErr.namespace).toBe('AUDIO');
    expect(asyncErr.code).toBe('ERR_AUDIO_NODE');
    expect(asyncErr.data.frequency).toBe(440);
  });

  it('enhances Result monad with mapError, tapError, logError, withData, and withTraceId', () => {
    const originalError = new SanctuaryError({
      namespace: ErrorNamespaceEnum.Engine,
      code: 'ERR_INVALID_MOVE',
      message: 'Pawn cannot move backwards',
      data: { from: 'e4', to: 'e3' }
    });

    let tappedError: any = null;
    const failRes: Result<number, SanctuaryError> = failure(originalError);

    // Getters on Failure
    expect(failRes.errorMessage).toBe('Pawn cannot move backwards');
    expect(failRes.errorNamespace.getOrElse('')).toBe('ENGINE');
    expect(failRes.errorData.getOrElse({} as any)).toEqual({ from: 'e4', to: 'e3' });
    expect(failRes.traceId.isNone()).toBe(true);

    // tapError side-effect
    const tappedRes = failRes.tapError(e => {
      tappedError = e;
    });
    expect(tappedRes).toBe(failRes);
    expect(tappedError).toBe(originalError);

    // withData and withTraceId
    const enrichedRes = failRes
      .withData({ piece: 'pawn', color: 'white' })
      .withTraceId('trc_pawn_1');

    expect(enrichedRes.isFailure()).toBe(true);
    const enrichedErr = enrichedRes.match({ Ok: () => null as any, Err: e => e });
    expect(enrichedErr.data).toEqual({ from: 'e4', to: 'e3', piece: 'pawn', color: 'white' });
    expect(enrichedErr.traceId).toBe('trc_pawn_1');

    // mapError transformation
    const mappedRes = failRes.mapError(e => `Transformed: ${e.message}`);
    expect(mappedRes.isFailure()).toBe(true);
    expect(mappedRes.match({ Ok: () => '', Err: e => e })).toBe('Transformed: Pawn cannot move backwards');

    // logError on Failure
    const mockLogger = {
      error: mock((_msg: string, _ctx: any) => {})
    } as any;
    failRes.logError(mockLogger, 'Move rejection trace');
    expect(mockLogger.error).toHaveBeenCalled();
    expect(mockLogger.error.mock.calls[0][0]).toContain('Move rejection trace');

    // Success branch equivalents
    const successRes: Result<number, SanctuaryError> = success(100);
    expect(successRes.errorMessage).toBeUndefined();
    expect(successRes.errorNamespace.isNone()).toBe(true);
    expect(successRes.errorData.isNone()).toBe(true);
    expect(successRes.traceId.isNone()).toBe(true);

    let tappedSuccess = false;
    successRes.tapError(() => {
      tappedSuccess = true;
    });
    expect(tappedSuccess).toBe(false);

    expect(successRes.mapError(() => 'unused').getOrThrow()).toBe(100);
    expect(successRes.withData({ key: 'val' }).getOrThrow()).toBe(100);
    expect(successRes.withTraceId('trc_succ').getOrThrow()).toBe(100);
    expect(successRes.logError(mockLogger)).toBe(successRes);
  });

  it('supports strongly typed and validated UUID v4 Trace IDs on SanctuaryError', () => {
    const traceId = generateTraceId();
    expect(isValidUuidV4(traceId)).toBe(true);

    const err = new DatabaseError({
      code: 'ERR_QUERY_FAILED',
      message: 'Deadlock detected',
      data: { query: 'SELECT * FROM sessions' },
      traceId
    });

    expect(err.traceId).toBe(traceId);
    expect(isValidUuidV4(err.traceId)).toBe(true);

    const newTraceId = generateTraceId();
    const updated = err.withTraceId(newTraceId);
    expect(isValidUuidV4(updated.traceId)).toBe(true);
    expect(updated.traceId).toBe(newTraceId);
    expect(updated.traceId).not.toBe(traceId);
  });
});
