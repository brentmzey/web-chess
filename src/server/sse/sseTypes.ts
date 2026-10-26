import type { ChessThemeEnum } from '../../types';

export type SessionRole = 'white' | 'black' | 'spectator';

export type SessionStatus =
  | 'pending'
  | 'active'
  | 'check'
  | 'checkmate'
  | 'stalemate'
  | 'draw_agreement'
  | 'resigned'
  | 'timeout'
  | 'abandoned';

export type SSEEventType =
  | 'session_created'
  | 'player_joined'
  | 'player_left'
  | 'player_heartbeat'
  | 'move_made'
  | 'theme_changed'
  | 'draw_offered'
  | 'draw_accepted'
  | 'draw_declined'
  | 'resigned'
  | 'game_over';

export interface GameSessionRecord {
  id: string;
  session_code: string;
  white_participant_id: string | null;
  black_participant_id: string | null;
  status: SessionStatus;
  current_fen: string;
  turn: 'w' | 'b';
  move_count: number;
  theme: ChessThemeEnum | string;
  allow_undo: number; // 0 or 1
  time_control_initial_sec: number | null;
  time_control_increment_sec: number;
  white_time_remaining_ms: number | null;
  black_time_remaining_ms: number | null;
  winner: 'w' | 'b' | 'draw' | null;
  do_not_delete?: number; // 0 or 1
  created_at: number;
  updated_at: number;
  ended_at: number | null;
}

export interface SessionParticipantRecord {
  id: string;
  session_id: string;
  user_id: string;
  role: SessionRole;
  display_name: string;
  is_connected: number; // 0 or 1
  last_heartbeat_at: number;
  connected_at: number;
  disconnected_at: number | null;
}

export interface SessionTokenRecord {
  id: string;
  session_id: string;
  participant_id: string;
  token_hash: string;
  role: SessionRole;
  expires_at: number;
  created_at: number;
}

export interface GameMoveRecord {
  id: string;
  session_id: string;
  participant_id: string | null;
  move_number: number;
  ply: number;
  color: 'w' | 'b';
  san: string;
  uci: string;
  fen_before: string;
  fen_after: string;
  time_taken_ms: number;
  created_at: number;
}

export interface SessionEventRecord {
  id: string;
  session_id: string;
  event_seq: number;
  event_type: SSEEventType;
  payload_json: string;
  created_at: number;
}

export interface SSEEnvelope<T = unknown> {
  id: number; // strictly monotonic event_seq
  event: SSEEventType;
  data: T;
  timestamp: number;
}

export interface CreateSessionOptions {
  theme?: ChessThemeEnum | string;
  allowUndo?: boolean;
  timeControlInitialSec?: number;
  timeControlIncrementSec?: number;
  creatorDisplayName?: string;
  creatorRole?: SessionRole;
  userId?: string;
}

export interface JoinSessionOptions {
  sessionCode: string;
  displayName: string;
  role?: SessionRole;
  userId?: string;
}

export interface SessionAuthResult {
  session: GameSessionRecord;
  participant: SessionParticipantRecord;
  token: string;
}

export interface SubmitMoveOptions {
  sessionId: string;
  token: string;
  sanOrUci: string;
}
