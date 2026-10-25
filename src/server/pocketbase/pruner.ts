import { currentEpochMs, epochMsToIso } from '../../utils/dateTime';
import { failure, success, tryCatchAsync, type Result } from '../../utils/fp';
import { logger } from '../../utils/logger';

export interface PruneReport {
  deletedSessionsCount: number;
  cutoffTimestamp: string;
  sessionCodes: string[];
  durationMs: number;
}

interface PocketBaseAuthResponse {
  token: string;
}

interface SessionListResponse {
  items: Array<{
    id: string;
    session_code: string;
    created: string;
  }>;
  totalItems: number;
}

const toError = (err: unknown): Error =>
  err instanceof Error ? err : new Error(String(err));

/**
 * Prunes stale or abandoned game sessions older than the specified age in days.
 * When a session in `game_sessions` is deleted by a superuser, PocketBase's
 * `cascadeDelete: true` automatically purges all related records in
 * `session_participants`, `game_moves`, and `session_events`.
 */
export async function prunePocketBaseSessions(
  baseUrl: string,
  email: string,
  password: string,
  olderThanDays: number = 3,
  batchSize: number = 100
): Promise<Result<PruneReport, string>> {
  const startTime = currentEpochMs();
  const url = baseUrl.replace(/\/+$/, '');
  const cutoffMs = startTime - olderThanDays * 86_400_000;
  const cutoffIso = epochMsToIso(cutoffMs);
  const cutoffPocketBase = cutoffIso.replace('T', ' ').replace('Z', '');

  logger.info(
    `[PocketBase Pruner] Initiating stale session cleanup for records older than ${olderThanDays} days (Cutoff: ${cutoffPocketBase})...`
  );

  // 1. Superuser Authentication
  const authResult = await tryCatchAsync(async () => {
    const superuserRes = await fetch(`${url}/api/collections/_superusers/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password })
    });

    if (superuserRes.ok) {
      return (await superuserRes.json()) as PocketBaseAuthResponse;
    }

    const adminRes = await fetch(`${url}/api/admins/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password })
    });

    if (adminRes.ok) {
      return (await adminRes.json()) as PocketBaseAuthResponse;
    }

    throw new Error(`Authentication failed with status ${superuserRes.status} / ${adminRes.status}`);
  }, toError);

  const token = authResult.match({
    Ok: (auth) => auth.token,
    Err: (err) => {
      logger.error(`[PocketBase Pruner] Superuser authentication failed: ${err.message}`);
      return null;
    }
  });

  if (!token) {
    return failure('Superuser authentication failed');
  }

  const headers = {
    Authorization: token,
    'Content-Type': 'application/json'
  };

  // 2. Fetch Stale Sessions (no moves or updates in the last N days)
  const filter = `updated < "${cutoffPocketBase}"`;
  const listUrl = `${url}/api/collections/game_sessions/records?filter=${encodeURIComponent(
    filter
  )}&perPage=${batchSize}&sort=+created`;

  const fetchRes = await tryCatchAsync(async () => {
    const res = await fetch(listUrl, { headers });
    if (!res.ok) {
      throw new Error(`Failed to query stale sessions: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as SessionListResponse;
  }, toError);

  const sessionList = fetchRes.match({
    Ok: (list) => list,
    Err: (err) => {
      logger.error(`[PocketBase Pruner] Query failed: ${err.message}`);
      return null;
    }
  });

  if (!sessionList) {
    return failure('Failed to query stale game sessions');
  }

  const deletedCodes: string[] = [];

  // 3. Cascade Delete Stale Sessions
  for (const session of sessionList.items) {
    const deleteRes = await tryCatchAsync(async () => {
      const res = await fetch(`${url}/api/collections/game_sessions/records/${session.id}`, {
        method: 'DELETE',
        headers
      });
      if (!res.ok) {
        throw new Error(`Failed to delete session ${session.session_code}: ${res.statusText}`);
      }
      return true;
    }, toError);

    deleteRes.match({
      Ok: () => {
        deletedCodes.push(session.session_code);
        logger.info(
          `[PocketBase Pruner] Cascade deleted stale session ${session.session_code} (${session.id})`
        );
      },
      Err: (err) => {
        logger.warn(
          `[PocketBase Pruner] Skipping session ${session.session_code}: ${err.message}`
        );
      }
    });
  }

  const durationMs = currentEpochMs() - startTime;
  const report: PruneReport = {
    deletedSessionsCount: deletedCodes.length,
    cutoffTimestamp: cutoffPocketBase,
    sessionCodes: deletedCodes,
    durationMs
  };

  logger.info(
    `[PocketBase Pruner] Completed stale session purge in ${durationMs}ms. Purged: ${deletedCodes.length} sessions (cascade deleted related participants, moves, and events).`
  );

  return success(report);
}
