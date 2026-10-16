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

## ⚡ Agent Workflows & Best Practices

When operating in this repository, agents must adhere to the following:
1. **Always Use Bun**: Execute all package management, testing, and script commands via `bun` (`bun test`, `bun run build`, `bun add`). Do not invoke `npm`, `yarn`, or `pnpm`.
2. **Zero File Assets**: Never inject static `.png`, `.jpg`, `.mp3`, or `.obj` assets. Maintain procedural generation algorithms.
3. **Verification Before Merging**: Always run `bun test && bun run typecheck && bun run build` prior to finalizing a turn or pushing commits.
