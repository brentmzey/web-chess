import { currentEpochMs, epochMsToIso } from '../../utils/dateTime';
import { failure, success, tryCatchAsync, type Result } from '../../utils/fp';
import { logger } from '../../utils/logger';

export type CleanupTriggerSource = 'cron_hook' | 'cli_manual' | 'api_maintenance';

export interface PruneReport {
  traceId: string;
  auditLogId?: string;
  triggerSource: CleanupTriggerSource;
  deletedSessionsCount: number;
  cutoffTimestamp: string;
  sessionCodes: string[];
  durationMs: number;
  success: boolean;
  errorMessage?: string;
}

interface PocketBaseAuthResponse {
  token: string;
}

interface SessionListResponse {
  items: Array<{
    id: string;
    session_code: string;
    created: string;
    updated: string;
  }>;
  totalItems: number;
}

const toError = (err: unknown): Error =>
  err instanceof Error ? err : new Error(String(err));

/**
 * Prunes stale or abandoned game sessions that haven't had a move made in `olderThanDays`.
 * Records full observability, metrics, and trace IDs in the Hungarian-prefixed
 * namespaced table `tbl_audit_cleanup_logs`.
 *
 * When a session in `game_sessions` is deleted by a superuser, PocketBase's
 * `cascadeDelete: true` automatically purges all related records in
 * `session_participants`, `game_moves`, and `session_events`.
 */
export async function prunePocketBaseSessions(
  baseUrl: string,
  email: string,
  password: string,
  olderThanDays: number = 3,
  batchSize: number = 100,
  triggerSource: CleanupTriggerSource = 'cli_manual'
): Promise<Result<PruneReport, string>> {
  const startTime = currentEpochMs();
  const traceId = `trc_cln_${startTime}_${Math.random().toString(36).substring(2, 8)}`;
  const url = baseUrl.replace(/\/+$/, '');
  const cutoffMs = startTime - olderThanDays * 86_400_000;
  const cutoffIso = epochMsToIso(cutoffMs);
  const cutoffPocketBase = cutoffIso.replace('T', ' ').replace('Z', '');

  logger.info(
    `[PocketBase Pruner] Initiating stale session cleanup for records without moves for ${olderThanDays} days`,
    { traceId, triggerSource, cutoff: cutoffPocketBase, olderThanDays }
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
      logger.error(`[PocketBase Pruner] Superuser authentication failed: ${err.message}`, { traceId });
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
      logger.error(`[PocketBase Pruner] Query failed: ${err.message}`, { traceId });
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
          `[PocketBase Pruner] Cascade deleted stale session ${session.session_code} (${session.id})`,
          { traceId, sessionCode: session.session_code, sessionId: session.id }
        );
      },
      Err: (err) => {
        logger.warn(
          `[PocketBase Pruner] Skipping session ${session.session_code}: ${err.message}`,
          { traceId, sessionCode: session.session_code }
        );
      }
    });
  }

  const durationMs = currentEpochMs() - startTime;

  // 4. Record Hungarian-prefixed Observability & Tracing Audit Log into tbl_audit_cleanup_logs
  const auditPayload = {
    txt_trace_id: traceId,
    txt_trigger_source: triggerSource,
    int_deleted_sessions: deletedCodes.length,
    txt_cutoff_timestamp: cutoffPocketBase,
    txt_pruned_codes_json: deletedCodes,
    int_duration_ms: durationMs,
    bln_success: true,
    txt_error_message: ''
  };

  const auditRes = await tryCatchAsync(async () => {
    const res = await fetch(`${url}/api/collections/tbl_audit_cleanup_logs/records`, {
      method: 'POST',
      headers,
      body: JSON.stringify(auditPayload)
    });
    if (!res.ok) {
      throw new Error(`Audit log creation failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as { id: string };
  }, toError);

  const auditLogId = auditRes.match({
    Ok: rec => rec?.id,
    Err: (err) => {
      logger.warn(`[PocketBase Pruner] Could not write audit record: ${err.message}`, { traceId });
      return undefined;
    }
  });

  // 5. Partitioned Archival Maintenance: move audit logs older than retention cutoff (30 days) to tbl_audit_cleanup_logs_history
  await tryCatchAsync(async () => {
    const auditRetentionCutoff = epochMsToIso(startTime - 30 * 86_400_000).replace('T', ' ').replace('Z', '');
    const oldAuditRes = await fetch(
      `${url}/api/collections/tbl_audit_cleanup_logs/records?filter=${encodeURIComponent(`created < "${auditRetentionCutoff}"`)}&perPage=50`,
      { headers }
    );
    if (oldAuditRes.ok) {
      const oldLogs = (await oldAuditRes.json()) as { items: Array<Record<string, any>> };
      for (const log of oldLogs.items) {
        // Copy to history partition table
        await fetch(`${url}/api/collections/tbl_audit_cleanup_logs_history/records`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            txt_trace_id: log.txt_trace_id,
            txt_trigger_source: log.txt_trigger_source,
            int_deleted_sessions: log.int_deleted_sessions,
            txt_cutoff_timestamp: log.txt_cutoff_timestamp,
            txt_pruned_codes_json: log.txt_pruned_codes_json,
            int_duration_ms: log.int_duration_ms,
            bln_success: log.bln_success,
            txt_error_message: log.txt_error_message || ''
          })
        });
        // Remove from active table so active table stays completely lean
        await fetch(`${url}/api/collections/tbl_audit_cleanup_logs/records/${log.id}`, {
          method: 'DELETE',
          headers
        });
      }
    }
  }, toError);

  const report: PruneReport = {
    traceId,
    auditLogId,
    triggerSource,
    deletedSessionsCount: deletedCodes.length,
    cutoffTimestamp: cutoffPocketBase,
    sessionCodes: deletedCodes,
    durationMs,
    success: true
  };

  logger.info(
    `[PocketBase Pruner] Completed stale session purge in ${durationMs}ms. Purged: ${deletedCodes.length} sessions (auditLog: ${auditLogId || 'n/a'}).`,
    { traceId, auditLogId, deletedCount: deletedCodes.length, durationMs }
  );

  return success(report);
}
