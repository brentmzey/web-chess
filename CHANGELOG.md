# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) with `RC#` Release Candidates (`X.Y.Z-rc.N`).
Every general feature change or application behavior update is consolidated under the active `RC#` entry until `main` is pushed to remote, which triggers a production **Build & Release**.

## [1.2.0-rc.27] - 2026-10-27
### Added
- **Dynamic Multi-Player Seat Addition, Human Seat Claiming & AI Hot-Swapping Across All 7 Arcade Games (`src/games/*`, `src/main.ts`, `index.html`)**:
  - **Engine-Level `TableSeatManager` & Dynamic Player Management**: Integrated `seatManager: TableSeatManager<T>`, `addPlayer(playerName, isBot)`, `claimSeatForHuman(playerIndex, humanName)`, and `vacatePlayerSeat(playerId, fallbackBotName)` across **Gothic Blackjack** (`1–7 seats`), **Cathedral Poker** (`2–9 seats`), **Sacred Skip-Bo** (`2–6 seats`), **Ten Rites / Phase 10** (`2–6 seats`), **Cardinal Uno** (`2–10 seats`), **The Resistance: Avalon** (`5–10 seats`), and **Sacred Geometry SET** (`1–20 seats`).
  - **Theater Multi-Player Seat Selectors, `+ Player` Controls & Interactive Seat Strips (`index.html`, `src/main.ts`)**: Added live seat-count selectors (`#bjk-seats-select`, `#poker-seats-select`, `#skipbo-seats-select`, `#phase10-seats-select`, `#uno-seats-select`, `#avalon-seats-select`, `#set-seats-select`), instant `+ Player` / `+ Knight` buttons (`#bjk-btn-add-player`, `#poker-btn-add-player`, `#skipbo-btn-add-player`, `#phase10-btn-add-player`, `#uno-btn-add-player`, `#avalon-btn-add-player`, `#set-btn-add-player`), `#phase10-btn-bot-step`, and interactive multi-player seat tracks (`#bjk-seats-track`, `#poker-seats-track`, `#skipbo-opponents-track`, `#phase10-opponents-track`, `#uno-opponents-track`, `#set-players-scoreboard`) where clicking any seat badge claims it for a human user.

## [1.2.0-rc.26] - 2026-10-27
### Added
- **Grand Sanctuary Playing Card & Typography UI/UX Overhaul Across All 7 Arcade Game Theaters (`src/styles/main.css`, `src/main.ts`, `index.html`)**:
  - **Fluid Grand Playing Card Scale (`.playing-card-ui`, `.playing-card-corner`, `.playing-card-center`, `.arcade-set-card-ui`)**: Upgraded playing card dimensions across Gothic Blackjack, Cathedral Poker, Sacred Skip-Bo, Ten Rites (Phase 10), and Cardinal Uno to `width: clamp(5.25rem, 8.2vw, 7.25rem); height: clamp(7.5rem, 11.8vw, 10.25rem)` with crisp corner indices (`clamp(0.92rem, 1.15vw, 1.15rem)`) and large center pips/ranks (`clamp(2.1rem, 3.2vw, 3rem)`), replacing tiny or non-standard Tailwind classes (`w-13`, `w-14`, `h-19`, `h-20`, `h-22`, `text-[9px]`).
  - **Sacred Geometry SET Theater & SVG Card Upgrade (`renderSetSymbolSvg`, `renderSetTable`)**: Enlarged procedural SET SVG shapes (`w-16 h-9 sm:w-20 sm:h-11`), tactile `.arcade-set-card-ui` cards (`min-height: clamp(7.5rem, 12.5vh, 10rem)`), and unified DOM bindings across `#set-table-grid`, `#set-players-scoreboard`, `#set-deck-remaining`, `#set-available-count`, `#set-status-banner`, `#set-tab-ai`, and `#set-tab-live`.
  - **Wider Full-Screen Arenas (`max-w-7xl`) & Tactile Controls**: Expanded all 7 arcade theater arenas to `max-w-7xl` with larger status banners (`text-sm sm:text-base`), opponent strips, Avalon quest/seat cards, Skip-Bo building/discard piles, and action buttons (`py-3.5 text-sm sm:text-base`).
- **Universal ECMAScript `Temporal` API First with `dayjs` Fallback (`src/utils/dateTime.ts`, `src/games/multiplayer/tableSeatManager.ts`, `scripts/benchmark-storage.ts`, `AGENTS.md`)**:
  - Added `subtractDaysEpochMs` and `subtractDaysIso` to `src/utils/dateTime.ts` using `Temporal.Instant` with automatic `dayjs` fallback (modeled after MST Notes UI).
  - Replaced all remaining raw `Date.now()` and `new Date()` calls in `src/games/multiplayer/tableSeatManager.ts` and `scripts/benchmark-storage.ts` with `currentEpochMs()` and `nowIso()`, and codified the mandatory Temporal-first with Day.js fallback rule in `AGENTS.md`.

## [1.2.0-rc.25] - 2026-10-27
### Added
- **Live PocketHost 32-Collection Multi-Game Migration, Hibernation-Resilient Cron Hook & Server-Side Cleanup Cron (`pb_hooks/cleanup.pb.js`, `src/server/pocketbase/migrator.ts`, `src/server/pocketbase/pruner.ts`, `src/server/pocketbase/multiGameSchema.json`, `src/server/server.ts`)**:
  - **All 32 Hungarian Collections Migrated to Live PocketHost (`https://web-chess.pockethost.io`)**: Extended `runPocketBaseMigration` (`bun run pb:migrate`) to migrate both `schema.json` and `multiGameSchema.json` (`tbl_bjk_*`, `tbl_res_*`, `tbl_uno_*`, `tbl_p10_*`, `tbl_pok_*`, `tbl_skp_*`, `tbl_set_*`) with `created`/`updated` `autodate` fields and composite `(do_not_delete, updated, status)` cleanup indexes.
  - **Hibernation-Resilient PocketBase Cron Hook (`pb_hooks/cleanup.pb.js`)**: Configured `cronAdd("cleanup_stale_chess_sessions", "0 3,15 * * *")` alongside an `onRecordAfterCreateSuccess` wakeup hook that checks `tbl_audit_cleanup_logs` and automatically executes a full 8-game stale session cleanup sweep whenever >= 12 hours have elapsed since the last cleanup (preventing PocketHost container hibernation from skipping a 12-hour cleanup window).
  - **Universal 8-Game Pruner & Server Cron Trigger (`src/server/pocketbase/pruner.ts`, `scripts/pb-cleanup.ts`)**: Added `triggerPocketBaseServerCron` (`POST /api/crons/cleanup_stale_chess_sessions`) and expanded `prunePocketBaseSessions` to sweep `game_sessions` and all 7 multi-game arcade session collections (`tbl_bjk_sessions`, `tbl_res_sessions`, `tbl_uno_sessions`, `tbl_p10_sessions`, `tbl_pok_sessions`, `tbl_skp_sessions`, `tbl_set_sessions`) where `updated < cutoff && do_not_delete != true`.
  - **Local Bun Server Automated Cleanup Cron (`src/server/server.ts`)**: Added `startCleanupCron`, `stopCleanupCron`, `runStaleCleanupSweep`, and `POST /api/maintenance/cleanup` on `SanctuaryRealtimeServer`.

## [1.2.0-rc.24] - 2026-10-27
### Added
- **Battery & GPU Power Governor (`src/graphics/renderGovernor.ts`, `src/graphics/scene.ts`, `src/graphics/shatter.ts`, `src/main.ts`, `src/styles/main.css`)**:
  - **Zero-Wattage 3D Suspension Behind 2D Arcade Theaters & Hidden Tabs**: Completely suspends Three.js WebGL rendering (`renderer.render(scene, camera)`), particle buffer uploads, and trigonometry calculations (`RenderPowerStateEnum.Suspended`) whenever `document.hidden` is true or any full-screen 2D Arcade Game Theater (`#blackjack-modal`, `#poker-modal`, `#skipbo-modal`, `#phase10-modal`, `#uno-modal`, `#avalon-modal`, `#set-modal`, `#arcade-hub-modal`) is open.
  - **Adaptive Frame-Rate Governor (60 FPS Active -> 20 FPS Ambient Idle)**: Caps active 3D rendering at `60 FPS` (`16ms` interval) so `120Hz` ProMotion displays do not burn double battery, and smoothly steps down to `20 FPS` (`50ms` interval) after `3.5s` of user inactivity (`RenderPowerStateEnum.AmbientIdle`), waking immediately on any pointer, wheel, touch, or keyboard interaction.
  - **On-Demand Shadow Map Caching (`renderer.shadowMap.autoUpdate = false`)**: Disabled per-frame `2048 × 2048` `PCFSoftShadowMap` recalculation and only updates shadow maps when pieces move, shatter, or sync on the board.
  - **Integrated GPU Power Profile & Geometry Reuse**: Switched WebGL `powerPreference` from `'high-performance'` to `'default'` so dual-GPU laptops remain on efficiency GPU cores, reused shared unit `OctahedronGeometry` and `DodecahedronGeometry` across shatter explosions, disposed expired shockwave geometries/materials, and applied CSS `content-visibility: auto; contain-intrinsic-size: auto none auto 28px;` to off-screen chronicle rows.
- **Pure `Option<HTMLElement>` DOM Architecture & `ImmutableBuilder<T>` (`src/utils/fp.ts`, `src/ui/uiController.ts`)**:
  - Replaced all 78 `HTMLElement | null` / `HTMLButtonElement | null` / `HTMLInputElement | null` fields in `UIControllerElements` with `readonly Option<HTMLElement>` fields constructed via `buildUIControllerElements` and `ImmutableBuilder<T>`.
  - Added `domById`, `zipOptions`, `zip3Options`, and `ImmutableBuilder` to `src/utils/fp.ts`, enforcing `Readonly<T>` / `readonly` immutability and IntelliJ Java parameter alignment.

## [1.2.0-rc.23] - 2026-10-27
### Added
- **Sacred Geometry SET ($\text{GF}(3)^4$ Finite Geometry Card Game) (`src/games/set/setEngine.ts`, `index.html`, `src/main.ts`, `tests/setEngine.test.ts`)**:
  - Engineered the 81-card $\text{GF}(3)^4$ / $\text{AG}(4, 3)$ affine geometry engine across 4 features: `count` (`1 | 2 | 3`), `shape` (`diamond | squiggle | oval`), `shading` (`solid | striped | open`), and `color` (`red | green | purple`).
  - Implemented collinearity validation ($(a_i + b_i + c_i) \bmod 3 === 0$), unique third-card completion vector calculation ($(6 - a_i - b_i) \bmod 3$), human-readable attribute failure explanations, Cap Set Theorem 21-card guarantee handling, false-Set $-1$ point penalty enforcement, hints, AI opponent turns, and end-of-game detection.
  - Added full-screen `#set-modal` theater with procedural SVG symbol rendering (diamonds, ovals, squiggles with solid, open, and striped SVG pattern fills), real-time available-Set counter, AI opponent mode, and Live Online multiplayer mode (`SET-XXXX`).
- **Playable Cardinal Uno & The Resistance: Avalon Engines, Full-Screen Theaters & Real-Time Multiplayer (`src/games/uno/unoEngine.ts`, `src/games/avalon/avalonEngine.ts`, `src/server/services/arcadeRealtimeService.ts`, `src/realtime/arcadeRealtimeClient.ts`)**:
  - Built complete `CardinalUnoEngine` (2–10 players, 108-card deck, Skip, 2-player Reverse-as-Skip rule, Draw Two, Wild, Wild Draw 4, UNO declaration, deck recycling) and `#uno-modal` full-screen theater.
  - Built complete `AvalonEngine` (5–10 players, Merlin, Percival, Loyal Servants, Assassin, Morgana, Minions of Mordred, 5 Quests with 7+ player two-fail Quest 4 rule, 5-reject evil victory, and Merlin Assassination stage) and `#avalon-modal` full-screen theater.
  - Added `ArcadeRealtimeService` and `ArcadeRealtimeClient` providing multiplexed Server-Sent Events (SSE) real-time rooms, `Last-Event-ID` missed-event replay, and automatic AI bot hot-swapping when human players join or leave across all arcade games.
- **Database Schema Optimization, SET Tables & Universal 3+ Day Stale Session Pruning (`src/server/db/multiGameSchema.sql`, `src/server/pocketbase/multiGameSchema.json`, `src/server/services/multiGameService.ts`, `pb_hooks/cleanup.pb.js`)**:
  - Added Hungarian-prefixed SET tables (`tbl_set_sessions`, `tbl_set_seats`, `tbl_set_moves`, `tbl_set_events`, `tbl_archived_set_snapshots`, `tbl_archived_set_snapshots_history`) and PocketBase collections for Poker (`tbl_pok_*`), Skip-Bo (`tbl_skp_*`), and SET (`tbl_set_*`).
  - Added composite cleanup indexes (`idx_<prefix>_cleanup_composite ON tbl_<prefix>_sessions (do_not_delete, updated_at, status)`) across all 7 arcade SQLite table families.
  - Implemented `MultiGameService.pruneAllStaleArcadeGames(olderThanDays = 3)` and expanded `pb_hooks/cleanup.pb.js` cron (`0 3,15 * * *`) to archive snapshots and cascade-delete stale sessions older than 3 days across every game collection while preserving records flagged with `do_not_delete = true`.
- **IntelliJ Java Function/Method Parameter Formatting & Documentation Refresh (`AGENTS.md`, `README.md`, `CHANGELOG.md`)**:
  - Formatted multi-parameter functions and methods in the IntelliJ Java parameter alignment style (first parameter immediately after `(`, subsequent parameters flush vertically below, closing `)` on the final parameter's line) and codified this rule in `AGENTS.md`.

## [1.2.0-rc.22] - 2026-10-27
### Added
- **Expansive Full-Screen Viewport Architecture for All Games (`index.html`, `src/styles/main.css`, `src/main.ts`)**:
  - **Full-Screen Table Theaters**: Transformed all game views (Gothic Blackjack, Cathedral Poker, Sacred Skip-Bo, and Ten Rites Phase 10) from cramped, centered modal popups into majestic, edge-to-edge full-screen game arenas (`fixed inset-0 w-full h-full`) matching the immersive grandeur of Sanctuary Chess.
  - **Atmospheric Sanctuary Navigation Bar**:
    - Embedded unified top navigation bars across all game tables featuring prominent "Sanctuary" exit buttons, gothic typography headers, thematic game icons, and live status bars.
    - Integrated native HTML5 Fullscreen API toggles (`btn-bjk-fullscreen`, `btn-poker-fullscreen`, `btn-skipbo-fullscreen`, `btn-phase10-fullscreen`) with dynamic icon swapping (`fullscreen` / `fullscreen_exit`) via `fullscreenchange` event observation.
  - **Atmospheric Procedural Gaming Felts (`src/styles/main.css`)**:
    - Created custom CSS felts: `.felt-blackjack` (deep emerald velvet radial gradient with casino rim shadow), `.felt-poker` (warm mahogany and amber oval felt), `.felt-skipbo` (celestial sapphire sanctuary table), and `.felt-phase10` (obsidian and liturgical jade felt).
  - **High-Fidelity Playing Card Component System (`.playing-card-ui`)**:
    - Implemented large, responsive tournament playing cards with realistic ivory parchment gradients, dual corner rank/suit indices, center suit symbols, drop shadows, and upside-down bottom pips.
    - Added interactive tactile card animations: hover elevation transforms (`translateY(-4px)`), smooth card scaling, and illuminated golden selection rings (`.card-selected`).
  - **Tactile Control Docks & Clear Spacing**:
    - Expanded building piles and stockpile cards for Sacred Skip-Bo with real-time "Next Needed" hints and progress counters.
    - Expanded community card arena and multi-seat layout for Cathedral Poker.
    - Expanded dual draw/discard piles, laid melds sanctuary, and consecrated 10-card hand view for Ten Rites Phase 10.
    - Expanded dealer shoe, chip rack, and betting controls for Gothic Blackjack.

## [1.2.0-rc.21] - 2026-10-26
### Added
- **Complete Multi-Game Suite: Phase 10, Skip-Bo, Blackjack, & Multi-Variant Poker with Play vs Computer & Live 1v1 Online**:
  - **Ten Rites (Phase 10) Interactive Engine (`src/games/phase10/phase10Engine.ts`, `index.html`, `src/main.ts`)**:
    - Built complete functional Phase 10 engine with all 10 liturgical phases, set and run validators, deck recycling, card drawing from deck or discard pile, phase laying down, hitting on melds, and tournament scoring.
    - Added dedicated sanctuary interactive modal (`#phase10-modal`) with live phase tracker, multi-card hand selectors, and seamless toggle between **Play vs Computer (Prior AI)** and **Live 1v1 Online** (`P10-XXXX` codes & share links).
  - **Sacred Skip-Bo Engine (`src/games/skipbo/skipboEngine.ts`, `index.html`, `src/main.ts`)**:
    - Created 162-card sequential building engine (1-12 ascending building piles + Skip-Bo Wilds, 15-card stockpiles, 4 personal discard piles).
    - Autonomous AI Abbot solver with optimal play sequencing (stockpile -> hand -> discard) and strategic end-of-turn discards.
    - Dedicated sanctuary table modal (`#skipbo-modal`) with shared building piles, hand view, stockpile counter, and toggle between **Play vs Computer** and **Live 1v1 Online** (`SKIP-XXXX` codes & share links).
  - **Expanded Cathedral Poker Engine (4 Variants) (`src/games/poker/pokerEngine.ts`, `index.html`, `src/main.ts`)**:
    - Added **Seven-Card Stud** (2 down, 4 up, 1 down) and **Five-Card Draw** (card exchange up to 3 cards) alongside **Texas Hold'em** and **Omaha**.
    - Dedicated sanctuary table modal (`#poker-modal`) with variant switcher, community board, pot display, betting actions (Check, Call, Raise, Fold, All-In), next street progression, and toggle between **Play vs Computer** and **Live 1v1 Online** (`POKER-XXXX` codes & share links).
  - **Gothic Blackjack Live 1v1 Online Toggle (`index.html`, `src/main.ts`)**:
    - Added Live 1v1 Online mode toggle bar to `#blackjack-modal` with auto-generated session code (`BJK-XXXX`) and one-click share link copying.
  - **Hungarian Database Schemas & Observability for Skip-Bo (`src/server/db/multiGameSchema.sql`, `src/server/services/multiGameService.ts`)**:
    - Added `tbl_skp_sessions`, `tbl_skp_seats`, `tbl_skp_moves`, `tbl_skp_events`, `tbl_archived_skp_snapshots`, and `tbl_archived_skp_snapshots_history`.
    - Integrated `[SERVER_SIDE] [SKIPBO_TRACE]` structured logging and snapshot archival in `MultiGameService`.
  - **Universal Deep-Linking & Routing (`src/routing/sessionRouter.ts`, `src/main.ts`)**:
    - Updated Arcade Hub cards to "Live & Playable" for Phase 10, Skip-Bo, Blackjack, and Poker.
    - Deep-linking and quick join router directly boots into the respective game modal in Live 1v1 mode upon receiving codes (`SANCT-`, `BJK-`, `POKER-`, `SKIP-`, `P10-`).
- **Comprehensive Unit & Integration Testing**:
  - Added unit test suites for Skip-Bo (`tests/skipboEngine.test.ts`), Phase 10 (`tests/phase10Engine.test.ts`), expanded Poker (`tests/pokerEngine.test.ts`), and UIController (`tests/uiController.test.ts`).
  - Total passing tests increased to **292 / 292 passing** across 38 files with >98.6% line and branch coverage.

## [1.2.0-rc.20] - 2026-10-26
### Added
- **Centralized Game Enums & Constants Suite (`src/constants/gameEnums.ts`, `src/types/index.ts`)**:
  - Eliminated ad-hoc string literals across the game engine architectures by creating strict TypeScript Enums and constant types.
  - Added `ArcadeGameEnum` (`Chess`, `Blackjack`, `Avalon`, `Uno`, `Phase10`, `Poker`) and `GameCodePrefixEnum` (`SANCT-`, `BJK-`, `AVALON-`, `UNO-`, `P10-`, `POKER-`).
  - Added `CardSuitEnum` (`Hearts`, `Diamonds`, `Clubs`, `Spades`), `CardValueEnum` (`Two` through `Ace`), `CARD_SUITS`, `CARD_VALUES`.
  - Added `AIModelEnum`, `DifficultyEnum`, `BlackjackActionEnum`, `BlackjackStageEnum`, `BlackjackOutcomeEnum`.
  - Added `HotSwapActionEnum`, `SeatHandStatusEnum`, `LiveRoleEnum`.
  - Added `PokerVariantEnum`, `PokerStageEnum`, `PokerActionEnum`, `PokerHandRankEnum`, and `POKER_HAND_VALUES`.
  - Re-exported all enums and constants through `src/types/index.ts` for unified import patterns.
- **Cathedral Poker Multi-Variant Engine & Hand Evaluator (`src/games/poker/pokerEngine.ts`)**:
  - Engineered pure functional `CathedralPokerEngine` supporting Texas Hold'em and Omaha variants.
  - Implemented exhaustive 10-tier poker hand evaluator (`RoyalFlush`, `StraightFlush`, `FourOfAKind`, `FullHouse`, `Flush`, `Straight`, `ThreeOfAKind`, `TwoPair`, `OnePair`, `HighCard`) with support for A-2-3-4-5 wheel straights and deep kicker tie-breaking.
  - Multi-seat betting engine featuring blind deductions, dealing phases (PreFlop, Flop, Turn, River, Showdown), action handling (`Fold`, `Check`, `Call`, `Bet`, `Raise`), and side-pot capable pot distribution.
- **Dedicated Poker Hungarian Database Schema & Observability (`src/server/db/multiGameSchema.sql`, `src/server/services/multiGameService.ts`)**:
  - Added Hungarian-prefixed tables: `tbl_pok_sessions`, `tbl_pok_seats`, `tbl_pok_moves`, `tbl_pok_events`, `tbl_archived_pok_snapshots`, and `tbl_archived_pok_snapshots_history`.
  - Enhanced `MultiGameService` with structured tracing (`[SERVER_SIDE] [POKER_TRACE]`), snapshot persistence, and cold storage partition transfers.
- **Universal Session Router Poker Support (`src/routing/sessionRouter.ts`)**:
  - Added `ArcadeGameEnum.Poker` routing metadata, display titles, and `POKER-` session code recognition.
- **Comprehensive Unit Testing Suite (`tests/pokerEngine.test.ts`, `tests/multiGameService.test.ts`, `tests/sessionRouter.test.ts`)**:
  - Added 5 new poker evaluator tests covering Texas Hold'em & Omaha rounds, hand rank calculations, and betting dynamics.
  - Expanded `MultiGameService` and `SessionRouter` test suites to cover poker session lifecycle and routing.
  - All 267 tests passing with >98.8% line and branch coverage.

## [1.2.0-rc.19] - 2026-10-26
### Added
- **Dynamic Multi-Seat Table Allocation & Bot Hot-Swapping (`src/games/multiplayer/tableSeatManager.ts`)**:
  - Engineered generic, functional `TableSeatManager` supporting arbitrary player capacities (5-7 in Blackjack, 5-10 in Avalon, 2-10 in Uno, 2-6 in Phase 10).
  - Dynamic Bot Pre-Fill: Automatically populates empty seats with AI bots (`minimax`, `micro-neural`, `gemini-nano`) so matches start instantly without waiting for a lobby to fill.
  - Seamless Bot Hot-Swap on Player Join (`claimSeat`): Automatically replaces the seated AI bot with the incoming human player without interrupting the table state.
  - Dynamic AI Replacement on Player Disconnect/Leave (`vacateSeat`): Instantly hot-swaps an AI bot back into an abandoned seat, maintaining hand continuity and preventing table freezes.
- **Multi-Player (>2) Gothic Blackjack Engine (`src/games/blackjack/blackjackMultiSeatEngine.ts`)**:
  - Implemented 5-seat multiplayer Gothic Blackjack table engine supporting multiple simultaneous human players alongside AI opponents.
  - Includes 6-deck shoe dealing, dealer Soft 17 rules, sequential multi-seat turns, bot auto-play heuristics, human player actions (`hit`, `stand`, `double`), and casino payout settlements (3:2 natural blackjack, 1:1 wins, ties push, busts lose).
- **Dedicated Hungarian Database Tables, Tracing & History Partitions (`src/server/db/multiGameSchema.sql`, `src/server/pocketbase/multiGameSchema.json`, `src/server/services/multiGameService.ts`)**:
  - Added dedicated seats, moves, events, and snapshot partition tables across Blackjack (`tbl_bjk_*`), Avalon (`tbl_res_*`), Uno (`tbl_uno_*`), and Phase 10 (`tbl_p10_*`).
  - Implemented `MultiGameService` with structured tracing (`[SERVER_SIDE] [BJK_TRACE]`, `[RES_TRACE]`, etc.), snapshot archival with `bln_do_not_delete` support, and transaction-safe migrations to history partitions (`tbl_archived_<game>_snapshots_history`).
- **Scene & Background Environments Roadmap (`docs/SCENE_THEMES_ROADMAP.md`)**:
  - Established procedural 3D environment architecture and rollout plan for Courtroom (High Court of Justice), Royal Palace (Throne Room), Grand Monastic Library (Scriptorium), and Alchemical Crucible while maintaining the High Gothic Basilica as default.
- **Testing & Verification (`tests/tableSeatManager.test.ts`, `tests/blackjackMultiSeatEngine.test.ts`, `tests/multiGameService.test.ts`)**:
  - Added 18 new unit & integration tests covering multi-seat capacity, bot filling, hot swapping, multi-player rounds, and database cascade deletion with 260 total passing tests across 35 files.

## [1.2.0-rc.18] - 2026-10-26
### Added
- **Live Chess Match Stalemate & Checkmate Exit UX (`index.html`, `src/ui/uiController.ts`, `src/main.ts`)**:
  - Implemented `#gameover-live-actions` container inside `#gameover-modal` with dedicated **"Exit Live Match"** (`#modal-leave-live`) and **"Inspect Board"** (`#modal-inspect-live`) actions, resolving the stalemate UX trap where players were previously unable to leave due to pregame mode locks.
  - Added persistent **"Exit"** action (`#btn-persistent-leave-live`) to the top `#live-persistent-hud`, allowing players to exit cleanly at any moment during or after a live match.
  - Implemented dynamic stalemate subtitle formatting distinguishing between live matches with session code display and offline matches.
  - Consolidated live exit logic into `handleLeaveLiveMatch()` across all triggers to tear down PocketBase SSE subscriptions, clear active banners, and restore standard game modes.
- **Phase 2: Gothic Blackjack Interactive Engine & Multi-Game AI Opponent Suite (`src/games/blackjack/blackjackEngine.ts`, `index.html`, `src/main.ts`)**:
  - Built pure functional Gothic Blackjack game engine (`BlackjackEngine`) featuring Fisher-Yates multi-deck shoe creation, card evaluation (soft/hard aces, 21, busts), relic chip bank, betting controls, hit, stand, double down, natural 3:2 payouts, and dealer AI thresholds (Cautious stands on 16, Balanced on 17, Ruthless on 18).
  - Added interactive Gothic velvet felt table (`#blackjack-modal`) with chip betting ($10, $25, $50, $100), dynamic card flip animations, and AI opponent selector.
  - Added dual-action buttons across all Arcade Hub cards (`data-game-ai` and `data-game-live`), allowing all arcade titles to be launched both against computer opponents (Minimax, Micro-Neural, Gemini Nano based on device tier) and as live multiplayer sessions.
  - Implemented device tier filtering (`getAvailableBlackjackAI`) ensuring Mobile Lite devices use lightweight AI models without crashing.
- **Testing & Verification (`tests/blackjackEngine.test.ts`, `tests/uiController.test.ts`)**:
  - Added unit test suite `tests/blackjackEngine.test.ts` with 100% line and function coverage across all card mechanics, payouts, AI thresholds, and betting rules.
  - Expanded `tests/uiController.test.ts` to assert live gameover action toggling, stalemate subtitle formatting, and blackjack modal visibility.
  - Maintained 242 passing tests with 99.19% line coverage and 99.53% branch coverage.

## [1.2.0-rc.17] - 2026-10-26
### Added
- **Persistent In-Game Live Match Sharing HUD & Quick Actions (`#live-persistent-hud`, `src/ui/uiController.ts`, `src/main.ts`)**:
  - Implemented a persistent on-screen HUD bar displayed directly below the top turn indicator whenever a Live 1v1 match is active on the 3D board.
  - Added one-click **"Copy Link"** button (`#btn-persistent-copy-link`) that copies the canonical invite URL (`https://...?session=SANCT-XXXX`), displays dynamic "Copied!" check feedback, sounds cathedral audio confirmation, and triggers toast banners.
  - Added quick **"Code"** button (`#btn-persistent-copy-code`) to copy the raw 6-character session code.
  - Added persistent on-screen **"Pin"** toggle button (`#btn-persistent-toggle-pin`) synchronized with the database `do_not_delete` match-protection state.
  - Added matching **"Copy Link"** action button (`#btn-live-banner-copy-link`) inside the Live Match modal banner.
  - Expanded `UIController` with methods `setPersistentCopyLinkCopied` and `setBannerCopyLinkCopied` alongside full test coverage in `tests/uiController.test.ts`.

## [1.2.0-rc.16] - 2026-10-26
### Added
- **Phase 1: Sanctuary Multi-Game Arcade Hub & Universal Session Router (`src/routing/sessionRouter.ts`, `index.html`, `src/ui/uiController.ts`)**:
  - Implemented the Sanctuary Arcade Front Screen / Game Selector Hub modal (`#arcade-hub-modal`) with cards for Wizard's Chess 3D (flagship, live & playable), Gothic Blackjack (Phase 2), The Resistance: Avalon (Phase 3), Cardinal Uno (Phase 4), and Ten Rites / Phase 10 (Phase 5).
  - Added bottom floating `#btn-arcade-hub` button with full backdrop-blur dismiss and keyboard navigation.
  - Implemented universal quick-join search box (`#hub-quick-join-input`) capable of parsing raw codes or full shareable links across all 5 game prefixes (`SANCT-`, `BJK-`, `AVALON-`, `UNO-`, `P10-`).
  - Created `SessionRouter` (`src/routing/sessionRouter.ts`) with prefix detection, deep-link query parameter parsing (`?game=...&session=...` and legacy `?session=SANCT-...`), and canonical URL generation (`buildArcadeGameUrl`).
- **Hungarian Multi-Game Database Schema Architecture (`src/server/pocketbase/multiGameSchema.json`, `src/server/db/multiGameSchema.sql`)**:
  - Engineered Hungarian-prefixed schema specifications for Blackjack (`tbl_bjk_*`), Avalon/Resistance (`tbl_res_*`), Uno (`tbl_uno_*`), and Phase 10 (`tbl_p10_*`).
  - Structured dedicated primary session collections with unique `session_code` and `do_not_delete` pinning flags.
  - Designed matching single-row compact snapshot tables (`tbl_archived_<game>_snapshots`) and cold-storage history partitions (`tbl_archived_<game>_snapshots_history`) across both PocketBase and SQLite schemas.
- **PocketHost SFTP Automated Hook Deployment (`scripts/pb-deploy-hooks.ts`, `package.json`, `AGENTS.md`)**:
  - Implemented `bun run pb:deploy-hooks` script to automatically upload `pb_hooks/` files (including `cleanup.pb.js`) via SFTP to `ftp.pockethost.io:2222`.
  - Verified remote deployment of `cleanup.pb.js` into `/web-chess/pb_hooks/cleanup.pb.js` on PocketHost.
  - Added `bun run pb:deploy-hooks` to persistent pre-approved command permissions in `AGENTS.md`.
- **Testing & Verification (`tests/sessionRouter.test.ts`, `tests/arcadeHubIntegration.test.ts`)**:
  - Added unit test suite covering game prefix detection, URL parsing, link extraction, and game metadata.
  - Added integration test suite verifying Hub UI modal transitions, quick-join feedback styling, PocketBase multi-game schema integrity, and in-memory SQLite schema execution with foreign key cascades.

## [1.2.0-rc.15] - 2026-10-26
### Added
- **"DO NOT DELETE" Match Pinning UI Toggle, Schema Protection & Pruner Exclusion (`do_not_delete` / `bln_do_not_delete`)**:
  - Implemented session pinning UI with a creation-time checkbox (`#live-host-do-not-delete`) in the Match Setup modal and a real-time interactive pin badge (`#btn-toggle-do-not-delete`) in the active match banner.
  - Added `do_not_delete` boolean column and `idx_game_sessions_do_not_delete` index to PocketBase `game_sessions` schema; deployed live migration to PocketHost.
  - Added `bln_do_not_delete` boolean field to snapshot archival tables `tbl_archived_game_snapshots` and `tbl_archived_game_snapshots_history`.
  - Added `do_not_delete` integer column and `ix_game_sessions_do_not_delete` index to SQLite `game_sessions` table.
  - Updated PocketBase Goja cron hook (`pb_hooks/cleanup.pb.js`) and REST pruner service (`src/server/pocketbase/pruner.ts`) query filter to `updated < {:cutoff} && do_not_delete != true`, strictly exempting pinned matches from pruning and snapshot archival.
  - Updated SQLite `SessionRepository.pruneStaleSessions` to filter `WHERE updated_at < ? AND (do_not_delete IS NULL OR do_not_delete = 0)`.
  - Implemented `PocketBaseChessClient.setSessionDoNotDelete` and instance method `client.setDoNotDelete(pinned)` enabling mid-game status pinning.
  - Added comprehensive unit and end-to-end integration tests (`tests/cleanupHook.test.ts`, `tests/pruner.test.ts`, `tests/sessionRepository.test.ts`, `tests/uiController.test.ts`, `tests/integration.test.ts`) validating pin survival across pruning cycles with >99% code coverage.

## [1.2.0-rc.14] - 2026-10-26
### Added
- **Indexed Compact Archival Snapshots & Match Restoration Architecture (`tbl_archived_game_snapshots`, `tbl_archived_game_snapshots_history`)**:
  - Implemented single-row compact match snapshots captured immediately prior to cascade deletion during pruner cycles across both PocketBase and SQLite schemas.
  - Collapses entire multi-table games (sessions, participants, moves, and events) into a single optimized, indexed row containing `txt_session_code` (UNIQUE), `txt_final_fen`, `txt_white_player`, `txt_black_player`, `txt_winner`, `txt_status`, `int_total_plies`, `txt_pgn`, and `json_snapshot_payload`.
  - Added historical partition rollover table `tbl_archived_game_snapshots_history` for cold-storage tiering of snapshots older than 30 days.
  - Deployed live PocketHost migration creating `tbl_archived_game_snapshots` (`pbc_9090007`) and `tbl_archived_game_snapshots_history` (`pbc_4053568688`).
  - Implemented lossless restoration functions `SessionRepository.restoreSessionFromSnapshot` (SQLite) and `restoreArchivedPocketBaseSession` (PocketBase REST API) to resurrect pruned games on demand.
  - Added complete unit and integration tests across Goja VM, SQLite repository, and PocketBase pruner services.

## [1.2.0-rc.13] - 2026-10-26
### Added
- **PocketBase Goja Cron Hook Sandboxed Unit Testing (`tests/cleanupHook.test.ts`)**:
  - Engineered unit testing suite executing `pb_hooks/cleanup.pb.js` inside an emulated PocketBase Goja VM context with mock `$app` and `cronAdd` APIs.
  - Verified schedule registration (`0 3,15 * * *`), stale session cascade deletion, structured audit logging into `tbl_audit_cleanup_logs`, 30-day partition rollover into `tbl_audit_cleanup_logs_history`, and non-crashing error resilience.
- **End-to-End Pruning & Partitioned Archival Integration Testing (`tests/integration.test.ts`, `tests/pruner.test.ts`)**:
  - Added end-to-end integration test verifying complete lifecycle: creating stale sessions with participants, moves, and events, executing cascade pruning, recording Hungarian trace logs, and archiving older records to cold-storage history.
  - Expanded `tests/pruner.test.ts` to assert partition rollover payloads and verified live execution against PocketHost via `bun run pb:cleanup`.

## [1.2.0-rc.12] - 2026-10-26
### Added
- **Partitioned Historical Audit Architecture (`tbl_audit_cleanup_logs_history`, `src/server/pocketbase/schema.json`, `src/server/db/schema.sql`, `src/server/db/sessionRepository.ts`, `src/server/pocketbase/pruner.ts`, `pb_hooks/cleanup.pb.js`)**:
  - Implemented automatic partition rollover from the active Hungarian-notated audit table (`tbl_audit_cleanup_logs`) into a dedicated cold storage history table (`tbl_audit_cleanup_logs_history`).
  - Added schema specification with matching Hungarian-prefixed columns (`txt_trace_id`, `txt_trigger_source`, `int_deleted_sessions`, `txt_cutoff_timestamp`, `txt_pruned_codes_json`, `int_duration_ms`, `bln_success`, `txt_error_message`, `created`, `updated`) and performance indices (`idx_tbl_audit_hist_trace`, `idx_tbl_audit_hist_created`, `idx_tbl_audit_hist_source`).
  - Created and applied live PocketHost migration for collection `tbl_audit_cleanup_logs_history` (`pbc_2694825927`).
  - Implemented automated 30-day archival threshold: audit entries older than 30 days are automatically archived to the history table and evicted from the primary table, keeping the primary active table lean and sub-millisecond fast.
  - Added `SessionRepository.archiveCleanupAudits` and `SessionRepository.getHistoricalCleanupAudits` to the SQLite persistence layer.
- **Persistent Pre-Approved Command Permissions (`AGENTS.md`)**:
  - Documented Rule 9 in `AGENTS.md` explicitly defining persistent user-approved operational permissions (Bun testing and building, shell credential sourcing via `~/.zshrc`, automated migrations, security scans, and committing/pushing upon verification) to maintain autonomous velocity without breaking guardrails.

## [1.2.0-rc.11] - 2026-10-26
### Added
- **Hungarian-Prefixed Namespaced Audit & Observability Table (`tbl_audit_cleanup_logs`, `src/server/pocketbase/schema.json`, `src/server/db/schema.sql`, `src/server/pocketbase/pruner.ts`, `pb_hooks/cleanup.pb.js`)**:
  - Implemented Hungarian notation audit table `tbl_audit_cleanup_logs` across PocketBase and SQLite schema specifications with indexed columns: `txt_trace_id`, `txt_trigger_source`, `int_deleted_sessions`, `txt_cutoff_timestamp`, `txt_pruned_codes_json`, `int_duration_ms`, `bln_success`, `txt_error_message`.
  - Added correlated trace IDs (`trc_cln_<timestamp>_<hash>` and `trc_hook_<timestamp>_<hash>`) tracking every pruning execution across PocketBase Goja cron hooks, manual CLI invocations, and API maintenance runs.
  - Implemented 90-day self-trimming retention policy within the pruner to keep `tbl_audit_cleanup_logs` compact, searchable, and free of long-term bloat.
  - Added methods `SessionRepository.recordCleanupAudit` and `SessionRepository.getCleanupAudits` to local SQLite persistence layer.
  - Applied schema migration to live PocketHost instance creating collection `tbl_audit_cleanup_logs` (`pbc_320509512`) with validated read/write access.

## [1.2.0-rc.10] - 2026-10-26
### Changed
- **Semi-Daily Goja Hook Pruning for Games Inactive for 3 Days (`pb_hooks/cleanup.pb.js`, `src/server/pocketbase/pruner.ts`, `src/server/db/sessionRepository.ts`)**:
  - Configured PocketBase Goja cron hook to run **twice daily** (`0 3,15 * * *` at 03:00 and 15:00 UTC) to cascade delete game sessions that haven't had a move made in 3 days (`updated < cutoff`).
  - Switched pruning filters from `created` to `updated` across both PocketBase and SQLite persistence layers, preserving actively contested games while removing abandoned matches.
- **Deactivated GitHub Actions Cron Schedule (`.github/workflows/cleanup-stale-sessions.yml`)**:
  - Removed automated cron schedule from GitHub Actions to prevent consuming account minutes; workflow is set to manual `workflow_dispatch` only.

## [1.2.0-rc.9] - 2026-10-25
### Added
- **Optimized B-Tree Indexing Architecture across all PocketHost Collections (`src/server/pocketbase/schema.json`)**:
  - Expanded and applied high-performance single-column and compound indices across all four PocketHost collections:
    - `game_sessions`: `idx_game_sessions_code` (unique), `idx_game_sessions_status`, `idx_game_sessions_created`, `idx_game_sessions_updated`, `idx_game_sessions_status_created`.
    - `session_participants`: `idx_participants_session`, `idx_participants_session_role`, `idx_participants_created`.
    - `game_moves`: `idx_moves_session_ply` (unique), `idx_moves_session`, `idx_moves_session_created`.
    - `session_events`: `idx_events_session_seq` (unique), `idx_events_session`, `idx_events_session_type`, `idx_events_created`.
  - Added explicit `autodate` schema fields (`created`, `updated`) to all PocketBase collections conforming to PocketBase v0.23+ specifications, enabling rapid date-based range queries and sub-millisecond retrieval.
- **Automated Cascade Pruning & Anti-Bloat Maintenance System (`src/server/pocketbase/pruner.ts`, `scripts/pb-cleanup.ts`, `tests/pruner.test.ts`, `package.json`)**:
  - Engineered functional cascade pruner ([`src/server/pocketbase/pruner.ts`](file:///Users/brentzey/personal/web-chess/src/server/pocketbase/pruner.ts)) using Rust/Scala pattern matching and ECMAScript `Temporal` / `Day.js` date arithmetic.
  - Deletes stale or abandoned game sessions older than 3 days (`created < cutoff`), taking full advantage of PocketBase's `cascadeDelete: true` to automatically purge all associated participants, moves, and SSE events in a single operation.
  - Added CLI task `bun run pb:cleanup` (`scripts/pb-cleanup.ts`) with custom `--days=N` threshold support and structured audit reporting.
  - Added local SQLite cascade deletion support to `SessionRepository.pruneStaleSessions` in [`src/server/db/sessionRepository.ts`](file:///Users/brentzey/personal/web-chess/src/server/db/sessionRepository.ts).
- **Automated Scheduled Daily GitHub Actions Cron (`.github/workflows/cleanup-stale-sessions.yml`)**:
  - Created automated daily cron workflow running at **03:00 AM UTC** (`0 3 * * *`) that executes `bun run scripts/pb-cleanup.ts` with zero manual overhead.
- **Native PocketBase JavaScript Hook Cron (`pb_hooks/cleanup.pb.js`)**:
  - Created standalone Goja cron job utilizing PocketBase's `cronAdd` API for native server-side scheduled execution.

## [1.2.0-rc.8] - 2026-10-25
### Added
- **Live Match Opponent Mode Lock & State Preservation (`index.html`, `src/ui/uiController.ts`, `src/main.ts`, `tests/uiController.test.ts`)**:
  - Locked the opponent mode selection whenever a live 1v1 multiplayer match is active (`currentMode === GameModeEnum.Live`), preventing accidental corruption of active peer sessions:
    - Disabled non-live opponent mode cards (`data-mode-select !== 'live'`) in the Game Settings / Pre-Game modal (`#pregame-modal`) with visual lock indicators (`#pregame-mode-lock-notice`), muted styling (`opacity-30`, `cursor-not-allowed`, `pointer-events-none`), and explicit `disabled` attributes.
    - Locked the bottom bar mode cycling chip (`#btn-mode`), displaying a notification banner explaining that the live multiplayer match is locked to the remote peer.
    - Added programmatic guards in `selectGameMode` and `.mode-select-card` click listeners to reject any transitions away from `GameModeEnum.Live` while connected to a live session.
  - Added a prominent `#live-active-banner` within the Live Session modal displaying the active session code (`#live-active-code`) and a dedicated `#btn-leave-live-session` ("Leave Match") action.
  - Implemented clean exit workflow in `#btn-leave-live-session`: safely disconnects the active PocketHost SSE client, clears encrypted live session persistence, cleans URL query parameters, resets the local board, restores Minimax engine mode, and displays a confirmation notification.

## [1.2.0-rc.7] - 2026-10-25
### Added
- **Comprehensive Documentation Suite & Architecture Overhaul (`README.md`, `docs/`, `CONTRIBUTING.md`)**:
  - Authored dedicated subsystem guides in `docs/`: `ARCHITECTURE.md` (high-level architecture, rendering, and state flow), `REALTIME_MULTIPLAYER.md` (PocketHost SSE streams, URL-first invites, seat assignment, and schema validation), `SECURITY_PERSISTENCE.md` (AES-GCM-256 Web Crypto in IndexedDB, zero-plaintext guarantees, and universal credential policies), and `DATETIME_TEMPORAL.md` (ECMAScript Temporal API and Day.js fallback model).
  - Synchronized `README.md` and `CONTRIBUTING.md` with complete tech stack updates, all 27 automated test suites (200 tests), and real-time multiplayer workflows.
- **ECMAScript Temporal API with Day.js Fallback for All DateTime Operations (`src/utils/dateTime.ts`, `tests/dateTime.test.ts`, `package.json`)**:
  - Implemented unified, functional date/datetime utility (`src/utils/dateTime.ts`) conforming to the modern ECMAScript `Temporal` specification with seamless fallback to `Day.js` (with UTC, timezone, and advancedFormat plugins) when Temporal is unsupported or throws an engine exception.
  - Migrated 100% of date and time operations across client storage (`src/storage/indexedDbStore.ts`), reactive state persistence (`src/store/chessStore.ts`), real-time multiplayer synchronization (`src/realtime/pocketbaseClient.ts`), execution logger (`src/utils/logger.ts`), SSE stream manager (`src/server/sse/sseManager.ts`), and database persistence layers (`src/server/db/sessionRepository.ts`, `src/server/services/realtimeChessService.ts`) to use `currentEpochMs()`, `nowIso()`, `epochMsToIso()`, `isoToEpochMs()`, and `formatDateTime()`.
  - Added test coverage in `tests/dateTime.test.ts` exercising both the native Temporal engine and the Day.js fallback paths, maintaining 100% function and line coverage.

## [1.2.0-rc.6] - 2026-10-25
### Added
- **Streamlined Live 1v1 Match Setup UX & URL-First Sharing (`index.html`, `src/ui/uiController.ts`, `src/main.ts`, `tests/uiController.test.ts`)**:
  - Re-architected `#live-created-info` in the Live Match Setup modal to present the **Full Match Invite Link (URL)** first and foremost as the primary, recommended option (`1. Share Match Link (Recommended)` with `#btn-copy-link`), providing instant one-click connection for opponents.
  - Positioned the manual 6-character match code as a secondary option (`2. Or Share Match Code` with `#btn-copy-code`) for players joining across separate devices or tabs.
  - Added a dedicated `#btn-enter-live-match` ("Enter Sanctuary Board & Wait") button to dismiss the setup modal and enter the board view immediately.
- **Backdrop Click & Escape Key Dismissal for Modals (`src/main.ts`)**:
  - Added backdrop click detection to `#pregame-modal`, `#live-session-modal`, and `#storage-audit-modal`, closing dialogs when clicking anywhere on the darkened backdrop outside modal cards.
  - Added global `Escape` key listener to dismiss active dialog overlays cleanly.
- **PocketHost API Rules & Immutability Hardening (`src/server/pocketbase/schema.json`, `scripts/pb-migrate.ts`)**:
  - Enforced schema API security rules on PocketHost collections: rejecting requests without valid session codes or FENs, requiring monotonic plies and event sequences.
  - Enforced append-only immutability on `game_moves` and `session_events` (`updateRule: null`, `deleteRule: null`), preventing tampering or public deletion of match history.
- **Client Security, Input Sanitization & Production Console Obfuscation (`src/realtime/pocketbaseClient.ts`, `src/utils/env.ts`, `tests/pocketbaseClient.test.ts`, `tests/env.test.ts`)**:
  - Added text and session code sanitization helpers (`sanitizeTextInput`, `sanitizeSessionCode`) to neutralize HTML injection and malformed query strings.
  - Added duplicate turn move guard (`this.lastMovePly === payload.ply`), rejecting duplicate submissions without breaking legitimate consecutive turns.
  - Isolated environment detection into `src/utils/env.ts`: in production mode (`!isDevMode()`), suppresses internal collection names, raw SSE topic routes, and client IDs from browser console inspection.

### Fixed
- **Circular Module Loading & Dev Mode Override Normalization (`src/utils/env.ts`, `src/storage/indexedDbStore.ts`)**:
  - Extracted dev mode probe and override state into `src/utils/env.ts`, resolving circular module dependency between storage and realtime clients.
  - Hardened `setDevModeOverride` to accept `Option<boolean>`, booleans, null, or undefined, eliminating runtime `TypeError` exceptions.

## [1.2.0-rc.5] - 2026-10-25
### Added
- **Encrypted Live Session Persistence & Automatic Reconnection (`src/store/chessStore.ts`, `src/types/index.ts`, `src/main.ts`, `tests/chessStore.test.ts`)**:
  - Added `StoredLiveSessionInfo` schema to `StoredSessionState` and `ChessStoreState`, securely persisting active multiplayer session credentials (`sessionCode`, `sessionId`, `participantId`, `token`, `role`, `playerName`) into AES-GCM-256 encrypted client storage (`IndexedDB`).
  - Implemented automatic live session rehydration on tab reload (`restoreSessionIfEnabled`): re-establishes the real-time SSE stream (`initRealtimeClient`), restores player seat assignment (`liveUserRole`), aligns 3D perspective orientation (`camController.camState.theta`), and synchronizes the latest authoritative position from PocketHost.
  - Synchronized browser URL history state with `?session=${sessionCode}` on live match creation and join, automatically cleaning URL queries upon exiting live multiplayer or resetting.

### Fixed
- **Host & Guest Re-Join Seat Reclamation & Join Modal Dismissal (`src/realtime/pocketbaseClient.ts`, `src/main.ts`, `tests/pocketbaseClient.test.ts`)**:
  - Removed occupied seat exception in `PocketBaseChessClient.joinSession` when selecting `'w'` or `'b'`, allowing returning players to reclaim their seat upon reload without being blocked.
  - Eliminated premature pop-up of the Join Match dialog on page reload when an active matching live session is already restored from encrypted storage.
  - Added static endpoint resolution helper `PocketBaseChessClient.getEndpoint()`.
- **PocketHost Environment Variable Migration Tooling (`scripts/pb-migrate.ts`, `package.json`, `.env.example`)**:
  - Updated `pb:migrate` script to automatically source `~/.zshrc` to pick up global `PB_ADMIN_EMAIL` and `PB_ADMIN_PASSWORD` credentials without logging or exposing secrets.
  - Added robust fallback parsing in `scripts/pb-migrate.ts` preventing unexpanded shell variable templates from causing URL or authentication exceptions.

## [1.2.0-rc.4] - 2026-10-25
### Fixed
- **Host SSE Event Reception & Unique Record ID Deduplication (`src/realtime/pocketbaseClient.ts`, `src/main.ts`, `tests/pocketbaseClient.test.ts`)**:
  - Replaced timestamp-based event sequence check (`eventSeq <= this.lastEventSeq`) with globally unique PocketBase record ID tracking (`seenRecordIds: Set<string>`). This eliminates clock-skew false drops where the host dropped the opponent's moves due to local counter increments or slight client clock offsets.
  - Added self-healing authoritative state sync via `session_updated` SSE channel in `initRealtimeClient`. Any difference between local FEN and remote game session FEN immediately updates the 3D board pieces, turn indicators, and check/game-over modals without requiring a manual refresh.
  - Implemented background tab fast-path in `animateChessMove` (`typeof document !== 'undefined' && document.hidden`): applies piece coordinates and updates `pieceMap` synchronously so browser tab throttling/pausing of `requestAnimationFrame` when testing or playing in background tabs does not freeze or block move execution.
  - Added clean board reset (`chess.reset()`, `syncBoardPiecesWithChessState()`, `updateHighlights()`) in `#btn-create-live-session` so generating a new live match always initializes with a pristine board.

## [1.2.0-rc.3] - 2026-10-25
### Fixed
- **PocketBase Real-Time SSE Event Routing & Subscription Topic Multiplexing (`src/realtime/pocketbaseClient.ts`, `tests/pocketbaseClient.test.ts`)**:
  - Fixed event listener mismatch where PocketBase Server-Sent Events emitted exact topic names (`session_events`, `session_events/*`, `game_sessions`, `game_sessions/:id`); registered matching listeners for both collection-level and wildcard topics to guarantee 100% real-time move, player joined, and session update delivery without manual page reloads.
  - Added monotonic sequence event deduplication (`eventSeq <= this.lastEventSeq`) inside `PocketBaseChessClient` event dispatcher to prevent duplicate execution when subscribed across multiplexed SSE channels.
- **Seat Resolution, Participant Re-join & Role Permissions (`src/realtime/pocketbaseClient.ts`, `src/main.ts`)**:
  - Fixed seat assignment logic in `PocketBaseChessClient.joinSession` to recognize re-joining players by matching `displayName` against existing `white_player_name` or `black_player_name`, preventing unintentional demotion to spectator on tab refresh or re-connection.
  - Added explicit seat validation: throwing an actionable descriptive error when attempting to join as White or Black if that seat is already occupied by a different player.
  - Standardized role type representations (`'white' | 'black' | 'spectator'`) across both `createSession` and `joinSession` returns.
- **Opponent Piece Movement & Board Interaction Locking (`src/main.ts`)**:
  - Resolved piece movement locking for Black and White players by validating player color against active `chess.turn()` (`PieceColorEnum.White` / `PieceColorEnum.Black`) with informative temporary status banners explaining when interactions are waiting on opponent turns or disabled in spectator mode.
  - Automatically synchronized 3D camera orientation for Black players (`camController.camState.theta = Math.PI`), framing the board naturally from Black's perspective upon hosting or joining as Black.
  - Extended `executeMoveOnBoard` and `submitMove` to support pawn promotion flags (`promotion?: string`) in both UCI strings and SAN objects.
  - Added auto-dismissal of host match modal upon receipt of `player_joined` SSE event, instantly transitioning the host into active play when their opponent connects.

## [1.2.0-rc.2] - 2026-10-24
### Added
- **PocketHost / PocketBase BaaS Cloud Migration & Realtime SSE Adapter (`scripts/pb-migrate.ts`, `src/server/pocketbase/schema.json`, `src/server/pocketbase/migrator.ts`, `src/realtime/pocketbaseClient.ts`, `src/main.ts`, `netlify.toml`, `package.json`)**:
  - Successfully executed schema migration against PocketHost instance (`https://web-chess.pockethost.io`), establishing canonical collections (`game_sessions`, `session_participants`, `game_moves`, `session_events`) with cascading delete foreign key relations and unique indices (`idx_game_sessions_code`, `idx_moves_session_ply`, `idx_events_session_seq`).
  - Configured granular PocketBase API security rules: public creation and viewing for match coordination, public progression updates, immutable event/move log enforcement (`updateRule: null`, `deleteRule: null`), and hidden token hashes.
  - Implemented `PocketBaseChessClient`, a zero-dependency client-side adapter utilizing native browser `fetch` and `EventSource` to subscribe directly to PocketHost's `/api/realtime` SSE feed (`PB_CONNECT` handshake, collection multiplexing) and execute match mutations without intermediate server requirements, enabling serverless multiplayer deployment on Netlify.
  - Connected `PocketBaseChessClient` directly into the live UI match lifecycle in `src/main.ts`, resolving 404 errors on static hosts by routing session creation, joining, moves, and theme synchronization directly to PocketHost.
  - Updated Netlify Content Security Policy (`connect-src 'self' https://web-chess.pockethost.io wss://web-chess.pockethost.io`) and added SPA fallback redirects in `netlify.toml`.
  - Added automated migration runner `bun run pb:migrate` (`scripts/pb-migrate.ts`) and canonical declarative schema specification (`src/server/pocketbase/schema.json`).
- **Server-Sent Events (SSE) & Real-Time Multiplayer Chess Engine (`src/server/server.ts`, `src/server/services/realtimeChessService.ts`, `src/server/sse/sseManager.ts`, `src/server/sse/sseTypes.ts`, `src/realtime/realtimeClient.ts`)**:
  - Implemented high-throughput real-time Server-Sent Events fan-out broadcasting engine adhering to the W3C EventSource standard (`SSEManager`), complete with connection keepalive pings (`:keepalive\n\n`), client heartbeat monitors, and monotonic sequence event numbers (`id: <eventSeq>`).
  - Added support for typed event streaming (`session_created`, `player_joined`, `player_left`, `move_made`, `theme_changed`, `draw_offered`, `draw_accepted`, `draw_declined`, `resigned`, `game_over`) and reliable reconnection with automatic catch-up replay via `Last-Event-ID`.
  - Implemented `RealtimeChessClient` for client-side event consumption with typed listeners, automatic reconnection handling, and REST mutation APIs for moves, theme synchronization, and resignations.
  - Implemented `SanctuaryRealtimeServer` HTTP and SSE API router with Bun HTTP runtime (`Bun.serve`), CORS headers, Bearer token extraction, and comprehensive REST endpoints (`/api/sessions`, `/api/sessions/join`, `/api/sessions/:id`, `/api/sessions/:id/events`, `/api/sessions/:id/moves`, `/api/sessions/:id/resign`, `/api/sessions/:id/theme`).
- **Live Multiplayer UI Faculties, Session Creation & Joining Controls (`index.html`, `src/main.ts`, `src/ui/uiController.ts`, `src/constants/board.ts`, `src/types/index.ts`, `vite.config.ts`)**:
  - Added `#btn-live` quick-action button in bottom navigation bar and Live Multiplayer mode card in `#pregame-modal`.
  - Added `#live-session-modal` dialog featuring responsive tabs for "Host Match" (`#live-tab-host`) and "Join Match" (`#live-tab-join`).
  - Implemented Host Match setup: player color selection (White, Black, Random), turn timer selection, strict tournament mode toggle, cryptographic token generation indicators, shareable 6-character Sanctuary session code display, and one-click copy buttons for session code and full invitation URL (`#btn-copy-live-code`, `#btn-copy-live-link`).
  - Implemented Join Match setup: session code input (`#input-join-code`), player name (`#input-join-name`), role selection (Opponent / Spectator), live join button (`#btn-join-live-session`), contextual error banners (`#live-join-error`), and automated `?session=SANCT-XXXX` query parameter auto-fill.
  - Integrated real-time SSE move broadcasting and event synchronization into the 3D board loop: automatic piece animations on opponent moves, remote theme synchronization, role-based interaction locking (disallowing spectator moves and enforcing turn-player color ownership), and connection status updates in the HUD.
  - Configured Vite development server `/api` proxy in `vite.config.ts` targeting `http://localhost:3001` and added `bun run server` script in `package.json`.
- **Canonical Relational Database Schemas with Strict Referential Integrity, Foreign Keys & Indices (`src/server/db/schema.sql`, `src/server/db/schema.postgres.sql`, `src/server/db/database.ts`, `src/server/db/sessionRepository.ts`)**:
  - Authored canonical DDL schemas for both SQLite (`bun:sqlite`) and PostgreSQL, enforcing strict `FOREIGN KEY (...) REFERENCES ... ON DELETE CASCADE` across `game_sessions`, `session_participants`, `session_tokens`, `game_moves`, and `session_events`.
  - Configured comprehensive unique constraints and high-performance B-tree indices (`idx_sessions_code`, `idx_participants_session`, `idx_participants_active_white`, `idx_participants_active_black`, `idx_tokens_hash`, `idx_moves_session_ply`, `idx_events_session_seq`) guaranteeing monotonic ordering, partial unique constraints on active player slots, and cascade deletion integrity.
  - Engineered cryptographically secure session authorization with SHA-256 hashed bearer tokens generated via 256-bit CSPRNG entropy (`generateSecureToken`) and readable 6-character sanctuary session codes (`SANCT-XXXX`).
  - Implemented `SessionRepository` utilizing functional paradigms, monadic `Option` and `Result` types, and transactional execution wrappers (`db.transaction`).

## [1.2.0-rc.1] - 2026-10-18
### Added
- **Live-Swappable 3D Sanctuary & Board Theme System (`src/types/index.ts`, `src/constants/board.ts`, `src/graphics/materials.ts`, `src/main.ts`, `index.html`)**:
  - Added `ChessThemeEnum` and `CHESS_THEMES` with four distinct 3D PBR Sanctuary & Board themes: **High Gothic Basilica** (`gothic-basilica`), **Emerald Citadel** (`emerald-citadel`), **Astral Observatory** (`astral-observatory`), and **Crimson Crucible** (`crimson-inquisition`).
  - Added `applyThemePalette(theme, materials, squareMeshes, sceneTargets)` to mutate shared 3D piece materials, architectural stone/carpet/accent materials, all 64 board square tiles, and scene/hemisphere/altar/strike lighting in-place at runtime.
  - Players can switch themes **at any time — both before a game starts AND in the middle of an active match (`chess.history().length > 0`) — without resetting the board or move history**, via either the 1-tap `#btn-theme` bottom navigation chip or the **Sanctuary & Board Theme** selector grid in **Game Settings** (`#pregame-modal`), with the active theme automatically persisted in encrypted `IndexedDB` (`StoredSessionState.theme`).
- **Rust / Scala-Style Exhaustive Pattern Matching & Unwrap Combinators (`src/utils/fp.ts`, `src/constants/board.ts`, `src/types/index.ts`)**:
  - Extended `Optional<T>` (`Some<T>` | `None<T>`) with `.match({ Some, None })` and `.getOrThrow(errorOrMessage?)` for explicit fallback mapping vs. fail-fast invariant enforcement.
  - Extended `Result<T, E>` (`Success<T, E>` | `Failure<T, E>`) with `.match({ Ok, Err })` and `.getOrThrow(errorOrMessage?)`.
  - Added `matchBool(condition, { true: () => ..., false: () => ... })` for exhaustive boolean pattern matching alongside enum/union `match(target, branches)`.
  - Added `SettingsApplyActionEnum` (`KeepActiveGame`, `ApplyAndReset`, `StartNewGame`), `resolveSettingsApplyAction()`, and `getSettingsActionButtonLabel()` to model mid-game vs. pre-game settings transitions as an algebraic sum type.
- **Development Mode Plaintext Payload Encryption Logging (`src/storage/indexedDbStore.ts`, `src/vite-env.d.ts`)**:
  - When running in local development mode (`import.meta.env.DEV` or `isDevMode()`), `encryptPayload()` automatically prints the complete unencrypted plaintext payload and context to the console using `logger.info` (`[DEV STORAGE ENCRYPT]`), providing complete developer visibility into session data before AES-GCM-256 encryption.
  - In production builds (`import.meta.env.PROD`), plaintext payload logging is strictly disabled to prevent sensitive state leakage. Added `DevModeEnvProbe`, `detectDevMode`, and `setDevModeOverride` for pure, deterministic testing.
- **Centralized Reactive State Store & Tab-Refresh State Persistence (`src/store/chessStore.ts`, `src/main.ts`, `src/types/index.ts`)**:
  - Implemented `ChessStore` (`chessStore`), a centralized reactive state store managing unified chess match state (`fen`, `history`, `mode`, `difficulty`, `allowUndo`, `theme`, `useActionCam`, `gameStarted`, `persistenceEnabled`, display contrast/brightness, `deviceTier`, `selectedSquare`, `legalMovesForSelected`, `pendingPromotionMove`, `isThinking`, `isGameOver`, `gameOverTitle`, `gameOverSubtitle`).
  - Added seamless tab-refresh state rehydration via `chessStore.hydrate()` with exhaustive pattern matching over `StorageLoadStatusEnum` (`Restored`, `Empty`, `Unreadable`, `Unavailable`). Refreshing a tab or reopening the browser instantly restores in-progress matches, active themes, move histories, and camera preferences without unexpectedly presenting pre-game modals.
  - Attached automated browser lifecycle listeners (`pagehide`, `beforeunload`, `visibilitychange`) through `setupLifecycleListeners()` to ensure in-memory state snapshots are flushed and persisted to encrypted IndexedDB immediately upon tab backgrounding, unload, or navigation.
  - Added comprehensive test suite (`tests/chessStore.test.ts`) and end-to-end integration flow (`tests/integration.test.ts` Integration Flow 6) validating tab-refresh survival and rehydration across browser restarts.
- **Storage Architecture & Engine Benchmark Suite (`scripts/benchmark-storage.ts`, `package.json`)**:
  - Added comprehensive storage performance benchmark comparing client-side Web Crypto `AES-GCM-256` encryption against embedded relational SQLite (`bun:sqlite`), PocketBase document schemas, TrailBase binary architecture, and IndexedDB structured cloning. Run via `bun run benchmark:storage`.

### Changed
- **Functional & Pattern-Matched UI / Board Control Flows (`src/main.ts`, `src/constants/board.ts`)**:
  - Refactored `main()`, `syncAllControlsUI()`, `handleBoardClick()`, `startNewGame()`, `handlePersistenceToggle()`, and `restoreSessionIfEnabled()` to use `match`, `matchBool`, `Option.match({ Some, None })`, `fromNullable(...).getOrElse(...)`, and `fromNullable(...).getOrThrow(...)`.

### Security
- **Hardened Client Storage Encryption (`src/storage/indexedDbStore.ts`, `src/ui/uiController.ts`, `src/types/index.ts`)**:
  - **Removed the hardcoded AES key from the bundle.** Anyone could previously read the key from the shipped JS and decrypt a copied IndexedDB. The 256-bit AES-GCM key is now generated per browser profile via Web Crypto `generateKey` with `extractable: false`; only the opaque `CryptoKey` handle is persisted (Structured Clone), so raw key bytes can never be exported or read from the database file.
  - Added AEAD **Additional Authenticated Data** binding every record to its context (`active_session` / `persistence_preference`), defeating cross-record envelope transplant attacks; explicit 128-bit auth tag.
  - **Fail-closed key handling**: a transient IndexedDB read error never rotates/overwrites the stored key; a key that cannot be persisted is never handed out. Added `rotateMasterCryptoKey()` and `clearCachedCryptoKey()`.
  - Decrypted JSON is parsed with `safeJsonParse` (strips `__proto__` / `constructor` / `prototype`); move text rendered into `innerHTML` is escaped via `escapeHtml`.
  - Storage Audit report now states `keyExtractable: false`, `hardcodedBundleKey: false`, `aadContextBound: true`, `authTagBits: 128`.
  - **Note:** sessions encrypted with the old bundled key cannot be decrypted and are discarded on first load (a new game starts).
- **Wipe & Start Over (`src/storage/indexedDbStore.ts`, `src/ui/uiController.ts`, `src/main.ts`, `index.html`)**:
  - New two-step **Danger Zone** in the Storage Audit panel (`#wipe-storage-btn` → confirm/cancel). `wipeAllStorage()` clears every record *and the encryption key*, drops the in-memory key, and the app resets to a fresh game, default settings/theme, and a brand-new key; ciphertext copied beforehand becomes permanently undecryptable.
  - Restoring a session is modelled as an exhaustive sum type (`StorageLoadStatusEnum`: `Restored` / `Empty` / `Unreadable` / `Unavailable`) consumed with Rust/Scala-style `match`, so the user is told exactly what happened (e.g. unreadable legacy data points to **Wipe & Start Over**). An unreadable persistence preference now resets to the default (on) instead of silently disabling persistence.
- **Strict Content-Security-Policy (`netlify.toml`)**: removed `'unsafe-inline'` and `'unsafe-eval'` from `script-src`; added `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests`; dropped `https:` from `img-src`; added `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy: same-origin`. Locked by `tests/securityHeaders.test.ts`.

### Fixed
- **Non-Destructive Mid-Game Settings Modal (`src/constants/board.ts`, `src/main.ts`, `index.html`)**:
  - Opening **Game Settings** (`#btn-setup`) while a match is already in progress (`chess.history().length > 0`) snapshots `{ mode, difficulty, allowUndo }` and resolves `SettingsApplyActionEnum.KeepActiveGame` when no match settings changed, preserving the active chessboard and move history intact unless settings were modified (`ApplyAndReset`) or **New Game** (`#btn-reset` / `#modal-new-game`) was explicitly triggered (`StartNewGame`).
- **Automatic Encrypted Session Persistence Across Tab & Browser Refreshes (`src/storage/indexedDbStore.ts`, `src/main.ts`, `index.html`)**:
  - Enabled encrypted `IndexedDB` session persistence (`AES-GCM-256`) by default (`getPersistencePreference()` defaults to `true`, `#persist-session-checkbox` and `#drawer-persist-checkbox` checked out-of-the-box) with immediate move persistence and `pagehide` / `visibilitychange` flush listeners so refreshing the browser/tab always preserves the exact board FEN, algebraic move history, opponent style, difficulty, undo rule, active 3D theme, and display contrast/brightness.

## [1.1.0-rc.1] - 2026-10-18


### Added
- **AES-GCM-256 Encrypted Client Storage & Ciphertext Audit Inspector (`src/storage/indexedDbStore.ts`, `src/ui/uiController.ts`)**:
  - All records persisted to `IndexedDB` (`active_session` and `persistence_preference`) are encrypted client-side before storage using the Web Crypto API (`AES-GCM` 256-bit key with a unique 12-byte random IV per write) and decrypted + authenticated when fetched.
  - Added `auditEncryptedStorage()` and the **Encrypted Storage Audit** modal (`#storage-audit-modal`), allowing users to inspect their stored IndexedDB records as raw encrypted ciphertext envelopes (`v: 1`, `alg: "AES-GCM-256"`, `iv`, `ciphertext`) alongside explicit cipher metadata (`AES-GCM-256`, `256`-bit key, `12`-byte IV, `Galois/Counter Mode (AEAD, 128-bit Auth Tag)`, `plaintextExposed: false`, `localStorageUsed: false`) without ever exposing decrypted plaintext.
  - Zero `localStorage` usage; zero plaintext session fields stored at rest.
- **Functional Programming Monadic Pipelines (`src/utils/fp.ts`)**:
  - Exported `Option<T>` / `Optional<T>` (`Some<T>` | `None<T>`) and `Result<T, E>` (`Success<T, E>` | `Failure<T, E>`) with `fromNullable`, `map`, `flatMap`, `flatMapAsync`, `filter`, `fold`, `getOrElse`, `fromResult`, `toResult`, `tryCatch`, `tryCatchAsync`, and exhaustive `match`.
- **Selectable Opponent Difficulty & Aggressiveness Levels (`OpponentDifficultyEnum`)**:
  - Added `Cautious` (Lv 1), `Balanced` (Lv 2), and `Aggressive` / `Ruthless` (Lv 3) profiles across all AI play styles (`Minimax`, `Micro-Neural AI`, and `Gemini Nano` on-device LLM).
- **Pre-Game Match Setup & Undo Lock Rule (`allowUndo`)**:
  - Added pre-game **Game Settings & Match Setup** modal (`#pregame-modal`) allowing players to configure Play Style, Opponent Difficulty, **Allow Move Undo** (Standard Mode vs. Strict Mode), and Encrypted IndexedDB Session Persistence before play begins.
- **Mobile Sanctuary Lite & Low-Capability Hardware Tier (`src/graphics/deviceTier.ts`)**:
  - Added `inspectHardwareCapabilities()` to detect narrow/short mobile screens (`<768px` width or `<550px` height), low RAM (`deviceMemory <= 4` GB), low CPU (`hardwareConcurrency <= 4` cores), and Data Saver (`saveData: true`).
  - Scales shadow maps, dust count, and shatter shard physics, adapts portrait camera FOV/polar angle/radius (`computeAspectAdjustedFov`, `computeAspectAdjustedPhi`, `computeAspectAdjustedRadius`), and supports 2-finger pinch-to-zoom.
- **Pretty `tslog` Client/Server Execution Logger (`src/utils/logger.ts`)**:
  - Added structured, colorized `tslog` (`type: 'pretty'`) logging that automatically detects and tags `CLIENT_SIDE` vs. `SERVER_SIDE` execution contexts and hardware capabilities.
- **SonarQube / JaCoCo-Style Line, Branch & Function Coverage Reporting (`scripts/coverageReport.ts`, `sonar-project.properties`)**:
  - Added `bun run test:coverage` generating `coverage/lcov.info` and `coverage/coverage-report.md` with **100.00% Line Coverage**, **100.00% Branch Coverage**, and **100.00% Function Coverage** across all 21 tested modules.

### Changed
- **Chess-Focused UI Terminology with High Gothic Basilica Theme**:
  - Replaced liturgical UI labels ("Consecrate Sanctuary Rite", "Rite Setup", "New Rite", "Ironman Rite") with standard chess game terminology ("Game Settings & Match Setup", "Game Settings", "New Game", "Strict Mode", "Pawn Promotion") while preserving the complete High Gothic Basilica & Sanctuary 3D visual and acoustic theme.

### Fixed
- **Mobile Portrait Camera Framing & Rose Window Occlusion (`src/interaction/camera.ts`, `src/graphics/cathedral.ts`)**:
  - Fixed portrait mobile camera radius (`computeAspectAdjustedRadius <= 24.5`), vertical FOV (`computeAspectAdjustedFov`), and overhead polar angle (`computeAspectAdjustedPhi`) so the camera stays strictly inside the Basilica crossing in front of the South Rose Window (`z = 30.5`) and Nave piers (`x = ±16.2`) while framing all 64 squares (`a1..h8`).
  - Changed stained glass rose and lancet windows from `THREE.DoubleSide` to inward-facing `THREE.FrontSide` so exterior window geometry can never occlude the camera from behind.
- **Retina Mobile Rendering & Touch Gameplay (`src/graphics/deviceTier.ts`, `src/main.ts`, `src/engine/coordinates.ts`, `src/styles/main.css`)**:
  - Increased `MOBILE_LITE_PROFILE.maxPixelRatio` to `2.0` for crisp Retina rendering on mobile phones.
  - Added `touch-action: none` on `#canvas-container` and `canvas`, `getBoundingClientRect()` touch coordinate normalization, mathematical board-plane (`y = 0`) raycast fallback via `worldToSquare(x, z): Option<string>`, `6px` orbit drag deadzone, and `18px` capacitive tap tolerance.
  - Compacted mobile top HUD and bottom navigation chips (`<640px`) so all 10 game controls fit on a single row without horizontal clipping.
- **Non-Destructive Mid-Game Settings Modal (`src/constants/board.ts`, `src/main.ts`, `index.html`)**:
  - Opening **Game Settings** (`#btn-setup`) while a match is already in progress (`chess.history().length > 0`) snapshots the active `{ mode, difficulty, allowUndo }` configuration and uses `haveMatchSettingsChanged` / `shouldResetBoardOnSettingsApply` to preserve the current board and move history unless match settings were actually modified or **New Game** (`#btn-reset` / `#modal-new-game`) was explicitly triggered.


## [1.0.0] - 2026-10-15
### Added
- **Modular TypeScript Architecture**: Full modularization of 3D chess engine, graphics, audio, interaction, and UI into strict TypeScript modules.
- **Bun & Vite Toolchain**: Lightning-fast compilation, hot module reloading, and bundle chunking using Bun runtime and Vite 5.
- **Three.js r160 & PBR Graphics**:
  - High Gothic Basilica crossing with clustered piers, quadripartite groin vaults, and apse presbytery.
  - Procedural Cosmati pavement, Carrara marble, and volcanic obsidian textures.
  - Pointed lancet stained glass windows and radiant north/south rose windows with volumetric god-rays.
  - Six flickering brass altar candlesticks and suspended ruby-glass eternal sanctuary lamp.
  - 4 swinging brass thuribles on 17.5m chains.
- **Articulated Wizard Chess Pieces**:
  - Custom procedural 3D meshes for all 6 piece types with medieval weaponry (halberds, warhammers, lances, crosiers, star scepters, broadswords).
  - Idle breathing animations and liturgical weapon sway.
- **34-Shard Shatter Physics & Melee Attacks**:
  - Physical wind-up, melee strike, and shatter sequence on capture moves.
  - Physics-driven stone shards with gravity, collision bounce, angular velocity, and scale decay.
  - Expanding arcane shockwave rings and dynamic camera impact shake.
- **Procedural Cathedral Web Audio Engine**:
  - 100% synthesized audio via Web Audio API: D-minor pipe organ chords with bronze bell harmonics, stone sliding friction, metallic cleaves, and shard clinks.
- **Wizard AI Minimax Engine**:
  - 2-ply Minimax search algorithm with material weighting and center-control heuristic.
  - Move ordering prioritizing captures for optimal decision speed.
- **Material Design 3 HUD & UI**:
  - Minimalist top turn indicator and dynamic check/checkmate banner.
  - Slide-over Chronicle of Moves drawer with algebraic history and shattered relics lists.
  - Sanctuary Consecration (pawn promotion) and Game Over modals.
  - 5 Basilica camera presets and dynamic Melee Action Cam.
- **Comprehensive Automated Test Suite**:
  - 12 unit tests running via `bun test` covering coordinates math, rules validation, castling, promotion, undo, and AI evaluation.
- **Netlify Ready**:
  - `netlify.toml` with build commands, Node 22 runtime, strict CSP/HSTS security headers, and asset caching.

## [0.1.0] - 2026-10-15
### Added
- Initial single-file 3D wizard chess prototype (`wizard_s_chess_3d.html`).
