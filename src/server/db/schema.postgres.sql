-- ============================================================================
-- Sanctuary Chess: PostgreSQL Enterprise Schema (DbFactory Compliant)
-- Designed for High-Concurrency SSE Streams, Real-Time Cross-References & Indexing
-- ============================================================================

-- 1. Game Sessions Table
CREATE TABLE IF NOT EXISTS game_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_code VARCHAR(16) NOT NULL UNIQUE,
    white_participant_id UUID,
    black_participant_id UUID,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (
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
    current_fen VARCHAR(128) NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    turn VARCHAR(1) NOT NULL DEFAULT 'w' CHECK (turn IN ('w', 'b')),
    move_count INTEGER NOT NULL DEFAULT 0,
    theme VARCHAR(64) NOT NULL DEFAULT 'gothic-basilica',
    allow_undo BOOLEAN NOT NULL DEFAULT FALSE,
    time_control_initial_sec INTEGER,
    time_control_increment_sec INTEGER NOT NULL DEFAULT 0,
    white_time_remaining_ms BIGINT,
    black_time_remaining_ms BIGINT,
    winner VARCHAR(4) CHECK (winner IN ('w', 'b', 'draw')),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    ended_at BIGINT
);

-- 2. Session Participants Table (Player & Spectator Cross-Reference)
CREATE TABLE IF NOT EXISTS session_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    user_id VARCHAR(128) NOT NULL,
    role VARCHAR(16) NOT NULL CHECK (role IN ('white', 'black', 'spectator')),
    display_name VARCHAR(64) NOT NULL,
    is_connected BOOLEAN NOT NULL DEFAULT TRUE,
    last_heartbeat_at BIGINT NOT NULL,
    connected_at BIGINT NOT NULL,
    disconnected_at BIGINT
);

-- Circular FK references after both tables exist
ALTER TABLE game_sessions
    ADD CONSTRAINT fk_white_participant FOREIGN KEY (white_participant_id) REFERENCES session_participants(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_black_participant FOREIGN KEY (black_participant_id) REFERENCES session_participants(id) ON DELETE SET NULL;

-- 3. Session Bearer Tokens (SHA-256 Hashed Tokens)
CREATE TABLE IF NOT EXISTS session_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES session_participants(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    role VARCHAR(16) NOT NULL CHECK (role IN ('white', 'black', 'spectator')),
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL
);

-- 4. Game Moves Table
CREATE TABLE IF NOT EXISTS game_moves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    participant_id UUID REFERENCES session_participants(id) ON DELETE SET NULL,
    move_number INTEGER NOT NULL,
    ply INTEGER NOT NULL,
    color VARCHAR(1) NOT NULL CHECK (color IN ('w', 'b')),
    san VARCHAR(16) NOT NULL,
    uci VARCHAR(8) NOT NULL,
    fen_before VARCHAR(128) NOT NULL,
    fen_after VARCHAR(128) NOT NULL,
    time_taken_ms INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    CONSTRAINT uq_pg_game_moves_session_ply UNIQUE (session_id, ply)
);

-- 5. Session Events Log (SSE Monotonic Log)
CREATE TABLE IF NOT EXISTS session_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    event_seq INTEGER NOT NULL,
    event_type VARCHAR(32) NOT NULL CHECK (
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
    payload_json JSONB NOT NULL,
    created_at BIGINT NOT NULL,
    CONSTRAINT uq_pg_session_events_session_seq UNIQUE (session_id, event_seq)
);

-- ============================================================================
-- PostgreSQL Performance Indices
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_game_sessions_code ON game_sessions(session_code);
CREATE INDEX IF NOT EXISTS ix_pg_game_sessions_status ON game_sessions(status);
CREATE INDEX IF NOT EXISTS ix_pg_game_sessions_updated ON game_sessions(updated_at DESC);

CREATE INDEX IF NOT EXISTS ix_pg_session_participants_session ON session_participants(session_id);
CREATE INDEX IF NOT EXISTS ix_pg_session_participants_user ON session_participants(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_session_participants_active_role ON session_participants(session_id, role) WHERE role IN ('white', 'black');

CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_session_tokens_hash ON session_tokens(token_hash);
CREATE INDEX IF NOT EXISTS ix_pg_session_tokens_participant ON session_tokens(participant_id);
CREATE INDEX IF NOT EXISTS ix_pg_session_tokens_expires ON session_tokens(expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_game_moves_session_ply ON game_moves(session_id, ply);
CREATE INDEX IF NOT EXISTS ix_pg_game_moves_session ON game_moves(session_id);
CREATE INDEX IF NOT EXISTS ix_pg_game_moves_participant ON game_moves(participant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_session_events_session_seq ON session_events(session_id, event_seq);
CREATE INDEX IF NOT EXISTS ix_pg_session_events_session_type ON session_events(session_id, event_type);
CREATE INDEX IF NOT EXISTS ix_pg_session_events_created ON session_events(created_at);
