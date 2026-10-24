# Contributing to Wizard's Chess 3D

We welcome contributions to Wizard's Chess 3D! To maintain the high code quality, visual fidelity, and robust performance of this repository, please review and adhere to the following guidelines.

---

## 🛠️ Development Environment Setup

We exclusively use **Bun** as our runtime, package manager, and test runner.

1. **Install Bun**:
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Clone and Install Dependencies**:
   ```bash
   git clone https://github.com/brentmzey/web-chess.git
   cd web-chess
   bun install
   ```

3. **Start the Development Server**:
   ```bash
   bun run dev
   ```

---

## 📐 Core Engineering Paradigms

1. **Functional Programming Paradigms & Rust/Scala Pattern Matching ([`src/utils/fp.ts`](file:///Users/brentzey/personal/web-chess/src/utils/fp.ts))**:
   - Always program using functional paradigms (`Option<T>` / `Optional<T>`, `Result<T, E>`, `fromNullable`, `map`, `flatMap`, `flatMapAsync`, `filter`, `fold`, `getOrElse`, `getOrThrow`, `tryCatch`, `tryCatchAsync`) and exhaustive Rust/Scala-style pattern matching (`match`, `matchBool`, `opt.match({ Some, None })`, `res.match({ Ok, Err })`).
   - Avoid imperative null-branching (`if (x !== null && x !== undefined)`), nested `if/else` ladders, or raw `try/catch` blocks when transforming nullable values, DOM elements, or asynchronous I/O. Use `fromNullable(...).getOrElse(...)` when a fallback is sensible, or `fromNullable(...).getOrThrow(...)` when a missing reference violates a required invariant.

2. **Encrypted Client Storage ([`src/storage/indexedDbStore.ts`](file:///Users/brentzey/personal/web-chess/src/storage/indexedDbStore.ts))**:
   - All client persistence uses **IndexedDB** (`WizardChessSessionDB`)—never `localStorage`.
   - Every payload written to storage **must** be encrypted using Web Crypto API `AES-GCM-256` (`encryptPayload`) with a unique 12-byte random IV before writing, and decrypted + authenticated (`decryptPayload`) when fetching.
3. **Strict TypeScript**:
   - All methods, function signatures, mesh user data, and event parameters must have explicit interfaces or types.
   - Run `bun run typecheck` before submitting changes.
4. **Theme Separation & Chess UI Terminology**:
   - The **High Gothic Basilica & Sanctuary** aesthetic (architecture, stained glass, lighting, articulated pieces, and pipe organ acoustics) is the visual and audio theme of the chessboard (architected so additional themes can be added in the future).
   - All game settings, modals, and match rules must use clear, standard **chess terminology** (e.g., *"Game Settings"*, *"Game Settings & Match Setup"*, *"New Game"*, *"Strict Mode"*, *"Pawn Promotion"*). Do not label game settings or matches as *"Sanctuary Rites"*.
5. **Zero External Media Assets**:
   - Audio is generated procedurally via the Web Audio API in [`CathedralSoundEngine.ts`](file:///Users/brentzey/personal/web-chess/src/audio/CathedralSoundEngine.ts). Do not commit `.mp3`, `.wav`, or `.ogg` files.
   - Textures are generated procedurally on HTML5 `<canvas>` in [`textures.ts`](file:///Users/brentzey/personal/web-chess/src/graphics/textures.ts). Do not commit bitmap image files.
6. **PBR & Three.js Efficiency (Desktop & Mobile Sanctuary Lite)**:
   - Reuse geometries and shared materials where possible.
   - Respect `DeviceProfileConfig` in [`deviceTier.ts`](file:///Users/brentzey/personal/web-chess/src/graphics/deviceTier.ts) so small-screen and low-RAM/low-CPU devices maintain smooth 60fps performance.
7. **Chess Engine Integrity**:
   - All board modifications must go through `chess.js` and sync accurately via `syncBoardPiecesWithChessState()`.
   - Never bypass legal chess rules (check, checkmate, stalemate, castling rights, promotion, en passant).
8. **Standardized DateTime Architecture ([`src/utils/dateTime.ts`](file:///Users/brentzey/personal/web-chess/src/utils/dateTime.ts))**:
   - All date, timestamp, and duration operations must use the centralized datetime utility conforming to the ECMAScript `Temporal` API (`currentEpochMs()`, `nowIso()`, `epochMsToIso()`, `formatDateTime()`) with automatic `Day.js` fallback.
   - Never invoke raw `Date.now()` or `new Date().toISOString()` directly in application code.
9. **Mandatory Universal Credential & Vulnerability Pre-Commit/Pre-Push Scanning**:
   - Never commit or push real secrets, admin credentials, database tokens, or PocketHost superuser passwords to Git or remote.
   - Always verify `.env` files are excluded in `.gitignore`, inspect `git diff`, and confirm zero sensitive leaks before pushing to remote. Sourced credentials must be injected via external environment variables (`PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD` from `~/.zshrc`).
10. **PocketHost / PocketBase BaaS & Schema Integrity ([`src/server/pocketbase/`](file:///Users/brentzey/personal/web-chess/src/server/pocketbase/))**:
   - Apply cloud schema migrations via `bun run pb:migrate`.
   - Maintain append-only immutability on move and event collections (`updateRule: null`, `deleteRule: null`) to prevent data tampering.

---

## 📦 Versioning, `CHANGELOG.md` & Release Candidates (`SemVer` + `RC#`)

Every general feature change, enhancement, or application behavior update **MUST** include a [`CHANGELOG.md`](file:///Users/brentzey/personal/web-chess/CHANGELOG.md) entry:
- **Semantic Versioning with Release Candidates (`X.Y.Z-rc.N`)**:
  - Feature changes and behavior updates are grouped under a single active Release Candidate entry (e.g., `## [1.1.0-rc.1]`) in `CHANGELOG.md` (with matching `"version"` in `package.json`).
  - Changes continue to accumulate under the active `RC#` entry during development and iteration **until `main` is pushed to remote (`origin/main`)**, which triggers the production **Build & Release** pipeline.

---

## 🧪 High Code Coverage, Unit & Integration Testing Requirements

We enforce high levels of automated test coverage (**100% Line & Branch Coverage**, **>99% Function Coverage**) across both unit and end-to-end integration suites:
- **Unit & Integration Test Runner**: Run `bun run test:coverage` to execute all unit tests (`tests/*.test.ts`) and full end-to-end integration flows (`tests/integration.test.ts`), generating SonarQube / JaCoCo-compatible LCOV (`coverage/lcov.info`) and Markdown (`coverage/coverage-report.md`) reports.
- **New Features & Behavior Changes**: Every new feature or behavior change (AI difficulty heuristics, AES-GCM-256 encrypted storage, device tier detection, or UI state flows) **must** include both isolated unit tests and end-to-end integration coverage under `tests/`.

```bash
# Run unit & integration tests with Line & Branch Coverage Report
bun run test:coverage

# Run TypeScript typecheck
bun run typecheck

# Run full production build
bun run build
```

---

## 🚀 Submitting a Pull Request

1. Create a feature branch:
   ```bash
   git checkout -b feat/my-enhancement
   ```
2. Update [`CHANGELOG.md`](file:///Users/brentzey/personal/web-chess/CHANGELOG.md) under the current `X.Y.Z-rc.N` release candidate heading.
3. Commit your changes using conventional commit messages (`feat: ...`, `fix: ...`, `perf: ...`, `refactor: ...`).
4. Ensure `bun run test:coverage && bun run typecheck && bun run build` passes with zero errors or warnings.
5. Push to your branch and open a Pull Request against the `main` branch (pushing `main` to remote triggers the production Build & Release).

