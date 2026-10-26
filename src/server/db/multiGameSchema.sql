-- Multi-Game Sanctuary Arcade SQL Schema
-- Dedicated Hungarian-prefixed tables for Blackjack, Avalon/Resistance, Uno, and Phase 10

-- ============================================================================
-- 1. GOTHIC BLACKJACK TABLES
-- ============================================================================
CREATE TABLE IF NOT EXISTS tbl_bjk_sessions (
    id TEXT PRIMARY KEY,
    session_code TEXT NOT NULL UNIQUE,
    dealer_cards_json TEXT,
    dealer_total INTEGER,
    status TEXT NOT NULL CHECK (status IN ('betting', 'player_turn', 'dealer_turn', 'settled')),
    min_bet REAL NOT NULL DEFAULT 5,
    max_bet REAL NOT NULL DEFAULT 500,
    deck_shoe_count INTEGER NOT NULL DEFAULT 6,
    do_not_delete INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bjk_session_code ON tbl_bjk_sessions (session_code);
CREATE INDEX IF NOT EXISTS idx_bjk_status ON tbl_bjk_sessions (status);
CREATE INDEX IF NOT EXISTS idx_bjk_do_not_delete ON tbl_bjk_sessions (do_not_delete);
CREATE INDEX IF NOT EXISTS idx_bjk_updated_at ON tbl_bjk_sessions (updated_at);

CREATE TABLE IF NOT EXISTS tbl_bjk_hands (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    cards_json TEXT NOT NULL,
    bet_amount REAL NOT NULL,
    hand_total INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES tbl_bjk_sessions (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bjk_hand_session ON tbl_bjk_hands (session_id);

CREATE TABLE IF NOT EXISTS tbl_archived_bjk_snapshots (
    id TEXT PRIMARY KEY,
    txt_session_code TEXT NOT NULL UNIQUE,
    txt_outcome TEXT,
    int_total_hands INTEGER NOT NULL,
    int_dealer_total INTEGER,
    bln_do_not_delete INTEGER NOT NULL DEFAULT 0,
    json_snapshot_payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tbl_archived_bjk_snapshots_history (
    id TEXT PRIMARY KEY,
    txt_session_code TEXT NOT NULL,
    txt_outcome TEXT,
    int_total_hands INTEGER NOT NULL,
    int_dealer_total INTEGER,
    bln_do_not_delete INTEGER NOT NULL DEFAULT 0,
    json_snapshot_payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- ============================================================================
-- 2. THE RESISTANCE: AVALON TABLES
-- ============================================================================
CREATE TABLE IF NOT EXISTS tbl_res_sessions (
    id TEXT PRIMARY KEY,
    session_code TEXT NOT NULL UNIQUE,
    player_count INTEGER NOT NULL,
    current_mission INTEGER NOT NULL DEFAULT 1,
    failed_proposals INTEGER NOT NULL DEFAULT 0,
    leader_id TEXT,
    winner TEXT CHECK (winner IN ('good', 'evil')),
    status TEXT NOT NULL CHECK (status IN ('lobby', 'team_building', 'team_voting', 'questing', 'assassination', 'concluded')),
    do_not_delete INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_res_session_code ON tbl_res_sessions (session_code);
CREATE INDEX IF NOT EXISTS idx_res_status ON tbl_res_sessions (status);
CREATE INDEX IF NOT EXISTS idx_res_do_not_delete ON tbl_res_sessions (do_not_delete);
CREATE INDEX IF NOT EXISTS idx_res_updated_at ON tbl_res_sessions (updated_at);

CREATE TABLE IF NOT EXISTS tbl_res_missions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    mission_number INTEGER NOT NULL,
    team_size INTEGER NOT NULL,
    fails_required INTEGER NOT NULL DEFAULT 1,
    outcome TEXT CHECK (outcome IN ('success', 'fail')),
    fail_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES tbl_res_sessions (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_res_mission_session ON tbl_res_missions (session_id);

CREATE TABLE IF NOT EXISTS tbl_archived_res_snapshots (
    id TEXT PRIMARY KEY,
    txt_session_code TEXT NOT NULL UNIQUE,
    txt_winner TEXT,
    int_player_count INTEGER NOT NULL,
    int_missions_passed INTEGER NOT NULL,
    int_missions_failed INTEGER NOT NULL,
    bln_do_not_delete INTEGER NOT NULL DEFAULT 0,
    json_snapshot_payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tbl_archived_res_snapshots_history (
    id TEXT PRIMARY KEY,
    txt_session_code TEXT NOT NULL,
    txt_winner TEXT,
    int_player_count INTEGER NOT NULL,
    int_missions_passed INTEGER NOT NULL,
    int_missions_failed INTEGER NOT NULL,
    bln_do_not_delete INTEGER NOT NULL DEFAULT 0,
    json_snapshot_payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- ============================================================================
-- 3. CARDINAL UNO TABLES
-- ============================================================================
CREATE TABLE IF NOT EXISTS tbl_uno_sessions (
    id TEXT PRIMARY KEY,
    session_code TEXT NOT NULL UNIQUE,
    current_color TEXT NOT NULL CHECK (current_color IN ('red', 'blue', 'green', 'yellow')),
    top_card_json TEXT NOT NULL,
    turn_direction INTEGER NOT NULL DEFAULT 1,
    draw_pile_count INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('lobby', 'playing', 'concluded')),
    winner_name TEXT,
    do_not_delete INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_uno_session_code ON tbl_uno_sessions (session_code);
CREATE INDEX IF NOT EXISTS idx_uno_do_not_delete ON tbl_uno_sessions (do_not_delete);

CREATE TABLE IF NOT EXISTS tbl_archived_uno_snapshots (
    id TEXT PRIMARY KEY,
    txt_session_code TEXT NOT NULL UNIQUE,
    txt_winner_name TEXT,
    int_total_turns INTEGER NOT NULL,
    bln_do_not_delete INTEGER NOT NULL DEFAULT 0,
    json_snapshot_payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tbl_archived_uno_snapshots_history (
    id TEXT PRIMARY KEY,
    txt_session_code TEXT NOT NULL,
    txt_winner_name TEXT,
    int_total_turns INTEGER NOT NULL,
    bln_do_not_delete INTEGER NOT NULL DEFAULT 0,
    json_snapshot_payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- ============================================================================
-- 4. TEN RITES (PHASE 10) TABLES
-- ============================================================================
CREATE TABLE IF NOT EXISTS tbl_p10_sessions (
    id TEXT PRIMARY KEY,
    session_code TEXT NOT NULL UNIQUE,
    current_round INTEGER NOT NULL DEFAULT 1,
    top_discard_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('lobby', 'playing', 'round_ended', 'concluded')),
    winner_name TEXT,
    do_not_delete INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_p10_session_code ON tbl_p10_sessions (session_code);
CREATE INDEX IF NOT EXISTS idx_p10_do_not_delete ON tbl_p10_sessions (do_not_delete);

CREATE TABLE IF NOT EXISTS tbl_archived_p10_snapshots (
    id TEXT PRIMARY KEY,
    txt_session_code TEXT NOT NULL UNIQUE,
    txt_winner_name TEXT,
    int_winning_phase INTEGER NOT NULL,
    bln_do_not_delete INTEGER NOT NULL DEFAULT 0,
    json_snapshot_payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tbl_archived_p10_snapshots_history (
    id TEXT PRIMARY KEY,
    txt_session_code TEXT NOT NULL,
    txt_winner_name TEXT,
    int_winning_phase INTEGER NOT NULL,
    bln_do_not_delete INTEGER NOT NULL DEFAULT 0,
    json_snapshot_payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
