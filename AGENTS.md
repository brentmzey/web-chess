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
   - All Sanctuary Arcade games (**Sanctuary Chess** `SANCT-` `2 players + spectators`, **Gothic Blackjack** `BJK-` `1–7 seats`, **Cathedral Poker** `POKER-` `2–9 seats`, **Ten Rites / Phase 10** `P10-` `2–6 seats`, **Sacred Skip-Bo** `SKIP-` `2–6 seats`, **Cardinal Uno** `UNO-` `2–10 seats`, **The Resistance: Avalon** `AVALON-` `5–10 seats`, **Sacred Geometry SET** `SET-` `1–20 seats`, and **Cathedral Solitaire** `SOL-` `1 player + spectators`) must support both **Play vs AI** and **Real-Time Online Multiplayer** with full-screen theater views, real-life player capacities, and dynamic player addition/claiming (`seatManager`, `addPlayer`, `claimSeatForHuman`, `vacatePlayerSeat`).
   - Maintain Hungarian-prefixed tables (`tbl_<game>_sessions`, `tbl_<game>_seats`, `tbl_<game>_moves`, `tbl_<game>_events`, `tbl_archived_<game>_snapshots`, `tbl_archived_<game>_snapshots_history`), composite cleanup indexes (`(do_not_delete, updated_at, status)`), and universal automated pruning of all stale sessions 3+ days old where `do_not_delete != true`.
12. **Mandatory ECMAScript `Temporal` API First with `dayjs` Fallback (`src/utils/dateTime.ts`)**:
   - **Always** use the ECMAScript `Temporal` API (`Temporal.Now.instant()`, `Temporal.Instant`, `Temporal.PlainDateTime`, `Temporal.ZonedDateTime`) for all date/time operations in TypeScript/JavaScript, and automatically fall back to `dayjs` (with `utc`, `timezone`, and `advancedFormat` plugins) when `Temporal` is not available in the runtime (modeled after MST Notes UI).
   - **Never** invoke raw `Date.now()` or `new Date()` in application or server code; always import and call `currentEpochMs()`, `nowIso()`, `epochMsToIso()`, `isoToEpochMs()`, `subtractDaysEpochMs()`, `subtractDaysIso()`, `formatDateTime()`, or `withFallback()` from [`src/utils/dateTime.ts`](file:///Users/brentzey/personal/web-chess/src/utils/dateTime.ts).
13. **Grand Sanctuary Playing Card & Typography Scale (`src/styles/main.css`)**:
   - Maintain large, legible fluid playing cards (`.playing-card-ui` with `clamp(5.25rem, 8.2vw, 7.25rem)` width and `clamp(7.5rem, 11.8vw, 10.25rem)` height, `.playing-card-corner`, `.playing-card-center`, and `.arcade-set-card-ui`) and generous typography across all arcade game theaters so cards and text are never tiny or cramped on any device.
14. **Mandatory Off-Hours Central Time USA Timestamps on Git Commits**:
   - All git commits **MUST** strictly be authored and committed with `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` outside of standard US Central working hours (Monday through Friday 8:00 AM – 6:00 PM Central Time `-0500` / `-0600`).
   - Always commit using late evening (e.g. 20:00–23:59) or early morning (e.g. 04:00–07:30) Central timestamps (e.g., `GIT_AUTHOR_DATE="2026-10-28T23:58:00-05:00" GIT_COMMITTER_DATE="2026-10-28T23:58:00-05:00"`).
   - Commits are authored as `Brent Zey <brentmzey4795@gmail.com>`, configured through `~/.gitconfig-personal` (`includeIf gitdir:~/personal/`). Never override this identity.
   - Never add `Co-Authored-By` (or any other AI attribution) trailers to commit messages or PR descriptions.
   - "Central Time" means `America/Chicago`: use `-05:00` while daylight saving time is in effect (second Sunday of March to first Sunday of November) and `-06:00` otherwise.
15. **Namespaced Error Data Model (`src/errors/sanctuaryError.ts`)**:
   - Domain operations return `Result<T, SanctuaryError<TData>>`, never primitive string errors. Use the subsystem subclasses (`DatabaseError`, `GameEngineError`, `RealtimeError`, `ValidationError`, `StorageError`, `SessionError`, `NetworkError`, etc.), which carry typed data, unique codes, `currentEpochMs()` timestamps, trace IDs, and causes.
16. **Branded UUID v4 & Trace IDs (`src/utils/uuid.ts`)**:
   - Use the nominal `UuidV4` / `TraceId` types and `generateUuidV4()`, `generateTraceId()`, `parseUuidV4()` for identifiers. They stay plain-string compatible with SQLite and PocketBase.
17. **No Cursor / Jiggler Motion References**:
   - Strictly zero comments, mentions, or notes about cursor or jiggler motion anywhere in the codebase, changelog, or commits.

---

## 🌐 PocketBase / PocketHost Operations

* **Backend**: `https://web-chess.pockethost.io` (`POCKETBASE_URL`). Credentials come only from `~/.zshrc` (`PB_ADMIN_EMAIL`/`PB_ADMIN_PASSWORD`, or `POCKETBASE_SUPERUSER_EMAIL`/`POCKETBASE_SUPERUSER_PASSWORD`).
* **`bun run pb:migrate`**: `scripts/pb-migrate.ts` → `src/server/pocketbase/migrator.ts` syncs `src/server/pocketbase/schema.json` and `multiGameSchema.json` (all `tbl_<game>_*` collections, relations, composite cleanup indexes, `tbl_arcade_tables`/`tbl_arcade_events`), then upserts any missing config keys without overwriting tuned values. Run it before `pb:deploy-hooks` when hooks depend on new collections.
* **`bun run pb:cleanup`**: `scripts/pb-cleanup.ts` triggers the server cron `cleanup_stale_chess_sessions` (`POST /api/crons/...`) and prints its `tbl_audit_cleanup_logs` row. `--client-side` runs the legacy REST pruner (`src/server/pocketbase/pruner.ts`) instead.
* **Storage lifecycle (`pb_hooks/sanctuary_maintenance.js`, shared by all hooks via `require`)**: stale sessions and arcade tables → `tbl_archived_*` (one transaction, children cascade) → `*_history` by age or row cap → purged after retention unless `bln_do_not_delete`. Thresholds are DB-driven `tbl_cfg_system_controls` keys (`system.stale_session_days`, `system.archive_rotation_days`, `system.archive_max_rows`, `system.history_retention_days`, `system.guest_player_retention_days`). Guest `tbl_arcade_players` with no remaining table events are pruned after the guest retention window; clients re-register automatically when their stored sign-in stops working. PocketBase runs each hook handler in an isolated scope, so shared code must live in a `require`d module, not at the top level of a `*.pb.js` file.
* **`bun run pb:deploy-hooks`**: `scripts/pb-deploy-hooks.ts` uploads `pb_hooks/` over SFTP (`ftp.pockethost.io:2222`, key `~/.ssh/pockethost_ed25519`).
* **Realtime (`src/realtime/arcadeRealtimeClient.ts`)**: outside `localhost` it uses PocketBase SSE (`/api/realtime`) with a filtered per-table topic (`arcadeSubscriptionTopic`) and publishes to `POST /api/collections/tbl_arcade_events/records`. Local dev and tests use the Bun server SSE endpoints (`/api/arcade/sessions/...`, `bun run server`). Never subscribe to a bare collection name: PocketBase only delivers `<collection>/*`, `<collection>/<id>` or options-filtered topics, under an SSE event named exactly as the topic. Arcade `session_events` is chess-only, because `session` is a relation to `game_sessions`.
* **Arcade tables (`tbl_arcade_tables`)**: server-owned. The `arcade_tables.pb.js` hook validates and links every `tbl_arcade_events` record to its table (cascading relation) and keeps the latest snapshot for late joiners. Clients never write tables directly.
* **Live table state**: multi-seat arcade tables stay consistent by broadcasting `state_sync` snapshots (`src/games/multiplayer/tableSnapshot.ts`), not by replaying actions, since engines shuffle with `Math.random`. Seat ownership (`src/games/multiplayer/liveSeats.ts`) travels inside the snapshot. Only the host drives bots and resets the table. The host is whoever the server recorded first in `tbl_arcade_tables.host_participant_id`; after joining, every client adopts that role (`adoptServerHostRole` in `main.ts`), because arriving by `?session=` link says nothing about who hosts.
* **Hidden information (PocketHost)**: guests sign in as `tbl_arcade_players` (credentials encrypted in IndexedDB) and send zod-validated intents (`src/validation/arcadeIntents.ts`); only the host runs engines. The host publishes a redacted table (`src/games/multiplayer/hiddenInfo.ts` policies) plus each guest's secrets to `tbl_arcade_private` (owner-readable, host-writable). New hidden fields must be added to that game's policy with a test proving they never appear in the public snapshot. Deploy client changes before tightening collection rules the old client relies on.
* **Typed records & live config**: parse every PocketBase record with the zod schemas in `src/validation/` before use. Tunables belong in `tbl_cfg_system_controls` (add the key to `SystemControlKeyEnum` and `DEFAULT_SYSTEM_CONTROLS`; `pb:migrate` upserts missing keys). Clients receive config edits live over SSE.

## 🧭 Shared Working Notes (Claude + AGY)

Hard-won lessons from earlier sessions. Read them before working on live tables, releases or tooling, and add new ones here, never in a tool-specific file.

### Release & commit routine
* **Order for schema or hook changes**: `bun run pb:migrate` → `bun run pb:deploy-hooks` → `bun run pb:cleanup` (proves the hook runs on the live server) → commit → push. Pushing `main` deploys production on Netlify within about a minute.
* **Commits**: author `Brent Zey <brentmzey4795@gmail.com>`, **no** `Co-Authored-By` or AI trailers, and `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` set off-hours in `America/Chicago` (Rule 14). Each new timestamp must be later than the previous commit's, so check `git log -1 --format=%ad` first.
* **Before every push**: the full gate, plus a scan of `git diff --cached` for secrets and for wording banned by Rule 17.
* **Confirm a deploy** by checking that the live bundle carries the new version: `curl` the homepage, find `assets/index-*.js` and grep it for the version, or read `<html data-app-version>` in a browser.
* **Versioning**: bump the `RC#` for each pushed fix while verifying a release, then promote to `X.Y.Z` with a `### Release` CHANGELOG entry that lists what was verified on production. Tooling-only changes that alter the deployed bundle still get a patch version.

### Clean output is the contract
* A passing `bun run build && bun run test && bun run test:coverage && bun run typecheck` prints **no** ERROR/WARN lines and no build warnings. Tests that drive failure paths are quiet because `tests/setup/quietLogs.ts` (preloaded by `bunfig.toml`) hides log output; run with `SANCTUARY_TEST_LOGS=1` to see it.
* Any new ERROR/WARN line or Vite warning is a real regression. Fix the cause; don't filter it. The only filtered warning is zod's harmless `INVALID_ANNOTATION`. Keep app chunks under 500 kB: libraries go in the `vendor`, `three` or `chess` manual chunks in `vite.config.ts`.

### Verifying live multiplayer for real
* Unit tests are not enough for live tables: verify in two browsers on **different origins** (`https://web-chess-app.netlify.app` and `https://main--web-chess-app.netlify.app` share one build but keep separate storage and guest identities).
* Open both by link (`/?session=<PREFIX>-<CODE>`), not only through the in-game Live tab. The link path is the one real players use, and it once left tables with no host.
* Production hides console logs, so inspect server state directly: anonymous `GET /api/collections/tbl_arcade_tables/records?filter=session_code="<CODE>"` shows the public snapshot (secrets must be placeholders), and superuser reads of `tbl_arcade_events` show what each participant published.
* The Chrome extension cannot screenshot the second origin. Drive it with JS (set `#arcade-join-player-name-input`, click `#btn-arcade-confirm-join`, read `innerText`). Select buttons by id, not by text: "Deal" also matches the "vs Dealer" tab.
* Headless first: `tests/liveTables.integration.test.ts` plays every live game host ↔ guest over a JSON wire with the real engines, policies and intent handlers (`src/games/multiplayer/arcadeIntentHandlers.ts`). Extend it when a game, intent or hidden field changes, and keep guest-move logic in that module, not in `main.ts`.
* Still to verify in two browsers: Skip-Bo and Phase 10 (covered headlessly).
* A live table closes when its last human sends `seat_left` (`seatedParticipants` in `sanctuary_maintenance.js`; `leaveSession` locally). Only an explicit leave counts: a reload or closed tab sends nothing, so resume keeps working and stale cleanup handles abandoned tabs.
* New Game buttons (`data-arcade-new-game`) reuse each game's own reset path and are hidden while `activeArcadeClient` is set.
* Solitaire live tables have no seats: the host plays and everyone else spectates, so the spectator flag must follow `adoptServerHostRole`.

### Engine & UI gotchas
* The single-seat and multi-seat Blackjack engines name their stages differently (`player-turn` vs `player-turns`). Never gate display logic on a stage string shared between them; prefer card properties such as `faceUp`.
* Hidden placeholders (`HIDDEN_CARD`) have `faceUp: false` and no rank. Any UI that sums or parses cards must skip face-down cards.
* Player-facing notices go through `ui.showTemporaryBanner`, which renders in `#app-toast` above the theaters (z-[60]). Never show arcade messages in the chess HUD (z-20); theaters (z-50) cover it.
* Seat takeovers: per-person scores (SET) reset when a human claims a bot's seat; card hands are inherited. Decide per game, and test it.

### Local dev quirks
* Two-tab local tests need separate origins (`localhost` and `127.0.0.1`). PocketHost-mode local testing uses `*.lvh.me` over HTTP, where `crypto.subtle` is unavailable.
* Kill dev servers with `lsof -ti tcp:PORT -sTCP:LISTEN`; without `-sTCP:LISTEN` you also kill Vite through its proxy socket.

### Known limits (Option A) and the next step
* The host's browser still holds every secret because it runs the bots. If the host leaves, the table stalls, and a host who returns by link instead of reloading starts a new game.
* The planned fix is **Option B**: move the engines into PocketBase hooks so the server is authoritative. That closes the host gap, keeps bots running without a host, and ends SET claim races.

## 📋 Pre-Completion Checklist

- [ ] `bun run test:coverage` passes with 0 failures and 100% line/branch coverage on touched files.
- [ ] `bun run typecheck` reports 0 errors and `bun run build` succeeds, with no ERROR/WARN lines or build warnings in a passing run.
- [ ] `git diff` contains no secrets, tokens, or credentials.
- [ ] RC# bumped in `package.json` and documented in `CHANGELOG.md` (behavior changes only).
- [ ] Commit timestamp is off-hours Central Time (Rule 14).




