# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) with `RC#` Release Candidates (`X.Y.Z-rc.N`).
Every general feature change or application behavior update is consolidated under the active `RC#` entry until `main` is pushed to remote, which triggers a production **Build & Release**.

## [1.1.0-rc.1] - 2026-10-18
### Added
- **AES-GCM-256 Encrypted Client Storage (`src/storage/indexedDbStore.ts`)**:
  - All records persisted to `IndexedDB` (`active_session` and `persistence_preference`) are encrypted client-side before storage using the Web Crypto API (`AES-GCM` 256-bit key with a unique 12-byte random IV per write) and decrypted + authenticated when fetched.
  - Zero `localStorage` usage; zero plaintext session fields stored at rest.
- **Functional Programming Monadic Pipelines (`src/utils/fp.ts`)**:
  - Exported `Option<T>` / `Optional<T>` (`Some<T>` | `None<T>`) and `Result<T, E>` (`Success<T, E>` | `Failure<T, E>`) with `fromNullable`, `map`, `flatMap`, `flatMapAsync`, `filter`, `fold`, `getOrElse`, `fromResult`, `toResult`, `tryCatch`, `tryCatchAsync`, and exhaustive `match`.
- **Selectable Opponent Difficulty & Aggressiveness Levels (`OpponentDifficultyEnum`)**:
  - Added `Cautious` (Lv 1), `Balanced` (Lv 2), and `Aggressive` / `Ruthless` (Lv 3) profiles across all AI play styles (`Minimax`, `Micro-Neural AI`, and `Gemini Nano` on-device LLM).
- **Pre-Game Match Setup & Undo Lock Rule (`allowUndo`)**:
  - Added pre-game **Game Settings & Match Setup** modal (`#pregame-modal`) allowing players to configure Play Style, Opponent Difficulty, **Allow Move Undo** (Standard Mode vs. Strict Mode), and Encrypted IndexedDB Session Persistence before play begins.
- **Mobile Sanctuary Lite & Low-Capability Hardware Tier (`src/graphics/deviceTier.ts`)**:
  - Added `inspectHardwareCapabilities()` to detect narrow/short mobile screens (`<768px` width or `<550px` height), low RAM (`deviceMemory <= 4` GB), low CPU (`hardwareConcurrency <= 4` cores), and Data Saver (`saveData: true`).
  - Scales shadow maps, pixel ratio, MSAA, dust count, and shatter shard physics, widens portrait camera radius (`computeAspectAdjustedRadius`), and supports 2-finger pinch-to-zoom.
- **Pretty `tslog` Client/Server Execution Logger (`src/utils/logger.ts`)**:
  - Added structured, colorized `tslog` (`type: 'pretty'`) logging that automatically detects and tags `CLIENT_SIDE` vs. `SERVER_SIDE` execution contexts and hardware capabilities.
- **SonarQube / JaCoCo-Style Line & Branch Coverage Reporting (`scripts/coverageReport.ts`, `sonar-project.properties`)**:
  - Added `bun run test:coverage` generating `coverage/lcov.info` and `coverage/coverage-report.md` with **100.00% Line Coverage** and **100.00% Branch Coverage** across all 21 tested modules.

### Changed
- **Chess-Focused UI Terminology with High Gothic Basilica Theme**:
  - Replaced liturgical UI labels ("Consecrate Sanctuary Rite", "Rite Setup", "New Rite", "Ironman Rite") with standard chess game terminology ("Game Settings & Match Setup", "Game Settings", "New Game", "Strict Mode", "Pawn Promotion") while preserving the complete High Gothic Basilica & Sanctuary 3D visual and acoustic theme.

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
