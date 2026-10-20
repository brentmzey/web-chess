import * as THREE from 'three';
import { Chess, type Move } from 'chess.js';
import { CathedralSoundEngine } from './audio/CathedralSoundEngine';
import {
  CHESS_THEMES,
  DIFFICULTY_PROFILES,
  GAME_MODES,
  getDifficultyProfile,
  getGameModeConfig,
  getSettingsActionButtonLabel,
  getThemeConfig,
  resolveSettingsApplyAction,
  shouldResetBoardOnSettingsApply,
  type MatchSettingsSnapshot
} from './constants/board';
import { computeMinimaxMove } from './engine/ai';
import { indicesToSquare, squareToWorld, worldToSquare } from './engine/coordinates';
import { checkGeminiNanoStatus, computeGeminiNanoAIMove } from './engine/geminiNanoAI';
import { computeMicroNeuralAIMove } from './engine/neuralAI';
import { buildChessboardGrid, updateBoardHighlights } from './graphics/board';
import { buildGothicCathedral } from './graphics/cathedral';
import { initDeviceTier } from './graphics/deviceTier';
import {
  applyDisplaySettings,
  DISPLAY_PRESETS,
  getDisplaySettings,
  setDisplaySettings
} from './graphics/displaySettings';
import { buildDustParticles } from './graphics/dust';
import { applyThemePalette, createMaterials } from './graphics/materials';
import { buildWizardPieceMesh } from './graphics/pieces';
import { initScene } from './graphics/scene';
import { ShatterSystem } from './graphics/shatter';
import { CameraController } from './interaction/camera';
import {
  auditEncryptedStorage,
  clearSessionState,
  getPersistencePreference,
  loadSessionOutcome,
  saveSessionState,
  SESSION_KEY,
  setPersistencePreference,
  wipeAllStorage
} from './storage/indexedDbStore';
import {
  ChessThemeEnum,
  DeviceTierEnum,
  GameModeEnum,
  OpponentDifficultyEnum,
  PieceColorEnum,
  SettingsApplyActionEnum,
  StorageLoadStatusEnum,
  type ChessTheme,
  type GameMode,
  type OpponentDifficulty,
  type PieceColor,
  type PieceMeshGroup,
  type PieceType,
  type SavedCamState
} from './types';
import { UIController } from './ui/uiController';
import { fromNullable, match, matchBool } from './utils/fp';
import { logExecutionContext, logger } from './utils/logger';

// Entry point initialization
function main(): void {
  const container = fromNullable(document.getElementById('canvas-container')).getOrThrow(
    () => new Error('Canvas container (#canvas-container) not found in DOM')
  );

  // 0. Detect Device Tier (Desktop Ultra HD vs Mobile Sanctuary Lite) & Log Execution Side
  const deviceProfile = initDeviceTier();
  logExecutionContext('SanctuaryMain', {
    tier: deviceProfile.tier,
    profile: deviceProfile.label
  });

  // 1. Scene, Renderer, Lights (configured for active DeviceProfileConfig)
  const {
    scene,
    camera,
    renderer,
    strikeFlashLight,
    altarWarmLight,
    boardKeyLight,
    hemiLight
  } = initScene(container, deviceProfile);

  // 2. Audio & Materials
  const soundFX = new CathedralSoundEngine();
  const materials = createMaterials();

  // 3. 3D Gothic Basilica Architecture
  const { swingingThuribles, candleFlames } = buildGothicCathedral(scene, materials);

  // 4. 64-Square Board Grid
  const { squareMeshes, highlightGroup } = buildChessboardGrid(scene, materials);

  // 5. Shatter Physics System & Ambient Dust (scaled to device tier)
  const shatterSystem = new ShatterSystem(
    scene,
    materials,
    soundFX,
    strikeFlashLight,
    deviceProfile
  );
  const { updateDust } = buildDustParticles(scene, deviceProfile.dustCount);

  // 6. Camera & UI Controllers
  const camController = new CameraController(camera);
  const ui = new UIController();
  ui.applyDeviceProfileUI(deviceProfile);

  // 7. Chess & Match Configuration State
  const chess = new Chess();
  const pieceMap: Record<string, PieceMeshGroup> = {};

  let selectedSquare: string | null = null;
  let legalMovesForSelected: Move[] = [];
  let isAnimating = false;
  let currentMode: GameMode = GameModeEnum.Minimax;
  let currentDifficulty: OpponentDifficulty = OpponentDifficultyEnum.Balanced;
  let currentTheme: ChessTheme = ChessThemeEnum.GothicBasilica;
  let allowUndo = true;
  let pendingAllowUndo = true;
  let modalOpenedFromReset = false;
  let settingsSnapshotOnOpen: MatchSettingsSnapshot = {
    mode: currentMode,
    difficulty: currentDifficulty,
    allowUndo
  };
  let persistenceEnabled = true;
  let useActionCam = true;
  let pendingPromotionMove: { from: string; to: string } | null = null;

  // Display settings (in-memory + persisted in IndexedDB when session persistence is enabled)
  const displaySettings = getDisplaySettings();
  applyDisplaySettings(displaySettings, renderer, hemiLight, boardKeyLight, container);

  async function persistCurrentSession(): Promise<void> {
    if (!persistenceEnabled) return;
    await saveSessionState({
      id: SESSION_KEY,
      enabled: true,
      fen: chess.fen(),
      history: chess.history(),
      mode: currentMode,
      difficulty: currentDifficulty,
      allowUndo,
      theme: currentTheme,
      contrast: displaySettings.contrast,
      brightness: displaySettings.brightness,
      deviceTier: deviceProfile.tier,
      timestamp: Date.now()
    });
  }

  function syncBoardPiecesWithChessState(): void {
    Object.keys(pieceMap).forEach(sq => {
      fromNullable(pieceMap[sq]).map(piece => {
        scene.remove(piece);
      });
      delete pieceMap[sq];
    });

    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        fromNullable(board[r]?.[f]).map(cell => {
          const sq = indicesToSquare(f, r);
          const meshGroup = buildWizardPieceMesh(
            cell.type as PieceType,
            cell.color as PieceColor,
            materials
          );
          const worldPos = squareToWorld(sq);
          meshGroup.position.copy(worldPos);
          meshGroup.userData.square = sq;
          scene.add(meshGroup);
          pieceMap[sq] = meshGroup;
        });
      }
    }
  }

  function updateHighlights(): void {
    updateBoardHighlights(
      highlightGroup,
      squareMeshes,
      selectedSquare,
      legalMovesForSelected,
      chess.in_check(),
      chess.turn() as PieceColor,
      pieceMap
    );
  }

  function syncAllControlsUI(): void {
    const modeCfg = getGameModeConfig(currentMode);
    const diffCfg = getDifficultyProfile(currentDifficulty);
    const themeCfg = getThemeConfig(currentTheme);
    const inProgress = chess.history().length > 0;
    const currentSnapshot: MatchSettingsSnapshot = {
      mode: currentMode,
      difficulty: currentDifficulty,
      allowUndo: pendingAllowUndo
    };
    const settingsAction = resolveSettingsApplyAction(
      inProgress,
      settingsSnapshotOnOpen,
      currentSnapshot,
      modalOpenedFromReset
    );
    const willResetBoard = shouldResetBoardOnSettingsApply(
      inProgress,
      settingsSnapshotOnOpen,
      currentSnapshot,
      modalOpenedFromReset
    );

    // Bottom bar mode, difficulty & theme chips
    fromNullable(document.getElementById('mode-label')).map(el => {
      el.textContent = modeCfg.label;
    });
    fromNullable(document.getElementById('mode-icon')).map(el => {
      el.textContent = modeCfg.icon;
    });
    fromNullable(document.getElementById('btn-mode')).map(btn => {
      btn.title = `${modeCfg.label}: ${modeCfg.description} (Click to cycle)`;
    });

    fromNullable(document.getElementById('theme-label')).map(el => {
      el.textContent = themeCfg.badge;
    });
    fromNullable(document.getElementById('theme-icon')).map(el => {
      el.textContent = themeCfg.icon;
    });
    fromNullable(document.getElementById('btn-theme')).map(btn => {
      btn.title = `Sanctuary & Board Theme: ${themeCfg.label} (Click to cycle live mid-game)`;
    });

    fromNullable(document.getElementById('difficulty-label')).map(el => {
      el.textContent = match(currentMode as GameModeEnum, {
        [GameModeEnum.PassAndPlay]: () => '2P Human',
        [GameModeEnum.Minimax]: () => diffCfg.badge,
        [GameModeEnum.MicroNeural]: () => diffCfg.badge,
        [GameModeEnum.GeminiNano]: () => diffCfg.badge
      });
    });
    fromNullable(document.getElementById('difficulty-icon')).map(el => {
      el.textContent = match(currentMode as GameModeEnum, {
        [GameModeEnum.PassAndPlay]: () => 'group',
        [GameModeEnum.Minimax]: () => diffCfg.icon,
        [GameModeEnum.MicroNeural]: () => diffCfg.icon,
        [GameModeEnum.GeminiNano]: () => diffCfg.icon
      });
    });
    fromNullable(document.getElementById('btn-difficulty')).map(btn => {
      matchBool(currentMode === GameModeEnum.PassAndPlay, {
        true: () => {
          btn.classList.add('opacity-50');
          btn.title = 'Pass & Play mode: Both sides controlled by humans';
        },
        false: () => {
          btn.classList.remove('opacity-50');
          btn.title = `Opponent Difficulty: ${diffCfg.label} (Click to cycle)`;
        }
      });
    });

    // Pre-Game Modal Device Tier Notice
    fromNullable(document.getElementById('pregame-device-icon')).map(el => {
      el.textContent = match(deviceProfile.tier, {
        [DeviceTierEnum.MobileLite]: () => 'smartphone',
        [DeviceTierEnum.Desktop]: () => 'desktop_windows'
      });
    });
    fromNullable(document.getElementById('pregame-device-label')).map(el => {
      el.textContent = deviceProfile.label;
    });
    fromNullable(document.getElementById('pregame-device-desc')).map(el => {
      el.textContent = deviceProfile.notice;
    });
    fromNullable(document.getElementById('pregame-device-pill')).map(el => {
      el.textContent = deviceProfile.badge;
    });

    // Strip / disable heavy desktop-only Gemini Nano card on Mobile Lite
    fromNullable(document.getElementById('card-gemini-nano') as HTMLButtonElement | null).map(
      card => {
        match(deviceProfile.tier, {
          [DeviceTierEnum.MobileLite]: () => {
            card.classList.add('opacity-50');
            card.setAttribute('data-desktop-only', 'true');
            fromNullable(document.getElementById('gemini-card-badge')).map(b => {
              b.textContent = 'DESKTOP ONLY';
              b.className =
                'text-[9px] font-bold px-1.5 py-0.5 rounded bg-stone-500/30 text-stone-300';
            });
            fromNullable(document.getElementById('gemini-card-desc')).map(d => {
              d.textContent =
                'Requires Desktop Chrome Canary with on-device window.ai. Stripped on Mobile Lite.';
            });
          },
          [DeviceTierEnum.Desktop]: () => {}
        });
      }
    );

    // Pre-game mode selection cards highlight
    document.querySelectorAll('.mode-select-card').forEach(card => {
      const cardMode = card.getAttribute('data-mode-select');
      const isSelected = cardMode === currentMode;
      card.classList.toggle('border-amber-400/70', isSelected);
      card.classList.toggle('bg-amber-400/15', isSelected);
      card.classList.toggle('border-white/10', !isSelected);
    });

    // Pre-game difficulty buttons highlight & tailored description
    document.querySelectorAll('.diff-select-btn').forEach(btn => {
      const btnDiff = btn.getAttribute('data-diff-select');
      const isSelected = btnDiff === currentDifficulty;
      btn.classList.toggle('border-amber-400/70', isSelected);
      btn.classList.toggle('bg-amber-400/15', isSelected);
      btn.classList.toggle('border-white/10', !isSelected);
    });

    fromNullable(document.getElementById('pregame-difficulty-section')).map(sec => {
      sec.classList.toggle('opacity-55', currentMode === GameModeEnum.PassAndPlay);
    });

    fromNullable(document.getElementById('pregame-difficulty-desc')).map(descEl => {
      descEl.textContent = diffCfg.styleDescriptions[currentMode as GameModeEnum];
    });

    // Pre-game theme selection buttons highlight & description
    document.querySelectorAll('.theme-select-btn').forEach(btn => {
      const btnTheme = btn.getAttribute('data-theme-select');
      const isSelected = btnTheme === currentTheme;
      btn.classList.toggle('border-amber-400/70', isSelected);
      btn.classList.toggle('bg-amber-400/15', isSelected);
      btn.classList.toggle('border-white/10', !isSelected);
    });

    fromNullable(document.getElementById('pregame-theme-desc')).map(descEl => {
      descEl.textContent = themeCfg.description;
    });

    // Pre-game Allow Undo checkbox & badge
    const activeUndoSetting = matchBool(inProgress, {
      true: () => pendingAllowUndo,
      false: () => allowUndo
    });
    fromNullable(
      document.getElementById('allow-undo-checkbox') as HTMLInputElement | null
    ).map(chk => {
      chk.checked = activeUndoSetting;
    });
    fromNullable(document.getElementById('allow-undo-badge')).map(badge => {
      matchBool(activeUndoSetting, {
        true: () => {
          badge.textContent = 'ALLOWED';
          badge.className =
            'text-[10px] px-2 py-0.5 rounded-full bg-emerald-400/20 text-emerald-300 font-bold';
        },
        false: () => {
          badge.textContent = 'STRICT (NO UNDO)';
          badge.className =
            'text-[10px] px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 font-bold';
        }
      });
    });
    fromNullable(document.getElementById('undo-locked-inprogress-note')).map(note => {
      note.classList.toggle('hidden', !inProgress);
    });

    // Persistence checkboxes (Pre-game modal + Chronicle drawer)
    fromNullable(
      document.getElementById('persist-session-checkbox') as HTMLInputElement | null
    ).map(chk => {
      chk.checked = persistenceEnabled;
    });
    fromNullable(
      document.getElementById('drawer-persist-checkbox') as HTMLInputElement | null
    ).map(chk => {
      chk.checked = persistenceEnabled;
    });

    // Resume / Enter Game & Start New Game button labels and active-chip highlight via Rust/Scala pattern matching
    fromNullable(document.getElementById('resume-rite-label')).map(lbl => {
      lbl.textContent = matchBool(inProgress, {
        true: () => 'Resume Active Game',
        false: () => 'Enter Game'
      });
    });
    fromNullable(document.getElementById('start-rite-label')).map(lbl => {
      lbl.textContent = getSettingsActionButtonLabel(settingsAction);
    });
    fromNullable(document.getElementById('resume-rite-btn')).map(btn => {
      btn.classList.toggle(
        'active-chip',
        match(settingsAction, {
          [SettingsApplyActionEnum.KeepActiveGame]: () => true,
          [SettingsApplyActionEnum.ApplyAndReset]: () => false,
          [SettingsApplyActionEnum.StartNewGame]: () => false
        })
      );
    });
    fromNullable(document.getElementById('start-rite-btn')).map(btn => {
      btn.classList.toggle('active-chip', willResetBoard);
    });

    ui.update(chess, currentMode, undefined, currentDifficulty, allowUndo);
  }


  function finishMoveState(
    moveObj: Move,
    attacker: PieceMeshGroup,
    savedCamState: SavedCamState | null,
    onComplete?: () => void
  ): void {
    delete pieceMap[moveObj.from];
    pieceMap[moveObj.to] = attacker;
    attacker.userData.square = moveObj.to;

    // Castling Rook Movement
    if (moveObj.flags.includes('k') || moveObj.flags.includes('q')) {
      const rank = moveObj.color === PieceColorEnum.White ? '1' : '8';
      const rookFrom = moveObj.flags.includes('k') ? 'h' + rank : 'a' + rank;
      const rookTo = moveObj.flags.includes('k') ? 'f' + rank : 'd' + rank;
      const rookMesh = pieceMap[rookFrom];
      if (rookMesh) {
        delete pieceMap[rookFrom];
        pieceMap[rookTo] = rookMesh;
        rookMesh.userData.square = rookTo;
        rookMesh.position.copy(squareToWorld(rookTo));
      }
    }

    // Pawn Promotion
    if (moveObj.flags.includes('p') && moveObj.promotion) {
      scene.remove(attacker);
      const promotedMesh = buildWizardPieceMesh(
        moveObj.promotion as PieceType,
        moveObj.color as PieceColor,
        materials
      );
      promotedMesh.position.copy(squareToWorld(moveObj.to));
      promotedMesh.userData.square = moveObj.to;
      scene.add(promotedMesh);
      pieceMap[moveObj.to] = promotedMesh;
    }

    // Restore Action Cam
    if (savedCamState) {
      setTimeout(() => {
        camController.camState.target.copy(savedCamState.target);
        camController.camState.radius = savedCamState.radius;
        camController.camState.phi = savedCamState.phi;
      }, 420);
    }

    isAnimating = false;
    syncAllControlsUI();
    void persistCurrentSession();
    if (onComplete) onComplete();
  }

  function animateChessMove(moveObj: Move, onComplete?: () => void): void {
    isAnimating = true;
    const attacker = pieceMap[moveObj.from];
    if (!attacker) {
      isAnimating = false;
      if (onComplete) onComplete();
      return;
    }

    const startPos = squareToWorld(moveObj.from);
    const endPos = squareToWorld(moveObj.to);
    const isCapture = moveObj.flags.includes('c') || moveObj.flags.includes('e');
    const isKnight = attacker.userData.type === 'n';

    let victimSquare = moveObj.to;
    if (moveObj.flags.includes('e')) {
      const epRank = moveObj.color === PieceColorEnum.White ? '5' : '4';
      victimSquare = moveObj.to[0] + epRank;
    }
    const victim = isCapture ? pieceMap[victimSquare] : null;

    const dirVec = new THREE.Vector3().subVectors(endPos, startPos);
    const moveDist = dirVec.length();
    const dirNorm = dirVec.clone().normalize();
    attacker.rotation.y = Math.atan2(dirNorm.x, dirNorm.z);

    let savedCamState: SavedCamState | null = null;
    if (isCapture && useActionCam) {
      savedCamState = {
        target: camController.camState.target.clone(),
        radius: camController.camState.radius,
        phi: camController.camState.phi
      };
      camController.camState.target.lerpVectors(startPos, endPos, 0.65);
      camController.camState.radius = 13.5;
      camController.camState.phi = 0.98;
    }

    if (!isCapture) {
      const duration = isKnight ? 650 : 520;
      soundFX.playStoneSlide(duration / 1000);
      const t0 = performance.now();

      function stepQuiet(now: number): void {
        const p = Math.min(1, (now - t0) / duration);
        const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

        attacker!.position.lerpVectors(startPos, endPos, ease);
        if (isKnight) {
          attacker!.position.y = Math.sin(p * Math.PI) * 2.85;
          attacker!.rotation.x = Math.sin(p * Math.PI * 2) * 0.25;
        } else {
          attacker!.position.y = Math.sin(p * Math.PI) * 0.18;
        }

        if (p < 1) {
          requestAnimationFrame(stepQuiet);
        } else {
          attacker!.position.copy(endPos);
          attacker!.rotation.x = 0;
          attacker!.rotation.y = attacker!.userData.baseRotY;
          finishMoveState(moveObj, attacker!, savedCamState, onComplete);
        }
      }
      requestAnimationFrame(stepQuiet);
    } else {
      const stopPos = endPos.clone().addScaledVector(dirNorm, -Math.min(1.65, moveDist * 0.45));
      const duration = 980;
      let hasShattered = false;
      soundFX.playStoneSlide(0.45);
      const t0 = performance.now();

      function stepCombat(now: number): void {
        const p = Math.min(1, (now - t0) / duration);
        const weaponGroup = attacker!.userData.weaponGroup;

        if (p < 0.48) {
          const subP = p / 0.48;
          const ease = 1 - Math.pow(1 - subP, 2);
          attacker!.position.lerpVectors(startPos, stopPos, ease);
          if (isKnight) {
            attacker!.position.y = Math.sin(subP * Math.PI) * 2.1;
          }
        } else if (p < 0.68) {
          const subP = (p - 0.48) / 0.2;
          attacker!.rotation.x = -subP * 0.28;
          if (weaponGroup) weaponGroup.rotation.x = -subP * 1.15;
        } else if (p < 0.8) {
          const subP = (p - 0.68) / 0.12;
          attacker!.rotation.x = -0.28 + subP * 0.54;
          if (weaponGroup) weaponGroup.rotation.x = -1.15 + subP * 2.38;
          if (!hasShattered && subP >= 0.45) {
            hasShattered = true;
            if (victim) {
              shatterSystem.spawnShatterExplosion(victim, dirNorm);
              delete pieceMap[victimSquare];
            }
          }
        } else {
          const subP = (p - 0.8) / 0.2;
          attacker!.position.lerpVectors(stopPos, endPos, subP);
          attacker!.rotation.x = (1 - subP) * 0.26;
          if (weaponGroup) weaponGroup.rotation.x = (1 - subP) * 1.23;
        }

        if (p < 1) {
          requestAnimationFrame(stepCombat);
        } else {
          attacker!.position.copy(endPos);
          attacker!.rotation.x = 0;
          attacker!.rotation.y = attacker!.userData.baseRotY;
          if (attacker!.userData.weaponGroup) {
            attacker!.userData.weaponGroup.rotation.set(0, 0, 0);
          }
          finishMoveState(moveObj, attacker!, savedCamState, onComplete);
        }
      }
      requestAnimationFrame(stepCombat);
    }
  }

  function triggerTurnOrAI(): void {
    if (chess.game_over()) {
      soundFX.playCathedralOrganAndBell();
      ui.showGameOver(chess);
      return;
    }

    if (
      currentMode !== GameModeEnum.PassAndPlay &&
      chess.turn() === PieceColorEnum.Black &&
      !isAnimating
    ) {
      setTimeout(async () => {
        const aiMove = await match(currentMode as GameModeEnum, {
          [GameModeEnum.PassAndPlay]: async () => null,
          [GameModeEnum.Minimax]: async () => computeMinimaxMove(chess, currentDifficulty),
          [GameModeEnum.MicroNeural]: async () =>
            computeMicroNeuralAIMove(chess, currentDifficulty),
          [GameModeEnum.GeminiNano]: async () => {
            ui.update(
              chess,
              currentMode,
              `Gemini Nano (${currentDifficulty.toUpperCase()}) Thinking...`,
              currentDifficulty,
              allowUndo
            );
            const result = await computeGeminiNanoAIMove(
              chess,
              statusText => {
                ui.showTemporaryBanner(statusText, 3200);
              },
              currentDifficulty
            );
            return result.move;
          }
        });

        fromNullable(aiMove)
          .map(move => chess.move(move))
          .filter(executed => executed !== null)
          .map(executed => {
            selectedSquare = null;
            legalMovesForSelected = [];
            updateHighlights();
            void persistCurrentSession();
            animateChessMove(executed!, () => {
              if (chess.in_check()) soundFX.playCathedralOrganAndBell();
              if (chess.game_over()) {
                ui.showGameOver(chess);
              } else {
                syncAllControlsUI();
              }
            });
          });
      }, 480);
    }
  }

  function executeMoveOnBoard(moveAttempt: {
    from: string;
    to: string;
    promotion?: string;
  }): void {
    const executed = chess.move(moveAttempt);
    if (!executed) return;

    selectedSquare = null;
    legalMovesForSelected = [];
    updateHighlights();
    void persistCurrentSession();

    animateChessMove(executed, () => {
      if (chess.in_check()) soundFX.playCathedralOrganAndBell();
      triggerTurnOrAI();
    });
  }

  // Pointer & Multi-Touch Interaction (Orbit + Mobile Pinch-to-Zoom + Tap to Select)
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const planeHitPoint = new THREE.Vector3();
  let isDragging = false;
  let dragStartPos = { x: 0, y: 0 };
  let prevPointer = { x: 0, y: 0 };
  const activeTouches = new Map<number, { x: number; y: number }>();
  let lastPinchDist: number | null = null;

  const canvasEl = renderer.domElement;

  canvasEl.addEventListener('pointerdown', (e: PointerEvent) => {
    activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activeTouches.size === 1) {
      isDragging = true;
      dragStartPos = { x: e.clientX, y: e.clientY };
      prevPointer = { x: e.clientX, y: e.clientY };
    } else if (activeTouches.size === 2) {
      isDragging = false;
      const pts = Array.from(activeTouches.values());
      lastPinchDist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
    }
  });

  window.addEventListener('pointermove', (e: PointerEvent) => {
    if (activeTouches.has(e.pointerId)) {
      activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (activeTouches.size === 2) {
      const pts = Array.from(activeTouches.values());
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      if (lastPinchDist !== null) {
        const delta = lastPinchDist - dist;
        camController.camState.radius = Math.max(
          13.5,
          Math.min(27.5, camController.camState.radius + delta * 0.05)
        );
      }
      lastPinchDist = dist;
      return;
    }

    if (!isDragging) return;
    const totalDist = Math.hypot(e.clientX - dragStartPos.x, e.clientY - dragStartPos.y);
    if (totalDist < 6) return;

    const dx = e.clientX - prevPointer.x;
    const dy = e.clientY - prevPointer.y;
    prevPointer = { x: e.clientX, y: e.clientY };

    camController.camState.theta -= dx * 0.0065;
    camController.camState.phi = Math.max(
      0.18,
      Math.min(1.28, camController.camState.phi - dy * 0.0055)
    );
  });

  function handleBoardClick(clientX: number, clientY: number): void {
    if (isAnimating || chess.game_over()) return;
    if (currentMode !== GameModeEnum.PassAndPlay && chess.turn() === PieceColorEnum.Black) return;

    const rectOpt = fromNullable(canvasEl.getBoundingClientRect?.());
    const width = rectOpt
      .filter(r => r.width > 0)
      .map(r => r.width)
      .getOrElse(window.innerWidth);
    const height = rectOpt
      .filter(r => r.height > 0)
      .map(r => r.height)
      .getOrElse(window.innerHeight);
    const offsetX = rectOpt.map(r => clientX - r.left).getOrElse(clientX);
    const offsetY = rectOpt.map(r => clientY - r.top).getOrElse(clientY);


    pointer.x = (offsetX / width) * 2 - 1;
    pointer.y = -(offsetY / height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);

    const interactables: THREE.Object3D[] = [
      ...Object.values(squareMeshes),
      ...Object.values(pieceMap)
    ];

    const intersects = raycaster.intersectObjects(interactables, true);
    let raycastSquare: string | undefined;

    for (const hit of intersects) {
      let hitObj: THREE.Object3D | null = hit.object;
      while (hitObj && !hitObj.userData?.['square'] && hitObj.parent) {
        hitObj = hitObj.parent;
      }
      if (hitObj?.userData?.['square']) {
        raycastSquare = hitObj.userData['square'] as string;
        break;
      }
    }

    // Fallback to mathematical board-plane intersection so mobile taps never miss between tile bevels
    const clickedSquareOpt = fromNullable(raycastSquare).match({
      Some: sq => fromNullable(sq),
      None: () =>
        matchBool(Boolean(raycaster.ray.intersectPlane(boardPlane, planeHitPoint)), {
          true: () => worldToSquare(planeHitPoint.x, planeHitPoint.z),
          false: () => fromNullable<string>(undefined)
        })
    });

    clickedSquareOpt.match({
      None: () => {},
      Some: clickedSquare => {
        const candidateMove = legalMovesForSelected.find(m => m.to === clickedSquare);
        if (selectedSquare && candidateMove) {
          matchBool(candidateMove.flags.includes('p'), {
            true: () => {
              pendingPromotionMove = { from: selectedSquare!, to: clickedSquare };
              ui.showPromotionModal();
            },
            false: () => {
              executeMoveOnBoard({ from: selectedSquare!, to: clickedSquare });
            }
          });
          return;
        }

        fromNullable(chess.get(clickedSquare as any))
          .filter(pieceOnSq => pieceOnSq.color === chess.turn())
          .match({
            Some: () => {
              selectedSquare = clickedSquare;
              legalMovesForSelected = chess.moves({
                square: clickedSquare as any,
                verbose: true
              });
              soundFX.playSelect();
              updateHighlights();
            },
            None: () => {
              selectedSquare = null;
              legalMovesForSelected = [];
              updateHighlights();
            }
          });
      }
    });
  }

  window.addEventListener('pointerup', (e: PointerEvent) => {
    activeTouches.delete(e.pointerId);
    if (activeTouches.size < 2) {
      lastPinchDist = null;
    }
    if (!isDragging) return;
    isDragging = false;
    const dist = Math.hypot(e.clientX - dragStartPos.x, e.clientY - dragStartPos.y);
    if (dist < 18) {
      handleBoardClick(e.clientX, e.clientY);
    }
  });

  window.addEventListener('pointercancel', (e: PointerEvent) => {
    activeTouches.delete(e.pointerId);
    lastPinchDist = null;
    isDragging = false;
  });

  canvasEl.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      camController.camState.radius = Math.max(
        13.5,
        Math.min(27.5, camController.camState.radius + e.deltaY * 0.018)
      );
    },
    { passive: false }
  );

  // Mode Selection Logic
  async function selectGameMode(nextMode: GameModeEnum): Promise<void> {
    if (
      nextMode === GameModeEnum.GeminiNano &&
      deviceProfile.tier === DeviceTierEnum.MobileLite
    ) {
      ui.showTemporaryBanner(
        'Gemini Nano Local LLM requires Desktop Chrome. Available on Desktop!',
        3500
      );
      return;
    }

    currentMode = nextMode;
    logger.info('Opponent style selected', {
      mode: currentMode,
      difficulty: currentDifficulty,
      tier: deviceProfile.tier
    });

    if (currentMode === GameModeEnum.GeminiNano) {
      const nanoStatus = await checkGeminiNanoStatus();
      matchBool(nanoStatus.available, {
        true: () => ui.showTemporaryBanner('Gemini Nano On-Device AI Active', 2500),
        false: () =>
          ui.showTemporaryBanner(
            'Chrome Canary with window.ai needed. Auto-fallback to Neural AI.',
            3500
          )
      });
    }

    syncAllControlsUI();
    void persistCurrentSession();
    triggerTurnOrAI();
  }

  // Difficulty Selection Logic
  function selectDifficulty(nextDiff: OpponentDifficultyEnum): void {
    currentDifficulty = nextDiff;
    const diffCfg = getDifficultyProfile(currentDifficulty);
    logger.info('Opponent difficulty/aggressiveness updated', {
      mode: currentMode,
      difficulty: currentDifficulty,
      aggressiveness: diffCfg.aggressiveness
    });
    soundFX.playSelect();
    syncAllControlsUI();
    void persistCurrentSession();
    if (currentMode !== GameModeEnum.PassAndPlay) {
      ui.showTemporaryBanner(
        `Opponent set to ${diffCfg.label} (${diffCfg.badge})`,
        2200
      );
    }
  }

  // Live-Swappable 3D Sanctuary & Board Theme Selection Logic (works before AND mid-game without resetting)
  function selectTheme(nextTheme: ChessThemeEnum): void {
    currentTheme = nextTheme;
    const themeCfg = applyThemePalette(currentTheme, materials, squareMeshes, {
      scene,
      hemiLight,
      altarWarmLight,
      strikeFlashLight
    });
    applyDisplaySettings(displaySettings, renderer, hemiLight, boardKeyLight, container);
    updateHighlights();
    logger.info('Sanctuary & Board Theme updated live', {
      theme: currentTheme,
      label: themeCfg.label,
      inProgress: chess.history().length > 0
    });
    soundFX.playSelect();
    syncAllControlsUI();
    void persistCurrentSession();
    ui.showTemporaryBanner(`Theme: ${themeCfg.label} (${themeCfg.badge})`, 2200);
  }

  // Bottom Bar Event Listeners
  fromNullable(document.getElementById('btn-setup')).map(btn =>
    btn.addEventListener('click', () => {
      modalOpenedFromReset = false;
      pendingAllowUndo = allowUndo;
      settingsSnapshotOnOpen = {
        mode: currentMode,
        difficulty: currentDifficulty,
        allowUndo
      };
      syncAllControlsUI();
      ui.showPreGameModal();
    })
  );

  fromNullable(document.getElementById('close-pregame-btn')).map(btn =>
    btn.addEventListener('click', () => {
      modalOpenedFromReset = false;
      ui.hidePreGameModal();
    })
  );

  fromNullable(document.getElementById('resume-rite-btn')).map(btn =>
    btn.addEventListener('click', () => {
      modalOpenedFromReset = false;
      if (chess.history().length === 0) {
        allowUndo = pendingAllowUndo;
      }
      settingsSnapshotOnOpen = {
        mode: currentMode,
        difficulty: currentDifficulty,
        allowUndo
      };
      syncAllControlsUI();
      void persistCurrentSession();
      ui.hidePreGameModal();
      triggerTurnOrAI();
    })
  );

  function startNewGame(): void {
    const inProgress = chess.history().length > 0;
    const currentSnapshot: MatchSettingsSnapshot = {
      mode: currentMode,
      difficulty: currentDifficulty,
      allowUndo: pendingAllowUndo
    };
    const settingsAction = resolveSettingsApplyAction(
      inProgress,
      settingsSnapshotOnOpen,
      currentSnapshot,
      modalOpenedFromReset
    );
    modalOpenedFromReset = false;

    const resetAndStartMatch = (): void => {
      chess.reset();
      allowUndo = pendingAllowUndo;
      settingsSnapshotOnOpen = {
        mode: currentMode,
        difficulty: currentDifficulty,
        allowUndo
      };
      logger.info('Started new Chess Match', {
        mode: currentMode,
        difficulty: currentDifficulty,
        allowUndo,
        persistenceEnabled,
        deviceTier: deviceProfile.tier
      });
      selectedSquare = null;
      legalMovesForSelected = [];
      syncBoardPiecesWithChessState();
      updateHighlights();
      syncAllControlsUI();
      ui.hideGameOver();
      ui.hidePreGameModal();
      soundFX.playSelect();
      void persistCurrentSession();
    };

    match(settingsAction, {
      [SettingsApplyActionEnum.KeepActiveGame]: () => {
        // Nothing changed from active match settings -> keep current game intact!
        syncAllControlsUI();
        void persistCurrentSession();
        ui.hidePreGameModal();
        triggerTurnOrAI();
      },
      [SettingsApplyActionEnum.ApplyAndReset]: resetAndStartMatch,
      [SettingsApplyActionEnum.StartNewGame]: resetAndStartMatch
    });
  }

  fromNullable(document.getElementById('start-rite-btn')).map(btn =>
    btn.addEventListener('click', startNewGame)
  );

  // Pre-Game Modal Mode Cards
  document.querySelectorAll('.mode-select-card').forEach(card => {
    card.addEventListener('click', () => {
      fromNullable(card.getAttribute('data-mode-select') as GameModeEnum | null).map(modeAttr => {
        soundFX.playSelect();
        void selectGameMode(modeAttr);
      });
    });
  });

  // Pre-Game Modal Difficulty Buttons
  document.querySelectorAll('.diff-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      fromNullable(btn.getAttribute('data-diff-select') as OpponentDifficultyEnum | null).map(
        diffAttr => {
          selectDifficulty(diffAttr);
        }
      );
    });
  });

  // Pre-Game Modal Theme Buttons (apply live even if a game is already in progress!)
  document.querySelectorAll('.theme-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      fromNullable(btn.getAttribute('data-theme-select') as ChessThemeEnum | null).map(
        themeAttr => {
          selectTheme(themeAttr);
        }
      );
    });
  });

  // Pre-Game Allow Undo Checkbox
  fromNullable(document.getElementById('allow-undo-checkbox') as HTMLInputElement | null).map(
    allowUndoCheckbox =>
      allowUndoCheckbox.addEventListener('change', () => {
        pendingAllowUndo = allowUndoCheckbox.checked;
        // If the game hasn't started yet (0 moves), apply immediately
        if (chess.history().length === 0) {
          allowUndo = pendingAllowUndo;
          void persistCurrentSession();
        }
        syncAllControlsUI();
      })
  );

  // Encrypted IndexedDB Session Persistence Toggle Handler
  async function handlePersistenceToggle(enabled: boolean): Promise<void> {
    persistenceEnabled = enabled;
    await setPersistencePreference(enabled);
    await matchBool(enabled, {
      true: async () => {
        await persistCurrentSession();
        ui.showTemporaryBanner('Encrypted session persistence active in IndexedDB', 2400);
      },
      false: async () => {
        await clearSessionState();
        ui.showTemporaryBanner('IndexedDB encrypted session state cleared', 2400);
      }
    });
    syncAllControlsUI();
  }

  fromNullable(document.getElementById('persist-session-checkbox') as HTMLInputElement | null).map(
    pregamePersistCheckbox =>
      pregamePersistCheckbox.addEventListener('change', () => {
        void handlePersistenceToggle(pregamePersistCheckbox.checked);
      })
  );

  fromNullable(document.getElementById('drawer-persist-checkbox') as HTMLInputElement | null).map(
    drawerPersistCheckbox =>
      drawerPersistCheckbox.addEventListener('change', () => {
        void handlePersistenceToggle(drawerPersistCheckbox.checked);
      })
  );

  async function openStorageAuditInspector(): Promise<void> {
    const auditResult = await auditEncryptedStorage();
    ui.renderStorageAudit(auditResult);
    ui.showStorageAuditModal();
  }

  fromNullable(document.getElementById('btn-audit-storage')).map(btn =>
    btn.addEventListener('click', () => {
      void openStorageAuditInspector();
    })
  );

  fromNullable(document.getElementById('btn-drawer-audit-storage')).map(btn =>
    btn.addEventListener('click', () => {
      void openStorageAuditInspector();
    })
  );

  fromNullable(document.getElementById('refresh-audit-btn')).map(btn =>
    btn.addEventListener('click', () => {
      void openStorageAuditInspector();
    })
  );

  fromNullable(document.getElementById('close-audit-btn')).map(btn =>
    btn.addEventListener('click', () => {
      ui.hideStorageAuditModal();
    })
  );

  fromNullable(document.getElementById('done-audit-btn')).map(btn =>
    btn.addEventListener('click', () => {
      ui.hideStorageAuditModal();
    })
  );

  // Wipe & Start Over: erase every encrypted record + the key, reset all in-memory state
  async function wipeAndStartOver(): Promise<void> {
    const result = await wipeAllStorage();
    result.match({
      Ok: () => {
        chess.reset();
        selectedSquare = null;
        legalMovesForSelected = [];
        currentMode = GameModeEnum.Minimax;
        currentDifficulty = OpponentDifficultyEnum.Balanced;
        currentTheme = ChessThemeEnum.GothicBasilica;
        applyThemePalette(currentTheme, materials, squareMeshes, {
          scene,
          hemiLight,
          altarWarmLight,
          strikeFlashLight
        });
        allowUndo = true;
        pendingAllowUndo = true;
        persistenceEnabled = true;
        modalOpenedFromReset = false;
        settingsSnapshotOnOpen = {
          mode: currentMode,
          difficulty: currentDifficulty,
          allowUndo
        };
        syncBoardPiecesWithChessState();
        updateHighlights();
        syncAllControlsUI();
        ui.hideGameOver();
        ui.hideStorageAuditModal();
        void persistCurrentSession();
        ui.showTemporaryBanner('All saved data wiped. Started over with a brand-new encryption key.', 4200);
      },
      Err: message => ui.showTemporaryBanner(`Wipe failed: ${message}`, 4500)
    });
  }

  fromNullable(document.getElementById('wipe-storage-btn')).map(btn =>
    btn.addEventListener('click', () => ui.showWipeConfirm())
  );
  fromNullable(document.getElementById('wipe-cancel-btn')).map(btn =>
    btn.addEventListener('click', () => ui.hideWipeConfirm())
  );
  fromNullable(document.getElementById('wipe-confirm-btn')).map(btn =>
    btn.addEventListener('click', () => {
      void wipeAndStartOver();
    })
  );

  // Cycle Game Mode from Bottom Bar
  fromNullable(document.getElementById('btn-mode')).map(btn =>
    btn.addEventListener('click', async () => {
      const availableModes = GAME_MODES.filter(
        m => !(deviceProfile.tier === DeviceTierEnum.MobileLite && m.desktopOnly)
      );
      const currentIndex = availableModes.findIndex(m => m.id === currentMode);
      const nextConfig = fromNullable(
        availableModes[(currentIndex + 1) % availableModes.length]
      ).getOrThrow('No available game modes configured');
      await selectGameMode(nextConfig.id);
    })
  );

  // Cycle Difficulty from Bottom Bar
  fromNullable(document.getElementById('btn-difficulty')).map(btn =>
    btn.addEventListener('click', () => {
      matchBool(currentMode === GameModeEnum.PassAndPlay, {
        true: () => {
          ui.showTemporaryBanner('Pass & Play: Two human players duel directly', 2200);
        },
        false: () => {
          const idx = DIFFICULTY_PROFILES.findIndex(d => d.id === currentDifficulty);
          const nextDiff = fromNullable(
            DIFFICULTY_PROFILES[(idx + 1) % DIFFICULTY_PROFILES.length]
          ).getOrThrow('No difficulty profiles configured');
          selectDifficulty(nextDiff.id);
        }
      });
    })
  );

  // Cycle Sanctuary & Board Theme from Bottom Bar (works live mid-game!)
  fromNullable(document.getElementById('btn-theme')).map(btn =>
    btn.addEventListener('click', () => {
      const idx = CHESS_THEMES.findIndex(t => t.id === currentTheme);
      const nextTheme = fromNullable(
        CHESS_THEMES[(idx + 1) % CHESS_THEMES.length]
      ).getOrThrow('No chess themes configured');
      selectTheme(nextTheme.id);
    })
  );

  const camLabel = document.getElementById('cam-label');
  fromNullable(document.getElementById('btn-cam-cycle')).map(btnCamCycle =>
    btnCamCycle.addEventListener('click', () => {
      const preset = camController.cyclePreset();
      fromNullable(camLabel).map(lbl => {
        lbl.textContent = preset.name;
      });
    })
  );

  fromNullable(document.getElementById('btn-cinematic')).map(btnCinematic =>
    btnCinematic.addEventListener('click', e => {
      useActionCam = !useActionCam;
      (e.currentTarget as HTMLElement).classList.toggle('active-chip', useActionCam);
    })
  );

  // Undo Last Move (respects Pre-Game allowUndo rule)
  fromNullable(document.getElementById('btn-undo')).map(btnUndo =>
    btnUndo.addEventListener('click', () => {
      if (!allowUndo) {
        ui.showTemporaryBanner(
          'Strict Mode: Undo was disabled in Game Settings before this match began!',
          2800
        );
        return;
      }
      if (isAnimating || chess.history().length === 0) return;
      chess.undo();
      if (
        currentMode !== GameModeEnum.PassAndPlay &&
        chess.turn() === PieceColorEnum.Black &&
        chess.history().length > 0
      ) {
        chess.undo();
      }
      selectedSquare = null;
      legalMovesForSelected = [];
      syncBoardPiecesWithChessState();
      updateHighlights();
      syncAllControlsUI();
      soundFX.playSelect();
      void persistCurrentSession();
    })
  );

  // New Game button opens the Pre-Game Settings modal so user can configure Undo & Difficulty before starting
  fromNullable(document.getElementById('btn-reset')).map(btn =>
    btn.addEventListener('click', () => {
      modalOpenedFromReset = true;
      pendingAllowUndo = allowUndo;
      settingsSnapshotOnOpen = {
        mode: currentMode,
        difficulty: currentDifficulty,
        allowUndo
      };
      syncAllControlsUI();
      ui.showPreGameModal();
    })
  );

  fromNullable(document.getElementById('modal-new-game')).map(btn =>
    btn.addEventListener('click', () => {
      ui.hideGameOver();
      modalOpenedFromReset = true;
      pendingAllowUndo = allowUndo;
      settingsSnapshotOnOpen = {
        mode: currentMode,
        difficulty: currentDifficulty,
        allowUndo
      };
      syncAllControlsUI();
      ui.showPreGameModal();
    })
  );

  fromNullable(document.getElementById('modal-inspect')).map(btn =>
    btn.addEventListener('click', () => {
      ui.hideGameOver();
    })
  );

  const audioIcon = document.getElementById('audio-icon');
  fromNullable(document.getElementById('btn-audio')).map(btnAudio =>
    btnAudio.addEventListener('click', e => {
      soundFX.enabled = !soundFX.enabled;
      fromNullable(audioIcon).map(icon => {
        icon.textContent = matchBool(soundFX.enabled, {
          true: () => 'volume_up',
          false: () => 'volume_off'
        });
      });
      (e.currentTarget as HTMLElement).classList.toggle('active-chip', soundFX.enabled);
    })
  );

  // Sanctuary Contrast & Visibility Controls
  const btnContrast = document.getElementById('btn-contrast');
  const contrastPanel = document.getElementById('contrast-panel');
  const closeContrastBtn = document.getElementById('close-contrast-btn');
  const contrastSlider = document.getElementById('contrast-slider') as HTMLInputElement | null;
  const brightnessSlider = document.getElementById('brightness-slider') as HTMLInputElement | null;
  const contrastVal = document.getElementById('contrast-val');
  const brightnessVal = document.getElementById('brightness-val');

  function syncDisplayInputs(): void {
    const activeDisp = getDisplaySettings();
    fromNullable(contrastSlider).map(s => {
      s.value = String(activeDisp.contrast);
    });
    fromNullable(brightnessSlider).map(s => {
      s.value = String(activeDisp.brightness);
    });
    fromNullable(contrastVal).map(v => {
      v.textContent = `${activeDisp.contrast}%`;
    });
    fromNullable(brightnessVal).map(v => {
      v.textContent = `${activeDisp.brightness}%`;
    });
  }
  syncDisplayInputs();

  function updateDisplay(): void {
    applyDisplaySettings(displaySettings, renderer, hemiLight, boardKeyLight, container);
    syncDisplayInputs();
    void persistCurrentSession();
  }

  fromNullable(btnContrast).map(btn =>
    btn.addEventListener('click', e => {
      fromNullable(contrastPanel).map(panel => {
        const isHidden = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !isHidden);
        (e.currentTarget as HTMLElement).classList.toggle('active-chip', isHidden);
      });
    })
  );

  fromNullable(closeContrastBtn).map(btn =>
    btn.addEventListener('click', () => {
      fromNullable(contrastPanel).map(p => p.classList.add('hidden'));
      fromNullable(btnContrast).map(b => b.classList.remove('active-chip'));
    })
  );

  fromNullable(contrastSlider).map(slider =>
    slider.addEventListener('input', () => {
      displaySettings.contrast = parseInt(slider.value, 10);
      setDisplaySettings(displaySettings);
      updateDisplay();
    })
  );

  fromNullable(brightnessSlider).map(slider =>
    slider.addEventListener('input', () => {
      displaySettings.brightness = parseInt(slider.value, 10);
      setDisplaySettings(displaySettings);
      updateDisplay();
    })
  );

  document.querySelectorAll('.contrast-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      fromNullable(btn.getAttribute('data-preset'))
        .flatMap(presetKey => fromNullable(DISPLAY_PRESETS[presetKey]))
        .map(preset => {
          displaySettings.contrast = preset.contrast;
          displaySettings.brightness = preset.brightness;
          setDisplaySettings(displaySettings);
          updateDisplay();
        });
    });
  });

  fromNullable(document.getElementById('btn-drawer')).map(btn =>
    btn.addEventListener('click', () => ui.toggleDrawer())
  );
  fromNullable(document.getElementById('close-drawer-btn')).map(btn =>
    btn.addEventListener('click', () => ui.toggleDrawer())
  );

  document.querySelectorAll('.promo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const promoPieceOpt = fromNullable(btn.getAttribute('data-promo'));
      ui.hidePromotionModal();
      fromNullable(pendingPromotionMove)
        .flatMap(pendingMove =>
          promoPieceOpt.map(promoPiece => ({
            from: pendingMove.from,
            to: pendingMove.to,
            promotion: promoPiece
          }))
        )
        .map(movePayload => {
          executeMoveOnBoard(movePayload);
          pendingPromotionMove = null;
        });
    });
  });

  // Restore Saved Session from IndexedDB if Persistence Preference is Enabled
  async function restoreSessionIfEnabled(): Promise<void> {
    const pref = await getPersistencePreference();
    persistenceEnabled = pref;

    if (pref) {
      const outcome = await loadSessionOutcome();
      match(outcome.status, {
        [StorageLoadStatusEnum.Restored]: () => {},
        [StorageLoadStatusEnum.Empty]: () => {},
        [StorageLoadStatusEnum.Unreadable]: () =>
          ui.showTemporaryBanner(
            'Saved data could not be unlocked (older version or different browser profile). Open Storage Audit → Wipe & Start Over to reset.',
            6500
          ),
        [StorageLoadStatusEnum.Unavailable]: () =>
          ui.showTemporaryBanner(
            'Encrypted storage is unavailable in this browser — progress will not persist.',
            4500
          )
      });
      const savedOpt = fromNullable(outcome.session);
      savedOpt.match({
        None: () => {},
        Some: saved => {
          // Restore Mode (strip desktop-only GeminiNano if on MobileLite)
          const savedMode = fromNullable(saved.mode).getOrElse(GameModeEnum.Minimax);
          currentMode = matchBool(
            savedMode === GameModeEnum.GeminiNano &&
              deviceProfile.tier === DeviceTierEnum.MobileLite,
            {
              true: () => GameModeEnum.MicroNeural,
              false: () => savedMode
            }
          );

          currentDifficulty = fromNullable(saved.difficulty).getOrElse(
            OpponentDifficultyEnum.Balanced
          );
          currentTheme = fromNullable(saved.theme).getOrElse(ChessThemeEnum.GothicBasilica);
          applyThemePalette(currentTheme, materials, squareMeshes, {
            scene,
            hemiLight,
            altarWarmLight,
            strikeFlashLight
          });

          allowUndo = fromNullable(saved.allowUndo).getOrElse(true);
          pendingAllowUndo = allowUndo;
          settingsSnapshotOnOpen = {
            mode: currentMode,
            difficulty: currentDifficulty,
            allowUndo
          };

          // Restore Display Contrast & Brightness
          if (typeof saved.contrast === 'number' && typeof saved.brightness === 'number') {
            displaySettings.contrast = saved.contrast;
            displaySettings.brightness = saved.brightness;
            setDisplaySettings(displaySettings);
            applyDisplaySettings(displaySettings, renderer, hemiLight, boardKeyLight, container);
            syncDisplayInputs();
          }

          // Replay move history so full algebraic chronicle & captured pieces restore
          chess.reset();
          if (Array.isArray(saved.history) && saved.history.length > 0) {
            for (const san of saved.history) {
              const moved = chess.move(san);
              if (!moved) {
                chess.load(saved.fen);
                break;
              }
            }
            // Hide Pre-Game setup modal automatically when resuming an active match
            ui.hidePreGameModal();
            ui.showTemporaryBanner('Sanctuary Session Restored from IndexedDB', 2800);
          } else if (saved.fen) {
            chess.load(saved.fen);
          }
        }
      });
    }

    syncBoardPiecesWithChessState();
    updateHighlights();
    syncAllControlsUI();
    if (chess.history().length > 0) {
      triggerTurnOrAI();
    }
  }

  // Flush encrypted session state on tab/browser refresh, close, or visibility backgrounding
  window.addEventListener('pagehide', () => {
    void persistCurrentSession();
  });
  document.addEventListener('visibilitychange', () => {
    matchBool(document.visibilityState === 'hidden', {
      true: () => {
        void persistCurrentSession();
      },
      false: () => {}
    });
  });

  // Initial Sync & IndexedDB Restore
  syncBoardPiecesWithChessState();
  syncAllControlsUI();
  void restoreSessionIfEnabled();

  // Main Render Animation Loop
  const clock = new THREE.Clock();

  function animateLoop(): void {
    requestAnimationFrame(animateLoop);
    const dt = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.getElapsedTime();

    // 1. Camera Orbit & Shake Interpolation
    camController.update(shatterSystem.cameraShakeIntensity);
    if (shatterSystem.cameraShakeIntensity > 0.005) {
      shatterSystem.cameraShakeIntensity *= 0.86;
    }

    // 2. Procedural Piece Idle Animation
    Object.values(pieceMap).forEach(piece => {
      const phase = piece.userData.idlePhase;
      const body = piece.userData.bodyGroup;
      const weapon = piece.userData.weaponGroup;
      if (body) {
        body.position.y = Math.sin(elapsed * 2.1 + phase) * 0.032;
      }
      if (weapon && !isAnimating) {
        weapon.rotation.z = Math.sin(elapsed * 1.7 + phase) * 0.045;
      }
    });

    // 3. Swinging Thuribles & Sanctuary Lamp
    swingingThuribles.forEach(th => {
      th.group.rotation.x = Math.sin(elapsed * th.speed + th.phase) * th.ampX;
      th.group.rotation.z = Math.cos(elapsed * th.speed * 0.8 + th.phase) * th.ampZ;
    });

    // 4. Flickering Altar Candlesticks
    candleFlames.forEach(cf => {
      const flicker =
        0.88 +
        Math.sin(elapsed * 14 + cf.phase) * 0.14 +
        Math.cos(elapsed * 23 + cf.phase) * 0.08;
      cf.mesh.scale.set(1, flicker, 1);
      cf.mesh.position.y = cf.baseY + (flicker - 1) * 0.05;
    });
    altarWarmLight.intensity = 1.4 + Math.sin(elapsed * 9.5) * 0.12;

    // 5. Dust and Incense Motes
    updateDust(dt, elapsed);

    // 6. Physics Shards & Shockwaves
    shatterSystem.update(dt);

    renderer.render(scene, camera);
  }

  animateLoop();
}

// Launch on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
