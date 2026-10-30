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
import { globalConfigClient } from './realtime/configClient';
import {
  auditEncryptedStorage,
  clearArcadeResumeState,
  loadArcadeResumeState,
  saveArcadeResumeState
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
import { UIController, escapeHtml } from './ui/uiController';
import {
  ModalManager,
  PregameModal,
  PromotionModal,
  GameOverModal,
  StorageAuditModal,
  LiveSessionModal,
  ArcadeRulesModal,
  ArcadeHubModal,
  ArcadeTheaterModal,
  FloatingPanelModal
} from './ui/baseModal';
import {
  BlackjackEngine,
  formatBlackjackAdditiveCount,
  type BlackjackAIModel,
  type BlackjackDifficulty,
  type PlayingCard
} from './games/blackjack/blackjackEngine';
import {
  BlackjackMultiSeatEngine
} from './games/blackjack/blackjackMultiSeatEngine';
import {
  CathedralPokerEngine,
  evaluatePokerHand,
  type PokerPlayerData
} from './games/poker/pokerEngine';
import {
  safeParsePokerPlayerData,
  defaultPokerPlayerData
} from './validation/gameSchemas';
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
import {
  CathedralSolitaireEngine
} from './games/solitaire/solitaireEngine';
import { ArcadeRealtimeClient, type ArcadeConnectionStatus } from './realtime/arcadeRealtimeClient';
import { exportTableSnapshot, importTableSnapshot, type ArcadeTableSnapshot, type SnapshotableEngine } from './games/multiplayer/tableSnapshot';
import type { TableSeatManager } from './games/multiplayer/tableSeatManager';
import {
  claimLiveSeat,
  isLocalTurn,
  parseSeatOwners,
  releaseLiveSeat,
  resolveLocalSeatKey,
  shouldDriveBots,
  type LiveSeatView,
  type SeatOwners
} from './games/multiplayer/liveSeats';
import { generateUuidV4 } from './utils/uuid';
import { currentEpochMs } from './utils/dateTime';
import {
  ArcadeGameEnum,
  CardSuitEnum,
  SystemControlKeyEnum,
  GameCodePrefixEnum,
  PokerVariantEnum,
  PokerActionEnum,
  PokerStageEnum,
  SkipBoSourcePileEnum,
  SkipBoCardTypeEnum,
  SolitaireStageEnum
} from './constants/gameEnums';
import {
  ARCADE_GAMES,
  buildArcadeGameUrl,
  extractSessionCodeOrUrl,
  resolveRoute,
  type ArcadeGameType,
  type RouteResolution
} from './routing/sessionRouter';
import {
  domById,
  fromNullable,
  match,
  matchBool,
  failure,
  none,
  some,
  tryCatch,
  tryCatchAsync,
  zipOptions,
  type Option,
  type Result
} from './utils/fp';
import { logExecutionContext, logger } from './utils/logger';
import { validatePlayerName } from './utils/playerValidation';
import { isDevMode } from './utils/env';
import { ScreenWakeLockManager } from './utils/wakeLock';

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

  // Screen Wake Lock Manager (Serious Eats / Recipe Cook Mode display wake lock)
  const wakeLockManager = new ScreenWakeLockManager(
    typeof navigator !== 'undefined' ? navigator : undefined,
    typeof document !== 'undefined' ? document : undefined,
    active => {
      ui.updateWakeLockUI(active, wakeLockManager.isSupported());
    }
  );
  ui.updateWakeLockUI(wakeLockManager.isActive(), wakeLockManager.isSupported());

  // 6b. Database-Driven PocketBase Configuration Sync (Without Redeployment)
  globalConfigClient.subscribe(() => {
    const announcement = globalConfigClient.getSystemControlValue<string>(SystemControlKeyEnum.GlobalAnnouncement, '');
    if (announcement) {
      ui.showTemporaryBanner(announcement, 6000);
    }
  });
  globalConfigClient.fetchRemoteConfig().catch(() => {});
  // Operator edits to tbl_cfg_* apply live to every open client
  globalConfigClient.subscribeRealtime();

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
      keepScreenAwake: wakeLockManager.isActive() || wakeLockManager.isRequested(),
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

    ui.updateWakeLockUI(wakeLockManager.isActive(), wakeLockManager.isSupported());
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

  // Unified, inheritable modal lifecycle & outside-card hit box interaction binding
  const modalManager = ModalManager.getInstance();

  modalManager.register(new PregameModal()).onClose(() => {
    modalOpenedFromReset = false;
    ui.hidePreGameModal();
  });

  modalManager.register(new PromotionModal()).onClose(() => {
    pendingPromotionMove = null;
    ui.hidePromotionModal();
  });

  modalManager.register(new GameOverModal()).onClose(() => {
    ui.hideGameOver();
  });

  modalManager.register(new StorageAuditModal()).onClose(() => {
    ui.hideStorageAuditModal();
  });

  modalManager.register(new LiveSessionModal()).onClose(() => {
    ui.hideLiveSessionModal();
  });

  modalManager.register(new ArcadeRulesModal()).onClose(() => {
    ui.hideArcadeRules();
  });

  modalManager.register(new ArcadeHubModal()).onClose(() => {
    ui.hideArcadeHub();
  });

  // Active Arcade Real-Time Client for live multiplayer synchronization across arcade theaters
  let activeArcadeClient: ArcadeRealtimeClient | null = null;

  /**
   * Keeps every client at a live table on the same state: local changes publish a full table snapshot
   * as a `state_sync` action, and remote snapshots replace the local engine state.
   */
  interface ArcadeTableSync {
    readonly engine: SnapshotableEngine;
    readonly rerender: () => void;
    readonly exportExtras?: () => unknown;
    readonly importExtras?: (extras: unknown) => void;
    /** Seats humans can own at a live table, keyed by engine player id or seat number. */
    readonly seats?: () => readonly LiveSeatView[];
    readonly claimSeat?: (key: string, playerName: string) => void;
    readonly releaseSeat?: (key: string) => void;
  }

  let activeArcadeSync: Option<ArcadeTableSync> = none();

  // Which human owns which seat at the live table; travels inside every table snapshot
  let liveSeatOwners: SeatOwners = {};
  let hasReceivedTableState = false;

  const exportSyncedSnapshot = (sync: ArcadeTableSync): ArcadeTableSnapshot =>
    exportTableSnapshot(sync.engine, { owners: liveSeatOwners, game: sync.exportExtras?.() ?? null });

  const importSyncedSnapshot = (sync: ArcadeTableSync,
                                raw: unknown): Result<void, string> =>
    importTableSnapshot(sync.engine, raw).map(extras => {
      const wrapped = (typeof extras === 'object' && extras !== null ? extras : {}) as { owners?: unknown; game?: unknown };
      liveSeatOwners = parseSeatOwners(wrapped.owners);
      sync.importExtras?.(wrapped.game);
    });
  let applyingRemoteSnapshot = false;
  let lastSyncedSnapshotJson = '';
  let pendingSyncTimer: Option<ReturnType<typeof setTimeout>> = none();

  // Assigned once the arcade engines exist; renders may call it earlier as a no-op
  let scheduleArcadeResumeSave: () => void = () => undefined;

  const publishArcadeStateIfChanged = (): void => {
    zipOptions(fromNullable(activeArcadeClient), activeArcadeSync).map(([client, sync]) => {
      const snapshot = exportSyncedSnapshot(sync);
      const json = JSON.stringify(snapshot);
      if (json === lastSyncedSnapshotJson) return;
      lastSyncedSnapshotJson = json;
      void client.sendAction('state_sync', snapshot as unknown as Record<string, unknown>).then(res =>
        res.match({
          Ok: () => undefined,
          Err: err => {
            logger.warn('[ARCADE_REALTIME] Table sync failed:', err);
            ui.showTemporaryBanner('Live table sync failed. Your last move may not have reached other players.', 3500);
          }
        })
      );
    });
  };

  /** Called by every arcade table render; batches rapid state changes into one snapshot. */
  const scheduleArcadeStateSync = (): void => {
    scheduleArcadeResumeSave();
    if (applyingRemoteSnapshot || activeArcadeSync.isNone()) return;
    // A guest's fresh local table must never overwrite the host's table before the first sync arrives
    if (!isLocalPlayerHost && !hasReceivedTableState) return;
    pendingSyncTimer.map(timer => clearTimeout(timer));
    const batchMs = Math.min(2000, Math.max(0, Number(globalConfigClient.getSystemControlValue<number>(SystemControlKeyEnum.ArcadeSyncBatchMs, 150)) || 150));
    pendingSyncTimer = some(setTimeout(() => {
      pendingSyncTimer = none();
      publishArcadeStateIfChanged();
    }, batchMs));
  };

  const disconnectActiveArcade = (): void => {
    fromNullable(activeArcadeClient).map(client => {
      void client.leaveSeat();
      client.disconnect();
      activeArcadeClient = null;
    });
    activeArcadeSync = none();
  };

  modalManager.register(
    new ArcadeTheaterModal('blackjack-modal', ['#btn-close-blackjack', '#btn-close-blackjack-x'])
  ).onClose(() => {
    disconnectActiveArcade();
    forgetArcadeResume();
    ui.hideBlackjack();
  });

  modalManager.register(
    new ArcadeTheaterModal('poker-modal', ['#btn-close-poker', '#btn-close-poker-x'])
  ).onClose(() => {
    disconnectActiveArcade();
    forgetArcadeResume();
    ui.hidePoker();
  });

  modalManager.register(
    new ArcadeTheaterModal('skipbo-modal', ['#btn-close-skipbo', '#btn-close-skipbo-x'])
  ).onClose(() => {
    disconnectActiveArcade();
    forgetArcadeResume();
    ui.hideSkipBo();
  });

  modalManager.register(
    new ArcadeTheaterModal('phase10-modal', ['#btn-close-phase10', '#btn-close-phase10-x'])
  ).onClose(() => {
    disconnectActiveArcade();
    forgetArcadeResume();
    ui.hidePhase10();
  });

  modalManager.register(
    new ArcadeTheaterModal('uno-modal', ['#btn-close-uno', '#btn-close-uno-x'])
  ).onClose(() => {
    disconnectActiveArcade();
    forgetArcadeResume();
    ui.hideUno();
  });

  modalManager.register(
    new ArcadeTheaterModal('avalon-modal', ['#btn-close-avalon', '#btn-close-avalon-x'])
  ).onClose(() => {
    disconnectActiveArcade();
    forgetArcadeResume();
    ui.hideAvalon();
  });

  modalManager.register(
    new ArcadeTheaterModal('set-modal', ['#btn-close-set', '#btn-close-set-x'])
  ).onClose(() => {
    disconnectActiveArcade();
    forgetArcadeResume();
    ui.hideSet();
  });

  modalManager.register(
    new FloatingPanelModal('contrast-panel', '#close-contrast-btn')
  );

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

  // Seamless Arcade Navigation: Hub & Sanctuary Links across all games
  document.querySelectorAll('[data-arcade-nav="hub"]').forEach(btn => {
    btn.addEventListener('click', (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      disconnectActiveArcade();
      if (typeof window !== 'undefined' && window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      ui.hideAllArcadeModals();
      ui.showArcadeHub();
      soundFX.playSelect();
    });
  });

  document.querySelectorAll('[data-arcade-nav="chess"]').forEach(btn => {
    btn.addEventListener('click', (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      disconnectActiveArcade();
      if (typeof window !== 'undefined' && window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      ui.hideAllArcadeModals();
      soundFX.playSelect();
      syncBoardPiecesWithChessState();
      updateHighlights();
    });
  });

  document.querySelectorAll<HTMLSelectElement>('.arcade-quick-switcher').forEach(sel => {
    sel.addEventListener('change', () => {
      const target = sel.value;
      if (target) {
        switchToArcadeGame(target as any);
        sel.value = '';
      }
    });
  });

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

  // Universal Arcade Rules Modal Controls & Theater Guide Triggers
  fromNullable(document.getElementById('btn-close-arcade-rules')).map(btn =>
    btn.addEventListener('click', () => ui.hideArcadeRules())
  );
  fromNullable(document.getElementById('btn-dismiss-arcade-rules')).map(btn =>
    btn.addEventListener('click', () => ui.hideArcadeRules())
  );

  fromNullable(document.getElementById('btn-chess-rules')).map(btn =>
    btn.addEventListener('click', () => ui.showArcadeRules(ArcadeGameEnum.Chess))
  );
  fromNullable(document.getElementById('btn-bjk-rules')).map(btn =>
    btn.addEventListener('click', () => ui.showArcadeRules(ArcadeGameEnum.Blackjack))
  );
  fromNullable(document.getElementById('btn-poker-rules')).map(btn =>
    btn.addEventListener('click', () => ui.showArcadeRules(ArcadeGameEnum.Poker))
  );
  fromNullable(document.getElementById('btn-skipbo-rules')).map(btn =>
    btn.addEventListener('click', () => ui.showArcadeRules(ArcadeGameEnum.SkipBo))
  );
  fromNullable(document.getElementById('btn-phase10-rules')).map(btn =>
    btn.addEventListener('click', () => ui.showArcadeRules(ArcadeGameEnum.Phase10))
  );
  fromNullable(document.getElementById('btn-uno-rules')).map(btn =>
    btn.addEventListener('click', () => ui.showArcadeRules(ArcadeGameEnum.Uno))
  );
  fromNullable(document.getElementById('btn-avalon-rules')).map(btn =>
    btn.addEventListener('click', () => ui.showArcadeRules(ArcadeGameEnum.Avalon))
  );
  fromNullable(document.getElementById('btn-set-rules')).map(btn =>
    btn.addEventListener('click', () => ui.showArcadeRules(ArcadeGameEnum.Set))
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
  let bjkMultiEngine = new BlackjackMultiSeatEngine(3, 10, 500);
  bjkMultiEngine.seatManager.claimSeat(1, 'p1', 'You (Pilgrim)');
  bjkMultiEngine.populateBotOpponents();

  /** Live Blackjack plays on the multi-seat table; each player sees and acts for their own seat. */
  const bjkLocalSeat = (): number => localSeatKeyFor('1').map(Number).getOrElse(0);
  const isBjkLocalTurn = (): boolean =>
    bjkMultiEngine.state.activeSeatTurn.map(seatNum => isLocalArcadeTurn('1', String(seatNum))).getOrElse(false);

  interface BlackjackView {
    readonly chipBank: number;
    readonly currentBet: number;
    readonly historyText: readonly string[];
    readonly outcome: string;
    readonly dealerHand: readonly PlayingCard[];
    readonly playerHand: readonly PlayingCard[];
    readonly stage: string;
  }

  /** Maps a multi-seat result onto the single-table outcome names the banner styling uses. */
  const liveBlackjackOutcome = (outcome: string,
                                status: string): string =>
    fromNullable(({
      won: 'player-won',
      blackjack: 'player-blackjack',
      lost: status === 'busted' ? 'player-busted' : 'dealer-won',
      push: 'push'
    } as Readonly<Record<string, string>>)[outcome]).getOrElse('in-progress');

  const blackjackView = (): BlackjackView =>
    matchBool(isArcadeLive(), {
      true: (): BlackjackView => {
        const m = bjkMultiEngine.state;
        const data = bjkMultiEngine.seatManager.getSeat(bjkLocalSeat()).map(seat => seat.extraData);
        return {
          chipBank: data.map(d => d.chipBank).getOrElse(0),
          currentBet: data.map(d => d.currentBet).getOrElse(0),
          historyText: m.historyText,
          outcome: data.map(d => liveBlackjackOutcome(d.outcome, d.status)).getOrElse('in-progress'),
          dealerHand: m.dealerHand,
          playerHand: data.map(d => d.cards).getOrElse([]),
          stage: isBjkLocalTurn() ? 'player-turn' : m.stage
        };
      },
      false: (): BlackjackView => bjkEngine.state
    });

  /** Between hands the live table returns to betting before anyone can bet or deal. */
  const ensureBjkBettingStage = (): void => {
    if (bjkMultiEngine.state.stage === 'round-settled') {
      bjkMultiEngine.prepareNextHand();
    }
  };

  const renderBlackjackTable = () => {
    scheduleArcadeStateSync();
    const s = blackjackView();
    domById('bjk-seats-track').map((track: HTMLElement) => {
      const occupied = bjkMultiEngine.seatManager.getOccupiedSeats();
      track.innerHTML = occupied
        .map(seat => {
          const isTurn = bjkMultiEngine.state.activeSeatTurn.getOrElse(-1) === seat.seatNumber;
          const canKick = isLocalPlayerHost && isArcadeLive() && !seat.isBot && seat.seatNumber !== bjkLocalSeat();
          return `
            <div data-bjk-seat="${seat.seatNumber}" class="px-3.5 py-2 rounded-2xl bg-black/65 border-2 ${
              isTurn ? 'border-amber-400 ring-2 ring-amber-400/50' : 'border-purple-500/40'
            } flex items-center gap-2.5 text-xs sm:text-sm cursor-pointer hover:border-amber-300 transition shadow-md" title="Click to claim seat as Human User">
              <div class="w-2.5 h-2.5 rounded-full ${seat.isBot ? 'bg-purple-400' : 'bg-emerald-400'}"></div>
              <span class="font-bold text-stone-100">S${seat.seatNumber}: ${escapeHtml(seat.playerName)}</span>
              <span class="text-amber-300 font-mono font-bold">${seat.extraData?.chipBank ?? 500}🪙</span>
              <span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${
                seat.isBot ? 'bg-purple-950/90 text-purple-200 border border-purple-400/30' : 'bg-emerald-950/90 text-emerald-200 border border-emerald-400/30'
              }">${seat.isBot ? 'AI' : 'Human'}</span>
              ${
                canKick
                  ? `<button type="button" data-kick-participant="${escapeHtml(seat.playerId)}" data-kick-name="${escapeHtml(seat.playerName)}" class="ml-1 px-1.5 py-0.5 rounded-md bg-red-950/90 hover:bg-red-900 text-red-300 border border-red-500/40 text-[10px] font-bold transition" title="Kick Player from Table">Kick</button>`
                  : ''
              }
            </div>
          `;
        })
        .join('');
      track.querySelectorAll('[data-kick-participant]').forEach(btn => {
        btn.addEventListener('click', (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          const targetId = btn.getAttribute('data-kick-participant') || '';
          const targetName = btn.getAttribute('data-kick-name') || 'Player';
          if (targetId) {
            kickLiveParticipant(targetId, targetName);
          }
        });
      });
      track.querySelectorAll('[data-bjk-seat]').forEach(el => {
        el.addEventListener('click', (e: Event) => {
          if ((e.target as HTMLElement)?.closest('[data-kick-participant]') || isArcadeLive()) return;
          const seatNum = parseInt(el.getAttribute('data-bjk-seat') || '1', 10);
          bjkMultiEngine.seatManager.claimSeat(seatNum, `human_s${seatNum}`, `Player ${seatNum}`);
          soundFX.playSelect();
          renderBlackjackTable();
        });
      });
    });

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
      el.textContent = formatBlackjackAdditiveCount(s.dealerHand, s.stage === 'player-turn');
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
      el.textContent = formatBlackjackAdditiveCount(s.playerHand, false);
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

  let bjkIsLive = false;
  fromNullable(document.getElementById('bjk-btn-deal')).map(btn =>
    btn.addEventListener('click', () => {
      matchBool(isArcadeLive(), {
        true: () => {
          // The host deals for the whole live table
          if (blockGuestTableReset()) return;
          ensureBjkBettingStage();
          bjkMultiEngine.startRound();
        },
        false: () => {
          bjkEngine.startRound();
        }
      });
      soundFX.playSelect();
      if (bjkIsLive && activeArcadeClient) {
        void activeArcadeClient.dispatchAction('bjk_deal', {});
      }
      renderBlackjackTable();
    })
  );

  fromNullable(document.getElementById('bjk-btn-hit')).map(btn =>
    btn.addEventListener('click', () => {
      if (isArcadeLive()) {
        if (!isBjkLocalTurn()) return;
        bjkMultiEngine.playerHit(bjkLocalSeat());
      } else {
        bjkEngine.hit();
      }
      soundFX.playSelect();
      if (bjkIsLive && activeArcadeClient) {
        void activeArcadeClient.dispatchAction('bjk_hit', {});
      }
      renderBlackjackTable();
    })
  );

  fromNullable(document.getElementById('bjk-btn-stand')).map(btn =>
    btn.addEventListener('click', () => {
      if (isArcadeLive()) {
        if (!isBjkLocalTurn()) return;
        bjkMultiEngine.playerStand(bjkLocalSeat());
      } else {
        bjkEngine.stand();
      }
      soundFX.playCathedralOrganAndBell();
      if (bjkIsLive && activeArcadeClient) {
        void activeArcadeClient.dispatchAction('bjk_stand', {});
      }
      renderBlackjackTable();
    })
  );

  fromNullable(document.getElementById('bjk-btn-double')).map(btn =>
    btn.addEventListener('click', () => {
      if (isArcadeLive()) {
        if (!isBjkLocalTurn()) return;
        bjkMultiEngine.playerDoubleDown(bjkLocalSeat());
      } else {
        bjkEngine.doubleDown();
      }
      soundFX.playSelect();
      if (bjkIsLive && activeArcadeClient) {
        void activeArcadeClient.dispatchAction('bjk_double', {});
      }
      renderBlackjackTable();
    })
  );

  document.querySelectorAll('.bjk-bet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const amt = parseInt(btn.getAttribute('data-bet') || '25', 10);
      if (isArcadeLive()) {
        if (bjkLocalSeat() === 0) return;
        ensureBjkBettingStage();
        bjkMultiEngine.placeBet(bjkLocalSeat(), amt);
      } else {
        bjkEngine.placeBet(amt);
      }
      soundFX.playSelect();
      if (bjkIsLive && activeArcadeClient) {
        void activeArcadeClient.dispatchAction('bjk_bet', { amount: amt });
      }
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

  domById<HTMLSelectElement>('bjk-seats-select').map(sel =>
    sel.addEventListener('change', () => {
      const targetSeats = parseInt(sel.value || '3', 10);
      bjkMultiEngine = new BlackjackMultiSeatEngine(7, 10, 500);
      bjkMultiEngine.seatManager.claimSeat(1, 'p1', 'You (Pilgrim)');
      for (let i = 2; i <= targetSeats; i++) {
        bjkMultiEngine.addPlayer(`Cathedral Pilgrim ${i}`, false);
      }
      soundFX.playSelect();
      renderBlackjackTable();
    })
  );

  domById('bjk-btn-add-player').map(btn =>
    btn.addEventListener('click', () => {
      const nextNum = bjkMultiEngine.seatManager.getOccupiedSeats().length + 1;
      const res = bjkMultiEngine.addPlayer(`Pilgrim User ${nextNum}`, false);
      if (res.isSuccess()) {
        soundFX.playSelect();
        domById<HTMLSelectElement>('bjk-seats-select').map(sel => {
          sel.value = String(bjkMultiEngine.seatManager.getOccupiedSeats().length);
        });
      }
      renderBlackjackTable();
    })
  );

  // Arcade Multi-Game State & Real-Name Verification
  let isLocalPlayerHost = false;
  let verifiedPlayerName: Option<string> = none();
  let pendingJoinSessionCode: Option<string> = none();
  let pendingJoinGame: Option<ArcadeGameType> = none();

  const switchToArcadeGame = (targetGame: ArcadeGameType | 'hub'): void => {
    ui.hideAllArcadeModals();
    soundFX.playSelect();
    if (typeof window !== 'undefined' && window.location.search && (targetGame === 'chess' || targetGame === 'hub')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    if (targetGame === 'hub') {
      disconnectActiveArcade();
      forgetArcadeResume();
      ui.showArcadeHub();
    } else if (targetGame === 'chess') {
      disconnectActiveArcade();
      forgetArcadeResume();
      syncBoardPiecesWithChessState();
      updateHighlights();
    } else if (targetGame === 'blackjack') {
      setBlackjackMode(false);
      renderBlackjackTable();
      ui.showBlackjack();
    } else if (targetGame === 'poker') {
      setPokerMode(false);
      renderPokerTable();
      ui.showPoker();
    } else if (targetGame === 'skipbo') {
      setSkipBoMode(false);
      renderSkipBoTable();
      ui.showSkipBo();
    } else if (targetGame === 'phase10') {
      setPhase10Mode(false);
      renderPhase10Table();
      ui.showPhase10();
    } else if (targetGame === 'uno') {
      setUnoMode(false);
      renderUnoTable();
      ui.showUno();
    } else if (targetGame === 'avalon') {
      setAvalonMode(false);
      renderAvalonTable();
      ui.showAvalon();
    } else if (targetGame === 'set') {
      setSetMode(false);
      renderSetTable();
      ui.showSet();
    } else if (targetGame === 'solitaire') {
      setSolitaireMode(false);
      renderSolitaireBoard();
      ui.showSolitaire();
    }
  };

  const promptJoinLiveSession = (gameType: ArcadeGameType,
                                 sessionCode: string): void => {
    pendingJoinGame = some(gameType);
    pendingJoinSessionCode = some(sessionCode);
    const meta = ARCADE_GAMES[gameType];
    const initialName = verifiedPlayerName.getOrElse('');
    ui.showArcadeJoinModal(
      meta ? meta.title : 'Sanctuary Arcade',
      meta ? meta.icon : 'token',
      sessionCode,
      initialName
    );
  };

  const joinVerifiedArcadeGame = (game: ArcadeGameType,
                                  code: string,
                                  playerName: string): void => {
    ui.hideAllArcadeModals();
    soundFX.playSelect();

    if (game === 'chess') {
      forgetArcadeResume();
      ui.showLiveSessionModal();
      ui.switchLiveSessionTab('join');
      domById<HTMLInputElement>('live-join-code').map(joinCodeInput => {
        joinCodeInput.value = code;
      });
    } else if (game === 'blackjack') {
      bjkLiveCode = code;
      bjkMultiEngine.seatManager.claimSeat(1, 'p1', playerName);
      setBlackjackMode(true);
      renderBlackjackTable();
      ui.showBlackjack();
    } else if (game === 'poker') {
      pokerLiveCode = code;
      pokerEngine.seatManager.claimSeat(1, 'p1', playerName);
      setPokerMode(true);
      renderPokerTable();
      ui.showPoker();
    } else if (game === 'skipbo') {
      skipboLiveCode = code;
      skipboEngine.claimSeatForHuman(0, playerName);
      setSkipBoMode(true);
      renderSkipBoTable();
      ui.showSkipBo();
    } else if (game === 'phase10') {
      phase10LiveCode = code;
      phase10Engine.claimSeatForHuman(0, playerName);
      setPhase10Mode(true);
      renderPhase10Table();
      ui.showPhase10();
    } else if (game === 'uno') {
      unoLiveCode = code;
      unoEngine.claimSeatForHuman(0, playerName);
      setUnoMode(true);
      renderUnoTable();
      ui.showUno();
    } else if (game === 'avalon') {
      avalonLiveCode = code;
      avalonEngine.claimSeatForHuman(0, playerName);
      setAvalonMode(true);
      renderAvalonTable();
      ui.showAvalon();
    } else if (game === 'set') {
      setLiveCode = code;
      setSetMode(true);
      renderSetTable();
      ui.showSet();
    } else if (game === 'solitaire') {
      solitaireLiveCode = code;
      setSolitaireMode(true, !isLocalPlayerHost);
      renderSolitaireBoard();
      ui.showSolitaire();
    }
  };

  domById('btn-arcade-cancel-join').map(btn =>
    btn.addEventListener('click', () => {
      ui.hideArcadeJoinModal();
      pendingJoinSessionCode = none();
      pendingJoinGame = none();
      ui.showArcadeHub();
    })
  );

  domById('btn-close-arcade-join').map(btn =>
    btn.addEventListener('click', () => {
      ui.hideArcadeJoinModal();
      pendingJoinSessionCode = none();
      pendingJoinGame = none();
    })
  );

  domById('btn-arcade-confirm-join').map(btn =>
    btn.addEventListener('click', () => {
      const rawName = domById<HTMLInputElement>('arcade-join-player-name-input')
        .map(i => i.value)
        .getOrElse('');
      const validationRes = validatePlayerName(rawName);

      validationRes.match({
        Ok: (cleanName: string) => {
          verifiedPlayerName = some(cleanName);
          ui.setArcadeJoinError(none());
          ui.hideArcadeJoinModal();

          const game = pendingJoinGame.getOrElse('poker');
          const code = pendingJoinSessionCode.getOrElse('');
          joinVerifiedArcadeGame(game, code, cleanName);
        },
        Err: (errMsg: string) => {
          ui.setArcadeJoinError(some(errMsg));
          soundFX.playSelect();
        }
      });
    })
  );

  // Common Arcade Live Session Sharing Helper
  const generateArcadeCode = (prefix: string) =>
    `${prefix}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  const copyArcadeMatchLink = (code: string,
                               btnEl: HTMLElement | null,
                               gameTitle: string = 'Match'): void => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?session=${code}`;
    void navigator.clipboard.writeText(shareUrl).then(() => {
      soundFX.playSelect();
      fromNullable(btnEl).map(el => {
        const originalText = el.innerHTML;
        el.innerHTML = '<span class="material-symbols-rounded text-xs">done</span><span>Copied!</span>';
        setTimeout(() => {
          el.innerHTML = originalText;
        }, 2000);
      });
      ui.showTemporaryBanner(`${gameTitle} Live Link copied to clipboard! Share it with your opponents.`, 3000);
    });
  };

  const copyArcadeMatchCode = (code: string,
                               btnEl: HTMLElement | null,
                               gameTitle: string = 'Match'): void => {
    void navigator.clipboard.writeText(code).then(() => {
      soundFX.playSelect();
      fromNullable(btnEl).map(el => {
        const originalText = el.innerHTML;
        el.innerHTML = '<span class="material-symbols-rounded text-xs">done</span><span>Copied!</span>';
        setTimeout(() => {
          el.innerHTML = originalText;
        }, 2000);
      });
      ui.showTemporaryBanner(`${gameTitle} Room Code ${code} copied to clipboard!`, 2500);
    });
  };

  // One participant id per page load, so reconnects and table switches keep the same identity
  let arcadeParticipantId = 'usr_' + generateUuidV4().slice(0, 12);

  /** Live view of an engine variable that is reassigned when a new game starts. */
  const engineRef = (getEngine: () => SnapshotableEngine): SnapshotableEngine => ({
    get state() {
      return getEngine().state;
    },
    set state(value: unknown) {
      getEngine().state = value;
    },
    get seatManager() {
      return getEngine().seatManager;
    }
  });

  /**
   * Seats a live participant on a numbered seat. A seat still held by a local placeholder human (the
   * host's default seat) is first returned to the bot pool, which keeps its chips and cards.
   */
  const claimNumberedSeat = (seatManager: TableSeatManager<any>,
                             key: string,
                             playerName: string): void => {
    const seatNumber = Number(key);
    seatManager.getSeat(seatNumber)
      .filter(seat => seat.isOccupied && !seat.isBot && seat.playerId !== arcadeParticipantId)
      .map(() => seatManager.vacateSeat(seatNumber));
    seatManager.claimSeat(seatNumber, arcadeParticipantId, playerName);
  };

  /** Seat adapter for engines that model the table as `state.players` with `claimSeatForHuman`. */
  const playerListSeats = (getEngine: () => {
    readonly state: { readonly players: readonly { readonly id: string; readonly isBot: boolean }[] };
    claimSeatForHuman(playerIndex: number, humanName: string): unknown;
    vacatePlayerSeat(playerId: string): unknown;
  }): Pick<ArcadeTableSync, 'seats' | 'claimSeat' | 'releaseSeat'> => ({
    seats: () => getEngine().state.players.map(p => ({ key: p.id, isBot: p.isBot })),
    claimSeat: (key, playerName) => {
      const idx = getEngine().state.players.findIndex(p => p.id === key);
      if (idx >= 0) getEngine().claimSeatForHuman(idx, playerName);
    },
    releaseSeat: key => {
      getEngine().vacatePlayerSeat(key);
    }
  });

  const arcadeTableSyncFor = (game: ArcadeGameEnum): Option<ArcadeTableSync> =>
    match<ArcadeGameEnum, Option<ArcadeTableSync>>(game, {
      [ArcadeGameEnum.Chess]: () => none(),
      [ArcadeGameEnum.Solitaire]: () => none(),
      [ArcadeGameEnum.Blackjack]: () => some({
        engine: engineRef(() => ({
          get state() {
            return { single: bjkEngine.state, multi: bjkMultiEngine.state };
          },
          set state(value: unknown) {
            const next = value as { single: typeof bjkEngine.state; multi: typeof bjkMultiEngine.state };
            bjkEngine.state = next.single;
            bjkMultiEngine.state = next.multi;
          },
          seatManager: bjkMultiEngine.seatManager
        })),
        rerender: () => renderBlackjackTable(),
        seats: () => bjkMultiEngine.seatManager.getOccupiedSeats().map(seat => ({ key: String(seat.seatNumber), isBot: seat.isBot })),
        claimSeat: (key, playerName) => claimNumberedSeat(bjkMultiEngine.seatManager, key, playerName),
        releaseSeat: key => {
          bjkMultiEngine.seatManager.vacateSeat(Number(key));
        }
      }),
      [ArcadeGameEnum.Poker]: () => some({
        engine: engineRef(() => pokerEngine),
        rerender: () => {
          runPokerBots();
          renderPokerTable();
        },
        seats: () => pokerEngine.seatManager.getOccupiedSeats().map(seat => ({ key: String(seat.seatNumber), isBot: seat.isBot })),
        claimSeat: (key, playerName) => claimNumberedSeat(pokerEngine.seatManager, key, playerName),
        releaseSeat: key => {
          pokerEngine.seatManager.vacateSeat(Number(key));
        },
        exportExtras: () => pokerEngine.exportShoe(),
        importExtras: extras => {
          if (Array.isArray(extras)) pokerEngine.importShoe(extras as PlayingCard[]);
        }
      }),
      [ArcadeGameEnum.SkipBo]: () => some({ engine: engineRef(() => skipboEngine), rerender: () => {
        renderSkipBoTable();
        runSkipBoBots();
      }, ...playerListSeats(() => skipboEngine) }),
      [ArcadeGameEnum.Phase10]: () => some({ engine: engineRef(() => phase10Engine), rerender: () => {
        renderPhase10Table();
        runPhase10Bots();
      }, ...playerListSeats(() => phase10Engine) }),
      [ArcadeGameEnum.Uno]: () => some({
        engine: engineRef(() => unoEngine),
        rerender: () => {
          renderUnoTable();
          checkAndRunUnoBots();
        },
        ...playerListSeats(() => unoEngine)
      }),
      [ArcadeGameEnum.Avalon]: () => some({ engine: engineRef(() => avalonEngine), rerender: () => renderAvalonTable(), ...playerListSeats(() => avalonEngine) }),
      [ArcadeGameEnum.Set]: () => some({ engine: engineRef(() => setEngine), rerender: () => renderSetTable(), ...playerListSeats(() => setEngine) })
    });

  // DB-driven arcade pacing (tbl_cfg_system_controls), clamped to sane bounds
  const arcadeBotTurnDelayMs = (): number =>
    Math.min(5000, Math.max(100, Number(globalConfigClient.getSystemControlValue<number>(SystemControlKeyEnum.ArcadeBotTurnDelayMs, 700)) || 700));

  // --- Live seats: every human at a live table acts for their own seat ---
  const isArcadeLive = (): boolean => activeArcadeClient !== null;

  /** The seat the local player acts for: `defaultKey` against AI, their owned seat at a live table. */
  const localSeatKeyFor = (defaultKey: string): Option<string> =>
    resolveLocalSeatKey(isArcadeLive(), liveSeatOwners, arcadeParticipantId, defaultKey);

  /** Only one browser per table plays the bots: the local one against AI, the host's when live. */
  const canDriveArcadeBots = (): boolean => shouldDriveBots(isArcadeLive(), isLocalPlayerHost);

  const isLocalArcadeTurn = (defaultKey: string,
                             currentSeatKey: string): boolean =>
    isLocalTurn(localSeatKeyFor(defaultKey), currentSeatKey);

  const ensureLocalLiveSeat = (sync: ArcadeTableSync): void => {
    // Seats are only claimed at live tables; against AI the local player already owns the first seat
    if (!isArcadeLive()) return;
    zipOptions(fromNullable(sync.seats), fromNullable(sync.claimSeat)).map(([seats, claim]) =>
      claimLiveSeat(seats(), liveSeatOwners, arcadeParticipantId, isLocalPlayerHost).map(({ key, owners }) => {
        liveSeatOwners = owners;
        claim(key, verifiedPlayerName.getOrElse('Cathedral Player'));
        sync.rerender();
        ui.showTemporaryBanner('You have a seat at the table.', 2000);
      })
    );
  };

  /** Host only: hands a departed human's seat back to a bot so the match keeps going. */
  const releaseLiveParticipant = (participantId: string): void => {
    if (!isLocalPlayerHost) return;
    activeArcadeSync.map(sync =>
      fromNullable(Object.entries(liveSeatOwners).find(([, owner]) => owner === participantId)).map(([key]) => {
        sync.releaseSeat?.(key);
        liveSeatOwners = releaseLiveSeat(liveSeatOwners, participantId);
        sync.rerender();
      })
    );
  };

  /** Host only: removes a participant from the live table and returns their seat to a bot. */
  const kickLiveParticipant = (targetParticipantId: string,
                               targetName: string): void => {
    fromNullable(activeArcadeClient).map(client => {
      void client.kickPlayer(targetParticipantId, 'Removed by table host').then(res =>
        res.match({
          Ok: () => ui.showTemporaryBanner(`Removed ${targetName} from the table.`, 2500),
          Err: err => ui.showTemporaryBanner(`Could not remove ${targetName}: ${err}`, 3500)
        })
      );
      releaseLiveParticipant(targetParticipantId);
    });
  };

  /** Guests at a live table cannot reset it; the host owns table setup. */
  const blockGuestTableReset = (): boolean => {
    const blocked = isArcadeLive() && !isLocalPlayerHost;
    if (blocked) {
      ui.showTemporaryBanner('Only the table host can change the table setup.', 2500);
    }
    return blocked;
  };

  /** After the host deals a fresh table, everyone re-claims a seat on the next sync. */
  const reseatAfterHostTableReset = (): void => {
    if (!isArcadeLive()) return;
    liveSeatOwners = {};
    activeArcadeSync.map(ensureLocalLiveSeat);
  };

  /** Local seat helpers for tables that take turns by `currentTurnIndex` over `state.players`. */
  const turnTableSeat = (getPlayers: () => readonly { readonly id: string; readonly isBot: boolean }[],
                         getTurnIndex: () => number) => ({
    localIndex: (): number => localSeatKeyFor('p1').map(id => getPlayers().findIndex(p => p.id === id)).getOrElse(-1),
    isLocalTurn: (): boolean => fromNullable(getPlayers()[getTurnIndex()]).map(p => isLocalArcadeTurn('p1', p.id)).getOrElse(false),
    isBotTurn: (): boolean => fromNullable(getPlayers()[getTurnIndex()]).map(p => p.isBot).getOrElse(false)
  });

  /**
   * Plays consecutive bot turns with the DB-configured pacing, only on the browser allowed to drive bots.
   */
  const createBotDriver = (isFinished: () => boolean,
                           isBotTurn: () => boolean,
                           playBotTurn: () => void,
                           rerender: () => void): (() => void) => {
    let timer: Option<ReturnType<typeof setTimeout>> = none();
    const run = (): void => {
      timer.map(t => clearTimeout(t));
      timer = none();
      if (isFinished() || !canDriveArcadeBots() || !isBotTurn()) return;
      timer = some(setTimeout(() => {
        timer = none();
        playBotTurn();
        rerender();
        run();
      }, arcadeBotTurnDelayMs()));
    };
    return run;
  };

  // --- Arcade refresh resume: keep a player in their arcade table across reloads on this device ---
  const visibleArcadeGame = (): Option<ArcadeGameEnum> =>
    fromNullable(([
      [ArcadeGameEnum.Blackjack, ui.isBlackjackVisible()],
      [ArcadeGameEnum.Poker, ui.isPokerVisible()],
      [ArcadeGameEnum.SkipBo, ui.isSkipBoVisible()],
      [ArcadeGameEnum.Phase10, ui.isPhase10Visible()],
      [ArcadeGameEnum.Uno, ui.isUnoVisible()],
      [ArcadeGameEnum.Avalon, ui.isAvalonVisible()],
      [ArcadeGameEnum.Set, ui.isSetVisible()],
      [ArcadeGameEnum.Solitaire, ui.isSolitaireVisible()]
    ] as const).find(([, visible]) => visible)).map(([game]) => game);

  const arcadeTableSnapshotFor = (game: ArcadeGameEnum): unknown =>
    matchBool(game === ArcadeGameEnum.Solitaire, {
      true: (): unknown => solitaireEngine.exportSnapshot(),
      false: (): unknown => arcadeTableSyncFor(game)
        .map(sync => exportSyncedSnapshot(sync) as unknown)
        .getOrElse(null)
    });

  let resumeSaveTimer: Option<ReturnType<typeof setTimeout>> = none();

  const persistArcadeResume = (): void => {
    visibleArcadeGame().map(game => {
      const client = fromNullable(activeArcadeClient);
      const sessionCode = client.map(c => c.getSessionCode()).getOrElse('');
      const resumeUrl = buildArcadeGameUrl(window.location.pathname, game, client.isSome() ? sessionCode : undefined);
      if (resumeUrl !== window.location.href) {
        window.history.replaceState(null, '', resumeUrl);
      }
      void saveArcadeResumeState({
        game,
        isLive: client.isSome(),
        sessionCode,
        isHost: isLocalPlayerHost,
        participantId: arcadeParticipantId,
        playerName: verifiedPlayerName.getOrElse(''),
        snapshot: arcadeTableSnapshotFor(game),
        savedAt: currentEpochMs()
      }).then(res =>
        res.match({
          Ok: () => undefined,
          Err: err => {
            logger.warn('[ARCADE_RESUME] Could not save the active arcade table:', err);
          }
        })
      );
    });
  };

  scheduleArcadeResumeSave = (): void => {
    if (!persistenceEnabled) return;
    resumeSaveTimer.map(timer => clearTimeout(timer));
    resumeSaveTimer = some(setTimeout(() => {
      resumeSaveTimer = none();
      persistArcadeResume();
    }, 400));
  };

  /** The player left the arcade table on purpose: stop restoring it on refresh. */
  const forgetArcadeResume = (): void => {
    resumeSaveTimer.map(timer => clearTimeout(timer));
    resumeSaveTimer = none();
    void clearArcadeResumeState();
    // Drop the arcade game from the URL too, or a reload would reopen the table just left
    if (new URLSearchParams(window.location.search).has('game')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  };

  const restoreArcadeTableSnapshot = (game: ArcadeGameEnum,
                                      snapshot: unknown): void => {
    matchBool(game === ArcadeGameEnum.Solitaire, {
      true: () => {
        solitaireEngine.importSnapshot(snapshot).match({
          Ok: () => renderSolitaireBoard(),
          Err: err => {
            logger.warn('[ARCADE_RESUME] Saved Solitaire table was not restored:', err);
          }
        });
      },
      false: () => {
        arcadeTableSyncFor(game).map(sync => applyRemoteArcadeSnapshot(sync, snapshot));
      }
    });
  };

  /**
   * On page load, returns the player to the arcade table they were in. A link to a different live
   * table, or an explicit hub link, takes precedence over the saved table.
   */
  const resumeArcadeTable = async (route: RouteResolution): Promise<boolean> => {
    if (route.showHub || !persistenceEnabled) return false;
    const saved = await loadArcadeResumeState();
    return saved
      .filter(state => state.game in ARCADE_GAMES && state.game !== ArcadeGameEnum.Chess)
      .filter(state => route.sessionCode.match({
        Some: code => state.isLive && code.toUpperCase() === state.sessionCode.toUpperCase(),
        None: () => route.game === ArcadeGameEnum.Chess || route.game === state.game
      }))
      .map(state => {
        const game = state.game as ArcadeGameEnum;
        arcadeParticipantId = state.participantId || arcadeParticipantId;
        verifiedPlayerName = state.playerName ? some(state.playerName) : verifiedPlayerName;
        isLocalPlayerHost = state.isHost;
        matchBool(state.isLive, {
          true: () => joinVerifiedArcadeGame(game, state.sessionCode, state.playerName || 'Cathedral Player'),
          false: () => switchToArcadeGame(game)
        });
        // At a live table only the host may restore its saved copy; guests always take the shared table state
        if (!state.isLive || state.isHost) {
          restoreArcadeTableSnapshot(game, state.snapshot);
        }
        ui.showTemporaryBanner(`Welcome back to ${ARCADE_GAMES[game]?.title ?? 'your table'}.`, 2200);
        return true;
      })
      .getOrElse(false);
  };

  const applyRemoteArcadeSnapshot = (sync: ArcadeTableSync,
                                     raw: unknown): void => {
    importSyncedSnapshot(sync, raw).match({
      Ok: () => {
        lastSyncedSnapshotJson = JSON.stringify(exportSyncedSnapshot(sync));
        applyingRemoteSnapshot = true;
        tryCatch(() => sync.rerender()).match({
          Ok: () => undefined,
          Err: err => logger.error('[ARCADE_REALTIME] Failed rendering synced table:', err)
        });
        applyingRemoteSnapshot = false;
        hasReceivedTableState = true;
        ensureLocalLiveSeat(sync);
        // Bots the host played while rendering the received table are published here (no-op if unchanged)
        scheduleArcadeStateSync();
      },
      Err: (err: string) => {
        logger.warn('[ARCADE_REALTIME] Ignored table snapshot:', err);
      }
    });
  };

  const announceArcadeConnectionStatus = (status: ArcadeConnectionStatus): void => {
    match(status, {
      connecting: () => undefined,
      live: () => undefined,
      reconnecting: () => ui.showTemporaryBanner('Live table connection lost. Reconnecting…', 3000),
      offline: () => ui.showTemporaryBanner('Could not reach the live table server. Check your connection and try again.', 4500)
    });
  };

  const setupArcadeRealtimeSession = (game: ArcadeGameEnum,
                                      sessionCode: string,
                                      playerName: string = 'Cathedral Player',
                                      onAction?: (actionType: string, payload: unknown) => void): ArcadeRealtimeClient => {
    disconnectActiveArcade();

    let hasBeenLive = false;
    const client = new ArcadeRealtimeClient({
      sessionCode,
      participantId: arcadeParticipantId,
      game,
      onStatusChange: status => {
        if (status === 'live' && hasBeenLive) {
          ui.showTemporaryBanner('Reconnected to the live table.', 2000);
        }
        hasBeenLive = hasBeenLive || status === 'live';
        announceArcadeConnectionStatus(status);
      }
    });
    activeArcadeClient = client;
    activeArcadeSync = arcadeTableSyncFor(game);
    lastSyncedSnapshotJson = '';
    liveSeatOwners = {};
    hasReceivedTableState = false;

    client.on('player_kicked', (evt: any) => {
      if (evt?.targetParticipantId === client.getParticipantId()) {
        disconnectActiveArcade();
        forgetArcadeResume();
        ui.hideAllArcadeModals();
        ui.showArcadeHub();
        ui.setHubQuickJoinFeedback('You have been removed from the table by the match host.', true);
        soundFX.playSelect();
      } else {
        ui.showTemporaryBanner('A player was removed from the table by the match host.', 2500);
      }
    });

    client.on('seat_claimed', (evt: any) => {
      ui.showTemporaryBanner(`${String(evt?.displayName ?? 'A player')} joined the table.`, 2200);
      if (game === ArcadeGameEnum.Solitaire) {
        broadcastSolitaireIfLive();
      }
      // Bring the newcomer up to date with the current table
      activeArcadeSync.map(() => {
        lastSyncedSnapshotJson = '';
        scheduleArcadeStateSync();
      });
    });

    client.on('action_dispatched', (evt: any) => {
      const actionType = String(evt?.actionType ?? '');
      activeArcadeSync.match({
        Some: tableSync => {
          // Snapshot-synced tables ignore raw action replays, which would reshuffle differently per client
          if (actionType === 'state_sync') applyRemoteArcadeSnapshot(tableSync, evt.payload);
        },
        None: () => {
          if (onAction) onAction(actionType, evt?.payload);
        }
      });
    });

    // Departed humans hand their seat back to a bot (PocketHost: seat_left, local server: bot_restored)
    client.on('seat_left', (evt: any) => releaseLiveParticipant(String(evt?.participantId ?? '')));
    client.on('bot_restored', (evt: any) => releaseLiveParticipant(String(evt?.vacatedPlayerId ?? '')));

    if (isLocalPlayerHost) {
      activeArcadeSync.map(ensureLocalLiveSeat);
    }
    // Join first: on the local server the join creates the table, and its event stream 404s until then
    void client.claimSeat(playerName).then(res => {
      res.match({
        Ok: () => undefined,
        Err: err => ui.showTemporaryBanner(`Could not join live table ${sessionCode}: ${err}`, 4500)
      });
      if (activeArcadeClient === client) {
        client.connect();
      }
    });

    return client;
  };

  // --- Gothic Blackjack Mode Switcher ---
  let bjkLiveCode = generateArcadeCode(GameCodePrefixEnum.Blackjack);
  const setBlackjackMode = (isLive: boolean) => {
    bjkIsLive = isLive;
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

    if (isLive) {
      setupArcadeRealtimeSession(ArcadeGameEnum.Blackjack,
                                 bjkLiveCode,
                                 verifiedPlayerName.getOrElse('Blackjack Pilgrim'),
                                 (action, payload: any) => {
        if (action === 'bjk_deal') {
          bjkEngine.startRound();
        } else if (action === 'bjk_hit') {
          bjkEngine.hit();
        } else if (action === 'bjk_stand') {
          bjkEngine.stand();
        } else if (action === 'bjk_double') {
          bjkEngine.doubleDown();
        } else if (action === 'bjk_bet' && typeof payload?.amount === 'number') {
          bjkEngine.placeBet(payload.amount);
        }
        renderBlackjackTable();
      });
    } else {
      disconnectActiveArcade();
      if (typeof window !== 'undefined' && window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
    renderBlackjackTable();
  };
  fromNullable(document.getElementById('bjk-tab-ai')).map(b => b.addEventListener('click', () => setBlackjackMode(false)));
  fromNullable(document.getElementById('bjk-tab-live')).map(b => b.addEventListener('click', () => {
    // Opening a live table from here creates it, so this browser hosts it
    isLocalPlayerHost = true;
    setBlackjackMode(true);
  }));
  fromNullable(document.getElementById('btn-bjk-copy-link')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchLink(bjkLiveCode, b, 'Blackjack'))
  );
  fromNullable(document.getElementById('btn-bjk-copy-code')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchCode(bjkLiveCode, b, 'Blackjack'))
  );
  fromNullable(document.getElementById('bjk-live-code')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchCode(bjkLiveCode, b, 'Blackjack'))
  );

  // =========================================================================
  // Cathedral Poker Engine & Table Controls
  // =========================================================================
  let pokerVariant = PokerVariantEnum.TexasHoldem;
  let pokerEngine = new CathedralPokerEngine(pokerVariant, 6, 10, 20);
  pokerEngine.seatManager.claimSeat(1, 'p1', 'You (Pilgrim)');
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

  /** The local player's seat number (0 when watching a full live table). */
  const pokerLocalSeat = (): number => localSeatKeyFor('1').map(Number).getOrElse(0);
  const isPokerLocalTurn = (): boolean =>
    pokerEngine.state.activeSeatTurn.map(seatNum => isLocalArcadeTurn('1', String(seatNum))).getOrElse(false);
  /** Bots act until a human's turn, only on the browser that drives bots. */
  const runPokerBots = (): void => {
    if (canDriveArcadeBots()) {
      pokerEngine.executeBotTurns();
    }
  };

  const renderPokerTable = () => {
    scheduleArcadeStateSync();
    const s = pokerEngine.state;
    domById('poker-seats-track').map((track: HTMLElement) => {
      const occupied = pokerEngine.seatManager.getOccupiedSeats();
      track.innerHTML = occupied
        .map(seat => {
          const isTurn = s.activeSeatTurn.getOrElse(-1) === seat.seatNumber;
          const isDealer = s.dealerSeat === seat.seatNumber;
          const canKick = isLocalPlayerHost && isArcadeLive() && !seat.isBot && seat.seatNumber !== pokerLocalSeat();
          return `
            <div data-poker-seat="${seat.seatNumber}" class="px-3.5 py-2 rounded-2xl bg-black/65 border-2 ${
              isTurn ? 'border-amber-400 ring-2 ring-amber-400/50' : seat.extraData.folded ? 'border-white/10 opacity-50' : 'border-amber-500/40'
            } flex items-center gap-2 text-xs sm:text-sm cursor-pointer hover:border-amber-300 transition shadow-md" title="Click to claim seat as Human User">
              ${isDealer ? '<span class="px-1.5 py-0.5 rounded-full bg-amber-400 text-stone-950 font-extrabold text-[10px]" title="Dealer Button">D</span>' : ''}
              <span class="font-bold text-stone-100">S${seat.seatNumber}: ${escapeHtml(seat.playerName)}</span>
              <span class="text-emerald-300 font-mono font-bold">$${seat.extraData.chipBank}</span>
              <span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${
                seat.isBot ? 'bg-purple-950/90 text-purple-200 border border-purple-400/30' : 'bg-emerald-950/90 text-emerald-200 border border-emerald-400/30'
              }">${seat.isBot ? 'AI' : 'Human'}</span>
              ${
                canKick
                  ? `<button type="button" data-kick-participant="${escapeHtml(seat.playerId)}" data-kick-name="${escapeHtml(seat.playerName)}" class="ml-1 px-1.5 py-0.5 rounded-md bg-red-950/90 hover:bg-red-900 text-red-300 border border-red-500/40 text-[10px] font-bold transition" title="Kick Player from Table">Kick</button>`
                  : ''
              }
            </div>
          `;
        })
        .join('');

      track.querySelectorAll('[data-kick-participant]').forEach(btn => {
        btn.addEventListener('click', (e: Event) => {
          e.stopPropagation();
          const targetId = btn.getAttribute('data-kick-participant') || '';
          const targetName = btn.getAttribute('data-kick-name') || 'Player';
          if (confirm(`Are you sure you want to kick ${targetName} from the table?`)) {
            kickLiveParticipant(targetId, targetName);
          }
        });
      });

      track.querySelectorAll('[data-poker-seat]').forEach(el => {
        el.addEventListener('click', (e: Event) => {
          if ((e.target as HTMLElement)?.closest('[data-kick-participant]')) return;
          if (isArcadeLive()) return;
          const seatNum = parseInt(el.getAttribute('data-poker-seat') || '1', 10);
          pokerEngine.seatManager.claimSeat(seatNum, `human_p${seatNum}`, verifiedPlayerName.getOrElse(`Player ${seatNum}`));
          soundFX.playSelect();
          renderPokerTable();
        });
      });
    });

    // Only the local player's own hole cards are shown
    const seat1Opt = pokerEngine.seatManager.getSeat(pokerLocalSeat());
    const p1Data: PokerPlayerData = seat1Opt.match({
      Some: seat => safeParsePokerPlayerData(seat.extraData),
      None: (): PokerPlayerData => defaultPokerPlayerData()
    });

    const isMyTurn = isPokerLocalTurn();

    fromNullable(document.getElementById('poker-pot-val')).map(el => {
      el.textContent = `$${s.pot}`;
    });
    fromNullable(document.getElementById('poker-current-bet-val')).map(el => {
      const toCall = Math.max(0, s.currentBet - p1Data.currentBet);
      el.textContent = `Bet: $${s.currentBet} • To Call: $${toCall}`;
    });
    fromNullable(document.getElementById('poker-stage-badge')).map(el => {
      el.textContent = s.stage;
    });

    const bannerText = s.stage === PokerStageEnum.Settled
      ? (s.historyText[s.historyText.length - 1] || 'Hand settled.')
      : isMyTurn
        ? '★ Your turn to act!'
        : s.activeSeatTurn.match({
            Some: seatNum => `Waiting for Seat ${seatNum}...`,
            None: () => s.historyText[s.historyText.length - 1] || 'Awaiting action.'
          });
    fromNullable(document.getElementById('poker-status-banner')).map(el => {
      el.textContent = bannerText;
    });

    fromNullable(document.getElementById('poker-community-cards')).map(c => {
      if (s.communityCards.length === 0) {
        c.innerHTML = '<span class="text-sm sm:text-base text-stone-400 italic">No community cards yet</span>';
      } else {
        c.innerHTML = s.communityCards.map(formatCardHtml).join('');
      }
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

    const canAct = s.stage !== PokerStageEnum.Lobby && s.stage !== PokerStageEnum.Settled && !p1Data.folded && (isMyTurn || !pokerEngine.state.activeSeatTurn.isSome());
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

  let pokerIsLive = false;
  const setPokerMode = (isLive: boolean) => {
    pokerIsLive = isLive;
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

    if (isLive) {
      setupArcadeRealtimeSession(ArcadeGameEnum.Poker,
                                 pokerLiveCode,
                                 verifiedPlayerName.getOrElse('Poker Pilgrim'),
                                 (action, payload: any) => {
        if (action === 'poker_deal') {
          pokerEngine.startHand();
        } else if (action === 'poker_action' && typeof payload?.action === 'string') {
          pokerEngine.playerAction(payload.seatNumber || 1, payload.action as PokerActionEnum, payload.amount);
        } else if (action === 'poker_next_street') {
          const stage = pokerEngine.state.stage;
          if (stage === PokerStageEnum.PreFlop) pokerEngine.dealFlop();
          else if (stage === PokerStageEnum.Flop) pokerEngine.dealTurn();
          else if (stage === PokerStageEnum.Turn) pokerEngine.dealRiver();
          else if (stage === PokerStageEnum.River) pokerEngine.resolveShowdown();
        }
        renderPokerTable();
      });
    } else {
      disconnectActiveArcade();
      if (typeof window !== 'undefined' && window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
    renderPokerTable();
  };

  fromNullable(document.getElementById('poker-tab-ai')).map(b => b.addEventListener('click', () => setPokerMode(false)));
  fromNullable(document.getElementById('poker-tab-live')).map(b => b.addEventListener('click', () => {
    // Opening a live table from here creates it, so this browser hosts it
    isLocalPlayerHost = true;
    setPokerMode(true);
  }));
  fromNullable(document.getElementById('btn-poker-copy-link')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchLink(pokerLiveCode, b, 'Poker'))
  );
  fromNullable(document.getElementById('btn-poker-copy-code')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchCode(pokerLiveCode, b, 'Poker'))
  );
  fromNullable(document.getElementById('poker-live-code')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchCode(pokerLiveCode, b, 'Poker'))
  );

  fromNullable(document.getElementById('poker-variant-select') as HTMLSelectElement | null).map(sel =>
    sel.addEventListener('change', () => {
      if (blockGuestTableReset()) return;
      pokerVariant = sel.value as PokerVariantEnum;
      const seatCount = domById<HTMLSelectElement>('poker-seats-select')
        .map(s => parseInt(s.value || '6', 10))
        .getOrElse(6);
      pokerEngine = new CathedralPokerEngine(pokerVariant, seatCount, 10, 20);
      reseatAfterHostTableReset();
      pokerEngine.seatManager.claimSeat(1, 'p1', 'You (Pilgrim)');
      pokerEngine.populateBotOpponents();
      renderPokerTable();
    })
  );

  domById<HTMLSelectElement>('poker-seats-select').map(sel =>
    sel.addEventListener('change', () => {
      if (blockGuestTableReset()) return;
      const seatCount = parseInt(sel.value || '6', 10);
      pokerEngine = new CathedralPokerEngine(pokerVariant, seatCount, 10, 20);
      reseatAfterHostTableReset();
      pokerEngine.seatManager.claimSeat(1, 'p1', 'You (Pilgrim)');
      pokerEngine.populateBotOpponents();
      soundFX.playSelect();
      renderPokerTable();
    })
  );

  domById('poker-btn-add-player').map(btn =>
    btn.addEventListener('click', () => {
      const nextNum = pokerEngine.seatManager.getOccupiedSeats().length + 1;
      const res = pokerEngine.addPlayer(`Poker Pilgrim ${nextNum}`, false);
      if (res.isSuccess()) {
        soundFX.playSelect();
        domById<HTMLSelectElement>('poker-seats-select').map(sel => {
          sel.value = String(pokerEngine.seatManager.getOccupiedSeats().length);
        });
      }
      renderPokerTable();
    })
  );

  fromNullable(document.getElementById('poker-btn-deal')).map(b =>
    b.addEventListener('click', () => {
      if (blockGuestTableReset()) return;
      pokerEngine.startHand();
      runPokerBots();
      soundFX.playSelect();
      if (pokerIsLive && activeArcadeClient) {
        void activeArcadeClient.dispatchAction('poker_deal', {});
      }
      renderPokerTable();
    })
  );

  fromNullable(document.getElementById('poker-btn-check')).map(b =>
    b.addEventListener('click', () => {
      if (!isPokerLocalTurn()) return;
      pokerEngine.playerAction(pokerLocalSeat(), PokerActionEnum.Check);
      runPokerBots();
      soundFX.playSelect();
      if (pokerIsLive && activeArcadeClient) {
        void activeArcadeClient.dispatchAction('poker_action', { seatNumber: pokerLocalSeat(), action: PokerActionEnum.Check });
      }
      renderPokerTable();
    })
  );

  fromNullable(document.getElementById('poker-btn-call')).map(b =>
    b.addEventListener('click', () => {
      if (!isPokerLocalTurn()) return;
      pokerEngine.playerAction(pokerLocalSeat(), PokerActionEnum.Call);
      runPokerBots();
      soundFX.playSelect();
      if (pokerIsLive && activeArcadeClient) {
        void activeArcadeClient.dispatchAction('poker_action', { seatNumber: pokerLocalSeat(), action: PokerActionEnum.Call });
      }
      renderPokerTable();
    })
  );

  fromNullable(document.getElementById('poker-btn-raise')).map(b =>
    b.addEventListener('click', () => {
      if (!isPokerLocalTurn()) return;
      const raiseAmt = pokerEngine.state.currentBet + 20;
      pokerEngine.playerAction(pokerLocalSeat(), PokerActionEnum.Raise, raiseAmt);
      runPokerBots();
      soundFX.playCathedralOrganAndBell();
      if (pokerIsLive && activeArcadeClient) {
        void activeArcadeClient.dispatchAction('poker_action', { seatNumber: pokerLocalSeat(), action: PokerActionEnum.Raise, amount: raiseAmt });
      }
      renderPokerTable();
    })
  );

  fromNullable(document.getElementById('poker-btn-fold')).map(b =>
    b.addEventListener('click', () => {
      if (!isPokerLocalTurn()) return;
      pokerEngine.playerAction(pokerLocalSeat(), PokerActionEnum.Fold);
      runPokerBots();
      soundFX.playSelect();
      if (pokerIsLive && activeArcadeClient) {
        void activeArcadeClient.dispatchAction('poker_action', { seatNumber: pokerLocalSeat(), action: PokerActionEnum.Fold });
      }
      renderPokerTable();
    })
  );

  fromNullable(document.getElementById('poker-btn-next-street')).map(b =>
    b.addEventListener('click', () => {
      // The host deals the board at a live table
      if (blockGuestTableReset()) return;
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
      if (pokerIsLive && activeArcadeClient) {
        void activeArcadeClient.dispatchAction('poker_next_street', {});
      }
      renderPokerTable();
    })
  );

  fromNullable(document.getElementById('poker-btn-draw-exchange')).map(b =>
    b.addEventListener('click', () => {
      if (pokerLocalSeat() === 0) return;
      pokerEngine.drawCardsFiveCardDraw(pokerLocalSeat(), [0, 1]);
      soundFX.playSelect();
      renderPokerTable();
    })
  );

  // =========================================================================
  // Sacred Skip-Bo Engine & Table Controls
  // =========================================================================
  let skipboEngine = new SkipBoEngine('Pilgrim', 'Cathedral Abbot', 15, undefined, 4);
  let skipboLiveCode = generateArcadeCode(GameCodePrefixEnum.SkipBo);
  let selectedSkipBoSource: SkipBoSourcePileEnum = SkipBoSourcePileEnum.Hand;
  let selectedSkipBoIndex: number = 0;

  const skipboSeat = turnTableSeat(() => skipboEngine.state.players, () => skipboEngine.state.currentTurnIndex);
  const runSkipBoBots = createBotDriver(() => skipboEngine.state.isGameOver,
                                        () => skipboSeat.isBotTurn(),
                                        () => {
                                          skipboEngine.autoPlayBotTurn();
                                        },
                                        () => renderSkipBoTable());

  const renderSkipBoTable = () => {
    scheduleArcadeStateSync();
    const s = skipboEngine.state;
    const skipboLocalIdx = skipboSeat.localIndex();
    // Without a seat (full live table) the player watches with empty piles
    const p1 = skipboLocalIdx >= 0 ? s.players[skipboLocalIdx]! : { ...s.players[0]!, hand: [], stockpile: [], discardPiles: [[], [], [], []] };
    const p2 = s.players[1]!;

    domById('skipbo-opponents-track').map((track: HTMLElement) => {
      track.innerHTML = s.players
        .map((p, idx) => {
          const isTurn = s.currentTurnIndex === idx;
          const topCard = p.stockpile.length > 0 ? p.stockpile[p.stockpile.length - 1] : null;
          const topLabel = topCard
            ? topCard.type === SkipBoCardTypeEnum.Wild
              ? '★'
              : `${topCard.value}`
            : 'Done';
          return `
            <div data-skipbo-seat="${idx}" class="px-3.5 py-2 rounded-2xl bg-black/65 border-2 ${
              isTurn ? 'border-amber-400 ring-2 ring-amber-400/50' : 'border-blue-500/40'
            } flex items-center gap-2.5 text-xs sm:text-sm cursor-pointer hover:border-amber-300 transition shadow-md" title="Click to claim seat as Human User">
              <div class="w-2.5 h-2.5 rounded-full ${p.isBot ? 'bg-purple-400' : 'bg-emerald-400'}"></div>
              <span class="font-bold text-stone-100">${escapeHtml(p.name)}</span>
              <span class="px-2 py-0.5 rounded-lg bg-amber-950/90 border border-amber-400/40 text-amber-200 font-mono font-extrabold text-xs">Top: ${topLabel} (${p.stockpile.length})</span>
              <span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${
                p.isBot ? 'bg-purple-950/90 text-purple-200 border border-purple-400/30' : 'bg-emerald-950/90 text-emerald-200 border border-emerald-400/30'
              }">${p.isBot ? 'AI' : 'Human'}</span>
            </div>
          `;
        })
        .join('');

      track.querySelectorAll('[data-skipbo-seat]').forEach(el => {
        el.addEventListener('click', () => {
          if (isArcadeLive()) return;
          const seatIdx = parseInt(el.getAttribute('data-skipbo-seat') || '0', 10);
          skipboEngine.claimSeatForHuman(seatIdx, `Human Player ${seatIdx + 1}`);
          soundFX.playSelect();
          renderSkipBoTable();
        });
      });
    });

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
          if (!skipboSeat.isLocalTurn()) return;
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
            <span class="text-xs uppercase font-extrabold text-stone-300">D${idx + 1} (${pile.length})</span>
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
            if (!skipboSeat.isLocalTurn()) return;
            skipboEngine.discardAndEndTurn(selectedSkipBoIndex, discIdx);
            soundFX.playCathedralOrganAndBell();
            if (skipboIsLive && activeArcadeClient) {
              void activeArcadeClient.dispatchAction('skipbo_discard', {
                handIndex: selectedSkipBoIndex,
                targetIndex: discIdx
              });
            }
            renderSkipBoTable();
            runSkipBoBots();
          } else {
            selectedSkipBoSource = SkipBoSourcePileEnum.Discard;
            selectedSkipBoIndex = discIdx;
            renderSkipBoTable();
          }
        });
      });
    });
  };

  let skipboIsLive = false;
  const setSkipBoMode = (isLive: boolean) => {
    skipboIsLive = isLive;
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

    if (isLive) {
      setupArcadeRealtimeSession(ArcadeGameEnum.SkipBo,
                                 skipboLiveCode,
                                 verifiedPlayerName.getOrElse('Skip-Bo Pilgrim'),
                                 (action, payload: any) => {
        if (action === 'skipbo_play' && payload) {
          skipboEngine.playToBuilding(payload.source, payload.sourceIndex, payload.buildingIndex);
        } else if (action === 'skipbo_discard' && payload) {
          skipboEngine.discardAndEndTurn(payload.handIndex, payload.targetIndex);
        }
        renderSkipBoTable();
      });
    } else {
      disconnectActiveArcade();
      if (typeof window !== 'undefined' && window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
    renderSkipBoTable();
  };

  fromNullable(document.getElementById('skipbo-tab-ai')).map(b => b.addEventListener('click', () => setSkipBoMode(false)));
  fromNullable(document.getElementById('skipbo-tab-live')).map(b => b.addEventListener('click', () => {
    // Opening a live table from here creates it, so this browser hosts it
    isLocalPlayerHost = true;
    setSkipBoMode(true);
  }));
  fromNullable(document.getElementById('btn-skipbo-copy-link')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchLink(skipboLiveCode, b, 'Skip-Bo'))
  );
  fromNullable(document.getElementById('btn-skipbo-copy-code')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchCode(skipboLiveCode, b, 'Skip-Bo'))
  );
  fromNullable(document.getElementById('skipbo-live-code')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchCode(skipboLiveCode, b, 'Skip-Bo'))
  );

  fromNullable(document.getElementById('skipbo-btn-play-selected')).map(b =>
    b.addEventListener('click', () => {
      if (!skipboSeat.isLocalTurn()) return;
      // Find lowest legal building pile
      let played = false;
      for (let p = 0; p < 4; p++) {
        const res = skipboEngine.playToBuilding(selectedSkipBoSource, selectedSkipBoIndex, p);
        if (res.isSuccess()) {
          soundFX.playSelect();
          played = true;
          if (skipboIsLive && activeArcadeClient) {
            void activeArcadeClient.dispatchAction('skipbo_play', {
              source: selectedSkipBoSource,
              sourceIndex: selectedSkipBoIndex,
              buildingIndex: p
            });
          }
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
      if (selectedSkipBoSource === SkipBoSourcePileEnum.Hand && skipboSeat.isLocalTurn()) {
        skipboEngine.discardAndEndTurn(selectedSkipBoIndex, 0);
        soundFX.playSelect();
        renderSkipBoTable();
        runSkipBoBots();
      }
    })
  );

  fromNullable(document.getElementById('skipbo-btn-bot-step')).map(b =>
    b.addEventListener('click', () => {
      if (!canDriveArcadeBots() || !skipboSeat.isBotTurn()) return;
      skipboEngine.autoPlayBotTurn();
      soundFX.playCathedralOrganAndBell();
      renderSkipBoTable();
      runSkipBoBots();
    })
  );

  domById<HTMLSelectElement>('skipbo-seats-select').map(sel =>
    sel.addEventListener('change', () => {
      if (blockGuestTableReset()) return;
      const count = parseInt(sel.value || '4', 10);
      skipboEngine = new SkipBoEngine('Pilgrim', 'Cathedral Abbot', 15, undefined, count);
      reseatAfterHostTableReset();
      soundFX.playSelect();
      renderSkipBoTable();
    })
  );

  domById('skipbo-btn-add-player').map(btn =>
    btn.addEventListener('click', () => {
      const nextNum = skipboEngine.state.players.length + 1;
      const res = skipboEngine.addPlayer(`Skip-Bo Pilgrim ${nextNum}`, false);
      if (res.isSuccess()) {
        soundFX.playSelect();
        domById<HTMLSelectElement>('skipbo-seats-select').map(sel => {
          sel.value = String(skipboEngine.state.players.length);
        });
      }
      renderSkipBoTable();
    })
  );

  // =========================================================================
  // Ten Rites (Phase 10) Engine & Table Controls
  // =========================================================================
  let phase10Engine = new Phase10Engine('Pilgrim', 'Cathedral Prior', undefined, 4);
  let phase10LiveCode = generateArcadeCode(GameCodePrefixEnum.Phase10);
  let selectedPhase10Indices: number[] = [];

  const phase10Seat = turnTableSeat(() => phase10Engine.state.players, () => phase10Engine.state.currentTurnIndex);
  const phase10LocalPlayerId = (): string =>
    fromNullable(phase10Engine.state.players[phase10Seat.localIndex()]).map(p => p.id).getOrElse('p1');
  const runPhase10Bots = createBotDriver(() => phase10Engine.state.isGameOver || phase10Engine.state.isRoundOver,
                                         () => phase10Seat.isBotTurn(),
                                         () => {
                                           phase10Engine.autoPlayBotTurn();
                                         },
                                         () => renderPhase10Table());

  const renderPhase10Table = () => {
    scheduleArcadeStateSync();
    const s = phase10Engine.state;
    const phase10LocalIdx = phase10Seat.localIndex();
    // Without a seat (full live table) the player watches with an empty hand
    const p1 = phase10LocalIdx >= 0 ? s.players[phase10LocalIdx]! : { ...s.players[0]!, hand: [] };

    domById('phase10-opponents-track').map((track: HTMLElement) => {
      track.innerHTML = s.players
        .map((p, idx) => {
          const isTurn = s.currentTurnIndex === idx;
          return `
            <div data-p10-seat="${idx}" class="px-3.5 py-2 rounded-2xl bg-black/65 border-2 ${
              isTurn ? 'border-amber-400 ring-2 ring-amber-400/50' : 'border-emerald-500/40'
            } flex items-center gap-2 text-xs sm:text-sm cursor-pointer hover:border-amber-300 transition shadow-md" title="Click to claim seat as Human User">
              <div class="w-2.5 h-2.5 rounded-full ${p.isBot ? 'bg-purple-400' : 'bg-emerald-400'}"></div>
              <span class="font-bold text-stone-100">${escapeHtml(p.name)}</span>
              <span class="px-2 py-0.5 rounded-lg bg-emerald-950/90 border border-emerald-400/40 text-emerald-200 font-mono font-extrabold text-xs">P${p.currentPhase} • ${p.hand.length}🂠 • ${p.score}pts</span>
              <span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${
                p.isBot ? 'bg-purple-950/90 text-purple-200 border border-purple-400/30' : 'bg-emerald-950/90 text-emerald-200 border border-emerald-400/30'
              }">${p.isBot ? 'AI' : 'Human'}</span>
            </div>
          `;
        })
        .join('');

      track.querySelectorAll('[data-p10-seat]').forEach(el => {
        el.addEventListener('click', () => {
          if (isArcadeLive()) return;
          const seatIdx = parseInt(el.getAttribute('data-p10-seat') || '0', 10);
          phase10Engine.claimSeatForHuman(seatIdx, `Human Player ${seatIdx + 1}`);
          soundFX.playSelect();
          renderPhase10Table();
        });
      });
    });

    const contract = PHASE_10_REQUIREMENTS[p1.currentPhase - 1] || { description: 'Mastery', shortLabel: 'Complete' };
    fromNullable(document.getElementById('phase10-target-contract')).map(el => {
      el.textContent = `Phase ${p1.currentPhase}: ${contract.description}`;
    });
    fromNullable(document.getElementById('phase10-player-score')).map(el => {
      el.textContent = `${p1.score} pts`;
    });
    fromNullable(document.getElementById('phase10-hand-count')).map(el => {
      let totalPts = 0;
      for (const card of p1.hand) {
        if (card.special === 'wild') totalPts += 25;
        else if (card.special === 'skip') totalPts += 15;
        else if (typeof card.value === 'number') totalPts += card.value >= 10 ? 10 : 5;
      }
      let selPts = 0;
      for (const selIdx of selectedPhase10Indices) {
        const card = p1.hand[selIdx];
        if (card) {
          if (card.special === 'wild') selPts += 25;
          else if (card.special === 'skip') selPts += 15;
          else if (typeof card.value === 'number') selPts += card.value >= 10 ? 10 : 5;
        }
      }
      el.textContent =
        selectedPhase10Indices.length > 0
          ? `${p1.hand.length} cards (${totalPts} pts) • ${selectedPhase10Indices.length} sel (${selPts} pts)`
          : `${p1.hand.length} cards • ${totalPts} pts in hand`;
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

  let phase10IsLive = false;
  const setPhase10Mode = (isLive: boolean) => {
    phase10IsLive = isLive;
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

    if (isLive) {
      setupArcadeRealtimeSession(ArcadeGameEnum.Phase10,
                                 phase10LiveCode,
                                 verifiedPlayerName.getOrElse('Phase 10 Pilgrim'),
                                 (action, payload: any) => {
        if (action === 'p10_draw' && payload) {
          phase10Engine.drawCard(Boolean(payload.fromDiscard));
        } else if (action === 'p10_lay' && payload) {
          phase10Engine.layDownPhase(payload.g1 || [], payload.g2 || []);
        } else if (action === 'p10_hit' && payload) {
          phase10Engine.hitCard(payload.cardIndex, payload.targetPlayerId || 'p1', payload.groupIndex || 0);
        } else if (action === 'p10_discard' && payload) {
          phase10Engine.discardAndEndTurn(payload.cardIndex);
        }
        renderPhase10Table();
      });
    } else {
      disconnectActiveArcade();
      if (typeof window !== 'undefined' && window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
    renderPhase10Table();
  };

  fromNullable(document.getElementById('phase10-tab-ai')).map(b => b.addEventListener('click', () => setPhase10Mode(false)));
  fromNullable(document.getElementById('phase10-tab-live')).map(b => b.addEventListener('click', () => {
    // Opening a live table from here creates it, so this browser hosts it
    isLocalPlayerHost = true;
    setPhase10Mode(true);
  }));
  fromNullable(document.getElementById('btn-phase10-copy-link')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchLink(phase10LiveCode, b, 'Phase 10'))
  );
  fromNullable(document.getElementById('btn-phase10-copy-code')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchCode(phase10LiveCode, b, 'Phase 10'))
  );
  fromNullable(document.getElementById('phase10-live-code')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchCode(phase10LiveCode, b, 'Phase 10'))
  );

  fromNullable(document.getElementById('phase10-btn-draw-deck')).map(b =>
    b.addEventListener('click', () => {
      if (!phase10Seat.isLocalTurn()) return;
      phase10Engine.drawCard(false);
      soundFX.playSelect();
      if (phase10IsLive && activeArcadeClient) {
        void activeArcadeClient.dispatchAction('p10_draw', { fromDiscard: false });
      }
      renderPhase10Table();
    })
  );

  fromNullable(document.getElementById('phase10-discard-pile-btn')).map(b =>
    b.addEventListener('click', () => {
      if (!phase10Engine.state.hasDrawnThisTurn && phase10Seat.isLocalTurn()) {
        phase10Engine.drawCard(true);
        soundFX.playSelect();
        if (phase10IsLive && activeArcadeClient) {
          void activeArcadeClient.dispatchAction('p10_draw', { fromDiscard: true });
        }
        renderPhase10Table();
      }
    })
  );

  fromNullable(document.getElementById('phase10-btn-lay-phase')).map(b =>
    b.addEventListener('click', () => {
      if (!phase10Seat.isLocalTurn()) return;
      const half = Math.floor(selectedPhase10Indices.length / 2);
      const g1 = selectedPhase10Indices.slice(0, half);
      const g2 = selectedPhase10Indices.slice(half);
      const res = phase10Engine.layDownPhase(g1, g2);
      if (res.isSuccess()) {
        selectedPhase10Indices = [];
        soundFX.playCathedralOrganAndBell();
        if (phase10IsLive && activeArcadeClient) {
          void activeArcadeClient.dispatchAction('p10_lay', { g1, g2 });
        }
      }
      renderPhase10Table();
    })
  );

  fromNullable(document.getElementById('phase10-btn-hit-card')).map(b =>
    b.addEventListener('click', () => {
      if (selectedPhase10Indices.length === 1 && phase10Seat.isLocalTurn()) {
        const hitIdx = selectedPhase10Indices[0]!;
        phase10Engine.hitCard(hitIdx, phase10LocalPlayerId(), 0);
        selectedPhase10Indices = [];
        soundFX.playSelect();
        if (phase10IsLive && activeArcadeClient) {
          void activeArcadeClient.dispatchAction('p10_hit', {
            cardIndex: hitIdx,
            targetPlayerId: phase10LocalPlayerId(),
            groupIndex: 0
          });
        }
        renderPhase10Table();
      }
    })
  );

  fromNullable(document.getElementById('phase10-btn-discard')).map(b =>
    b.addEventListener('click', () => {
      if (selectedPhase10Indices.length === 1 && phase10Seat.isLocalTurn()) {
        const discIdx = selectedPhase10Indices[0]!;
        phase10Engine.discardAndEndTurn(discIdx);
        selectedPhase10Indices = [];
        soundFX.playCathedralOrganAndBell();
        if (phase10IsLive && activeArcadeClient) {
          void activeArcadeClient.dispatchAction('p10_discard', { cardIndex: discIdx });
        }
        renderPhase10Table();
        runPhase10Bots();
      }
    })
  );

  domById('phase10-btn-bot-step').map(b =>
    b.addEventListener('click', () => {
      if (!canDriveArcadeBots() || !phase10Seat.isBotTurn()) return;
      phase10Engine.autoPlayBotTurn();
      soundFX.playCathedralOrganAndBell();
      renderPhase10Table();
      runPhase10Bots();
    })
  );

  domById<HTMLSelectElement>('phase10-seats-select').map(sel =>
    sel.addEventListener('change', () => {
      if (blockGuestTableReset()) return;
      const count = parseInt(sel.value || '4', 10);
      phase10Engine = new Phase10Engine('Pilgrim', 'Cathedral Prior', undefined, count);
      reseatAfterHostTableReset();
      selectedPhase10Indices = [];
      soundFX.playSelect();
      renderPhase10Table();
    })
  );

  domById('phase10-btn-add-player').map(btn =>
    btn.addEventListener('click', () => {
      const nextNum = phase10Engine.state.players.length + 1;
      const res = phase10Engine.addPlayer(`Phase 10 Pilgrim ${nextNum}`, false);
      if (res.isSuccess()) {
        soundFX.playSelect();
        domById<HTMLSelectElement>('phase10-seats-select').map(sel => {
          sel.value = String(phase10Engine.state.players.length);
        });
      }
      renderPhase10Table();
    })
  );

  // =========================================================================
  // Cardinal Uno Engine & Table Controls
  // =========================================================================
  let unoEngine = new CardinalUnoEngine('Pilgrim', 4);
  let unoLiveCode = generateArcadeCode(GameCodePrefixEnum.Uno);
  let pendingWildCardIndex: number | null = null;

  const unoLocalPlayerId = (): Option<string> => localSeatKeyFor('p1');
  const unoLocalIndex = (): number =>
    unoLocalPlayerId().map(id => unoEngine.state.players.findIndex(p => p.id === id)).getOrElse(-1);
  const isUnoLocalTurn = (): boolean =>
    fromNullable(unoEngine.state.players[unoEngine.state.currentTurnIndex])
      .map(current => isLocalArcadeTurn('p1', current.id))
      .getOrElse(false);

  const renderUnoTable = () => {
    scheduleArcadeStateSync();
    const s = unoEngine.state;
    const localIdx = unoLocalIndex();
    // Without a seat (full live table) the player watches with an empty hand
    const humanPlayer = localIdx >= 0 ? s.players[localIdx]! : { ...s.players[0]!, hand: [] };

    // Opponents Track
    fromNullable(document.getElementById('uno-opponents-track')).map(container => {
      const opponents = s.players
        .map((p, seatIdx) => ({ p, seatIdx }))
        .filter(({ seatIdx }) => seatIdx !== localIdx);
      container.innerHTML = opponents
        .map(
          ({ p, seatIdx }) => `
        <div data-uno-seat="${seatIdx}" class="px-4 py-2 rounded-2xl bg-black/65 border ${
          s.currentTurnIndex === seatIdx ? 'border-amber-400 ring-2 ring-amber-400/50' : 'border-white/15'
        } flex items-center gap-2.5 text-sm shadow-md cursor-pointer hover:border-amber-300 transition" title="Click to claim seat as Human User">
          <div class="w-2.5 h-2.5 rounded-full ${p.isBot ? 'bg-purple-400' : 'bg-sky-400'}"></div>
          <span class="font-bold text-stone-100">${escapeHtml(p.name)}</span>
          <span class="px-2.5 py-0.5 rounded-full bg-red-950/85 border border-red-500/40 text-amber-300 font-mono text-xs sm:text-sm font-extrabold">
            ${p.hand.length} 🂠
          </span>
          <span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${
            p.isBot ? 'bg-purple-950/90 text-purple-200 border border-purple-400/30' : 'bg-sky-950/90 text-sky-200 border border-sky-400/30'
          }">${p.isBot ? 'AI' : 'Human'}</span>
          ${p.calledUno ? '<span class="text-xs font-extrabold text-amber-400 uppercase tracking-wider">UNO!</span>' : ''}
        </div>
      `
        )
        .join('');

      container.querySelectorAll('[data-uno-seat]').forEach(el => {
        el.addEventListener('click', () => {
          // Live seats are assigned automatically; hot-seat claiming is for local play
          if (isArcadeLive()) return;
          const seatIdx = parseInt(el.getAttribute('data-uno-seat') || '1', 10);
          unoEngine.claimSeatForHuman(seatIdx, `Human Player ${seatIdx + 1}`);
          soundFX.playSelect();
          renderUnoTable();
        });
      });
    });

    // Active Color Badge
    fromNullable(document.getElementById('uno-active-color-badge')).map(badge => {
      const dirIcon = s.direction > 0 ? '↻ Clockwise' : '↺ Counter';
      badge.textContent = `${s.activeColor.toUpperCase()} • ${dirIcon}`;
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
      const playable = humanPlayer.hand.filter(c => unoEngine.canPlayCard(c)).length;
      el.textContent = `${humanPlayer.hand.length} cards • ${playable} playable`;
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
          if (!isUnoLocalTurn()) return;
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

  let unoBotTimeoutId: ReturnType<typeof setTimeout> | null = null;
  const clearUnoBotTimeout = () => {
    if (unoBotTimeoutId !== null) {
      clearTimeout(unoBotTimeoutId);
      unoBotTimeoutId = null;
    }
  };

  const isUnoBotTurn = (): boolean => fromNullable(unoEngine.state.players[unoEngine.state.currentTurnIndex]).map(p => p.isBot).getOrElse(false);

  const checkAndRunUnoBots = () => {
    clearUnoBotTimeout();
    if (unoEngine.state.isGameOver || !canDriveArcadeBots()) return;
    if (isUnoBotTurn()) {
      unoBotTimeoutId = setTimeout(() => {
        unoBotTimeoutId = null;
        if (unoEngine.state.isGameOver) return;
        unoEngine.executeAiTurn();
        renderUnoTable();
        checkAndRunUnoBots();
      }, arcadeBotTurnDelayMs());
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
      setupArcadeRealtimeSession(ArcadeGameEnum.Uno,
                                 unoLiveCode,
                                 verifiedPlayerName.getOrElse('Cardinal Pilgrim'),
                                 (action, payload: any) => {
        if (action === 'uno_play' && typeof payload?.handIndex === 'number') {
          unoEngine.playCard(payload.handIndex, payload.wildColor);
          renderUnoTable();
        } else if (action === 'uno_draw') {
          unoEngine.drawCard();
          renderUnoTable();
        }
      });
    } else {
      disconnectActiveArcade();
      if (typeof window !== 'undefined' && window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
    renderUnoTable();
  };

  fromNullable(document.getElementById('uno-tab-ai')).map(b => b.addEventListener('click', () => setUnoMode(false)));
  fromNullable(document.getElementById('uno-tab-live')).map(b => b.addEventListener('click', () => {
    // Opening a live table from here creates it, so this browser hosts it
    isLocalPlayerHost = true;
    setUnoMode(true);
  }));
  fromNullable(document.getElementById('btn-uno-copy-link')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchLink(unoLiveCode, b, 'Uno'))
  );
  fromNullable(document.getElementById('btn-uno-copy-code')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchCode(unoLiveCode, b, 'Uno'))
  );
  fromNullable(document.getElementById('uno-live-code')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchCode(unoLiveCode, b, 'Uno'))
  );

  fromNullable(document.getElementById('uno-draw-deck-btn')).map(b =>
    b.addEventListener('click', () => {
      if (isUnoLocalTurn()) {
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
      if (isUnoLocalTurn()) {
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
      const res = unoLocalPlayerId().match({
        Some: playerId => unoEngine.callUno(playerId),
        None: () => failure<string, string>('You do not have a seat at this table.')
      });
      if (res.isSuccess()) {
        soundFX.playCathedralOrganAndBell();
      }
      renderUnoTable();
    })
  );

  domById<HTMLSelectElement>('uno-seats-select').map(sel =>
    sel.addEventListener('change', () => {
      if (blockGuestTableReset()) return;
      const count = parseInt(sel.value || '4', 10);
      unoEngine = new CardinalUnoEngine('Pilgrim', count);
      reseatAfterHostTableReset();
      pendingWildCardIndex = null;
      soundFX.playSelect();
      renderUnoTable();
    })
  );

  domById('uno-btn-add-player').map(btn =>
    btn.addEventListener('click', () => {
      const nextNum = unoEngine.state.players.length + 1;
      const res = unoEngine.addPlayer(`Cardinal User ${nextNum}`, false);
      if (res.isSuccess()) {
        soundFX.playSelect();
        domById<HTMLSelectElement>('uno-seats-select').map(sel => {
          sel.value = String(unoEngine.state.players.length);
        });
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
  // A new quest or leader starts a fresh team selection
  let avalonSelectionRound = '';

  /** The knight the local player controls (seat owner at a live table, the first knight against AI). */
  const avalonLocalId = (): Option<string> => localSeatKeyFor('p1');
  const avalonBots = () => avalonEngine.state.players.filter(p => p.isBot);
  const canActForAvalonLeader = (): boolean =>
    avalonLocalId().map(id => id === avalonEngine.getCurrentLeader().id).getOrElse(false) ||
    (avalonEngine.getCurrentLeader().isBot && canDriveArcadeBots());

  /** Bots follow the human's vote; only the bot-driving browser casts their votes. */
  const castAvalonVote = (approve: boolean): void => {
    avalonLocalId().map(id => avalonEngine.castVote(id, approve));
    if (canDriveArcadeBots()) {
      avalonBots().forEach(bot => avalonEngine.castVote(bot.id, approve));
    }
  };

  /** Bots on the quest play to their alignment, once each; only the bot-driving browser plays their cards. */
  const castAvalonBotQuestCards = (): boolean => {
    if (!canDriveArcadeBots() || avalonEngine.state.stage !== 'quest-execution') return false;
    const quest = avalonEngine.getCurrentQuest();
    const pending = avalonBots().filter(bot => quest.proposedTeam.includes(bot.id) && !(quest.castBy ?? []).includes(bot.id));
    pending.forEach(bot => avalonEngine.castQuestCard(bot.id, bot.alignment === 'good'));
    return pending.length > 0;
  };

  const castAvalonQuestCard = (pass: boolean): void => {
    avalonLocalId().map(id => avalonEngine.castQuestCard(id, pass)).map(res =>
      res.match({
        Ok: () => undefined,
        Err: err => ui.showTemporaryBanner(err, 2500)
      })
    );
    castAvalonBotQuestCards();
  };

  let avalonBotTimer: Option<ReturnType<typeof setTimeout>> = none();
  /** Lets bot knights finish a quest on their own, e.g. when no human is on the team. */
  const scheduleAvalonBotQuestCards = (): void => {
    if (avalonBotTimer.isSome() || !canDriveArcadeBots() || avalonEngine.state.stage !== 'quest-execution') return;
    avalonBotTimer = some(setTimeout(() => {
      avalonBotTimer = none();
      if (castAvalonBotQuestCards()) renderAvalonTable();
    }, arcadeBotTurnDelayMs()));
  };

  const renderAvalonTable = () => {
    scheduleArcadeStateSync();
    const s = avalonEngine.state;
    const selectionRound = `${s.currentQuestIndex}:${s.currentLeaderIndex}:${s.stage}`;
    if (selectionRound !== avalonSelectionRound) {
      avalonSelectionRound = selectionRound;
      selectedAvalonKnights = [];
    }
    // Each player only ever sees their own role
    const humanPlayer = avalonLocalId()
      .flatMap(id => fromNullable(s.players.find(p => p.id === id)))
      .getOrElse({ ...s.players[0]!, role: 'Spectator' as typeof s.players[0]['role'], alignment: 'good' });

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
      const currentQuest = avalonEngine.getCurrentQuest();
      el.textContent = `Rejections: ${s.failedVoteCount} / 5 • Selected: ${selectedAvalonKnights.length} / ${currentQuest.teamSize}`;
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
              <span class="font-bold text-sm sm:text-base text-stone-100">${escapeHtml(p.name)}</span>
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
    // Only knights on the quest team play quest cards
    const isOnQuestTeam = avalonLocalId()
      .map(id => avalonEngine.getCurrentQuest().proposedTeam.includes(id))
      .getOrElse(false);
    fromNullable(document.getElementById('avalon-quest-controls')).map(el => {
      if (s.stage === 'quest-execution' && isOnQuestTeam) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
    scheduleAvalonBotQuestCards();
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
      setupArcadeRealtimeSession(ArcadeGameEnum.Avalon,
                                 avalonLiveCode,
                                 verifiedPlayerName.getOrElse('Arthurian Knight'),
                                 (action, payload: any) => {
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
    } else {
      disconnectActiveArcade();
      if (typeof window !== 'undefined' && window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
    renderAvalonTable();
  };

  fromNullable(document.getElementById('avalon-tab-ai')).map(b => b.addEventListener('click', () => setAvalonMode(false)));
  fromNullable(document.getElementById('avalon-tab-live')).map(b => b.addEventListener('click', () => {
    // Opening a live table from here creates it, so this browser hosts it
    isLocalPlayerHost = true;
    setAvalonMode(true);
  }));
  fromNullable(document.getElementById('btn-avalon-copy-link')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchLink(avalonLiveCode, b, 'Avalon'))
  );
  fromNullable(document.getElementById('btn-avalon-copy-code')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchCode(avalonLiveCode, b, 'Avalon'))
  );
  fromNullable(document.getElementById('avalon-live-code')).map(b =>
    b.addEventListener('click', () => copyArcadeMatchCode(avalonLiveCode, b, 'Avalon'))
  );

  fromNullable(document.getElementById('avalon-btn-propose')).map(b =>
    b.addEventListener('click', () => {
      if (!canActForAvalonLeader()) {
        ui.showTemporaryBanner(`${avalonEngine.getCurrentLeader().name} leads this quest and proposes the team.`, 2500);
        return;
      }
      const res = avalonEngine.proposeTeam(selectedAvalonKnights);
      res.match({
        Ok: () => undefined,
        Err: err => ui.showTemporaryBanner(err, 2800)
      });
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
      castAvalonVote(true);
      soundFX.playSelect();
      if (activeArcadeClient) {
        void activeArcadeClient.sendAction('avalon_vote', { playerId: avalonLocalId().getOrElse(''), approve: true });
      }
      renderAvalonTable();
    })
  );

  fromNullable(document.getElementById('avalon-btn-vote-reject')).map(b =>
    b.addEventListener('click', () => {
      castAvalonVote(false);
      soundFX.playSelect();
      if (activeArcadeClient) {
        void activeArcadeClient.sendAction('avalon_vote', { playerId: avalonLocalId().getOrElse(''), approve: false });
      }
      renderAvalonTable();
    })
  );

  fromNullable(document.getElementById('avalon-btn-quest-pass')).map(b =>
    b.addEventListener('click', () => {
      castAvalonQuestCard(true);
      soundFX.playCathedralOrganAndBell();
      if (activeArcadeClient) {
        void activeArcadeClient.sendAction('avalon_quest', { playerId: avalonLocalId().getOrElse(''), pass: true });
      }
      renderAvalonTable();
    })
  );

  fromNullable(document.getElementById('avalon-btn-quest-fail')).map(b =>
    b.addEventListener('click', () => {
      castAvalonQuestCard(false);
      soundFX.playSelect();
      if (activeArcadeClient) {
        void activeArcadeClient.sendAction('avalon_quest', { playerId: avalonLocalId().getOrElse(''), pass: false });
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

  domById<HTMLSelectElement>('avalon-seats-select').map(sel =>
    sel.addEventListener('change', () => {
      if (blockGuestTableReset()) return;
      const count = parseInt(sel.value || '5', 10);
      avalonEngine = new AvalonEngine('Percival', count);
      reseatAfterHostTableReset();
      selectedAvalonKnights = [];
      soundFX.playSelect();
      renderAvalonTable();
    })
  );

  domById('avalon-btn-add-player').map(btn =>
    btn.addEventListener('click', () => {
      const nextNum = avalonEngine.state.players.length + 1;
      const res = avalonEngine.addPlayer(`Knight User ${nextNum}`, false);
      if (res.isSuccess()) {
        soundFX.playSelect();
        domById<HTMLSelectElement>('avalon-seats-select').map(sel => {
          sel.value = String(avalonEngine.state.players.length);
        });
      }
      renderAvalonTable();
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

    const singleSvg = `<svg viewBox="0 0 64 40" class="w-11 h-6 sm:w-20 sm:h-11 drop-shadow"><defs><pattern id="${patternId}" width="5" height="5" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="5" stroke="${colorHex}" stroke-width="2.4" /></pattern></defs>${shapeElement}</svg>`;
    return Array.from({ length: card.count }, () => singleSvg).join('');
  };

  const renderSetTable = () => {
    scheduleArcadeStateSync();
    const s = setEngine.state;
    const validSets = setEngine.getAvailableSets();

    ['set-deck-remaining', 'set-deck-count-val'].forEach(id => {
      domById(id).map(el => {
        el.textContent = String(s.deck.length);
      });
    });
    ['set-available-count', 'set-available-val'].forEach(id => {
      domById(id).map(el => {
        el.textContent = `${validSets.length} • Selected: ${selectedSetIndices.length}/3`;
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
        s.players.forEach((p, idx) => {
          const badge = document.createElement('div');
          badge.className = `px-4 py-2 rounded-xl border-2 ${
            localSeatKeyFor('p1').map(id => id === p.id).getOrElse(false)
              ? 'border-fuchsia-400 bg-fuchsia-950/75'
              : 'border-white/15 bg-black/55'
          } text-xs sm:text-sm flex items-center gap-2.5 shadow-md cursor-pointer hover:border-amber-300 transition`;
          badge.title = 'Click to claim seat as Human User';
          badge.innerHTML = `<span class="font-bold text-stone-100">${escapeHtml(p.name)}</span><span class="text-amber-300 font-mono font-bold">Sets: ${p.score}</span><span class="text-stone-300 font-mono text-xs">(-${p.penalties})</span><span class="px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
            p.isBot ? 'bg-purple-950 text-purple-200' : 'bg-emerald-950 text-emerald-200'
          }">${p.isBot ? 'AI' : 'Human'}</span>`;
          badge.addEventListener('click', () => {
            if (isArcadeLive()) return;
            setEngine.claimSeatForHuman(idx, `Geometer ${idx + 1}`);
            soundFX.playSelect();
            renderSetTable();
          });
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
            <div class="flex flex-col items-center justify-center gap-1 sm:gap-1.5">${renderSetSymbolSvg(card)}</div>
            <span class="text-[10px] sm:text-xs font-mono font-bold text-stone-200 uppercase tracking-tight sm:tracking-wider leading-tight text-center">${card.count} ${card.color} ${card.shading} ${card.shape}</span>
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
      setupArcadeRealtimeSession(ArcadeGameEnum.Set,
                                 setLiveCode,
                                 verifiedPlayerName.getOrElse('Sanctuary Geometer'),
                                 () => renderSetTable());
    } else {
      disconnectActiveArcade();
      if (typeof window !== 'undefined' && window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
    renderSetTable();
  };

  ['set-tab-ai', 'set-mode-ai'].forEach(id => {
    domById(id).map(b => b.addEventListener('click', () => setSetMode(false)));
  });
  ['set-tab-live', 'set-mode-live'].forEach(id => {
    domById(id).map(b => b.addEventListener('click', () => {
      // Opening a live table from here creates it, so this browser hosts it
      isLocalPlayerHost = true;
      setSetMode(true);
    }));
  });
  ['btn-set-copy-link'].forEach(id => {
    domById(id).map(b =>
      b.addEventListener('click', () => {
        copyArcadeMatchLink(setLiveCode, b, 'SET');
      })
    );
  });
  ['btn-set-copy-code', 'set-copy-code-btn'].forEach(id => {
    domById(id).map(b =>
      b.addEventListener('click', () => {
        copyArcadeMatchCode(setLiveCode, b, 'SET');
      })
    );
  });
  domById('set-live-code').map(b =>
    b.addEventListener('click', () => {
      copyArcadeMatchCode(setLiveCode, b, 'SET');
    })
  );

  fromNullable(document.getElementById('set-btn-claim')).map(b =>
    b.addEventListener('click', () => {
      const setLocalId = localSeatKeyFor('p1');
      if (selectedSetIndices.length === 3 && setLocalId.isSome()) {
        const res = setEngine.claimSet(setLocalId.getOrElse(''), [
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
            playerId: setLocalId.getOrElse(''),
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
      const firstBot = setEngine.state.players.find(p => p.isBot);
      if (!canDriveArcadeBots() || !firstBot) return;
      setEngine.executeAiTurn(firstBot.id);
      selectedSetIndices = [];
      setHintIndex = null;
      soundFX.playSelect();
      renderSetTable();
    })
  );

  fromNullable(document.getElementById('set-btn-new-game')).map(b =>
    b.addEventListener('click', () => {
      if (blockGuestTableReset()) return;
      const seatCount = domById<HTMLSelectElement>('set-seats-select')
        .map(s => parseInt(s.value || '3', 10))
        .getOrElse(3);
      setEngine = new SetEngine(seatCount, 'You (Sanctuary Geometer)');
      reseatAfterHostTableReset();
      selectedSetIndices = [];
      setHintIndex = null;
      soundFX.playSelect();
      renderSetTable();
    })
  );

  domById<HTMLSelectElement>('set-seats-select').map(sel =>
    sel.addEventListener('change', () => {
      if (blockGuestTableReset()) return;
      const seatCount = parseInt(sel.value || '3', 10);
      setEngine = new SetEngine(seatCount, 'You (Sanctuary Geometer)');
      reseatAfterHostTableReset();
      selectedSetIndices = [];
      setHintIndex = null;
      soundFX.playSelect();
      renderSetTable();
    })
  );

  domById('set-btn-add-player').map(btn =>
    btn.addEventListener('click', () => {
      const nextNum = setEngine.state.players.length + 1;
      const res = setEngine.addPlayer(`Geometer User ${nextNum}`, false);
      if (res.isSuccess()) {
        soundFX.playSelect();
        domById<HTMLSelectElement>('set-seats-select').map(sel => {
          sel.value = String(setEngine.state.players.length);
        });
      }
      renderSetTable();
    })
  );

  // --- Cathedral Solitaire Mode & Game State ---
  let solitaireEngine = new CathedralSolitaireEngine();
  let solitaireLiveCode = generateArcadeCode(GameCodePrefixEnum.Solitaire);
  let solitaireIsLive = false;
  let solitaireIsSpectator = false;
  let selectedSolitaireCard: Option<{ source: 'waste' | 'tableau'; colIdx?: number; cardIdx?: number }> = none();

  const setSolitaireMode = (isLive: boolean,
                            asSpectator: boolean = false): void => {
    solitaireIsLive = isLive;
    solitaireIsSpectator = asSpectator;

    fromNullable(document.getElementById('solitaire-live-session-info')).map(el => {
      el.classList.toggle('hidden', !isLive);
      el.classList.toggle('flex', isLive);
    });

    fromNullable(document.getElementById('solitaire-live-code')).map(el => {
      el.textContent = solitaireLiveCode;
    });

    fromNullable(document.getElementById('solitaire-spectator-banner')).map(el => {
      el.classList.toggle('hidden', !solitaireIsSpectator);
      el.classList.toggle('flex', solitaireIsSpectator);
    });

    domById('solitaire-tab-ai').map(btn => {
      btn.className = !isLive
        ? 'px-3 py-1 rounded-xl bg-emerald-600 text-stone-950 font-bold text-[11px] transition'
        : 'px-3 py-1 rounded-xl bg-transparent hover:bg-white/10 text-emerald-300 font-bold text-[11px] transition';
    });

    domById('solitaire-tab-live').map(btn => {
      btn.className = isLive
        ? 'px-3 py-1 rounded-xl bg-emerald-600 text-stone-950 font-bold text-[11px] transition'
        : 'px-3 py-1 rounded-xl bg-transparent hover:bg-white/10 text-emerald-300 font-bold text-[11px] transition';
    });

    if (isLive) {
      setupArcadeRealtimeSession(
        ArcadeGameEnum.Solitaire,
        solitaireLiveCode,
        asSpectator ? 'Spectator Observer' : verifiedPlayerName.getOrElse('Solitary Pilgrim'),
        (actionType, payload) => {
          // Spectators mirror the player's board; the player keeps their own
          const isBoardUpdate = actionType === 'state_sync' || actionType === 'solitaire_state_update';
          if (isBoardUpdate && payload && solitaireIsSpectator) {
            solitaireEngine.importSnapshot(payload);
            renderSolitaireBoard();
          }
        }
      );
      // Publish the board right away so spectators (and the server-kept table snapshot) start in sync
      broadcastSolitaireIfLive();
    } else {
      disconnectActiveArcade();
      if (typeof window !== 'undefined' && window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
    renderSolitaireBoard();
  };

  const broadcastSolitaireIfLive = (): void => {
    if (solitaireIsLive && activeArcadeClient && !solitaireIsSpectator) {
      // Sent as the standard table snapshot, so PocketHost keeps it for spectators who join later
      void activeArcadeClient.sendAction('state_sync', solitaireEngine.exportSnapshot() as any);
    }
  };

  const renderSolitaireCardHtml = (card: PlayingCard,
                                   isSelected: boolean = false): string => {
    if (!card.faceUp) {
      return `
        <div class="playing-card-ui bg-gradient-to-br from-emerald-950 via-stone-900 to-emerald-950 text-emerald-300 border-emerald-500/60 shadow-xl items-center justify-center font-cathedral text-3xl select-none">
          🂠
        </div>
      `;
    }
    const isRed = ['hearts', 'diamonds'].includes(card.suit);
    const suitSymbol = card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠';
    return `
      <div class="playing-card-ui ${isSelected ? 'ring-4 ring-amber-300 scale-105' : ''} ${
        isRed
          ? 'bg-gradient-to-b from-stone-50 to-stone-200 text-red-600 border-red-400/70 shadow-xl'
          : 'bg-gradient-to-b from-stone-50 to-stone-200 text-stone-900 border-stone-400/70 shadow-xl'
      } cursor-pointer transition select-none">
        <div class="playing-card-corner">
          <span>${card.value}</span>
          <span>${suitSymbol}</span>
        </div>
        <div class="playing-card-center">${suitSymbol}</div>
        <div class="playing-card-corner rotate-180">
          <span>${card.value}</span>
          <span>${suitSymbol}</span>
        </div>
      </div>
    `;
  };

  const renderSolitaireBoard = (): void => {
    scheduleArcadeResumeSave();
    const s = solitaireEngine.state;

    // 1. HUD stats
    fromNullable(document.getElementById('solitaire-score')).map(el => {
      el.textContent = String(s.score);
    });
    fromNullable(document.getElementById('solitaire-moves')).map(el => {
      el.textContent = String(s.movesCount);
    });
    fromNullable(document.getElementById('solitaire-stock-count')).map(el => {
      el.textContent = String(s.stock.length);
    });
    fromNullable(document.getElementById('solitaire-waste-count')).map(el => {
      el.textContent = String(s.waste.length);
    });
    fromNullable(document.getElementById('solitaire-status-banner')).map(el => {
      if (s.stage === SolitaireStageEnum.Won) {
        el.textContent = '🎉 Cathedral Solitaire Victory Consecrated! All 52 cards assembled!';
        el.className = 'p-2 sm:p-3 rounded-2xl bg-amber-500 text-stone-950 text-center text-xs sm:text-sm font-cathedral font-bold tracking-wide shadow-lg animate-bounce';
      } else {
        el.textContent = s.historyText[s.historyText.length - 1] || 'Klondike patience: Build columns down alternating; ascend Ace to King onto Foundations.';
        el.className = 'p-2 sm:p-3 rounded-2xl bg-black/65 border border-emerald-400/40 text-center text-xs sm:text-sm font-cathedral font-bold text-emerald-200 tracking-wide shadow-lg';
      }
    });

    // 2. Stock Pile
    fromNullable(document.getElementById('solitaire-stock-pile')).map(el => {
      if (s.stock.length > 0) {
        el.innerHTML = `
          <div class="playing-card-ui bg-gradient-to-br from-emerald-950 via-stone-900 to-emerald-950 text-emerald-300 border-emerald-500/60 shadow-xl items-center justify-center font-cathedral text-3xl select-none">
            🂠
          </div>
        `;
      } else {
        el.innerHTML = `
          <span class="material-symbols-rounded text-2xl text-emerald-400/50 hover:text-emerald-300 transition" title="Recycle waste back into stock">refresh</span>
        `;
      }
    });

    // 3. Waste Pile
    fromNullable(document.getElementById('solitaire-waste-pile')).map(el => {
      if (s.waste.length > 0) {
        const topCard = s.waste[s.waste.length - 1]!;
        const isSelected = selectedSolitaireCard.map(sel => sel.source === 'waste').getOrElse(false);
        el.innerHTML = renderSolitaireCardHtml(topCard, isSelected);
      } else {
        el.innerHTML = '';
      }
    });

    // 4. Foundations
    const suits = [CardSuitEnum.Hearts, CardSuitEnum.Diamonds, CardSuitEnum.Clubs, CardSuitEnum.Spades];
    suits.forEach(suit => {
      fromNullable(document.getElementById(`solitaire-foundation-${suit}`)).map(el => {
        const pile = s.foundations[suit];
        if (pile.length > 0) {
          const topCard = pile[pile.length - 1]!;
          el.innerHTML = renderSolitaireCardHtml(topCard);
        } else {
          const icon = suit === 'hearts' ? 'favorite' : suit === 'diamonds' ? 'diamond' : suit === 'clubs' ? 'eco' : 'shield';
          const color = suit === 'hearts' ? 'text-rose-500/40' : suit === 'diamonds' ? 'text-amber-500/40' : suit === 'clubs' ? 'text-emerald-400/40' : 'text-sky-400/40';
          el.innerHTML = `<span class="material-symbols-rounded text-2xl ${color} select-none">${icon}</span>`;
        }
      });
    });

    // 5. Tableau Columns
    for (let colIdx = 0; colIdx < 7; colIdx++) {
      fromNullable(document.getElementById(`solitaire-tableau-${colIdx}`)).map(el => {
        const column = s.tableau[colIdx]!;
        if (column.length === 0) {
          el.innerHTML = `
            <div class="solitaire-slot border-2 border-dashed border-white/10 hover:border-emerald-400/40 rounded-2xl flex items-center justify-center text-stone-500 text-xs font-mono select-none" title="Empty Tableau slot (Accepts King)">
              K
            </div>
          `;
        } else {
          el.innerHTML = column
            .map((card, cardIdx) => {
              const isSelected = selectedSolitaireCard
                .map(sel => sel.source === 'tableau' && sel.colIdx === colIdx && typeof sel.cardIdx === 'number' && cardIdx >= sel.cardIdx)
                .getOrElse(false);
              const cardHtml = renderSolitaireCardHtml(card, isSelected);
              const marginTop = cardIdx === 0 ? '0' : '-5.5rem';
              return `
                <div data-col="${colIdx}" data-idx="${cardIdx}" style="margin-top: ${marginTop}; z-index: ${cardIdx + 1}; position: relative;" class="solitaire-tableau-card">
                  ${cardHtml}
                </div>
              `;
            })
            .join('');
        }
      });
    }
  };

  // Solitaire Interaction Event Listeners
  fromNullable(document.getElementById('solitaire-stock-slot')).map(slot =>
    slot.addEventListener('click', () => {
      if (solitaireIsSpectator) {
        ui.showTemporaryBanner('Spectator Mode: You are observing this match.', 2000);
        return;
      }
      solitaireEngine.drawFromStock(1);
      selectedSolitaireCard = none();
      soundFX.playStoneSlide(0.25);
      broadcastSolitaireIfLive();
      renderSolitaireBoard();
    })
  );

  fromNullable(document.getElementById('solitaire-waste-slot')).map(slot =>
    slot.addEventListener('click', () => {
      if (solitaireIsSpectator) return;
      if (solitaireEngine.state.waste.length === 0) return;

      selectedSolitaireCard = selectedSolitaireCard.match({
        Some: sel => (sel.source === 'waste' ? none() : some({ source: 'waste' as const })),
        None: () => some({ source: 'waste' as const })
      });
      soundFX.playSelect();
      renderSolitaireBoard();
    })
  );

  const suitsArr = [CardSuitEnum.Hearts, CardSuitEnum.Diamonds, CardSuitEnum.Clubs, CardSuitEnum.Spades];
  suitsArr.forEach(suit => {
    fromNullable(document.getElementById(`solitaire-foundation-${suit}`)).map(el =>
      el.addEventListener('click', () => {
        if (solitaireIsSpectator) return;
        selectedSolitaireCard.map(sel => {
          if (sel.source === 'waste') {
            const res = solitaireEngine.moveWasteToFoundation(suit);
            if (res.isSuccess()) {
              selectedSolitaireCard = none();
              soundFX.playSelect();
              broadcastSolitaireIfLive();
              renderSolitaireBoard();
            }
          } else if (sel.source === 'tableau' && typeof sel.colIdx === 'number') {
            const res = solitaireEngine.moveTableauToFoundation(sel.colIdx, suit);
            if (res.isSuccess()) {
              selectedSolitaireCard = none();
              soundFX.playSelect();
              broadcastSolitaireIfLive();
              renderSolitaireBoard();
            }
          }
        });
      })
    );
  });

  for (let cIdx = 0; cIdx < 7; cIdx++) {
    const colIdx = cIdx;
    fromNullable(document.getElementById(`solitaire-tableau-${colIdx}`)).map(colEl =>
      colEl.addEventListener('click', (e: MouseEvent) => {
        if (solitaireIsSpectator) return;
        const target = e.target as HTMLElement;
        const cardWrapper = target.closest('[data-idx]') as HTMLElement | null;

        if (cardWrapper && cardWrapper.dataset.idx !== undefined) {
          const cardIdx = Number(cardWrapper.dataset.idx);
          const clickedCard = solitaireEngine.state.tableau[colIdx]![cardIdx]!;

          selectedSolitaireCard.match({
            Some: sel => {
              // Try move onto this column
              if (sel.source === 'waste') {
                const res = solitaireEngine.moveWasteToTableau(colIdx);
                if (res.isSuccess()) {
                  selectedSolitaireCard = none();
                  soundFX.playStoneSlide(0.25);
                  broadcastSolitaireIfLive();
                  renderSolitaireBoard();
                  return;
                }
              } else if (sel.source === 'tableau' && typeof sel.colIdx === 'number' && typeof sel.cardIdx === 'number') {
                const res = solitaireEngine.moveTableauToTableau(sel.colIdx, sel.cardIdx, colIdx);
                if (res.isSuccess()) {
                  selectedSolitaireCard = none();
                  soundFX.playStoneSlide(0.25);
                  broadcastSolitaireIfLive();
                  renderSolitaireBoard();
                  return;
                }
              }
              // If move was not possible or invalid, select clicked card if face-up
              if (clickedCard.faceUp) {
                if (sel.source === 'tableau' && sel.colIdx === colIdx && sel.cardIdx === cardIdx) {
                  selectedSolitaireCard = none();
                } else {
                  selectedSolitaireCard = some({ source: 'tableau' as const, colIdx, cardIdx });
                }
                soundFX.playSelect();
                renderSolitaireBoard();
              }
            },
            None: () => {
              if (clickedCard.faceUp) {
                selectedSolitaireCard = some({ source: 'tableau' as const, colIdx, cardIdx });
                soundFX.playSelect();
                renderSolitaireBoard();
              }
            }
          });
        } else {
          // Empty column clicked: check if we have a King to move here
          selectedSolitaireCard.map(sel => {
            if (sel.source === 'waste') {
              const res = solitaireEngine.moveWasteToTableau(colIdx);
              if (res.isSuccess()) {
                selectedSolitaireCard = none();
                soundFX.playStoneSlide(0.25);
                broadcastSolitaireIfLive();
                renderSolitaireBoard();
              }
            } else if (sel.source === 'tableau' && typeof sel.colIdx === 'number' && typeof sel.cardIdx === 'number') {
              const res = solitaireEngine.moveTableauToTableau(sel.colIdx, sel.cardIdx, colIdx);
              if (res.isSuccess()) {
                selectedSolitaireCard = none();
                soundFX.playStoneSlide(0.25);
                broadcastSolitaireIfLive();
                renderSolitaireBoard();
              }
            }
          });
        }
      })
    );
  }

  fromNullable(document.getElementById('solitaire-btn-draw')).map(btn =>
    btn.addEventListener('click', () => {
      if (solitaireIsSpectator) return;
      solitaireEngine.drawFromStock(1);
      selectedSolitaireCard = none();
      soundFX.playStoneSlide(0.25);
      broadcastSolitaireIfLive();
      renderSolitaireBoard();
    })
  );

  fromNullable(document.getElementById('solitaire-btn-auto-move')).map(btn =>
    btn.addEventListener('click', () => {
      if (solitaireIsSpectator) return;
      const res = solitaireEngine.autoMoveToFoundations();
      if (res.isSuccess() && res.getOrThrow().movedCount > 0) {
        soundFX.playSelect();
        broadcastSolitaireIfLive();
        renderSolitaireBoard();
      } else {
        ui.showTemporaryBanner('No eligible cards for Foundation at this moment.', 2000);
      }
    })
  );

  fromNullable(document.getElementById('solitaire-btn-undo')).map(btn =>
    btn.addEventListener('click', () => {
      if (solitaireIsSpectator) return;
      const res = solitaireEngine.undo();
      if (res.isSuccess()) {
        selectedSolitaireCard = none();
        soundFX.playSelect();
        broadcastSolitaireIfLive();
        renderSolitaireBoard();
      } else {
        ui.showTemporaryBanner('No moves to undo.', 2000);
      }
    })
  );

  fromNullable(document.getElementById('solitaire-btn-new')).map(btn =>
    btn.addEventListener('click', () => {
      if (solitaireIsSpectator) return;
      solitaireEngine.restartGame();
      selectedSolitaireCard = none();
      soundFX.playSelect();
      broadcastSolitaireIfLive();
      renderSolitaireBoard();
    })
  );

  fromNullable(document.getElementById('btn-solitaire-rules')).map(btn =>
    btn.addEventListener('click', () => ui.showArcadeRules('solitaire'))
  );

  fromNullable(document.getElementById('btn-close-solitaire')).map(btn =>
    btn.addEventListener('click', () => {
      disconnectActiveArcade();
      forgetArcadeResume();
      ui.hideSolitaire();
    })
  );

  fromNullable(document.getElementById('btn-close-solitaire-x')).map(btn =>
    btn.addEventListener('click', () => {
      disconnectActiveArcade();
      forgetArcadeResume();
      ui.hideSolitaire();
    })
  );

  fromNullable(document.getElementById('btn-solitaire-copy-link')).map(btn =>
    btn.addEventListener('click', () => copyArcadeMatchLink(solitaireLiveCode, btn, 'Cathedral Solitaire'))
  );

  fromNullable(document.getElementById('btn-solitaire-copy-code')).map(btn =>
    btn.addEventListener('click', () => copyArcadeMatchCode(solitaireLiveCode, btn, 'Cathedral Solitaire'))
  );

  fromNullable(document.getElementById('solitaire-live-code')).map(el =>
    el.addEventListener('click', () => copyArcadeMatchCode(solitaireLiveCode, null, 'Cathedral Solitaire'))
  );

  fromNullable(document.getElementById('solitaire-tab-ai')).map(btn =>
    btn.addEventListener('click', () => {
      setSolitaireMode(false);
      renderSolitaireBoard();
    })
  );

  fromNullable(document.getElementById('solitaire-tab-live')).map(btn =>
    btn.addEventListener('click', () => {
      isLocalPlayerHost = true;
      solitaireLiveCode = generateArcadeCode(GameCodePrefixEnum.Solitaire);
      setSolitaireMode(true, false);
      renderSolitaireBoard();
    })
  );

  // Arcade Hub Dual Buttons (Play vs AI & Play Live)
  document.querySelectorAll('[data-game-ai]').forEach(btn => {
    btn.addEventListener('click', (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof window !== 'undefined' && window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      const targetGame = btn.getAttribute('data-game-ai') as ArcadeGameType | null;
      if (targetGame === 'chess') {
        forgetArcadeResume();
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
      } else if (targetGame === 'solitaire') {
        ui.hideArcadeHub();
        setSolitaireMode(false);
        renderSolitaireBoard();
        ui.showSolitaire();
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
    btn.addEventListener('click', (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      isLocalPlayerHost = true;
      const targetGame = btn.getAttribute('data-game-live') as ArcadeGameType | null;
      if (targetGame === 'chess') {
        forgetArcadeResume();
        ui.hideArcadeHub();
        ui.showLiveSessionModal();
        ui.switchLiveSessionTab('create');
      } else if (targetGame === 'blackjack') {
        bjkLiveCode = generateArcadeCode(GameCodePrefixEnum.Blackjack);
        ui.hideArcadeHub();
        setBlackjackMode(true);
        renderBlackjackTable();
        ui.showBlackjack();
      } else if (targetGame === 'poker') {
        pokerLiveCode = generateArcadeCode(GameCodePrefixEnum.Poker);
        ui.hideArcadeHub();
        setPokerMode(true);
        renderPokerTable();
        ui.showPoker();
      } else if (targetGame === 'skipbo') {
        skipboLiveCode = generateArcadeCode(GameCodePrefixEnum.SkipBo);
        ui.hideArcadeHub();
        setSkipBoMode(true);
        renderSkipBoTable();
        ui.showSkipBo();
      } else if (targetGame === 'phase10') {
        phase10LiveCode = generateArcadeCode(GameCodePrefixEnum.Phase10);
        ui.hideArcadeHub();
        setPhase10Mode(true);
        renderPhase10Table();
        ui.showPhase10();
      } else if (targetGame === 'uno') {
        unoLiveCode = generateArcadeCode(GameCodePrefixEnum.Uno);
        ui.hideArcadeHub();
        setUnoMode(true);
        renderUnoTable();
        ui.showUno();
      } else if (targetGame === 'avalon') {
        avalonLiveCode = generateArcadeCode(GameCodePrefixEnum.Avalon);
        ui.hideArcadeHub();
        setAvalonMode(true);
        renderAvalonTable();
        ui.showAvalon();
      } else if (targetGame === 'set') {
        setLiveCode = generateArcadeCode(GameCodePrefixEnum.Set);
        ui.hideArcadeHub();
        setSetMode(true);
        renderSetTable();
        ui.showSet();
      } else if (targetGame === 'solitaire') {
        solitaireLiveCode = generateArcadeCode(GameCodePrefixEnum.Solitaire);
        ui.hideArcadeHub();
        setSolitaireMode(true, false);
        renderSolitaireBoard();
        ui.showSolitaire();
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
        isLocalPlayerHost = false;
        if (game === 'chess') {
          forgetArcadeResume();
          ui.hideArcadeHub();
          ui.showLiveSessionModal();
          ui.switchLiveSessionTab('join');
          domById<HTMLInputElement>('live-join-code').map(joinCodeInput => {
            joinCodeInput.value = code;
          });
        } else {
          ui.hideArcadeHub();
          promptJoinLiveSession(game, code);
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
      if (!soundFX.enabled) {
        soundFX.suspend();
      }
      fromNullable(audioIcon).map(icon => {
        icon.textContent = matchBool(soundFX.enabled, {
          true: () => 'volume_up',
          false: () => 'volume_off'
        });
      });
      (e.currentTarget as HTMLElement).classList.toggle('active-chip', soundFX.enabled);
    })
  );

  // Screen Wake Lock Toggle (Cook Mode / Keep Screen Awake - Serious Eats Style)
  async function toggleKeepScreenAwake(): Promise<void> {
    const res = await wakeLockManager.toggle();
    res.match({
      Ok: active => {
        chessStore.setState({ keepScreenAwake: active });
        void persistCurrentSession();
        ui.updateWakeLockUI(active, wakeLockManager.isSupported());
        ui.showTemporaryBanner(
          matchBool(active, {
            true: () => 'Keep Screen Awake active: display will stay illuminated',
            false: () => 'Keep Screen Awake deactivated: normal screen sleep resumed'
          }),
          2600
        );
      },
      Err: err => {
        ui.updateWakeLockUI(false, wakeLockManager.isSupported());
        ui.showTemporaryBanner(`Keep Screen Awake unavailable: ${err.message}`, 3200);
      }
    });
  }

  fromNullable(document.getElementById('btn-wake-lock')).map(btnWakeLock =>
    btnWakeLock.addEventListener('click', () => {
      void toggleKeepScreenAwake();
    })
  );

  fromNullable(document.getElementById('wake-lock-checkbox') as HTMLInputElement | null).map(
    wakeLockCheckbox =>
      wakeLockCheckbox.addEventListener('change', () => {
        void toggleKeepScreenAwake();
      })
  );

  fromNullable(document.getElementById('btn-persistent-toggle-wake-lock')).map(btnPersistentWake =>
    btnPersistentWake.addEventListener('click', () => {
      void toggleKeepScreenAwake();
    })
  );

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      soundFX.suspend();
    }
  });

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

      // Restore Keep Screen Awake state if previously enabled
      if (storeState.keepScreenAwake && wakeLockManager.isSupported()) {
        void wakeLockManager.request().then(res => {
          res.map(active => ui.updateWakeLockUI(active, true));
        });
      }

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
    // Resume must never block the rest of page initialization
    const resumedArcadeTable = (await tryCatchAsync(() => resumeArcadeTable(route))).match({
      Ok: resumed => resumed,
      Err: err => {
        logger.warn('[ARCADE_RESUME] Could not restore the saved arcade table:', err);
        return false;
      }
    });
    if (!resumedArcadeTable && route.sessionCode.isNone() && route.game !== 'chess' && route.game in ARCADE_GAMES) {
      switchToArcadeGame(route.game);
    }
    route.sessionCode.filter(() => !resumedArcadeTable).map(sessionCode => {
      if (route.game === 'chess') {
        const activeLiveCode = chessStore.getState().liveSession?.sessionCode;
        if (!activeLiveCode || activeLiveCode.toUpperCase() !== sessionCode.toUpperCase()) {
          ui.showLiveSessionModal();
          ui.switchLiveSessionTab('join');
          domById<HTMLInputElement>('live-join-code').map(joinCodeInput => {
            joinCodeInput.value = sessionCode.toUpperCase();
          });
        }
      } else {
        isLocalPlayerHost = false;
        promptJoinLiveSession(route.game, sessionCode);
      }
      const title = route.game in ARCADE_GAMES ? ARCADE_GAMES[route.game as ArcadeGameType].title : 'Match';
      ui.setHubQuickJoinFeedback(
        `Invited to ${title} match: ${sessionCode}`,
        false
      );
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
