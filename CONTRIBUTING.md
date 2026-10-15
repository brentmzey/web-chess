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

1. **Strict TypeScript**:
   - Zero `any` types. All methods, function signatures, mesh user data, and event parameters must have explicit interfaces or types.
   - Run `bun run typecheck` before submitting changes.
2. **Zero External Media Assets**:
   - Audio is generated procedurally via the Web Audio API in [`CathedralSoundEngine.ts`](file:///Users/brentzey/personal/web-chess/src/audio/CathedralSoundEngine.ts). Do not commit `.mp3`, `.wav`, or `.ogg` files.
   - Textures are generated procedurally on HTML5 `<canvas>` in [`textures.ts`](file:///Users/brentzey/personal/web-chess/src/graphics/textures.ts). Do not commit bitmap image files.
3. **PBR & Three.js Efficiency**:
   - Reuse geometries and shared materials where possible.
   - Ensure all dynamic lights have appropriate decay and shadows configured with sensible map sizes.
4. **Chess Engine Integrity**:
   - All board modifications must go through `chess.js` and sync accurately via `syncBoardPiecesWithChessState()`.
   - Never bypass legal chess rules (check, checkmate, stalemate, castling rights, promotion, en passant).

---

## 🧪 Testing Requirements

We maintain strict regression protection:
- **Test Runner**: Run `bun test` to execute all unit tests.
- **Coverage**: Any new algorithmic features (such as AI heuristics, board coordinates, or rule enhancements) must include corresponding unit tests under `tests/`.

```bash
# Run unit tests
bun test

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
2. Commit your changes using conventional commit messages (`feat: ...`, `fix: ...`, `perf: ...`, `refactor: ...`).
3. Ensure `bun test && bun run typecheck && bun run build` passes with zero errors or warnings.
4. Push to your branch and open a Pull Request against the `main` branch.
