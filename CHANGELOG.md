# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
