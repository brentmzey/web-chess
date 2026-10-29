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
2. **Always Program Using Functional Paradigms, `Option<HTMLElement>`, Immutability & Rust/Scala Pattern Matching (`src/utils/fp.ts`)**:
   - Always use functional monads and combinators (`Option<T>` / `Optional<T>`, `Result<T, E>`, `domById`, `zipOptions`, `zip3Options`, `ImmutableBuilder`, `fromNullable`, `map`, `flatMap`, `flatMapAsync`, `filter`, `fold`, `getOrElse`, `getOrThrow`, `fromResult`, `toResult`, `tryCatch`, `tryCatchAsync`) and Rust/Scala-style exhaustive pattern matching (`match`, `matchBool`, `opt.match({ Some, None })`, `res.match({ Ok, Err })`) rather than imperative null-checks, `if/else` chains, or ad-hoc `try/catch` blocks.
   - **Never** type DOM or domain references as `HTMLElement | null` or `T | null`; always represent optionality with `Option<HTMLElement>` (`domById(id)`) and `Option<T>`.
   - Enforce immutability (`readonly` properties, `Readonly<T>`, `readonly T[]`, `const` bindings, and `ImmutableBuilder<T>`) across parameters and state snapshots (like `final` in Java).

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
8. **Mandatory Universal Credential & Vulnerability Pre-Commit/Pre-Push Scanning**:
   - In accordance with `/Users/brentzey/personal/AGENTS.md`, agents must ALWAYS globally scan and search for vulnerabilities, exposed credentials, API keys, and sensitive tokens in the repository prior to finalizing any turn or pushing to remote.
   - NEVER commit or push real secrets, admin credentials, database tokens, or PocketHost superuser passwords to git or remote. Always inject via environment variables (`PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD` sourced from `~/.zshrc`).
   - Always verify that `.env` files and local secrets are excluded via `.gitignore`, inspect `git diff`, and confirm zero sensitive leaks before pushing to remote.
9. **Persistent Pre-Approved Command Permissions & Operational Guardrails**:
   - The user has granted persistent standing permission for agents operating in this workspace to automatically run the following commands without requiring repeated turn-by-turn interactive confirmation (unless explicitly revoked or restricted in a subsequent user request):
     - **Testing & Quality Assurance**: `bun test`, `bun run test:coverage`, `bun run typecheck`, `bun run build`.
     - **Environment Variable Sourcing**: Sourcing `~/.zshrc` in zsh subshells (`source ~/.zshrc 2>/dev/null; ...`) to securely access environment-injected credentials (`PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD`) without exposing secrets in files or terminal logs.
     - **PocketHost Database Maintenance**: `bun run pb:migrate` (schema and index migrations), `bun run pb:cleanup` (stale session cascade pruning and observability logging), and `bun run pb:deploy-hooks` (PocketHost SFTP hook deployments).
     - **Security & Secret Scanning**: `git diff`, `git grep`, and regex scans to audit for sensitive tokens, passwords, and API keys.
     - **Automated Versioning, Git Commits & Remote Push**: Staging verified files, bumping `RC#` in `package.json` and `CHANGELOG.md`, committing with descriptive semantic messages, and pushing to `origin/main` to trigger production deployment once all tests pass with 100% line/branch coverage and zero type errors.
   - **Revocation Rule**: If the user explicitly specifies in a prompt to refrain from an action (e.g., *"do not commit"*, *"do not push"*, *"only show diff"*, *"pause before deploy"*), agents MUST immediately prioritize and adhere to that specific instruction over these pre-approved defaults.
10. **Mandatory IntelliJ Java Function/Method Parameter Formatting Style**:
   - Always write multi-parameter functions and methods in the **IntelliJ Java parameter alignment style**: the opening parenthesis `(` is followed immediately by the first parameter on that same line; subsequent parameters are placed on new lines aligned vertically (flush) with the first parameter; and the closing parenthesis `)` is placed on the same line as the final parameter:
     ```ts
     export function exampleFunction(firstParam: string,
                                     secondParam: number,
                                     thirdParam: boolean): ReturnType {
     ```
11. **Multi-Game Sanctuary Arcade Hub, Dynamic Multi-Player Seat Management, Hungarian Database Schema & 3+ Day Stale Session Pruning**:
   - All 8 Sanctuary Arcade games (**Sanctuary Chess** `SANCT-`, **Gothic Blackjack** `BJK-` `1–7 seats`, **Cathedral Poker** `POKER-` `2–9 seats`, **Ten Rites / Phase 10** `P10-` `2–6 seats`, **Sacred Skip-Bo** `SKIP-` `2–6 seats`, **Cardinal Uno** `UNO-` `2–10 seats`, **The Resistance: Avalon** `AVALON-` `5–10 seats`, and **Sacred Geometry SET** `SET-` `1–20 seats`) must support both **Play vs AI** and **Real-Time Online Multiplayer** with full-screen theater views, real-life player capacities, and dynamic player addition/claiming (`seatManager`, `addPlayer`, `claimSeatForHuman`, `vacatePlayerSeat`).
   - Maintain Hungarian-prefixed tables (`tbl_<game>_sessions`, `tbl_<game>_seats`, `tbl_<game>_moves`, `tbl_<game>_events`, `tbl_archived_<game>_snapshots`, `tbl_archived_<game>_snapshots_history`), composite cleanup indexes (`(do_not_delete, updated_at, status)`), and universal automated pruning of all stale sessions 3+ days old where `do_not_delete != true`.
12. **Mandatory ECMAScript `Temporal` API First with `dayjs` Fallback (`src/utils/dateTime.ts`)**:
   - **Always** use the ECMAScript `Temporal` API (`Temporal.Now.instant()`, `Temporal.Instant`, `Temporal.PlainDateTime`, `Temporal.ZonedDateTime`) for all date/time operations in TypeScript/JavaScript, and automatically fall back to `dayjs` (with `utc`, `timezone`, and `advancedFormat` plugins) when `Temporal` is not available in the runtime (modeled after MST Notes UI).
   - **Never** invoke raw `Date.now()` or `new Date()` in application or server code; always import and call `currentEpochMs()`, `nowIso()`, `epochMsToIso()`, `isoToEpochMs()`, `subtractDaysEpochMs()`, `subtractDaysIso()`, `formatDateTime()`, or `withFallback()` from [`src/utils/dateTime.ts`](file:///Users/brentzey/personal/web-chess/src/utils/dateTime.ts).
13. **Grand Sanctuary Playing Card & Typography Scale (`src/styles/main.css`)**:
   - Maintain large, legible fluid playing cards (`.playing-card-ui` with `clamp(5.25rem, 8.2vw, 7.25rem)` width and `clamp(7.5rem, 11.8vw, 10.25rem)` height, `.playing-card-corner`, `.playing-card-center`, and `.arcade-set-card-ui`) and generous typography across all arcade game theaters so cards and text are never tiny or cramped on any device.
14. **Mandatory Off-Hours Central Time USA Timestamps on Git Commits**:
   - All git commits **MUST** strictly be authored and committed with `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` outside of standard US Central working hours (Monday through Friday 8:00 AM – 6:00 PM Central Time `-0500` / `-0600`).
   - Always commit using late evening (e.g. 20:00–23:59) or early morning (e.g. 04:00–07:30) Central timestamps (e.g., `GIT_AUTHOR_DATE="2026-10-28T23:58:00-05:00" GIT_COMMITTER_DATE="2026-10-28T23:58:00-05:00"`).




