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
import { RenderGovernor } from './graphics/renderGovernor';
import { ShatterSystem } from './graphics/shatter';
import { CameraController } from './interaction/camera';
import { PocketBaseChessClient } from './realtime/pocketbaseClient';
import {
  auditEncryptedStorage
} from './storage/indexedDbStore';
import { chessStore, INITIAL_BOARD_FEN } from './store/chessStore';
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
import {
  BlackjackEngine,
  evaluateHand,
  type BlackjackAIModel,
  type BlackjackDifficulty
} from './games/blackjack/blackjackEngine';
import {
  CathedralPokerEngine,
  evaluatePokerHand,
  type PokerPlayerData
} from './games/poker/pokerEngine';
import {
  SkipBoEngine
} from './games/skipbo/skipboEngine';
import {
  Phase10Engine,
  PHASE_10_REQUIREMENTS
} from './games/phase10/phase10Engine';
import {
  CardinalUnoEngine,
  type UnoColor
} from './games/uno/unoEngine';
import {
  AvalonEngine
} from './games/avalon/avalonEngine';
import {
  SetEngine,
  type SetCard
} from './games/set/setEngine';
import { ArcadeRealtimeClient } from './realtime/arcadeRealtimeClient';
import {
  ArcadeGameEnum,
  GameCodePrefixEnum,
  PokerVariantEnum,
  PokerActionEnum,
  PokerStageEnum,
  SkipBoSourcePileEnum,
  SkipBoCardTypeEnum
} from './constants/gameEnums';
import {
  ARCADE_GAMES,
  extractSessionCodeOrUrl,
  resolveRoute,
  type ArcadeGameType
} from './routing/sessionRouter';
import { domById, fromNullable, match, matchBool } from './utils/fp';
import { logExecutionContext, logger } from './utils/logger';
import { isDevMode } from './utils/env';

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
  let matchStarted = false;
  let settingsSnapshotOnOpen: MatchSettingsSnapshot = {
    mode: currentMode,
    difficulty: currentDifficulty,
    allowUndo
  };
  let persistenceEnabled = true;
  let useActionCam = true;
  let pendingPromotionMove: { from: string; to: string } | null = null;
  let activeRealtimeClient: PocketBaseChessClient | null = null;
  let liveUserRole: 'white' | 'black' | 'spectator' = 'white';

  // Display settings (in-memory + persisted in IndexedDB when session persistence is enabled)
  const displaySettings = getDisplaySettings();
  applyDisplaySettings(displaySettings, renderer, hemiLight, boardKeyLight, container);

  async function persistCurrentSession(): Promise<void> {
    if (!persistenceEnabled) return;
    chessStore.setState({
      fen: chess.fen(),
      history: [...chess.history()],
      mode: currentMode as GameModeEnum,
      difficulty: currentDifficulty as OpponentDifficultyEnum,
      allowUndo,
      theme: currentTheme as ChessThemeEnum,
      contrast: displaySettings.contrast,
      brightness: displaySettings.brightness,
      deviceTier: deviceProfile.tier,
      persistenceEnabled,
      useActionCam,
      gameStarted: matchStarted || chess.history().length > 0
    });
    await chessStore.saveToStorage();
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
    renderer.shadowMap.needsUpdate = true;
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
      matchBool(currentMode === GameModeEnum.Live, {
        true: () => {
          btn.title = 'Live Multiplayer Match Active: Opponent mode locked to remote peer';
          btn.classList.add('opacity-75', 'cursor-not-allowed', 'border-sky-400/50');
        },
        false: () => {
          btn.title = `${modeCfg.label}: ${modeCfg.description} (Click to cycle)`;
          btn.classList.remove('opacity-75', 'cursor-not-allowed', 'border-sky-400/50');
        }
      });
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
        [GameModeEnum.GeminiNano]: () => diffCfg.badge,
        [GameModeEnum.Live]: () => 'Live Peer'
      });
    });
    fromNullable(document.getElementById('difficulty-icon')).map(el => {
      el.textContent = match(currentMode as GameModeEnum, {
        [GameModeEnum.PassAndPlay]: () => 'group',
        [GameModeEnum.Minimax]: () => diffCfg.icon,
        [GameModeEnum.MicroNeural]: () => diffCfg.icon,
        [GameModeEnum.GeminiNano]: () => diffCfg.icon,
        [GameModeEnum.Live]: () => 'sensors'
      });
    });
    fromNullable(document.getElementById('btn-difficulty')).map(btn => {
      matchBool(currentMode === GameModeEnum.PassAndPlay || currentMode === GameModeEnum.Live, {
        true: () => {
          btn.classList.add('opacity-50');
          btn.title = currentMode === GameModeEnum.Live ? 'Live match: Opponent is remote human' : 'Pass & Play mode: Both sides controlled by humans';
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

    // Active Live Session lock state & banner toggle
    const isLiveActive = currentMode === GameModeEnum.Live;
    const currentLiveInfo = chessStore.getState().liveSession;
    ui.setLiveMatchActive(isLiveActive, currentLiveInfo?.sessionCode, currentLiveInfo?.doNotDelete);

    // Pre-game mode selection cards highlight & lock
    document.querySelectorAll('.mode-select-card').forEach(card => {
      const cardMode = card.getAttribute('data-mode-select');
      const isSelected = cardMode === currentMode;

      matchBool(isLiveActive, {
        true: () => {
          matchBool(cardMode === 'live', {
            true: () => {
              card.classList.add('border-sky-400/80', 'bg-sky-400/20');
              card.classList.remove(
                'border-white/10',
                'border-amber-400/70',
                'bg-amber-400/15',
                'opacity-30',
                'cursor-not-allowed',
                'pointer-events-none'
              );
              (card as HTMLButtonElement).disabled = false;
            },
            false: () => {
              card.classList.remove(
                'border-amber-400/70',
                'bg-amber-400/15',
                'border-sky-400/80',
                'bg-sky-400/20'
              );
              card.classList.add(
                'border-white/10',
                'opacity-30',
                'cursor-not-allowed',
                'pointer-events-none'
              );
              (card as HTMLButtonElement).disabled = true;
              card.setAttribute(
                'title',
                'Opponent mode locked during active Live Multiplayer Match'
              );
            }
          });
        },
        false: () => {
          card.classList.remove('opacity-30', 'cursor-not-allowed', 'pointer-events-none');
          (card as HTMLButtonElement).disabled = false;
          card.removeAttribute('title');
          card.classList.toggle('border-amber-400/70', isSelected);
          card.classList.toggle('bg-amber-400/15', isSelected);
          card.classList.toggle('border-white/10', !isSelected);
        }
      });
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
      sec.classList.toggle('opacity-55', currentMode === GameModeEnum.PassAndPlay || currentMode === GameModeEnum.Live);
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
    updateHighlights();
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

    // Fast-path: When tab is in the background (hidden), requestAnimationFrame is paused
    if (typeof document !== 'undefined' && document.hidden) {
      attacker.position.copy(endPos);
      attacker.rotation.x = 0;
      attacker.rotation.y = attacker.userData.baseRotY;
      if (attacker.userData.weaponGroup) {
        attacker.userData.weaponGroup.rotation.set(0, 0, 0);
      }
      if (isCapture && victim) {
        scene.remove(victim);
        delete pieceMap[victimSquare];
      }
      finishMoveState(moveObj, attacker, savedCamState, onComplete);
      return;
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

  function triggerGameOverUI(): void {
    const isLive = currentMode === GameModeEnum.Live;
    const sessionCode = chessStore.getState().liveSession?.sessionCode;
    ui.showGameOver(chess, isLive, sessionCode);
  }

  function triggerTurnOrAI(): void {
    if (chess.game_over()) {
      soundFX.playCathedralOrganAndBell();
      triggerGameOverUI();
      return;
    }

    if (
      currentMode !== GameModeEnum.PassAndPlay &&
      currentMode !== GameModeEnum.Live &&
      chess.turn() === PieceColorEnum.Black &&
      !isAnimating
    ) {
      setTimeout(async () => {
        const aiMove = await match(currentMode as GameModeEnum, {
          [GameModeEnum.PassAndPlay]: async () => null,
          [GameModeEnum.Live]: async () => null,
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
                triggerGameOverUI();
              } else {
                syncAllControlsUI();
              }
            });
          });
      }, 480);
    }
  }

  function executeMoveOnBoard(
    moveAttempt: {
      from: string;
      to: string;
      promotion?: string;
    } | string,
    isRemote: boolean = false
  ): void {
    const executed = chess.move(moveAttempt);
    if (!executed) return;

    selectedSquare = null;
    legalMovesForSelected = [];
    updateHighlights();
    void persistCurrentSession();

    if (!isRemote && currentMode === GameModeEnum.Live && activeRealtimeClient) {
      void activeRealtimeClient.submitMove(executed.san, {
        ply: chess.history().length,
        color: executed.color,
        from: executed.from,
        to: executed.to,
        promotion: executed.promotion,
        fenAfter: chess.fen(),
        capturedPiece: executed.captured,
        isCheck: chess.in_check(),
        isCheckmate: chess.in_checkmate()
      });
    }

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
    if (currentMode === GameModeEnum.Live) {
      const myTurn = liveUserRole === 'white' ? PieceColorEnum.White : (liveUserRole === 'black' ? PieceColorEnum.Black : null);
      if (!myTurn || chess.turn() !== myTurn) {
        ui.showTemporaryBanner(
          liveUserRole === 'spectator'
            ? 'Spectator mode: board interactions disabled.'
            : `Waiting for ${chess.turn() === PieceColorEnum.White ? 'White Marble' : 'Black Obsidian'} to move...`,
          1500
        );
        return;
      }
    } else if (currentMode !== GameModeEnum.PassAndPlay && chess.turn() === PieceColorEnum.Black) {
      return;
    }

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
    if (currentMode === GameModeEnum.Live && nextMode !== GameModeEnum.Live) {
      ui.showTemporaryBanner(
        'Live Multiplayer Match active. Opponent mode is locked to preserve session integrity.',
        3200
      );
      return;
    }

    if (nextMode === GameModeEnum.Live) {
      ui.showLiveSessionModal();
      return;
    }

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
    if (activeRealtimeClient) {
      activeRealtimeClient.disconnect();
      activeRealtimeClient = null;
    }
    chessStore.setState({ liveSession: undefined });
    if (window.location.search) {
      window.history.replaceState(null, '', window.location.pathname);
    }
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
  function selectTheme(nextTheme: ChessThemeEnum, isRemote: boolean = false): void {
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

    if (!isRemote && currentMode === GameModeEnum.Live && activeRealtimeClient) {
      void activeRealtimeClient.changeTheme(currentTheme);
    }

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
      if (currentMode !== GameModeEnum.Live && activeRealtimeClient) {
        activeRealtimeClient.disconnect();
        activeRealtimeClient = null;
      }
      if (currentMode !== GameModeEnum.Live) {
        chessStore.setState({ liveSession: undefined });
        if (window.location.search) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
      chess.reset();
      allowUndo = pendingAllowUndo;
      matchStarted = true;
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
        matchStarted = true;
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
        if (currentMode === GameModeEnum.Live && modeAttr !== GameModeEnum.Live) {
          ui.showTemporaryBanner(
            'Live Multiplayer Match active. Opponent mode is locked to preserve session integrity.',
            3200
          );
          return;
        }
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
    await chessStore.setPersistence(enabled);
    matchBool(enabled, {
      true: () => {
        ui.showTemporaryBanner('Encrypted session persistence active in IndexedDB', 2400);
      },
      false: () => {
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
    const result = await chessStore.wipeAll();
    result.match({
      Ok: () => {
        chess.reset();
        if (activeRealtimeClient) {
          activeRealtimeClient.disconnect();
          activeRealtimeClient = null;
        }
        if (window.location.search) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        selectedSquare = null;
        legalMovesForSelected = [];
        matchStarted = false;
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
      if (currentMode === GameModeEnum.Live) {
        ui.showTemporaryBanner(
          'Live Multiplayer Match active. Conclude or exit match before changing opponent mode.',
          3000
        );
        return;
      }
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
      matchBool(currentMode === GameModeEnum.PassAndPlay || currentMode === GameModeEnum.Live, {
        true: () => {
          ui.showTemporaryBanner(
            currentMode === GameModeEnum.Live
              ? 'Live Match: Opponent is a remote human'
              : 'Pass & Play: Two human players duel directly',
            2200
          );
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
      if (currentMode === GameModeEnum.Live) {
        ui.showTemporaryBanner('Undo is disabled in Live Multiplayer matches.', 2500);
        return;
      }
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

  function initRealtimeClient(sessionId: string, participantId: string, token: string): void {
    if (activeRealtimeClient) {
      activeRealtimeClient.disconnect();
    }

    activeRealtimeClient = new PocketBaseChessClient({
      sessionId,
      participantId,
      token,
      onOpen: () => {
        matchBool(isDevMode(), {
          true: () => logger.info('[LIVE] Connected to PocketHost Live Session SSE stream', { sessionId }),
          false: () => logger.info('Connected to live multiplayer match stream.')
        });
        ui.showTemporaryBanner('🟢 Connected to Live Session SSE stream', 2500);
      },
      onPlayerJoined: data => {
        const p = data as { displayName: string; role: string };
        ui.showTemporaryBanner(
          `Opponent ${p.displayName} entered match as ${String(p.role).toUpperCase()}!`,
          3500
        );
        soundFX.playCathedralOrganAndBell();
        ui.hideLiveSessionModal();
      },
      onMove: data => {
        const myColor = liveUserRole === 'white' ? 'w' : (liveUserRole === 'black' ? 'b' : null);
        const m = data as { color: 'w' | 'b'; uci?: string; san?: string };
        if (m.color !== myColor) {
          const moveCandidate = (m.uci && m.uci.length >= 4)
            ? { from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] || undefined }
            : (m.san || '');
          executeMoveOnBoard(moveCandidate, true);
        }
      },
      onThemeChanged: data => {
        const t = data as { theme: string };
        const theme = t.theme as ChessThemeEnum;
        if (theme && theme !== currentTheme) {
          selectTheme(theme, true);
          ui.showTemporaryBanner(`Live Theme Synchronized: ${theme}`, 2500);
        }
      },
      onGameOver: data => {
        const g = data as { reason?: string };
        triggerGameOverUI();
        ui.showTemporaryBanner(`Match Concluded: ${g.reason || 'Game Over'}`, 4000);
      }
    });

    activeRealtimeClient.on('session_updated', data => {
      const s = data as { fen?: string; last_move_san?: string; status?: string };
      if (s?.fen && s.fen !== chess.fen()) {
        matchBool(isDevMode(), {
          true: () => logger.info('[LIVE] Synchronizing authoritative board state from session_updated FEN:', s.fen),
          false: () => logger.info('Synchronizing board state from live match.')
        });
        chess.load(s.fen);
        syncBoardPiecesWithChessState();
        updateHighlights();
        syncAllControlsUI();
        if (chess.in_check()) soundFX.playCathedralOrganAndBell();
        if (chess.game_over()) triggerGameOverUI();
      }
    });

    void activeRealtimeClient.connect();
  }

  // Live Multiplayer Modal & Controls
  fromNullable(document.getElementById('btn-live')).map(btn =>
    btn.addEventListener('click', () => ui.showLiveSessionModal())
  );
  fromNullable(document.getElementById('close-live-session-btn')).map(btn =>
    btn.addEventListener('click', () => ui.hideLiveSessionModal())
  );
  fromNullable(document.getElementById('tab-create-live')).map(btn =>
    btn.addEventListener('click', () => ui.switchLiveSessionTab('create'))
  );
  fromNullable(document.getElementById('tab-join-live')).map(btn =>
    btn.addEventListener('click', () => ui.switchLiveSessionTab('join'))
  );

  fromNullable(document.getElementById('btn-create-live-session')).map(btn =>
    btn.addEventListener('click', async () => {
      const hostNameInput = document.getElementById('live-host-name') as HTMLInputElement | null;
      const hostRoleSelect = document.getElementById('live-host-role') as HTMLSelectElement | null;
      const hostUndoSelect = document.getElementById('live-host-undo') as HTMLSelectElement | null;
      const hostDoNotDeleteInput = document.getElementById('live-host-do-not-delete') as HTMLInputElement | null;
      const isDoNotDelete = Boolean(hostDoNotDeleteInput?.checked);
      const createBtn = btn as HTMLButtonElement;
      createBtn.disabled = true;
      createBtn.textContent = 'Generating Secure Session...';

      const roleChoice = (hostRoleSelect?.value as 'white' | 'black') || 'white';
      const res = await PocketBaseChessClient.createSession('', {
        playerName: hostNameInput?.value || 'White Marble Host',
        role: roleChoice === 'white' ? 'w' : 'b',
        theme: currentTheme,
        timerRule: 'none',
        strictMode: hostUndoSelect?.value !== 'true',
        doNotDelete: isDoNotDelete,
        mode: 'live'
      });

      createBtn.disabled = false;
      createBtn.innerHTML =
        '<span class="material-symbols-rounded text-sm">rocket_launch</span><span>Generate Secure Live Session</span>';

      res.match({
        Ok: session => {
          chess.reset();
          syncBoardPiecesWithChessState();
          updateHighlights();
          currentMode = GameModeEnum.Live;
          liveUserRole = session.assignedRole as 'white' | 'black';
          if (liveUserRole === 'black') {
            camController.camState.theta = Math.PI;
          } else {
            camController.camState.theta = 0;
          }
          syncAllControlsUI();
          const inviteUrl = `${window.location.origin}${window.location.pathname}?session=${session.sessionCode}`;
          ui.showLiveCreatedSession(session.sessionCode, inviteUrl);
          ui.showTemporaryBanner(
            `Session ${session.sessionCode} ready! Copy and share the match invite link.`,
            3500
          );
          window.history.replaceState(null, '', `?session=${session.sessionCode}`);
          chessStore.setState({
            mode: GameModeEnum.Live,
            fen: chess.fen(),
            history: chess.history(),
            liveSession: {
              sessionCode: session.sessionCode,
              sessionId: session.sessionId,
              participantId: session.participantId,
              token: session.token,
              role: session.assignedRole as 'white' | 'black',
              playerName: hostNameInput?.value || 'White Marble Host',
              doNotDelete: isDoNotDelete
            }
          });
          void persistCurrentSession();
          initRealtimeClient(session.sessionId, session.participantId, session.token);
        },
        Err: err => {
          ui.showTemporaryBanner(`Failed to create live session: ${err.message}`, 4000);
        }
      });
    })
  );

  fromNullable(document.getElementById('btn-join-live-session')).map(btn =>
    btn.addEventListener('click', async () => {
      const joinCodeInput = document.getElementById('live-join-code') as HTMLInputElement | null;
      const joinNameInput = document.getElementById('live-join-name') as HTMLInputElement | null;
      const joinRoleSelect = document.getElementById('live-join-role') as HTMLSelectElement | null;
      const code = (joinCodeInput?.value || '').trim().toUpperCase();
      const name = (joinNameInput?.value || '').trim() || 'Visiting Challenger';
      const role = (joinRoleSelect?.value as 'white' | 'black' | 'spectator') || undefined;

      if (!code) {
        ui.showLiveJoinError('Please enter a valid session code (e.g. SANCT-XXXX).');
        return;
      }

      const joinBtn = btn as HTMLButtonElement;
      joinBtn.disabled = true;
      joinBtn.textContent = 'Connecting to Session...';
      ui.clearLiveJoinError();

      const res = await PocketBaseChessClient.joinSession('', {
        sessionCode: code,
        displayName: name,
        preferredRole: role === 'spectator' ? 'spectator' : (role === 'white' ? 'w' : (role === 'black' ? 'b' : undefined))
      });

      joinBtn.disabled = false;
      joinBtn.innerHTML =
        '<span class="material-symbols-rounded text-sm">login</span><span>Connect & Join Sanctuary Match</span>';

      res.match({
        Ok: session => {
          liveUserRole = session.assignedRole;
          currentMode = GameModeEnum.Live;
          if (liveUserRole === 'black') {
            camController.camState.theta = Math.PI;
          } else if (liveUserRole === 'white') {
            camController.camState.theta = 0;
          }
          currentTheme = (session.theme as ChessThemeEnum) || currentTheme;
          applyThemePalette(currentTheme, materials, squareMeshes, {
            scene,
            hemiLight,
            altarWarmLight,
            strikeFlashLight
          });

          if (session.fen && session.fen.trim()) {
            chess.load(session.fen);
          }
          syncBoardPiecesWithChessState();
          updateHighlights();
          syncAllControlsUI();
          ui.hideLiveSessionModal();
          ui.showTemporaryBanner(
            `Joined Live Match ${code} as ${session.assignedRole.toUpperCase()}!`,
            3500
          );
          window.history.replaceState(null, '', `?session=${code}`);
          chessStore.setState({
            mode: GameModeEnum.Live,
            fen: chess.fen(),
            history: chess.history(),
            liveSession: {
              sessionCode: code,
              sessionId: session.sessionId,
              participantId: session.participantId,
              token: session.token,
              role: session.assignedRole,
              playerName: name
            }
          });
          void persistCurrentSession();

          initRealtimeClient(session.sessionId, session.participantId, session.token);
        },
        Err: err => {
          ui.showLiveJoinError(`Could not join session: ${err.message}`);
        }
      });
    })
  );

  fromNullable(document.getElementById('btn-enter-live-match')).map(btn =>
    btn.addEventListener('click', () => {
      currentMode = GameModeEnum.Live;
      syncAllControlsUI();
      ui.hideLiveSessionModal();
      ui.showTemporaryBanner('Entered Live Sanctuary. Awaiting opponent move/connection.', 3000);
    })
  );

  const toggleDoNotDeleteHandler = async () => {
    const state = chessStore.getState();
    if (!state.liveSession) return;
    const currentPinned = Boolean(state.liveSession.doNotDelete);
    const nextPinned = !currentPinned;

    ui.setDoNotDeleteState(nextPinned);
    soundFX.playSelect();

    if (activeRealtimeClient) {
      await activeRealtimeClient.setDoNotDelete(nextPinned);
    } else {
      await PocketBaseChessClient.setSessionDoNotDelete('', state.liveSession.sessionId, nextPinned);
    }

    chessStore.setState({
      liveSession: {
        ...state.liveSession,
        doNotDelete: nextPinned
      }
    });
    void persistCurrentSession();

    if (nextPinned) {
      ui.showTemporaryBanner('Match protected: will NOT be auto-deleted by cleanup cron.', 3500);
    } else {
      ui.showTemporaryBanner('Match unpinned: will follow standard 3-day cleanup.', 3500);
    }
  };

  fromNullable(document.getElementById('btn-toggle-do-not-delete')).map(btn =>
    btn.addEventListener('click', toggleDoNotDeleteHandler)
  );

  fromNullable(document.getElementById('btn-persistent-toggle-pin')).map(btn =>
    btn.addEventListener('click', toggleDoNotDeleteHandler)
  );

  const getActiveLiveSessionCode = (): string | null => {
    const fromStore = chessStore.getState().liveSession?.sessionCode;
    if (fromStore) return fromStore;
    const persistentEl = document.getElementById('live-persistent-code');
    if (persistentEl?.textContent && persistentEl.textContent !== 'SANCT-XXXX') {
      return persistentEl.textContent.trim();
    }
    const bannerEl = document.getElementById('live-active-code');
    if (bannerEl?.textContent && bannerEl.textContent !== 'SANCT-XXXX') {
      return bannerEl.textContent.trim();
    }
    return null;
  };

  const copyLiveSessionLink = async (isPersistent: boolean) => {
    const code = getActiveLiveSessionCode();
    if (!code) return;
    const url = `${window.location.origin}${window.location.pathname}?session=${code}`;
    await navigator.clipboard.writeText(url);
    soundFX.playSelect();
    if (isPersistent) {
      ui.setPersistentCopyLinkCopied(true);
      setTimeout(() => ui.setPersistentCopyLinkCopied(false), 2000);
    } else {
      ui.setBannerCopyLinkCopied(true);
      setTimeout(() => ui.setBannerCopyLinkCopied(false), 2000);
    }
    ui.showTemporaryBanner('Match Invite Link copied to clipboard! Share it with your opponent.', 3000);
  };

  fromNullable(document.getElementById('btn-persistent-copy-link')).map(btn =>
    btn.addEventListener('click', () => void copyLiveSessionLink(true))
  );

  fromNullable(document.getElementById('btn-live-banner-copy-link')).map(btn =>
    btn.addEventListener('click', () => void copyLiveSessionLink(false))
  );

  fromNullable(document.getElementById('btn-persistent-copy-code')).map(btn =>
    btn.addEventListener('click', async () => {
      const code = getActiveLiveSessionCode();
      if (!code) return;
      await navigator.clipboard.writeText(code);
      soundFX.playSelect();
      ui.showTemporaryBanner(`Match Code ${code} copied to clipboard!`, 2000);
    })
  );

  const handleLeaveLiveMatch = () => {
    if (activeRealtimeClient) {
      activeRealtimeClient.disconnect();
      activeRealtimeClient = null;
    }
    currentMode = GameModeEnum.Minimax;
    liveUserRole = 'white';
    chessStore.setState({ mode: GameModeEnum.Minimax, liveSession: undefined });
    if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    chess.reset();
    syncBoardPiecesWithChessState();
    updateHighlights();
    syncAllControlsUI();
    void persistCurrentSession();
    ui.hideLiveSessionModal();
    ui.hideGameOver();
    soundFX.playSelect();
    ui.showTemporaryBanner('Exited Live Match. Opponent mode restored to Minimax Engine.', 3500);
  };

  fromNullable(document.getElementById('btn-leave-live-session')).map(btn =>
    btn.addEventListener('click', handleLeaveLiveMatch)
  );

  fromNullable(document.getElementById('modal-leave-live')).map(btn =>
    btn.addEventListener('click', handleLeaveLiveMatch)
  );

  fromNullable(document.getElementById('btn-persistent-leave-live')).map(btn =>
    btn.addEventListener('click', handleLeaveLiveMatch)
  );

  fromNullable(document.getElementById('modal-inspect-live')).map(btn =>
    btn.addEventListener('click', () => {
      ui.hideGameOver();
      ui.showTemporaryBanner('Match concluded. Click "Exit" on the top HUD bar to leave match.', 3500);
    })
  );

  fromNullable(document.getElementById('btn-copy-code')).map(btn =>
    btn.addEventListener('click', async () => {
      const codeEl = document.getElementById('live-created-code');
      if (codeEl?.textContent) {
        await navigator.clipboard.writeText(codeEl.textContent.trim());
        ui.showTemporaryBanner('Session Code copied to clipboard!', 2000);
      }
    })
  );

  fromNullable(document.getElementById('btn-copy-link')).map(btn =>
    btn.addEventListener('click', async () => {
      const urlInput = document.getElementById('live-created-url') as HTMLInputElement | null;
      const codeEl = document.getElementById('live-created-code');
      const url =
        urlInput?.value ||
        (codeEl?.textContent
          ? `${window.location.origin}${window.location.pathname}?session=${codeEl.textContent.trim()}`
          : '');
      if (url) {
        await navigator.clipboard.writeText(url);
        ui.showTemporaryBanner('Match Invite Link copied to clipboard! Share it with your opponent.', 3000);
      }
    })
  );

  // Close dialog modals on clicking outside their modal card (backdrop click)
  [
    {
      id: 'pregame-modal',
      close: () => {
        modalOpenedFromReset = false;
        ui.hidePreGameModal();
      }
    },
    {
      id: 'live-session-modal',
      close: () => ui.hideLiveSessionModal()
    },
    {
      id: 'storage-audit-modal',
      close: () => ui.hideStorageAuditModal()
    },
    {
      id: 'arcade-hub-modal',
      close: () => ui.hideArcadeHub()
    },
    {
      id: 'blackjack-modal',
      close: () => ui.hideBlackjack()
    },
    {
      id: 'poker-modal',
      close: () => ui.hidePoker()
    },
    {
      id: 'skipbo-modal',
      close: () => ui.hideSkipBo()
    },
    {
      id: 'phase10-modal',
      close: () => ui.hidePhase10()
    },
    {
      id: 'uno-modal',
      close: () => ui.hideUno()
    },
    {
      id: 'avalon-modal',
      close: () => ui.hideAvalon()
    },
    {
      id: 'set-modal',
      close: () => ui.hideSet()
    }
  ].forEach(({ id, close }) => {
    fromNullable(document.getElementById(id)).map(modalEl => {
      modalEl.addEventListener('click', (e: MouseEvent) => {
        if (e.target === modalEl) {
          close();
        }
      });
    });
  });

  // Sanctuary Arcade Hub Modal & Quick Join Controls
  fromNullable(document.getElementById('btn-arcade-hub')).map(btn =>
    btn.addEventListener('click', () => {
      ui.clearHubQuickJoinFeedback();
      ui.showArcadeHub();
    })
  );

  fromNullable(document.getElementById('btn-close-arcade-hub')).map(btn =>
    btn.addEventListener('click', () => ui.hideArcadeHub())
  );

  fromNullable(document.getElementById('btn-close-blackjack')).map(btn =>
    btn.addEventListener('click', () => ui.hideBlackjack())
  );

  fromNullable(document.getElementById('btn-close-poker')).map(btn =>
    btn.addEventListener('click', () => ui.hidePoker())
  );

  fromNullable(document.getElementById('btn-close-skipbo')).map(btn =>
    btn.addEventListener('click', () => ui.hideSkipBo())
  );

  fromNullable(document.getElementById('btn-close-phase10')).map(btn =>
    btn.addEventListener('click', () => ui.hidePhase10())
  );

  fromNullable(document.getElementById('btn-close-uno')).map(btn =>
    btn.addEventListener('click', () => ui.hideUno())
  );

  fromNullable(document.getElementById('btn-close-avalon')).map(btn =>
    btn.addEventListener('click', () => ui.hideAvalon())
  );

  fromNullable(document.getElementById('btn-close-set')).map(btn =>
    btn.addEventListener('click', () => ui.hideSet())
  );

  // Fullscreen Table Toggles
  const setupFullscreenToggle = (buttonId: string,
                                 modalId: string) => {
    fromNullable(document.getElementById(buttonId)).map(btn => {
      btn.addEventListener('click', () => {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        if (!document.fullscreenElement) {
          modal.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    });
  };

  setupFullscreenToggle('btn-bjk-fullscreen', 'blackjack-modal');
  setupFullscreenToggle('btn-poker-fullscreen', 'poker-modal');
  setupFullscreenToggle('btn-skipbo-fullscreen', 'skipbo-modal');
  setupFullscreenToggle('btn-phase10-fullscreen', 'phase10-modal');
  setupFullscreenToggle('btn-uno-fullscreen', 'uno-modal');
  setupFullscreenToggle('btn-avalon-fullscreen', 'avalon-modal');
  setupFullscreenToggle('btn-set-fullscreen', 'set-modal');

  document.addEventListener('fullscreenchange', () => {
    const isFs = !!document.fullscreenElement;
    [
      'btn-bjk-fullscreen',
      'btn-poker-fullscreen',
      'btn-skipbo-fullscreen',
      'btn-phase10-fullscreen',
      'btn-uno-fullscreen',
      'btn-avalon-fullscreen',
      'btn-set-fullscreen'
    ].forEach(id => {
      fromNullable(document.getElementById(id)).map(btn => {
        btn.innerHTML = `<span class="material-symbols-rounded text-lg">${isFs ? 'fullscreen_exit' : 'fullscreen'}</span>`;
      });
    });
  });

  // Gothic Blackjack Table Engine & Event Binding
  const bjkEngine = new BlackjackEngine(500, 'micro-neural', 'balanced');

  const renderBlackjackTable = () => {
    const s = bjkEngine.state;
    fromNullable(document.getElementById('bjk-bank-val')).map(el => {
      el.textContent = `${s.chipBank} Relics`;
    });
    fromNullable(document.getElementById('bjk-bet-val')).map(el => {
      el.textContent = `${s.currentBet}`;
    });
    fromNullable(document.getElementById('bjk-status-banner')).map(el => {
      el.textContent = s.historyText[s.historyText.length - 1] || 'Place bet to deal.';
      el.className =
        'p-3 sm:p-3.5 rounded-2xl border text-center text-sm sm:text-base font-cathedral font-bold tracking-wide transition shadow-lg ' +
        (s.outcome === 'player-won' || s.outcome === 'player-blackjack'
          ? 'bg-emerald-950/85 border-emerald-400/60 text-emerald-100'
          : s.outcome === 'player-busted' || s.outcome === 'dealer-won'
          ? 'bg-red-950/85 border-red-400/60 text-red-100'
          : 'bg-black/65 border-amber-400/40 text-amber-200');
    });

    fromNullable(document.getElementById('bjk-dealer-cards')).map(container => {
      if (s.dealerHand.length === 0) {
        container.innerHTML = '<span class="text-sm sm:text-base text-stone-400 italic">Place bet to deal</span>';
      } else {
        container.innerHTML = s.dealerHand
          .map(
            c => {
              const isRed = ['hearts', 'diamonds'].includes(c.suit);
              const suitSymbol = c.suit === 'hearts' ? '♥' : c.suit === 'diamonds' ? '♦' : c.suit === 'clubs' ? '♣' : '♠';
              return `
            <div class="playing-card-ui ${
              c.faceUp
                ? isRed
                  ? 'bg-gradient-to-b from-stone-50 to-stone-200 text-red-600 border-red-400/70 shadow-xl'
                  : 'bg-gradient-to-b from-stone-50 to-stone-200 text-stone-900 border-stone-400/70 shadow-xl'
                : 'bg-gradient-to-br from-purple-950 via-stone-900 to-purple-950 text-purple-300 border-purple-500/60 shadow-xl items-center justify-center font-cathedral text-4xl'
            }">
              ${
                c.faceUp
                  ? `
                <div class="playing-card-corner">
                  <span>${c.value}</span>
                  <span>${suitSymbol}</span>
                </div>
                <div class="playing-card-center">${suitSymbol}</div>
                <div class="playing-card-corner rotate-180">
                  <span>${c.value}</span>
                  <span>${suitSymbol}</span>
                </div>
              `
                  : '🂠'
              }
            </div>
          `;
            }
          )
          .join('');
      }
    });

    fromNullable(document.getElementById('bjk-dealer-total')).map(el => {
      const dEval = evaluateHand(s.dealerHand, true);
      el.textContent = s.stage === 'player-turn' ? `${dEval.total}+?` : `${evaluateHand(s.dealerHand).total}`;
    });

    fromNullable(document.getElementById('bjk-player-cards')).map(container => {
      if (s.playerHand.length === 0) {
        container.innerHTML = '<span class="text-sm sm:text-base text-stone-400 italic">No cards in play</span>';
      } else {
        container.innerHTML = s.playerHand
          .map(
            c => {
              const isRed = ['hearts', 'diamonds'].includes(c.suit);
              const suitSymbol = c.suit === 'hearts' ? '♥' : c.suit === 'diamonds' ? '♦' : c.suit === 'clubs' ? '♣' : '♠';
              return `
            <div class="playing-card-ui ${
              isRed
                ? 'bg-gradient-to-b from-stone-50 to-stone-200 text-red-600 border-red-400/70 shadow-xl'
                : 'bg-gradient-to-b from-stone-50 to-stone-200 text-stone-900 border-stone-400/70 shadow-xl'
            }">
              <div class="playing-card-corner">
                <span>${c.value}</span>
                <span>${suitSymbol}</span>
              </div>
              <div class="playing-card-center">${suitSymbol}</div>
              <div class="playing-card-corner rotate-180">
                <span>${c.value}</span>
                <span>${suitSymbol}</span>
              </div>
            </div>
          `;
            }
          )
          .join('');
      }
    });

    fromNullable(document.getElementById('bjk-player-total')).map(el => {
      el.textContent = `${evaluateHand(s.playerHand).total}`;
    });

    const isPlaying = s.stage === 'player-turn';
    fromNullable(document.getElementById('bjk-btn-deal') as HTMLButtonElement | null).map(btn => {
      btn.disabled = isPlaying;
    });
    fromNullable(document.getElementById('bjk-btn-hit') as HTMLButtonElement | null).map(btn => {
      btn.disabled = !isPlaying;
    });
    fromNullable(document.getElementById('bjk-btn-stand') as HTMLButtonElement | null).map(btn => {
      btn.disabled = !isPlaying;
    });
    fromNullable(document.getElementById('bjk-btn-double') as HTMLButtonElement | null).map(btn => {
      btn.disabled = !isPlaying || s.playerHand.length !== 2 || s.chipBank < s.currentBet;
    });
  };

  fromNullable(document.getElementById('bjk-btn-deal')).map(btn =>
    btn.addEventListener('click', () => {
      bjkEngine.startRound();
      soundFX.playSelect();
      renderBlackjackTable();
    })
  );

  fromNullable(document.getElementById('bjk-btn-hit')).map(btn =>
    btn.addEventListener('click', () => {
      bjkEngine.hit();
      soundFX.playSelect();
      renderBlackjackTable();
    })
  );

  fromNullable(document.getElementById('bjk-btn-stand')).map(btn =>
    btn.addEventListener('click', () => {
      bjkEngine.stand();
      soundFX.playCathedralOrganAndBell();
      renderBlackjackTable();
    })
  );

  fromNullable(document.getElementById('bjk-btn-double')).map(btn =>
    btn.addEventListener('click', () => {
      bjkEngine.doubleDown();
      soundFX.playSelect();
      renderBlackjackTable();
    })
  );

  document.querySelectorAll('.bjk-bet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const amt = parseInt(btn.getAttribute('data-bet') || '25', 10);
      bjkEngine.placeBet(amt);
      soundFX.playSelect();
      renderBlackjackTable();
    });
  });

  fromNullable(document.getElementById('bjk-ai-select') as HTMLSelectElement | null).map(sel =>
    sel.addEventListener('change', () => {
      bjkEngine.setAIModel(sel.value as BlackjackAIModel);
      renderBlackjackTable();
    })
  );

  fromNullable(document.getElementById('bjk-diff-select') as HTMLSelectElement | null).map(sel =>
    sel.addEventListener('change', () => {
      bjkEngine.setDifficulty(sel.value as BlackjackDifficulty);
      renderBlackjackTable();
    })
  );

  // Common Arcade Live Session Sharing Helper
  const generateArcadeCode = (prefix: string) =>
    `${prefix}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  const copyArcadeMatchLink = (code: string, btnEl: HTMLElement | null) => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?session=${code}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      if (btnEl) {
        const originalText = btnEl.innerHTML;
        btnEl.innerHTML = '<span class="material-symbols-rounded text-xs">done</span><span>Copied!</span>';
        setTimeout(() => {
          btnEl.innerHTML = originalText;
        }, 2000);
      }
    });
  };

  // Active Arcade Real-Time Client for live multiplayer synchronization
  let activeArcadeClient: ArcadeRealtimeClient | null = null;

  const setupArcadeRealtimeSession = (
    game: ArcadeGameEnum,
    sessionCode: string,
    playerName: string = 'Cathedral Player',
    onAction?: (actionType: string, payload: unknown) => void
  ): ArcadeRealtimeClient => {
    if (activeArcadeClient) {
      activeArcadeClient.disconnect();
      activeArcadeClient = null;
    }

    const client = new ArcadeRealtimeClient({
      sessionCode,
      participantId: 'usr_' + Math.random().toString(36).substring(2, 9)
    });
    activeArcadeClient = client;

    // Register or auto-create arcade room on server
    fetch('/api/arcade/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game,
        sessionCode,
        creatorName: playerName
      })
    })
      .catch(() => {})
      .then(() => client.claimSeat(playerName))
      .then(() => {
        client.connect();
      })
      .catch(() => {});

    if (onAction) {
      client.on('action_dispatched', (evt: any) => {
        onAction(evt.actionType, evt.payload);
      });
    }

    return client;
  };

  // --- Gothic Blackjack Mode Switcher ---
  let bjkLiveCode = generateArcadeCode(GameCodePrefixEnum.Blackjack);
  const setBlackjackMode = (isLive: boolean) => {
    fromNullable(document.getElementById('bjk-live-session-info')).map(el => {
      if (isLive) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
    fromNullable(document.getElementById('bjk-live-code')).map(el => {
      el.textContent = bjkLiveCode;
    });
    fromNullable(document.getElementById('bjk-tab-ai')).map(btn => {
      btn.className = isLive
        ? 'px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-purple-300 font-bold text-[11px]'
        : 'px-2.5 py-1 rounded-xl bg-purple-600 text-white font-bold text-[11px]';
    });
    fromNullable(document.getElementById('bjk-tab-live')).map(btn => {
      btn.className = isLive
        ? 'px-2.5 py-1 rounded-xl bg-purple-600 text-white font-bold text-[11px]'
        : 'px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-purple-300 font-bold text-[11px]';
    });
  };
  fromNullable(document.getElementById('bjk-tab-ai')).map(b => b.addEventListener('click', () => setBlackjackMode(false)));
  fromNullable(document.getElementById('bjk-tab-live')).map(b => b.addEventListener('click', () => setBlackjackMode(true)));
  fromNullable(document.getElementById('btn-bjk-copy-link')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchLink(bjkLiveCode, b))
  );

  // =========================================================================
  // Cathedral Poker Engine & Table Controls
  // =========================================================================
  let pokerVariant = PokerVariantEnum.TexasHoldem;
  let pokerEngine = new CathedralPokerEngine(pokerVariant, 6, 10, 20);
  pokerEngine.populateBotOpponents();
  let pokerLiveCode = generateArcadeCode(GameCodePrefixEnum.Poker);

  const formatCardHtml = (card: { readonly suit: string; readonly value: string; readonly faceUp: boolean }) => {
    const isRed = ['hearts', 'diamonds'].includes(card.suit);
    const suitSymbol = card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠';
    return `
      <div class="playing-card-ui ${
        card.faceUp
          ? isRed
            ? 'bg-gradient-to-b from-stone-50 to-stone-200 text-red-600 border-red-400/70 shadow-xl'
            : 'bg-gradient-to-b from-stone-50 to-stone-200 text-stone-900 border-stone-400/70 shadow-xl'
          : 'bg-gradient-to-br from-amber-950 via-stone-900 to-amber-950 text-amber-300 border-amber-500/60 shadow-xl items-center justify-center font-cathedral text-4xl'
      }">
        ${
          card.faceUp
            ? `
          <div class="playing-card-corner">
            <span>${card.value}</span>
            <span>${suitSymbol}</span>
          </div>
          <div class="playing-card-center">${suitSymbol}</div>
          <div class="playing-card-corner rotate-180">
            <span>${card.value}</span>
            <span>${suitSymbol}</span>
          </div>
        `
            : '🂠'
        }
      </div>
    `;
  };

  const renderPokerTable = () => {
    const s = pokerEngine.state;
    fromNullable(document.getElementById('poker-pot-val')).map(el => {
      el.textContent = `$${s.pot}`;
    });
    fromNullable(document.getElementById('poker-current-bet-val')).map(el => {
      el.textContent = `Current Bet: $${s.currentBet}`;
    });
    fromNullable(document.getElementById('poker-stage-badge')).map(el => {
      el.textContent = s.stage;
    });
    fromNullable(document.getElementById('poker-status-banner')).map(el => {
      el.textContent = s.historyText[s.historyText.length - 1] || 'Select action.';
    });

    fromNullable(document.getElementById('poker-community-cards')).map(c => {
      if (s.communityCards.length === 0) {
        c.innerHTML = '<span class="text-sm sm:text-base text-stone-400 italic">No community cards yet</span>';
      } else {
        c.innerHTML = s.communityCards.map(formatCardHtml).join('');
      }
    });

    const seat1Opt = pokerEngine.seatManager.getSeat(1);
    const p1Data: PokerPlayerData = seat1Opt.match({
      Some: seat => seat.extraData,
      None: (): PokerPlayerData => ({ holeCards: [], currentBet: 0, chipBank: 1000, folded: false, isAllIn: false })
    });

    fromNullable(document.getElementById('poker-player-cards')).map(c => {
      if (p1Data.holeCards.length === 0) {
        c.innerHTML = '<span class="text-sm sm:text-base text-stone-400 italic">No hole cards dealt</span>';
      } else {
        c.innerHTML = p1Data.holeCards.map(formatCardHtml).join('');
      }
    });

    fromNullable(document.getElementById('poker-chip-bank')).map(el => {
      el.textContent = `$${p1Data.chipBank}`;
    });

    if (p1Data.holeCards.length > 0) {
      const combined = [...p1Data.holeCards, ...s.communityCards];
      const evaluated = evaluatePokerHand(combined, s.variant, p1Data.holeCards);
      fromNullable(document.getElementById('poker-hand-rank')).map(el => {
        el.textContent = evaluated.description;
      });
    }

    const canAct = s.stage !== PokerStageEnum.Lobby && s.stage !== PokerStageEnum.Settled && !p1Data.folded;
    fromNullable(document.getElementById('poker-btn-deal') as HTMLButtonElement | null).map(b => {
      b.disabled = s.stage !== PokerStageEnum.Lobby && s.stage !== PokerStageEnum.Settled;
    });
    fromNullable(document.getElementById('poker-btn-check') as HTMLButtonElement | null).map(b => {
      b.disabled = !canAct || p1Data.currentBet < s.currentBet;
    });
    fromNullable(document.getElementById('poker-btn-call') as HTMLButtonElement | null).map(b => {
      b.disabled = !canAct || p1Data.currentBet >= s.currentBet;
    });
    fromNullable(document.getElementById('poker-btn-raise') as HTMLButtonElement | null).map(b => {
      b.disabled = !canAct || p1Data.chipBank < 20;
    });
    fromNullable(document.getElementById('poker-btn-fold') as HTMLButtonElement | null).map(b => {
      b.disabled = !canAct;
    });
    fromNullable(document.getElementById('poker-btn-next-street') as HTMLButtonElement | null).map(b => {
      b.disabled = s.stage === PokerStageEnum.Lobby || s.stage === PokerStageEnum.Settled;
    });
    fromNullable(document.getElementById('poker-btn-draw-exchange') as HTMLButtonElement | null).map(b => {
      b.disabled = s.variant !== PokerVariantEnum.FiveCardDraw || s.stage === PokerStageEnum.Lobby || s.stage === PokerStageEnum.Settled;
    });
  };

  const setPokerMode = (isLive: boolean) => {
    fromNullable(document.getElementById('poker-live-session-info')).map(el => {
      if (isLive) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
    fromNullable(document.getElementById('poker-live-code')).map(el => {
      el.textContent = pokerLiveCode;
    });
    fromNullable(document.getElementById('poker-tab-ai')).map(btn => {
      btn.className = isLive
        ? 'px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-amber-300 font-bold text-[11px]'
        : 'px-2.5 py-1 rounded-xl bg-amber-500 text-stone-950 font-bold text-[11px]';
    });
    fromNullable(document.getElementById('poker-tab-live')).map(btn => {
      btn.className = isLive
        ? 'px-2.5 py-1 rounded-xl bg-amber-500 text-stone-950 font-bold text-[11px]'
        : 'px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-amber-300 font-bold text-[11px]';
    });
  };

  fromNullable(document.getElementById('poker-tab-ai')).map(b => b.addEventListener('click', () => setPokerMode(false)));
  fromNullable(document.getElementById('poker-tab-live')).map(b => b.addEventListener('click', () => setPokerMode(true)));
  fromNullable(document.getElementById('btn-poker-copy-link')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchLink(pokerLiveCode, b))
  );

  fromNullable(document.getElementById('poker-variant-select') as HTMLSelectElement | null).map(sel =>
    sel.addEventListener('change', () => {
      pokerVariant = sel.value as PokerVariantEnum;
      pokerEngine = new CathedralPokerEngine(pokerVariant, 6, 10, 20);
      pokerEngine.populateBotOpponents();
      renderPokerTable();
    })
  );

  fromNullable(document.getElementById('poker-btn-deal')).map(b =>
    b.addEventListener('click', () => {
      pokerEngine.startHand();
      soundFX.playSelect();
      renderPokerTable();
    })
  );

  fromNullable(document.getElementById('poker-btn-check')).map(b =>
    b.addEventListener('click', () => {
      pokerEngine.playerAction(1, PokerActionEnum.Check);
      soundFX.playSelect();
      renderPokerTable();
    })
  );

  fromNullable(document.getElementById('poker-btn-call')).map(b =>
    b.addEventListener('click', () => {
      pokerEngine.playerAction(1, PokerActionEnum.Call);
      soundFX.playSelect();
      renderPokerTable();
    })
  );

  fromNullable(document.getElementById('poker-btn-raise')).map(b =>
    b.addEventListener('click', () => {
      pokerEngine.playerAction(1, PokerActionEnum.Raise, pokerEngine.state.currentBet + 20);
      soundFX.playCathedralOrganAndBell();
      renderPokerTable();
    })
  );

  fromNullable(document.getElementById('poker-btn-fold')).map(b =>
    b.addEventListener('click', () => {
      pokerEngine.playerAction(1, PokerActionEnum.Fold);
      soundFX.playSelect();
      renderPokerTable();
    })
  );

  fromNullable(document.getElementById('poker-btn-next-street')).map(b =>
    b.addEventListener('click', () => {
      const stage = pokerEngine.state.stage;
      if (stage === PokerStageEnum.PreFlop) {
        pokerEngine.dealFlop();
      } else if (stage === PokerStageEnum.Flop) {
        pokerEngine.dealTurn();
      } else if (stage === PokerStageEnum.Turn) {
        pokerEngine.dealRiver();
      } else if (stage === PokerStageEnum.River) {
        pokerEngine.resolveShowdown();
      }
      soundFX.playSelect();
      renderPokerTable();
    })
  );

  fromNullable(document.getElementById('poker-btn-draw-exchange')).map(b =>
    b.addEventListener('click', () => {
      pokerEngine.drawCardsFiveCardDraw(1, [0, 1]);
      soundFX.playSelect();
      renderPokerTable();
    })
  );

  // =========================================================================
  // Sacred Skip-Bo Engine & Table Controls
  // =========================================================================
  let skipboEngine = new SkipBoEngine('Pilgrim', 'Cathedral Abbot', 15);
  let skipboLiveCode = generateArcadeCode(GameCodePrefixEnum.SkipBo);
  let selectedSkipBoSource: SkipBoSourcePileEnum = SkipBoSourcePileEnum.Hand;
  let selectedSkipBoIndex: number = 0;

  const renderSkipBoTable = () => {
    const s = skipboEngine.state;
    const p1 = s.players[0]!;
    const p2 = s.players[1]!;

    fromNullable(document.getElementById('skipbo-opp-stock')).map(el => {
      el.textContent = `${p2.stockpile.length} remaining`;
    });
    fromNullable(document.getElementById('skipbo-player-stock-count')).map(el => {
      el.textContent = `${p1.stockpile.length} remaining`;
    });
    fromNullable(document.getElementById('skipbo-draw-deck-count')).map(el => {
      el.textContent = `${s.drawPile.length} cards`;
    });
    fromNullable(document.getElementById('skipbo-status-banner')).map(el => {
      el.textContent = s.historyText[s.historyText.length - 1] || 'Play cards or discard.';
    });

    // 4 Building piles
    fromNullable(document.getElementById('skipbo-building-piles')).map(container => {
      container.innerHTML = s.buildingPiles
        .map((pile, idx) => {
          const top = pile.length > 0 ? pile[pile.length - 1] : null;
          const label = top ? (top.type === SkipBoCardTypeEnum.Wild ? 'WILD' : `${top.value}`) : 'Empty';
          const nextNeeded = pile.length < 12 ? pile.length + 1 : 'Done';
          return `
          <div data-skipbo-building="${idx}" class="p-4 sm:p-5 rounded-2xl bg-blue-950/75 border-2 border-blue-400/60 hover:border-blue-300 text-center cursor-pointer transition shadow-xl hover:-translate-y-1">
            <div class="flex items-center justify-between text-xs uppercase font-extrabold text-blue-200">
              <span>Pile ${idx + 1}</span>
              <span class="text-amber-300">Next: ${nextNeeded}</span>
            </div>
            <div class="text-3xl sm:text-4xl font-extrabold font-mono text-white my-2.5">${label}</div>
            <span class="text-xs text-stone-300 font-mono font-bold">(${pile.length}/12)</span>
          </div>
        `;
        })
        .join('');

      container.querySelectorAll('[data-skipbo-building]').forEach(pileEl => {
        pileEl.addEventListener('click', () => {
          const targetPile = parseInt(pileEl.getAttribute('data-skipbo-building') || '0', 10);
          skipboEngine.playToBuilding(selectedSkipBoSource, selectedSkipBoIndex, targetPile);
          soundFX.playSelect();
          renderSkipBoTable();
        });
      });
    });

    // Stockpile top card
    fromNullable(document.getElementById('skipbo-stockpile-top')).map(el => {
      if (p1.stockpile.length > 0) {
        const top = p1.stockpile[p1.stockpile.length - 1]!;
        el.textContent = top.type === SkipBoCardTypeEnum.Wild ? 'WILD' : `${top.value}`;
      } else {
        el.textContent = 'None';
      }
      el.onclick = () => {
        selectedSkipBoSource = SkipBoSourcePileEnum.Stockpile;
        selectedSkipBoIndex = 0;
        soundFX.playSelect();
        renderSkipBoTable();
      };
    });

    // Hand cards
    fromNullable(document.getElementById('skipbo-player-hand')).map(container => {
      container.innerHTML = p1.hand
        .map(
          (c, idx) => `
        <div data-skipbo-hand="${idx}" class="playing-card-ui items-center justify-between text-center cursor-pointer transition ${
          selectedSkipBoSource === SkipBoSourcePileEnum.Hand && selectedSkipBoIndex === idx
            ? 'card-selected bg-amber-400 text-stone-950 font-extrabold'
            : c.type === SkipBoCardTypeEnum.Wild
            ? 'bg-gradient-to-b from-amber-500 to-amber-700 text-stone-950 border-amber-300 hover:border-amber-200 shadow-xl'
            : 'bg-gradient-to-b from-stone-800 to-stone-900 text-stone-100 border-white/25 hover:border-blue-400 shadow-xl'
        }">
          <div class="text-xs uppercase font-extrabold opacity-85">${c.type === SkipBoCardTypeEnum.Wild ? 'Wild' : 'Number'}</div>
          <div class="playing-card-center font-mono font-extrabold my-1">${c.type === SkipBoCardTypeEnum.Wild ? '★' : c.value}</div>
          <div class="text-xs sm:text-sm font-mono font-extrabold opacity-85">${c.type === SkipBoCardTypeEnum.Wild ? 'W' : c.value}</div>
        </div>
      `
        )
        .join('');

      container.querySelectorAll('[data-skipbo-hand]').forEach(cardEl => {
        cardEl.addEventListener('click', () => {
          selectedSkipBoSource = SkipBoSourcePileEnum.Hand;
          selectedSkipBoIndex = parseInt(cardEl.getAttribute('data-skipbo-hand') || '0', 10);
          soundFX.playSelect();
          renderSkipBoTable();
        });
      });
    });

    // 4 Discard piles
    fromNullable(document.getElementById('skipbo-discard-piles')).map(container => {
      container.innerHTML = p1.discardPiles
        .map((pile, idx) => {
          const top = pile.length > 0 ? pile[pile.length - 1] : null;
          const val = top ? (top.type === SkipBoCardTypeEnum.Wild ? 'W' : `${top.value}`) : '—';
          return `
          <div data-skipbo-discard="${idx}" class="p-3 sm:p-3.5 rounded-xl bg-black/65 border-2 border-white/20 text-center cursor-pointer hover:border-purple-400 transition shadow-md">
            <span class="text-xs uppercase font-extrabold text-stone-300">D${idx + 1}</span>
            <div class="text-base sm:text-lg font-mono font-extrabold text-purple-200 mt-0.5">${val}</div>
          </div>
        `;
        })
        .join('');

      container.querySelectorAll('[data-skipbo-discard]').forEach(discEl => {
        discEl.addEventListener('click', () => {
          const discIdx = parseInt(discEl.getAttribute('data-skipbo-discard') || '0', 10);
          // If hand card selected -> discard to this pile and end turn
          if (selectedSkipBoSource === SkipBoSourcePileEnum.Hand) {
            skipboEngine.discardAndEndTurn(selectedSkipBoIndex, discIdx);
            soundFX.playCathedralOrganAndBell();
            renderSkipBoTable();
          } else {
            selectedSkipBoSource = SkipBoSourcePileEnum.Discard;
            selectedSkipBoIndex = discIdx;
            renderSkipBoTable();
          }
        });
      });
    });
  };

  const setSkipBoMode = (isLive: boolean) => {
    fromNullable(document.getElementById('skipbo-live-session-info')).map(el => {
      if (isLive) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
    fromNullable(document.getElementById('skipbo-live-code')).map(el => {
      el.textContent = skipboLiveCode;
    });
    fromNullable(document.getElementById('skipbo-tab-ai')).map(btn => {
      btn.className = isLive
        ? 'px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-blue-300 font-bold text-[11px]'
        : 'px-2.5 py-1 rounded-xl bg-blue-600 text-white font-bold text-[11px]';
    });
    fromNullable(document.getElementById('skipbo-tab-live')).map(btn => {
      btn.className = isLive
        ? 'px-2.5 py-1 rounded-xl bg-blue-600 text-white font-bold text-[11px]'
        : 'px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-blue-300 font-bold text-[11px]';
    });
  };

  fromNullable(document.getElementById('skipbo-tab-ai')).map(b => b.addEventListener('click', () => setSkipBoMode(false)));
  fromNullable(document.getElementById('skipbo-tab-live')).map(b => b.addEventListener('click', () => setSkipBoMode(true)));
  fromNullable(document.getElementById('btn-skipbo-copy-link')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchLink(skipboLiveCode, b))
  );

  fromNullable(document.getElementById('skipbo-btn-play-selected')).map(b =>
    b.addEventListener('click', () => {
      // Find lowest legal building pile
      let played = false;
      for (let p = 0; p < 4; p++) {
        const res = skipboEngine.playToBuilding(selectedSkipBoSource, selectedSkipBoIndex, p);
        if (res.isSuccess()) {
          soundFX.playSelect();
          played = true;
          break;
        }
      }
      if (!played) {
        skipboEngine.state.historyText.push('No building pile accepts this card currently.');
      }
      renderSkipBoTable();
    })
  );

  fromNullable(document.getElementById('skipbo-btn-discard-selected')).map(b =>
    b.addEventListener('click', () => {
      if (selectedSkipBoSource === SkipBoSourcePileEnum.Hand) {
        skipboEngine.discardAndEndTurn(selectedSkipBoIndex, 0);
        soundFX.playSelect();
        renderSkipBoTable();
      }
    })
  );

  fromNullable(document.getElementById('skipbo-btn-bot-step')).map(b =>
    b.addEventListener('click', () => {
      skipboEngine.autoPlayBotTurn();
      soundFX.playCathedralOrganAndBell();
      renderSkipBoTable();
    })
  );

  // =========================================================================
  // Ten Rites (Phase 10) Engine & Table Controls
  // =========================================================================
  let phase10Engine = new Phase10Engine('Pilgrim', 'Cathedral Prior');
  let phase10LiveCode = generateArcadeCode(GameCodePrefixEnum.Phase10);
  let selectedPhase10Indices: number[] = [];

  const renderPhase10Table = () => {
    const s = phase10Engine.state;
    const p1 = s.players[0]!;

    const contract = PHASE_10_REQUIREMENTS[p1.currentPhase - 1] || { description: 'Mastery', shortLabel: 'Complete' };
    fromNullable(document.getElementById('phase10-target-contract')).map(el => {
      el.textContent = `Phase ${p1.currentPhase}: ${contract.description}`;
    });
    fromNullable(document.getElementById('phase10-player-score')).map(el => {
      el.textContent = `${p1.score} pts`;
    });
    fromNullable(document.getElementById('phase10-hand-count')).map(el => {
      el.textContent = `${p1.hand.length} cards`;
    });
    fromNullable(document.getElementById('phase10-status-banner')).map(el => {
      el.textContent = s.historyText[s.historyText.length - 1] || 'Draw from deck or discard to begin.';
    });

    // Discard pile top
    fromNullable(document.getElementById('phase10-discard-pile-btn')).map(el => {
      if (s.discardPile.length > 0) {
        const top = s.discardPile[s.discardPile.length - 1]!;
        el.textContent = `${top.color.substring(0, 1).toUpperCase()} ${top.value || top.special}`;
        el.className = `playing-card-ui items-center justify-center font-extrabold text-base sm:text-lg shadow-xl cursor-pointer transition ${
          top.color === 'red'
            ? 'bg-red-950 text-red-100 border-red-500/60'
            : top.color === 'blue'
            ? 'bg-blue-950 text-blue-100 border-blue-500/60'
            : top.color === 'green'
            ? 'bg-emerald-950 text-emerald-100 border-emerald-500/60'
            : 'bg-amber-950 text-amber-100 border-amber-500/60'
        }`;
      } else {
        el.textContent = 'Empty';
      }
    });

    // Laid Groups
    fromNullable(document.getElementById('phase10-laid-groups')).map(container => {
      const allLaid = s.players.flatMap(p => p.laidGroups);
      if (allLaid.length === 0) {
        container.innerHTML = '<span class="text-sm sm:text-base text-stone-400 italic">No melds laid down yet this round</span>';
      } else {
        container.innerHTML = allLaid
          .map(
            g => `
          <div class="p-2.5 sm:p-3 rounded-xl bg-black/65 border border-emerald-400/50 flex flex-wrap items-center gap-2 shadow-md">
            ${g.cards
              .map(
                c => `
              <span class="px-3 py-1.5 rounded-lg text-xs sm:text-sm font-mono font-extrabold border border-white/15 ${
                c.color === 'red'
                  ? 'bg-red-950 text-red-200'
                  : c.color === 'blue'
                  ? 'bg-blue-950 text-blue-200'
                  : c.color === 'green'
                  ? 'bg-emerald-950 text-emerald-200'
                  : 'bg-amber-950 text-amber-200'
              }">
                ${c.value || c.special}
              </span>
            `
              )
              .join('')}
          </div>
        `
          )
          .join('');
      }
    });

    // Player Hand Cards
    fromNullable(document.getElementById('phase10-player-hand')).map(container => {
      container.innerHTML = p1.hand
        .map((c, idx) => {
          const isSelected = selectedPhase10Indices.includes(idx);
          return `
          <div data-p10-hand="${idx}" class="playing-card-ui items-center justify-between cursor-pointer transition ${
            isSelected ? 'card-selected' : ''
          } ${
            c.color === 'red'
              ? 'bg-gradient-to-b from-red-950 to-red-900 text-red-100 border-red-500/70 shadow-xl'
              : c.color === 'blue'
              ? 'bg-gradient-to-b from-blue-950 to-blue-900 text-blue-100 border-blue-500/70 shadow-xl'
              : c.color === 'green'
              ? 'bg-gradient-to-b from-emerald-950 to-emerald-900 text-emerald-100 border-emerald-500/70 shadow-xl'
              : 'bg-gradient-to-b from-amber-950 to-amber-900 text-amber-100 border-amber-500/70 shadow-xl'
          }">
            <div class="text-xs uppercase font-extrabold opacity-90">${c.special !== 'standard' ? c.special : c.color}</div>
            <div class="playing-card-center font-mono font-extrabold">${c.special === 'wild' ? '★' : c.special === 'skip' ? '⊘' : c.value}</div>
            <div class="text-xs sm:text-sm font-mono font-extrabold opacity-90">${c.value || c.special}</div>
          </div>
        `;
        })
        .join('');

      container.querySelectorAll('[data-p10-hand]').forEach(el => {
        el.addEventListener('click', () => {
          const idx = parseInt(el.getAttribute('data-p10-hand') || '0', 10);
          if (selectedPhase10Indices.includes(idx)) {
            selectedPhase10Indices = selectedPhase10Indices.filter(i => i !== idx);
          } else {
            selectedPhase10Indices.push(idx);
          }
          soundFX.playSelect();
          renderPhase10Table();
        });
      });
    });

    // Buttons
    fromNullable(document.getElementById('phase10-btn-draw-deck') as HTMLButtonElement | null).map(b => {
      b.disabled = s.hasDrawnThisTurn;
    });
    fromNullable(document.getElementById('phase10-btn-lay-phase') as HTMLButtonElement | null).map(b => {
      b.disabled = !s.hasDrawnThisTurn || p1.phaseCompletedThisRound || selectedPhase10Indices.length < 6;
    });
    fromNullable(document.getElementById('phase10-btn-hit-card') as HTMLButtonElement | null).map(b => {
      b.disabled = !s.hasDrawnThisTurn || !p1.phaseCompletedThisRound || selectedPhase10Indices.length !== 1;
    });
    fromNullable(document.getElementById('phase10-btn-discard') as HTMLButtonElement | null).map(b => {
      b.disabled = !s.hasDrawnThisTurn || selectedPhase10Indices.length !== 1;
    });
  };

  const setPhase10Mode = (isLive: boolean) => {
    fromNullable(document.getElementById('phase10-live-session-info')).map(el => {
      if (isLive) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
    fromNullable(document.getElementById('phase10-live-code')).map(el => {
      el.textContent = phase10LiveCode;
    });
    fromNullable(document.getElementById('phase10-tab-ai')).map(btn => {
      btn.className = isLive
        ? 'px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-emerald-300 font-bold text-[11px]'
        : 'px-2.5 py-1 rounded-xl bg-emerald-600 text-stone-950 font-bold text-[11px]';
    });
    fromNullable(document.getElementById('phase10-tab-live')).map(btn => {
      btn.className = isLive
        ? 'px-2.5 py-1 rounded-xl bg-emerald-600 text-stone-950 font-bold text-[11px]'
        : 'px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-emerald-300 font-bold text-[11px]';
    });
  };

  fromNullable(document.getElementById('phase10-tab-ai')).map(b => b.addEventListener('click', () => setPhase10Mode(false)));
  fromNullable(document.getElementById('phase10-tab-live')).map(b => b.addEventListener('click', () => setPhase10Mode(true)));
  fromNullable(document.getElementById('btn-phase10-copy-link')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchLink(phase10LiveCode, b))
  );

  fromNullable(document.getElementById('phase10-btn-draw-deck')).map(b =>
    b.addEventListener('click', () => {
      phase10Engine.drawCard(false);
      soundFX.playSelect();
      renderPhase10Table();
    })
  );

  fromNullable(document.getElementById('phase10-discard-pile-btn')).map(b =>
    b.addEventListener('click', () => {
      if (!phase10Engine.state.hasDrawnThisTurn) {
        phase10Engine.drawCard(true);
        soundFX.playSelect();
        renderPhase10Table();
      }
    })
  );

  fromNullable(document.getElementById('phase10-btn-lay-phase')).map(b =>
    b.addEventListener('click', () => {
      const half = Math.floor(selectedPhase10Indices.length / 2);
      const g1 = selectedPhase10Indices.slice(0, half);
      const g2 = selectedPhase10Indices.slice(half);
      const res = phase10Engine.layDownPhase(g1, g2);
      if (res.isSuccess()) {
        selectedPhase10Indices = [];
        soundFX.playCathedralOrganAndBell();
      }
      renderPhase10Table();
    })
  );

  fromNullable(document.getElementById('phase10-btn-hit-card')).map(b =>
    b.addEventListener('click', () => {
      if (selectedPhase10Indices.length === 1) {
        phase10Engine.hitCard(selectedPhase10Indices[0]!, 'p1', 0);
        selectedPhase10Indices = [];
        soundFX.playSelect();
        renderPhase10Table();
      }
    })
  );

  fromNullable(document.getElementById('phase10-btn-discard')).map(b =>
    b.addEventListener('click', () => {
      if (selectedPhase10Indices.length === 1) {
        phase10Engine.discardAndEndTurn(selectedPhase10Indices[0]!);
        selectedPhase10Indices = [];
        soundFX.playCathedralOrganAndBell();
        renderPhase10Table();
      }
    })
  );

  // =========================================================================
  // Cardinal Uno Engine & Table Controls
  // =========================================================================
  let unoEngine = new CardinalUnoEngine('Pilgrim', 4);
  let unoLiveCode = generateArcadeCode(GameCodePrefixEnum.Uno);
  let pendingWildCardIndex: number | null = null;

  const renderUnoTable = () => {
    const s = unoEngine.state;
    const humanPlayer = s.players[0]!;

    // Opponents Track
    fromNullable(document.getElementById('uno-opponents-track')).map(container => {
      const opponents = s.players.slice(1);
      container.innerHTML = opponents
        .map(
          (p, idx) => `
        <div class="px-4 py-2 rounded-2xl bg-black/65 border ${
          s.currentTurnIndex === idx + 1 ? 'border-amber-400 ring-2 ring-amber-400/50' : 'border-white/15'
        } flex items-center gap-2.5 text-sm shadow-md">
          <div class="w-2.5 h-2.5 rounded-full ${p.isBot ? 'bg-purple-400' : 'bg-sky-400'}"></div>
          <span class="font-bold text-stone-100">${p.name}</span>
          <span class="px-2.5 py-0.5 rounded-full bg-red-950/85 border border-red-500/40 text-amber-300 font-mono text-xs sm:text-sm font-extrabold">
            ${p.hand.length} 🂠
          </span>
          ${p.calledUno ? '<span class="text-xs font-extrabold text-amber-400 uppercase tracking-wider">UNO!</span>' : ''}
        </div>
      `
        )
        .join('');
    });

    // Active Color Badge
    fromNullable(document.getElementById('uno-active-color-badge')).map(badge => {
      badge.textContent = s.activeColor.toUpperCase();
      const colorMap: Record<UnoColor, string> = {
        red: 'bg-red-950/85 text-red-100 border-red-500/60',
        blue: 'bg-blue-950/85 text-blue-100 border-blue-500/60',
        green: 'bg-emerald-950/85 text-emerald-100 border-emerald-500/60',
        yellow: 'bg-amber-950/85 text-amber-100 border-amber-500/60',
        wild: 'bg-purple-950/85 text-purple-100 border-purple-500/60'
      };
      badge.className = `px-4 py-2 rounded-xl border-2 font-cathedral font-extrabold text-sm sm:text-base uppercase tracking-wider shadow-lg ${colorMap[s.activeColor] || ''}`;
    });

    // Discard Pile Top
    fromNullable(document.getElementById('uno-discard-pile')).map(el => {
      const top = unoEngine.getTopDiscard();
      const colorBg =
        top.color === 'red'
          ? 'bg-gradient-to-b from-red-950 to-red-900 text-red-100 border-red-500/70'
          : top.color === 'blue'
          ? 'bg-gradient-to-b from-blue-950 to-blue-900 text-blue-100 border-blue-500/70'
          : top.color === 'green'
          ? 'bg-gradient-to-b from-emerald-950 to-emerald-900 text-emerald-100 border-emerald-500/70'
          : top.color === 'yellow'
          ? 'bg-gradient-to-b from-amber-950 to-amber-900 text-amber-100 border-amber-500/70'
          : 'bg-gradient-to-br from-stone-900 via-purple-950 to-stone-900 text-purple-200 border-purple-400/70';

      const label = top.type === 'number' ? top.value : top.type === 'wild4' ? '+4' : top.type === 'draw2' ? '+2' : top.type === 'reverse' ? '⇄' : top.type === 'skip' ? '⊘' : '★';
      el.className = `playing-card-ui items-center justify-between font-mono font-extrabold text-base shadow-2xl ${colorBg}`;
      el.innerHTML = `
        <div class="text-xs uppercase font-extrabold self-start">${top.color}</div>
        <div class="playing-card-center font-extrabold">${label}</div>
        <div class="text-xs uppercase font-extrabold self-end">${label}</div>
      `;
    });

    // Status Banner
    fromNullable(document.getElementById('uno-status-banner')).map(el => {
      el.textContent = s.historyText[s.historyText.length - 1] || 'Match cards or draw.';
    });

    // Hand Count & Player Hand
    fromNullable(document.getElementById('uno-hand-count')).map(el => {
      el.textContent = `${humanPlayer.hand.length} cards`;
    });

    fromNullable(document.getElementById('uno-player-hand')).map(container => {
      container.innerHTML = humanPlayer.hand
        .map((c, idx) => {
          const playable = unoEngine.canPlayCard(c);
          const colorBg =
            c.color === 'red'
              ? 'bg-gradient-to-b from-red-950 to-red-900 text-red-100 border-red-500/70'
              : c.color === 'blue'
              ? 'bg-gradient-to-b from-blue-950 to-blue-900 text-blue-100 border-blue-500/70'
              : c.color === 'green'
              ? 'bg-gradient-to-b from-emerald-950 to-emerald-900 text-emerald-100 border-emerald-500/70'
              : c.color === 'yellow'
              ? 'bg-gradient-to-b from-amber-950 to-amber-900 text-amber-100 border-amber-500/70'
              : 'bg-gradient-to-br from-stone-900 via-purple-950 to-stone-900 text-purple-200 border-purple-400/70';

          const label = c.type === 'number' ? c.value : c.type === 'wild4' ? '+4' : c.type === 'draw2' ? '+2' : c.type === 'reverse' ? '⇄' : c.type === 'skip' ? '⊘' : '★';

          return `
          <div data-uno-hand="${idx}" class="playing-card-ui items-center justify-between cursor-pointer transition ${colorBg} ${
            playable ? 'ring-2 ring-amber-400/60 hover:scale-105' : 'opacity-50'
          }">
            <div class="text-xs uppercase font-extrabold self-start opacity-90">${c.color}</div>
            <div class="playing-card-center font-mono font-extrabold">${label}</div>
            <div class="text-xs font-mono font-extrabold self-end opacity-90">${label}</div>
          </div>
        `;
        })
        .join('');

      container.querySelectorAll('[data-uno-hand]').forEach(el => {
        el.addEventListener('click', () => {
          if (s.currentTurnIndex !== 0) return;
          const idx = parseInt(el.getAttribute('data-uno-hand') || '0', 10);
          const card = humanPlayer.hand[idx];
          if (!card || !unoEngine.canPlayCard(card)) return;

          if (card.color === 'wild') {
            pendingWildCardIndex = idx;
            fromNullable(document.getElementById('uno-color-picker')).map(cp => cp.classList.remove('hidden'));
            return;
          }

          const res = unoEngine.playCard(idx);
          if (res.isSuccess()) {
            soundFX.playCathedralOrganAndBell();
            if (activeArcadeClient) {
              void activeArcadeClient.sendAction('uno_play', { handIndex: idx });
            }
            renderUnoTable();
            checkAndRunUnoBots();
          }
        });
      });
    });
  };

  const checkAndRunUnoBots = () => {
    if (unoEngine.state.isGameOver) return;
    if (unoEngine.state.currentTurnIndex !== 0) {
      setTimeout(() => {
        if (unoEngine.state.isGameOver) return;
        unoEngine.executeAiTurn();
        renderUnoTable();
        if (unoEngine.state.currentTurnIndex !== 0) {
          checkAndRunUnoBots();
        }
      }, 700);
    }
  };

  const setUnoMode = (isLive: boolean) => {
    fromNullable(document.getElementById('uno-live-session-info')).map(el => {
      if (isLive) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
    fromNullable(document.getElementById('uno-live-code')).map(el => {
      el.textContent = unoLiveCode;
    });
    fromNullable(document.getElementById('uno-tab-ai')).map(btn => {
      btn.className = isLive
        ? 'px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-red-300 font-bold text-[11px]'
        : 'px-2.5 py-1 rounded-xl bg-red-600 text-white font-bold text-[11px]';
    });
    fromNullable(document.getElementById('uno-tab-live')).map(btn => {
      btn.className = isLive
        ? 'px-2.5 py-1 rounded-xl bg-red-600 text-white font-bold text-[11px]'
        : 'px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-red-300 font-bold text-[11px]';
    });
    if (isLive) {
      setupArcadeRealtimeSession(ArcadeGameEnum.Uno, unoLiveCode, 'Pilgrim Player', (action, payload: any) => {
        if (action === 'uno_play' && typeof payload?.handIndex === 'number') {
          unoEngine.playCard(payload.handIndex, payload.wildColor);
          renderUnoTable();
        } else if (action === 'uno_draw') {
          unoEngine.drawCard();
          renderUnoTable();
        }
      });
    } else if (activeArcadeClient) {
      void activeArcadeClient.leaveSeat();
      activeArcadeClient.disconnect();
      activeArcadeClient = null;
    }
  };

  fromNullable(document.getElementById('uno-tab-ai')).map(b => b.addEventListener('click', () => setUnoMode(false)));
  fromNullable(document.getElementById('uno-tab-live')).map(b => b.addEventListener('click', () => setUnoMode(true)));
  fromNullable(document.getElementById('btn-uno-copy-link')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchLink(unoLiveCode, b))
  );

  fromNullable(document.getElementById('uno-draw-deck-btn')).map(b =>
    b.addEventListener('click', () => {
      if (unoEngine.state.currentTurnIndex === 0) {
        unoEngine.drawCard();
        soundFX.playSelect();
        if (activeArcadeClient) {
          void activeArcadeClient.sendAction('uno_draw', {});
        }
        renderUnoTable();
        checkAndRunUnoBots();
      }
    })
  );

  fromNullable(document.getElementById('uno-btn-draw')).map(b =>
    b.addEventListener('click', () => {
      if (unoEngine.state.currentTurnIndex === 0) {
        unoEngine.drawCard();
        soundFX.playSelect();
        if (activeArcadeClient) {
          void activeArcadeClient.sendAction('uno_draw', {});
        }
        renderUnoTable();
        checkAndRunUnoBots();
      }
    })
  );

  fromNullable(document.getElementById('uno-btn-call-uno')).map(b =>
    b.addEventListener('click', () => {
      const res = unoEngine.callUno('p1');
      if (res.isSuccess()) {
        soundFX.playCathedralOrganAndBell();
      }
      renderUnoTable();
    })
  );

  ['red', 'blue', 'green', 'yellow'].forEach(c => {
    fromNullable(document.getElementById(`uno-pick-${c}`)).map(b => {
      b.addEventListener('click', () => {
        if (pendingWildCardIndex !== null) {
          unoEngine.playCard(pendingWildCardIndex, c as UnoColor);
          pendingWildCardIndex = null;
          fromNullable(document.getElementById('uno-color-picker')).map(cp => cp.classList.add('hidden'));
          soundFX.playCathedralOrganAndBell();
          renderUnoTable();
          checkAndRunUnoBots();
        }
      });
    });
  });

  // =========================================================================
  // The Resistance: Avalon Engine & Table Controls
  // =========================================================================
  let avalonEngine = new AvalonEngine('Percival', 5);
  let avalonLiveCode = generateArcadeCode(GameCodePrefixEnum.Avalon);
  let selectedAvalonKnights: string[] = [];

  const renderAvalonTable = () => {
    const s = avalonEngine.state;
    const humanPlayer = s.players[0]!;

    // Quests Track
    fromNullable(document.getElementById('avalon-quests-track')).map(container => {
      container.innerHTML = s.quests
        .map((q, idx) => {
          const isCurrent = s.currentQuestIndex === idx;
          const statusBg = q.outcome.match({
            Some: o => (o === 'success' ? 'bg-emerald-600 text-stone-950 border-emerald-400' : 'bg-red-600 text-white border-red-400'),
            None: () => (isCurrent ? 'bg-sky-600 text-white border-amber-400 ring-2 ring-amber-400/40' : 'bg-stone-900 text-stone-300 border-white/20')
          });
          return `
          <div class="px-4 py-2 rounded-xl border-2 font-mono font-extrabold text-sm flex flex-col items-center shadow-md ${statusBg}">
            <span>Q${q.questNumber} (${q.teamSize})</span>
            <span class="text-xs uppercase">${q.outcome.match({ Some: o => o, None: () => (isCurrent ? 'Active' : 'Pending') })}</span>
          </div>
        `;
        })
        .join('');
    });

    // Vote Track
    fromNullable(document.getElementById('avalon-vote-track-val')).map(el => {
      el.textContent = `${s.failedVoteCount} / 5`;
    });

    // Role Herald
    fromNullable(document.getElementById('avalon-role-title')).map(el => {
      el.textContent = `${humanPlayer.role} (${humanPlayer.alignment === 'good' ? 'Good' : 'Evil'})`;
      el.className = `font-cathedral text-lg sm:text-xl font-bold ${humanPlayer.alignment === 'good' ? 'text-sky-300' : 'text-red-400'}`;
    });
    fromNullable(document.getElementById('avalon-role-desc')).map(el => {
      el.textContent =
        humanPlayer.role === 'Merlin'
          ? 'You know the minions of evil. Remain subtle to escape the Assassin!'
          : humanPlayer.role === 'Percival'
          ? 'You know who Merlin and Morgana are, but not which is which!'
          : humanPlayer.role === 'Assassin'
          ? 'Identify and execute Merlin at the end to snatch victory for Mordred!'
          : humanPlayer.alignment === 'good'
          ? 'Loyal Knight of Arthur. Seek out and approve pure teams!'
          : 'Minion of Mordred. Sow discord and fail quests!';
    });

    // Seats Grid
    fromNullable(document.getElementById('avalon-seats-grid')).map(container => {
      const currentQuest = avalonEngine.getCurrentQuest();
      container.innerHTML = s.players
        .map((p, idx) => {
          const isLeader = s.currentLeaderIndex === idx;
          const isSelected = selectedAvalonKnights.includes(p.id);
          const isProposed = currentQuest.proposedTeam.includes(p.id);
          return `
          <div data-avalon-seat="${p.id}" class="p-3.5 sm:p-4 rounded-2xl bg-black/65 border-2 ${
            isSelected
              ? 'border-amber-400 ring-2 ring-amber-400/50'
              : isProposed
              ? 'border-sky-400'
              : 'border-white/15'
          } flex flex-col items-center gap-1.5 cursor-pointer transition hover:bg-white/10 shadow-lg">
            <div class="flex items-center gap-1.5">
              ${isLeader ? '<span class="text-amber-400 text-base">👑</span>' : ''}
              <span class="font-bold text-sm sm:text-base text-stone-100">${p.name}</span>
            </div>
            <span class="text-xs px-2.5 py-0.5 rounded-full font-semibold ${p.isBot ? 'bg-purple-950/85 text-purple-200 border border-purple-400/40' : 'bg-sky-950/85 text-sky-200 border border-sky-400/40'}">
              ${p.isBot ? 'Bot Knight' : 'Human Knight'}
            </span>
            ${isProposed ? '<span class="text-xs font-extrabold text-sky-300 uppercase tracking-wider">On Quest</span>' : ''}
          </div>
        `;
        })
        .join('');

      container.querySelectorAll('[data-avalon-seat]').forEach(el => {
        el.addEventListener('click', () => {
          const pid = el.getAttribute('data-avalon-seat') || '';
          if (selectedAvalonKnights.includes(pid)) {
            selectedAvalonKnights = selectedAvalonKnights.filter(id => id !== pid);
          } else {
            selectedAvalonKnights.push(pid);
          }
          soundFX.playSelect();
          renderAvalonTable();
        });
      });
    });

    // Status Banner
    fromNullable(document.getElementById('avalon-status-banner')).map(el => {
      el.textContent = s.historyText[s.historyText.length - 1] || 'Advance the kingdom quests.';
    });

    // Control Docks visibility based on stage
    fromNullable(document.getElementById('avalon-vote-controls')).map(el => {
      if (s.stage === 'team-building' || s.stage === 'voting') el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
    fromNullable(document.getElementById('avalon-quest-controls')).map(el => {
      if (s.stage === 'quest-execution') el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
    fromNullable(document.getElementById('avalon-assassin-controls')).map(el => {
      if (s.stage === 'assassination') el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
  };

  const setAvalonMode = (isLive: boolean) => {
    fromNullable(document.getElementById('avalon-live-session-info')).map(el => {
      if (isLive) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
    fromNullable(document.getElementById('avalon-live-code')).map(el => {
      el.textContent = avalonLiveCode;
    });
    fromNullable(document.getElementById('avalon-tab-ai')).map(btn => {
      btn.className = isLive
        ? 'px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-sky-300 font-bold text-[11px]'
        : 'px-2.5 py-1 rounded-xl bg-sky-600 text-white font-bold text-[11px]';
    });
    fromNullable(document.getElementById('avalon-tab-live')).map(btn => {
      btn.className = isLive
        ? 'px-2.5 py-1 rounded-xl bg-sky-600 text-white font-bold text-[11px]'
        : 'px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-sky-300 font-bold text-[11px]';
    });
    if (isLive) {
      setupArcadeRealtimeSession(ArcadeGameEnum.Avalon, avalonLiveCode, 'Arthurian Knight', (action, payload: any) => {
        if (action === 'avalon_propose' && Array.isArray(payload?.team)) {
          avalonEngine.proposeTeam(payload.team);
          renderAvalonTable();
        } else if (action === 'avalon_vote' && typeof payload?.approve === 'boolean') {
          avalonEngine.castVote(payload.playerId || 'p1', payload.approve);
          renderAvalonTable();
        } else if (action === 'avalon_quest' && typeof payload?.pass === 'boolean') {
          avalonEngine.castQuestCard(payload.playerId || 'p1', payload.pass);
          renderAvalonTable();
        }
      });
    } else if (activeArcadeClient) {
      void activeArcadeClient.leaveSeat();
      activeArcadeClient.disconnect();
      activeArcadeClient = null;
    }
  };

  fromNullable(document.getElementById('avalon-tab-ai')).map(b => b.addEventListener('click', () => setAvalonMode(false)));
  fromNullable(document.getElementById('avalon-tab-live')).map(b => b.addEventListener('click', () => setAvalonMode(true)));
  fromNullable(document.getElementById('btn-avalon-copy-link')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchLink(avalonLiveCode, b))
  );

  fromNullable(document.getElementById('avalon-btn-propose')).map(b =>
    b.addEventListener('click', () => {
      const res = avalonEngine.proposeTeam(selectedAvalonKnights);
      if (res.isSuccess()) {
        soundFX.playCathedralOrganAndBell();
        if (activeArcadeClient) {
          void activeArcadeClient.sendAction('avalon_propose', { team: selectedAvalonKnights });
        }
        selectedAvalonKnights = [];
      }
      renderAvalonTable();
    })
  );

  fromNullable(document.getElementById('avalon-btn-vote-approve')).map(b =>
    b.addEventListener('click', () => {
      avalonEngine.castVote('p1', true);
      // Auto vote for bots
      avalonEngine.state.players.slice(1).forEach(bot => {
        avalonEngine.castVote(bot.id, true);
      });
      soundFX.playSelect();
      if (activeArcadeClient) {
        void activeArcadeClient.sendAction('avalon_vote', { playerId: 'p1', approve: true });
      }
      renderAvalonTable();
    })
  );

  fromNullable(document.getElementById('avalon-btn-vote-reject')).map(b =>
    b.addEventListener('click', () => {
      avalonEngine.castVote('p1', false);
      avalonEngine.state.players.slice(1).forEach(bot => {
        avalonEngine.castVote(bot.id, false);
      });
      soundFX.playSelect();
      if (activeArcadeClient) {
        void activeArcadeClient.sendAction('avalon_vote', { playerId: 'p1', approve: false });
      }
      renderAvalonTable();
    })
  );

  fromNullable(document.getElementById('avalon-btn-quest-pass')).map(b =>
    b.addEventListener('click', () => {
      avalonEngine.castQuestCard('p1', true);
      // Fill remaining quest cards with bots on team
      const quest = avalonEngine.getCurrentQuest();
      quest.proposedTeam.filter(id => id !== 'p1').forEach(id => {
        const bot = avalonEngine.state.players.find(p => p.id === id);
        const pass = bot?.alignment === 'good';
        avalonEngine.castQuestCard(id, pass);
      });
      soundFX.playCathedralOrganAndBell();
      if (activeArcadeClient) {
        void activeArcadeClient.sendAction('avalon_quest', { playerId: 'p1', pass: true });
      }
      renderAvalonTable();
    })
  );

  fromNullable(document.getElementById('avalon-btn-quest-fail')).map(b =>
    b.addEventListener('click', () => {
      avalonEngine.castQuestCard('p1', false);
      const quest = avalonEngine.getCurrentQuest();
      quest.proposedTeam.filter(id => id !== 'p1').forEach(id => {
        const bot = avalonEngine.state.players.find(p => p.id === id);
        const pass = bot?.alignment === 'good';
        avalonEngine.castQuestCard(id, pass);
      });
      soundFX.playSelect();
      if (activeArcadeClient) {
        void activeArcadeClient.sendAction('avalon_quest', { playerId: 'p1', pass: false });
      }
      renderAvalonTable();
    })
  );

  fromNullable(document.getElementById('avalon-btn-assassinate')).map(b =>
    b.addEventListener('click', () => {
      if (selectedAvalonKnights.length === 1) {
        avalonEngine.assassinateMerlin(selectedAvalonKnights[0]!);
        selectedAvalonKnights = [];
        soundFX.playCathedralOrganAndBell();
        renderAvalonTable();
      }
    })
  );

  // Sacred Geometry SET Table Engine & Event Binding
  let setEngine = new SetEngine(3, 'You (Sanctuary Geometer)');
  let selectedSetIndices: number[] = [];
  let setHintIndex: number | null = null;

  const renderSetSymbolSvg = (card: SetCard): string => {
    const colorHex =
      card.color === 'red'
        ? '#ef4444'
        : card.color === 'green'
          ? '#10b981'
          : '#c084fc';
    const patternId = `set-stripe-${card.id}`;
    const fillAttr =
      card.shading === 'solid'
        ? colorHex
        : card.shading === 'open'
          ? 'none'
          : `url(#${patternId})`;

    const shapeElement =
      card.shape === 'diamond'
        ? `<polygon points="32,4 60,20 32,36 4,20" fill="${fillAttr}" stroke="${colorHex}" stroke-width="3.2" />`
        : card.shape === 'oval'
          ? `<rect x="6" y="6" width="52" height="28" rx="14" ry="14" fill="${fillAttr}" stroke="${colorHex}" stroke-width="3.2" />`
          : `<path d="M 8,24 C 12,6 28,6 32,18 C 36,30 52,30 56,14 C 54,32 38,34 30,22 C 22,10 10,16 8,24 Z" fill="${fillAttr}" stroke="${colorHex}" stroke-width="3.2" />`;

    const singleSvg = `<svg viewBox="0 0 64 40" class="w-16 h-9 sm:w-20 sm:h-11 drop-shadow"><defs><pattern id="${patternId}" width="5" height="5" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="5" stroke="${colorHex}" stroke-width="2.4" /></pattern></defs>${shapeElement}</svg>`;
    return Array.from({ length: card.count }, () => singleSvg).join('');
  };

  const renderSetTable = () => {
    const s = setEngine.state;
    const validSets = setEngine.getAvailableSets();

    ['set-deck-remaining', 'set-deck-count-val'].forEach(id => {
      domById(id).map(el => {
        el.textContent = String(s.deck.length);
      });
    });
    ['set-available-count', 'set-available-val'].forEach(id => {
      domById(id).map(el => {
        el.textContent = String(validSets.length);
      });
    });
    ['set-status-banner', 'set-Banner-msg'].forEach(id => {
      domById(id).map(el => {
        el.textContent = s.historyText[s.historyText.length - 1] || 'Select 3 cards forming a SET.';
      });
    });

    ['set-players-scoreboard', 'set-players-strip'].forEach(id => {
      domById(id).map(strip => {
        strip.innerHTML = '';
        s.players.forEach(p => {
          const badge = document.createElement('div');
          badge.className = `px-4 py-2 rounded-xl border-2 ${
            p.id === 'p1'
              ? 'border-fuchsia-400 bg-fuchsia-950/75'
              : 'border-white/15 bg-black/55'
          } text-xs sm:text-sm flex items-center gap-2.5 shadow-md`;
          badge.innerHTML = `<span class="font-bold text-stone-100">${p.name}</span><span class="text-amber-300 font-mono font-bold">Sets: ${p.score}</span><span class="text-stone-300 font-mono text-xs">(-${p.penalties})</span>`;
          strip.appendChild(badge);
        });
      });
    });

    ['set-table-grid', 'set-board-grid'].forEach(id => {
      domById(id).map(grid => {
        grid.innerHTML = '';
        s.tableCards.forEach((card, idx) => {
          const isSelected = selectedSetIndices.includes(idx);
          const isHint = setHintIndex === idx;
          const btn = document.createElement('button');
          btn.className = `arcade-set-card-ui border-2 flex flex-col items-center justify-center gap-2 bg-stone-950/92 hover:bg-stone-900 shadow-xl ${
            isSelected
              ? 'border-amber-400 ring-2 ring-amber-400/70 -translate-y-1.5'
              : isHint
                ? 'border-cyan-400 ring-2 ring-cyan-400/60'
                : 'border-white/20'
          }`;
          btn.innerHTML = `
            <div class="flex flex-col items-center justify-center gap-1.5">${renderSetSymbolSvg(card)}</div>
            <span class="text-xs font-mono font-bold text-stone-200 uppercase tracking-wider">${card.count} ${card.color} ${card.shading} ${card.shape}</span>
          `;
          btn.addEventListener('click', () => {
            setHintIndex = null;
            if (selectedSetIndices.includes(idx)) {
              selectedSetIndices = selectedSetIndices.filter(i => i !== idx);
            } else if (selectedSetIndices.length < 3) {
              selectedSetIndices.push(idx);
            }
            soundFX.playSelect();
            renderSetTable();
          });
          grid.appendChild(btn);
        });
      });
    });

    domById<HTMLButtonElement>('set-btn-claim').map(b => {
      b.disabled = selectedSetIndices.length !== 3 || s.isGameOver;
    });
  };

  let setLiveCode = `SET-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const setSetMode = (isLive: boolean) => {
    ['set-tab-ai', 'set-mode-ai'].forEach(id => {
      domById(id).map(btn => {
        btn.className = isLive
          ? 'px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-fuchsia-300 font-bold text-xs transition'
          : 'px-3 py-1.5 rounded-xl bg-fuchsia-600 text-white font-bold text-xs transition';
      });
    });
    ['set-tab-live', 'set-mode-live'].forEach(id => {
      domById(id).map(btn => {
        btn.className = isLive
          ? 'px-3 py-1.5 rounded-xl bg-fuchsia-600 text-white font-bold text-xs transition'
          : 'px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-fuchsia-300 font-bold text-xs transition';
      });
    });
    ['set-live-session-info', 'set-live-banner'].forEach(id => {
      domById(id).map(el => {
        if (isLive) {
          el.classList.remove('hidden');
          el.classList.add('flex');
        } else {
          el.classList.add('hidden');
          el.classList.remove('flex');
        }
      });
    });
    ['set-live-code', 'set-live-code-val'].forEach(id => {
      domById(id).map(el => {
        el.textContent = setLiveCode;
      });
    });
    if (isLive) {
      setupArcadeRealtimeSession(ArcadeGameEnum.Set, setLiveCode, 'Sanctuary Geometer', () =>
        renderSetTable()
      );
    }
  };

  ['set-tab-ai', 'set-mode-ai'].forEach(id => {
    domById(id).map(b => b.addEventListener('click', () => setSetMode(false)));
  });
  ['set-tab-live', 'set-mode-live'].forEach(id => {
    domById(id).map(b => b.addEventListener('click', () => setSetMode(true)));
  });
  ['btn-set-copy-link', 'set-copy-code-btn'].forEach(id => {
    domById(id).map(b =>
      b.addEventListener('click', () => {
        copyArcadeMatchLink(setLiveCode, b);
        ui.showTemporaryBanner(`SET Room Link Copied: ${setLiveCode}`, 2500);
      })
    );
  });

  fromNullable(document.getElementById('set-btn-claim')).map(b =>
    b.addEventListener('click', () => {
      if (selectedSetIndices.length === 3) {
        const res = setEngine.claimSet('p1', [
          selectedSetIndices[0]!,
          selectedSetIndices[1]!,
          selectedSetIndices[2]!
        ]);
        if (res.isSuccess()) {
          soundFX.playCathedralOrganAndBell();
        } else {
          soundFX.playSelect();
        }
        if (activeArcadeClient) {
          void activeArcadeClient.sendAction('set_claim', {
            playerId: 'p1',
            indices: selectedSetIndices
          });
        }
        selectedSetIndices = [];
        setHintIndex = null;
        renderSetTable();
      }
    })
  );

  fromNullable(document.getElementById('set-btn-deal-more')).map(b =>
    b.addEventListener('click', () => {
      setEngine.dealThreeMoreCards();
      soundFX.playSelect();
      renderSetTable();
    })
  );

  fromNullable(document.getElementById('set-btn-hint')).map(b =>
    b.addEventListener('click', () => {
      setHintIndex = setEngine.getHintCardIndex().match({
        Some: idx => idx,
        None: () => null
      });
      soundFX.playSelect();
      renderSetTable();
    })
  );

  fromNullable(document.getElementById('set-btn-ai-move')).map(b =>
    b.addEventListener('click', () => {
      setEngine.executeAiTurn('p2');
      selectedSetIndices = [];
      setHintIndex = null;
      soundFX.playSelect();
      renderSetTable();
    })
  );

  fromNullable(document.getElementById('set-btn-new-game')).map(b =>
    b.addEventListener('click', () => {
      setEngine = new SetEngine(3, 'You (Sanctuary Geometer)');
      selectedSetIndices = [];
      setHintIndex = null;
      soundFX.playSelect();
      renderSetTable();
    })
  );

  // Arcade Hub Dual Buttons (Play vs AI & Play Live)
  document.querySelectorAll('[data-game-ai]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetGame = btn.getAttribute('data-game-ai') as ArcadeGameType | null;
      if (targetGame === 'chess') {
        ui.hideArcadeHub();
        modalOpenedFromReset = false;
        ui.showPreGameModal();
      } else if (targetGame === 'blackjack') {
        ui.hideArcadeHub();
        setBlackjackMode(false);
        renderBlackjackTable();
        ui.showBlackjack();
      } else if (targetGame === 'poker') {
        ui.hideArcadeHub();
        setPokerMode(false);
        renderPokerTable();
        ui.showPoker();
      } else if (targetGame === 'skipbo') {
        ui.hideArcadeHub();
        setSkipBoMode(false);
        renderSkipBoTable();
        ui.showSkipBo();
      } else if (targetGame === 'phase10') {
        ui.hideArcadeHub();
        setPhase10Mode(false);
        renderPhase10Table();
        ui.showPhase10();
      } else if (targetGame === 'uno') {
        ui.hideArcadeHub();
        setUnoMode(false);
        renderUnoTable();
        ui.showUno();
      } else if (targetGame === 'avalon') {
        ui.hideArcadeHub();
        setAvalonMode(false);
        renderAvalonTable();
        ui.showAvalon();
      } else if (targetGame === 'set') {
        ui.hideArcadeHub();
        setSetMode(false);
        renderSetTable();
        ui.showSet();
      } else if (targetGame && targetGame in ARCADE_GAMES) {
        const gameMeta = ARCADE_GAMES[targetGame];
        ui.setHubQuickJoinFeedback(
          `${gameMeta.title} AI Opponents active. Launching table...`,
          false
        );
      }
    });
  });

  document.querySelectorAll('[data-game-live]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetGame = btn.getAttribute('data-game-live') as ArcadeGameType | null;
      if (targetGame === 'chess') {
        ui.hideArcadeHub();
        ui.showLiveSessionModal();
        ui.switchLiveSessionTab('create');
      } else if (targetGame === 'blackjack') {
        ui.hideArcadeHub();
        setBlackjackMode(true);
        renderBlackjackTable();
        ui.showBlackjack();
      } else if (targetGame === 'poker') {
        ui.hideArcadeHub();
        setPokerMode(true);
        renderPokerTable();
        ui.showPoker();
      } else if (targetGame === 'skipbo') {
        ui.hideArcadeHub();
        setSkipBoMode(true);
        renderSkipBoTable();
        ui.showSkipBo();
      } else if (targetGame === 'phase10') {
        ui.hideArcadeHub();
        setPhase10Mode(true);
        renderPhase10Table();
        ui.showPhase10();
      } else if (targetGame === 'uno') {
        ui.hideArcadeHub();
        setUnoMode(true);
        renderUnoTable();
        ui.showUno();
      } else if (targetGame === 'avalon') {
        ui.hideArcadeHub();
        setAvalonMode(true);
        renderAvalonTable();
        ui.showAvalon();
      } else if (targetGame === 'set') {
        ui.hideArcadeHub();
        setSetMode(true);
        renderSetTable();
        ui.showSet();
      } else if (targetGame && targetGame in ARCADE_GAMES) {
        const gameMeta = ARCADE_GAMES[targetGame];
        ui.setHubQuickJoinFeedback(
          `${gameMeta.title} live multiplayer tables (${gameMeta.codePrefix}XXXX) ready on PocketHost.`,
          false
        );
      }
    });
  });

  const handleHubQuickJoin = () => {
    const rawVal = domById<HTMLInputElement>('hub-quick-join-input')
      .map(el => el.value)
      .getOrElse('');
    const parsedOpt = extractSessionCodeOrUrl(rawVal);
    parsedOpt.match({
      Some: ({ game, code }) => {
        if (game === 'chess') {
          ui.hideArcadeHub();
          ui.showLiveSessionModal();
          ui.switchLiveSessionTab('join');
          domById<HTMLInputElement>('live-join-code').map(joinCodeInput => {
            joinCodeInput.value = code;
          });
        } else if (game === 'blackjack') {
          ui.hideArcadeHub();
          bjkLiveCode = code;
          setBlackjackMode(true);
          renderBlackjackTable();
          ui.showBlackjack();
        } else if (game === 'poker') {
          ui.hideArcadeHub();
          pokerLiveCode = code;
          setPokerMode(true);
          renderPokerTable();
          ui.showPoker();
        } else if (game === 'skipbo') {
          ui.hideArcadeHub();
          skipboLiveCode = code;
          setSkipBoMode(true);
          renderSkipBoTable();
          ui.showSkipBo();
        } else if (game === 'phase10') {
          ui.hideArcadeHub();
          phase10LiveCode = code;
          setPhase10Mode(true);
          renderPhase10Table();
          ui.showPhase10();
        } else if (game === 'uno') {
          ui.hideArcadeHub();
          unoLiveCode = code;
          setUnoMode(true);
          renderUnoTable();
          ui.showUno();
        } else if (game === 'avalon') {
          ui.hideArcadeHub();
          avalonLiveCode = code;
          setAvalonMode(true);
          renderAvalonTable();
          ui.showAvalon();
        } else if (game === 'set') {
          ui.hideArcadeHub();
          setLiveCode = code;
          setSetMode(true);
          renderSetTable();
          ui.showSet();
        } else {
          const gameMeta = ARCADE_GAMES[game];
          ui.setHubQuickJoinFeedback(
            `Connecting to ${gameMeta.title} room ${code}...`,
            false
          );
        }
      },
      None: () => {
        ui.setHubQuickJoinFeedback(
          'Please enter a valid session code (e.g. SANCT-XXXX, BJK-XXXX, POKER-XXXX, SKIP-XXXX, P10-XXXX, UNO-XXXX, AVALON-XXXX, SET-XXXX) or match link.',
          true
        );
      }
    });
  };

  fromNullable(document.getElementById('btn-hub-quick-join')).map(btn =>
    btn.addEventListener('click', handleHubQuickJoin)
  );

  fromNullable(document.getElementById('hub-quick-join-input')).map(input =>
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleHubQuickJoin();
      }
    })
  );

  // Also support Escape key to dismiss any open setup modal
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      modalOpenedFromReset = false;
      ui.hidePreGameModal();
      ui.hideLiveSessionModal();
      ui.hideStorageAuditModal();
    }
  });


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
    const outcome = await chessStore.hydrate();
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

    const storeState = chessStore.getState();
    persistenceEnabled = storeState.persistenceEnabled;

    if (outcome.status === StorageLoadStatusEnum.Restored && outcome.session) {
      currentMode = storeState.mode;
      currentDifficulty = storeState.difficulty;
      currentTheme = storeState.theme;
      applyThemePalette(currentTheme, materials, squareMeshes, {
        scene,
        hemiLight,
        altarWarmLight,
        strikeFlashLight
      });

      allowUndo = storeState.allowUndo;
      pendingAllowUndo = allowUndo;
      useActionCam = storeState.useActionCam;
      matchStarted = storeState.gameStarted;
      settingsSnapshotOnOpen = {
        mode: currentMode,
        difficulty: currentDifficulty,
        allowUndo
      };

      // Restore Display Contrast & Brightness
      displaySettings.contrast = storeState.contrast;
      displaySettings.brightness = storeState.brightness;
      setDisplaySettings(displaySettings);
      applyDisplaySettings(displaySettings, renderer, hemiLight, boardKeyLight, container);
      syncDisplayInputs();

      // Check if restoring a Live session
      if (storeState.mode === GameModeEnum.Live && storeState.liveSession) {
        const live = storeState.liveSession;
        liveUserRole = live.role;
        if (liveUserRole === 'black') {
          camController.camState.theta = Math.PI;
        } else {
          camController.camState.theta = 0;
        }
        ui.hideLiveSessionModal();
        ui.hidePreGameModal();
        initRealtimeClient(live.sessionId, live.participantId, live.token);

        // Fetch latest authoritative FEN from PocketHost
        try {
          const sRes = await fetch(
            `${PocketBaseChessClient.getEndpoint()}/api/collections/game_sessions/records/${live.sessionId}`
          );
          if (sRes.ok) {
            const sData = (await sRes.json()) as { fen?: string };
            if (sData?.fen && sData.fen.trim()) {
              chess.load(sData.fen);
            }
          }
        } catch (e) {
          logger.warn('[LIVE] Could not fetch remote session FEN on restore:', e);
        }

        ui.showTemporaryBanner(
          `Reconnected to Live Session ${live.sessionCode} as ${liveUserRole.toUpperCase()}!`,
          3200
        );
      } else {
        // Replay move history so full algebraic chronicle & captured pieces restore
        chess.reset();
        if (storeState.history.length > 0) {
          for (const san of storeState.history) {
            const moved = chess.move(san);
            if (!moved) {
              chess.load(storeState.fen);
              break;
            }
          }
          ui.hidePreGameModal();
          ui.showTemporaryBanner('Sanctuary Session Restored from IndexedDB', 2800);
        } else {
          if (storeState.fen && storeState.fen !== INITIAL_BOARD_FEN) {
            chess.load(storeState.fen);
          }
          if (matchStarted) {
            ui.hidePreGameModal();
            ui.showTemporaryBanner('Sanctuary Session Restored from IndexedDB', 2800);
          }
        }
      }
    }

    // URL search parameter & universal arcade game routing handling
    const route = resolveRoute(window.location.search);
    if (route.showHub) {
      ui.showArcadeHub();
    }
    route.sessionCode.map(sessionCode => {
      if (route.game === 'chess') {
        const activeLiveCode = chessStore.getState().liveSession?.sessionCode;
        if (!activeLiveCode || activeLiveCode.toUpperCase() !== sessionCode.toUpperCase()) {
          ui.showLiveSessionModal();
          ui.switchLiveSessionTab('join');
          domById<HTMLInputElement>('live-join-code').map(joinCodeInput => {
            joinCodeInput.value = sessionCode.toUpperCase();
          });
        }
      } else if (route.game === 'blackjack') {
        bjkLiveCode = sessionCode;
        setBlackjackMode(true);
        renderBlackjackTable();
        ui.showBlackjack();
      } else if (route.game === 'poker') {
        pokerLiveCode = sessionCode;
        setPokerMode(true);
        renderPokerTable();
        ui.showPoker();
      } else if (route.game === 'skipbo') {
        skipboLiveCode = sessionCode;
        setSkipBoMode(true);
        renderSkipBoTable();
        ui.showSkipBo();
      } else if (route.game === 'phase10') {
        phase10LiveCode = sessionCode;
        setPhase10Mode(true);
        renderPhase10Table();
        ui.showPhase10();
      } else if (route.game === 'uno') {
        unoLiveCode = sessionCode;
        setUnoMode(true);
        renderUnoTable();
        ui.showUno();
      } else if (route.game === 'avalon') {
        avalonLiveCode = sessionCode;
        setAvalonMode(true);
        renderAvalonTable();
        ui.showAvalon();
      } else if (route.game === 'set') {
        setLiveCode = sessionCode;
        setSetMode(true);
        renderSetTable();
        ui.showSet();
      } else {
        ui.showArcadeHub();
        const gameMeta = ARCADE_GAMES[route.game];
        ui.setHubQuickJoinFeedback(
          `Invited to ${gameMeta.title} match: ${sessionCode}`,
          false
        );
      }
    });

    syncBoardPiecesWithChessState();
    updateHighlights();
    syncAllControlsUI();
    if (chess.history().length > 0 && currentMode !== GameModeEnum.Live) {
      triggerTurnOrAI();
    }
  }

  // Setup store lifecycle listeners for pagehide, beforeunload, and visibilitychange
  chessStore.setupLifecycleListeners();

  // Initial Sync & IndexedDB Restore
  syncBoardPiecesWithChessState();
  syncAllControlsUI();
  void restoreSessionIfEnabled();

  // Main Render Animation Loop governed by Battery & Power Governor
  const clock = new THREE.Clock();
  const renderGovernor = new RenderGovernor(undefined, performance.now());

  const wakeRenderGovernor = (): void => {
    renderGovernor.recordInteraction(performance.now());
  };
  ['pointerdown', 'pointermove', 'wheel', 'touchstart', 'keydown'].forEach(evtName => {
    window.addEventListener(evtName, wakeRenderGovernor, { passive: true });
  });

  function animateLoop(): void {
    requestAnimationFrame(animateLoop);

    const hasActiveMotion = isAnimating || shatterSystem.hasActiveParticles();
    const decision = renderGovernor.evaluateFrame({
      nowMs: performance.now(),
      isDocumentHidden: document.hidden,
      isCoveredByFullScreenModal: ui.isAnyFullScreenArcadeModalVisible(),
      hasActiveCombatOrMotion: hasActiveMotion
    });

    if (!decision.shouldRenderWebGL) {
      return;
    }

    const dt = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.getElapsedTime();

    if (decision.shouldUpdateShadows) {
      renderer.shadowMap.needsUpdate = true;
    }

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
    if (decision.shouldUpdateParticles) {
      updateDust(dt, elapsed);
    }

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
