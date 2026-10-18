# Agent Collaboration Guide

This repository is maintained and optimized in collaboration with autonomous AI coding agents using the **Google Antigravity (AGY)** framework.

---

## 🤖 Active Specialized Subagents & Roles

### 1. 3D Graphics & Shader Specialist
* **Role**: Maintains and enhances Three.js 3D meshes, PBR procedural shaders, lighting architecture, and particle systems.
* **Responsibilities**:
  - Tuning ACES Filmic tone mapping and directional / spot shadow parameters.
  - Expanding piece articulation and combat animation curves.
  - Optimizing shard collision geometry and draw calls for 60fps on mobile devices.

### 2. Chess Engine & AI Specialist
* **Role**: Enhances the legal chess engine and Minimax decision tree.
* **Responsibilities**:
  - Implementing deeper search depths (e.g., iterative deepening, quiescence search).
  - Enhancing piece-square tables and endgame evaluation tables.
  - Ensuring strict rule conformity for tournament play (threefold repetition, 50-move rule).

### 3. Procedural Audio Synthesizer Specialist
* **Role**: Develops and refines the Web Audio API sound engine (`CathedralSoundEngine.ts`).
* **Responsibilities**:
  - Refining the harmonic organ synthesizer (additive synthesis with detuned oscillators and biquad lowpass filtering).
  - Fine-tuning stone friction noise curves and realistic acoustic reverberation.
  - Ensuring graceful degradation on restricted or suspended audio contexts.

### 4. Performance & Netlify Deployment Specialist
* **Role**: Guarantees sub-second build times, zero bundle bloat, and optimal Core Web Vitals.
* **Responsibilities**:
  - Monitoring Vite manual chunk boundaries (`three`, `chess.js`, and application code).
  - Verifying Netlify HTTP security headers (CSP, HSTS, X-Frame-Options) in `netlify.toml`.
  - Maintaining automated unit tests via `bun test`.

---

## ⚡ Agent Workflows & Mandatory Engineering Rules

When operating in this repository, agents must adhere to the following without exception:

1. **Always Use Bun**:
   - Execute all package management, testing, and script commands via `bun` (`bun test`, `bun run test:coverage`, `bun run build`, `bun add`). Do not invoke `npm`, `yarn`, or `pnpm`.
2. **Always Program Using Functional Paradigms (`src/utils/fp.ts`)**:
   - Always use functional monads and combinators (`Option<T>` / `Optional<T>`, `Result<T, E>`, `fromNullable`, `map`, `flatMap`, `flatMapAsync`, `filter`, `fold`, `getOrElse`, `fromResult`, `toResult`, `tryCatch`, `tryCatchAsync`, and exhaustive `match`) rather than imperative null-checks or ad-hoc `try/catch` blocks.
3. **Encrypted Client Storage Only (`src/storage/indexedDbStore.ts`)**:
   - All data written to client storage (`IndexedDB`) **MUST** be encrypted prior to storage (`AES-GCM-256` via Web Crypto API with a fresh 12-byte random IV per write) and decrypted + authenticated when fetched (`encryptPayload` / `decryptPayload`).
   - **Never** use `localStorage` or store unencrypted plaintext session/preference payloads at rest.
4. **Mandatory `CHANGELOG.md` & SemVer with `RC#` Release Candidates**:
   - Every general feature change, enhancement, or application behavior update **MUST** have a corresponding entry in [`CHANGELOG.md`](file:///Users/brentzey/personal/web-chess/CHANGELOG.md) and [`package.json`](file:///Users/brentzey/personal/web-chess/package.json) using Semantic Versioning with `RC#` release candidates (e.g., `1.1.0-rc.1`, `1.1.0-rc.2`).
   - Ongoing feature changes accumulate under a single active `RC#` entry until `main` is pushed to remote (`origin/main`), which triggers the production **Build & Release** workflow.
5. **Basilica Theme vs. Standard Chess UI Terminology**:
   - Preserve the **High Gothic Basilica / Sanctuary** 3D architecture, lighting, stained glass, articulated pieces, shatter physics, and organ acoustics as the core visual/audio theme (designed to support future theme selections).
   - Keep UI controls, modals, and match rules phrased in standard chess game terminology (e.g., *"Game Settings"*, *"Game Settings & Match Setup"*, *"New Game"*, *"Strict Mode"*, *"Pawn Promotion"*)—do **not** label game settings or matches as *"Sanctuary Rites"* or *"Consecrate Rite"*.
6. **Zero File Assets**:
   - Never inject static `.png`, `.jpg`, `.mp3`, or `.obj` assets. Maintain procedural generation algorithms.
7. **High Code Coverage, Unit & Integration Testing Before Merging / Pushing**:
   - Always maintain high levels of code coverage (**100% Line & Branch Coverage**, **>99% Function Coverage**) backed by comprehensive unit tests and end-to-end integration tests (`tests/*.test.ts` and `tests/integration.test.ts`).
   - Always run `bun run test:coverage && bun run typecheck && bun run build` prior to finalizing a turn or pushing commits.


