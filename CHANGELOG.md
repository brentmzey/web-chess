# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) with `RC#` Release Candidates (`X.Y.Z-rc.N`).
Every general feature change or application behavior update is consolidated under the active `RC#` entry until `main` is pushed to remote, which triggers a production **Build & Release**.

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
