-- ============================================================================
-- Sanctuary Chess: Real-Time Multiplayer & SSE Database Schema
-- Canonical Schema with Strict Referential Integrity, Foreign Keys & Indices
-- ============================================================================

PRAGMA foreign_keys = ON;

-- 1. Game Sessions Table
CREATE TABLE IF NOT EXISTS game_sessions (
    id TEXT PRIMARY KEY,
    session_code TEXT NOT NULL UNIQUE,
    white_participant_id TEXT,
    black_participant_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN (
            'pending',
            'active',
            'check',
            'checkmate',
            'stalemate',
            'draw_agreement',
            'resigned',
            'timeout',
            'abandoned'
        )
    ),
    current_fen TEXT NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    turn TEXT NOT NULL DEFAULT 'w' CHECK (turn IN ('w', 'b')),
    move_count INTEGER NOT NULL DEFAULT 0,
    theme TEXT NOT NULL DEFAULT 'gothic-basilica',
    allow_undo INTEGER NOT NULL DEFAULT 0 CHECK (allow_undo IN (0, 1)),
    time_control_initial_sec INTEGER,
    time_control_increment_sec INTEGER NOT NULL DEFAULT 0,
    white_time_remaining_ms INTEGER,
    black_time_remaining_ms INTEGER,
    winner TEXT CHECK (winner IN ('w', 'b', 'draw')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ended_at INTEGER
);

-- 2. Session Participants Table (Cross-Reference between Sessions and Users/Clients)
CREATE TABLE IF NOT EXISTS session_participants (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('white', 'black', 'spectator')),
    display_name TEXT NOT NULL,
    is_connected INTEGER NOT NULL DEFAULT 1 CHECK (is_connected IN (0, 1)),
    last_heartbeat_at INTEGER NOT NULL,
    connected_at INTEGER NOT NULL,
    disconnected_at INTEGER
);

-- 3. Session Bearer Tokens (Cross-Reference for Authenticated Moves & Actions)
-- Raw token is never stored; only SHA-256 hash is persisted
CREATE TABLE IF NOT EXISTS session_tokens (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL REFERENCES session_participants(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('white', 'black', 'spectator')),
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- 4. Game Moves Table (Strictly sequential ply history)
CREATE TABLE IF NOT EXISTS game_moves (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    participant_id TEXT REFERENCES session_participants(id) ON DELETE SET NULL,
    move_number INTEGER NOT NULL,
    ply INTEGER NOT NULL,
    color TEXT NOT NULL CHECK (color IN ('w', 'b')),
    san TEXT NOT NULL,
    uci TEXT NOT NULL,
    fen_before TEXT NOT NULL,
    fen_after TEXT NOT NULL,
    time_taken_ms INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    CONSTRAINT uq_game_moves_session_ply UNIQUE (session_id, ply)
);

-- 5. Session Events Log (Sequential append-only log for SSE delivery & catch-up replay)
CREATE TABLE IF NOT EXISTS session_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    event_seq INTEGER NOT NULL,
    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'session_created',
            'player_joined',
            'player_left',
            'player_heartbeat',
            'move_made',
            'theme_changed',
            'draw_offered',
            'draw_accepted',
            'draw_declined',
            'resigned',
            'game_over'
        )
    ),
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    CONSTRAINT uq_session_events_session_seq UNIQUE (session_id, event_seq)
);

-- 6. Audit Cleanup Logs Table (Hungarian prefix notation & optimized observability)
CREATE TABLE IF NOT EXISTS tbl_audit_cleanup_logs (
    id TEXT PRIMARY KEY,
    txt_trace_id TEXT NOT NULL UNIQUE,
    txt_trigger_source TEXT NOT NULL CHECK (txt_trigger_source IN ('cron_hook', 'cli_manual', 'api_maintenance')),
    int_deleted_sessions INTEGER NOT NULL,
    txt_cutoff_timestamp TEXT NOT NULL,
    txt_pruned_codes_json TEXT NOT NULL,
    int_duration_ms INTEGER NOT NULL,
    bln_success INTEGER NOT NULL CHECK (bln_success IN (0, 1)),
    txt_error_message TEXT,
    created_at INTEGER NOT NULL
);

-- 7. Partitioned Audit Cleanup History Table (Long-term historical archive)
CREATE TABLE IF NOT EXISTS tbl_audit_cleanup_logs_history (
    id TEXT PRIMARY KEY,
    txt_trace_id TEXT NOT NULL UNIQUE,
    txt_trigger_source TEXT NOT NULL CHECK (txt_trigger_source IN ('cron_hook', 'cli_manual', 'api_maintenance')),
    int_deleted_sessions INTEGER NOT NULL,
    txt_cutoff_timestamp TEXT NOT NULL,
    txt_pruned_codes_json TEXT NOT NULL,
    int_duration_ms INTEGER NOT NULL,
    bln_success INTEGER NOT NULL CHECK (bln_success IN (0, 1)),
    txt_error_message TEXT,
    created_at INTEGER NOT NULL
);

-- 8. Archived Game Snapshots Table (Compact, indexed recovery record of wiped sessions)
CREATE TABLE IF NOT EXISTS tbl_archived_game_snapshots (
    id TEXT PRIMARY KEY,
    txt_session_code TEXT NOT NULL UNIQUE,
    txt_final_fen TEXT NOT NULL,
    txt_white_player TEXT,
    txt_black_player TEXT,
    txt_winner TEXT,
    txt_status TEXT NOT NULL,
    int_total_plies INTEGER,
    txt_pgn TEXT,
    json_snapshot_payload TEXT,
    txt_pruned_reason TEXT,
    created_at INTEGER NOT NULL
);

-- 9. Partitioned Archived Game Snapshots History Table (Cold storage for old snapshots)
CREATE TABLE IF NOT EXISTS tbl_archived_game_snapshots_history (
    id TEXT PRIMARY KEY,
    txt_session_code TEXT NOT NULL,
    txt_final_fen TEXT NOT NULL,
    txt_white_player TEXT,
    txt_black_player TEXT,
    txt_winner TEXT,
    txt_status TEXT NOT NULL,
    int_total_plies INTEGER,
    txt_pgn TEXT,
    json_snapshot_payload TEXT,
    txt_pruned_reason TEXT,
    created_at INTEGER NOT NULL
);

-- ============================================================================
-- Indices for High-Throughput Relational Queries, Lookups and Joins
-- ============================================================================

-- Game Sessions Indices
CREATE UNIQUE INDEX IF NOT EXISTS uq_game_sessions_code ON game_sessions(session_code);
CREATE INDEX IF NOT EXISTS ix_game_sessions_status ON game_sessions(status);
CREATE INDEX IF NOT EXISTS ix_game_sessions_updated ON game_sessions(updated_at DESC);

-- Session Participants Indices & Partial Unique Constraints
CREATE INDEX IF NOT EXISTS ix_session_participants_session ON session_participants(session_id);
CREATE INDEX IF NOT EXISTS ix_session_participants_user ON session_participants(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_session_participants_active_role ON session_participants(session_id, role) WHERE role IN ('white', 'black');

-- Session Tokens Indices
CREATE UNIQUE INDEX IF NOT EXISTS uq_session_tokens_hash ON session_tokens(token_hash);
CREATE INDEX IF NOT EXISTS ix_session_tokens_participant ON session_tokens(participant_id);
CREATE INDEX IF NOT EXISTS ix_session_tokens_expires ON session_tokens(expires_at);

-- Game Moves Indices
CREATE UNIQUE INDEX IF NOT EXISTS uq_game_moves_session_ply ON game_moves(session_id, ply);
CREATE INDEX IF NOT EXISTS ix_game_moves_session ON game_moves(session_id);
CREATE INDEX IF NOT EXISTS ix_game_moves_participant ON game_moves(participant_id);

-- Session Events Indices (Optimized for SSE Last-Event-ID replay)
CREATE UNIQUE INDEX IF NOT EXISTS uq_session_events_session_seq ON session_events(session_id, event_seq);
CREATE INDEX IF NOT EXISTS ix_session_events_session_type ON session_events(session_id, event_type);
CREATE INDEX IF NOT EXISTS ix_session_events_created ON session_events(created_at);

-- Audit Cleanup Logs Indices
CREATE UNIQUE INDEX IF NOT EXISTS uq_tbl_audit_trace ON tbl_audit_cleanup_logs(txt_trace_id);
CREATE INDEX IF NOT EXISTS ix_tbl_audit_created ON tbl_audit_cleanup_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_tbl_audit_source ON tbl_audit_cleanup_logs(txt_trigger_source);

-- Partitioned Audit History Indices
CREATE UNIQUE INDEX IF NOT EXISTS uq_tbl_audit_hist_trace ON tbl_audit_cleanup_logs_history(txt_trace_id);
CREATE INDEX IF NOT EXISTS ix_tbl_audit_hist_created ON tbl_audit_cleanup_logs_history(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_tbl_audit_hist_source ON tbl_audit_cleanup_logs_history(txt_trigger_source);

-- Archived Game Snapshots Indices (Fast lookup and recovery)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tbl_arch_code ON tbl_archived_game_snapshots(txt_session_code);
CREATE INDEX IF NOT EXISTS ix_tbl_arch_white ON tbl_archived_game_snapshots(txt_white_player);
CREATE INDEX IF NOT EXISTS ix_tbl_arch_black ON tbl_archived_game_snapshots(txt_black_player);
CREATE INDEX IF NOT EXISTS ix_tbl_arch_created ON tbl_archived_game_snapshots(created_at DESC);

-- Partitioned Archived Snapshots History Indices
CREATE INDEX IF NOT EXISTS ix_tbl_arch_hist_code ON tbl_archived_game_snapshots_history(txt_session_code);
CREATE INDEX IF NOT EXISTS ix_tbl_arch_hist_created ON tbl_archived_game_snapshots_history(created_at DESC);
