import { z } from 'zod';
import { failure, success, type Result } from '../utils/fp';

/**
 * Zod schemas for PocketBase realtime records. Everything that arrives over SSE or REST from
 * PocketHost is parsed through these before the app trusts it.
 */

/** A `tbl_arcade_events` record (REST list item or realtime `record`). */
export const ArcadeEventRecordSchema = z.object({
  id: z.string().optional(),
  table: z.string().optional(),
  session_code: z.string().min(1),
  game_key: z.string().optional(),
  participant_id: z.string().optional().default(''),
  event_type: z.string().min(1),
  event_seq: z.number().optional(),
  payload: z.unknown().optional()
});
export type ArcadeEventRecord = z.infer<typeof ArcadeEventRecordSchema>;

export const ArcadeTableStatusSchema = z.enum(['open', 'active', 'closed']);

/** A `tbl_arcade_tables` record, the server-owned registry of live arcade tables. */
export const ArcadeTableRecordSchema = z.object({
  id: z.string(),
  session_code: z.string().min(1),
  game_key: z.string().optional().default(''),
  host_participant_id: z.string().optional().default(''),
  status: ArcadeTableStatusSchema,
  int_event_count: z.number().optional().default(0),
  json_last_snapshot: z.unknown().optional()
});
export type ArcadeTableRecord = z.infer<typeof ArcadeTableRecordSchema>;

/** The envelope PocketBase sends for every realtime record change. */
export const RealtimeRecordMessageSchema = z.object({
  action: z.enum(['create', 'update', 'delete']),
  record: z.unknown()
});
export type RealtimeRecordMessage = z.infer<typeof RealtimeRecordMessageSchema>;

/** A PocketBase list response with untyped items, validated item by item afterwards. */
export const ListResponseSchema = z.object({
  items: z.array(z.unknown()).optional().default([])
});

const describeIssues = (error: z.ZodError): string =>
  error.issues.map(issue => `${issue.path.join('.') || 'record'}: ${issue.message}`).join('; ');

export const parseWith = <T>(schema: z.ZodType<T>,
                             raw: unknown,
                             label: string): Result<T, string> => {
  const parsed = schema.safeParse(raw);
  return parsed.success ? success(parsed.data) : failure(`Invalid ${label}: ${describeIssues(parsed.error)}`);
};
