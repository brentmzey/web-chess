import * as THREE from 'three';
import { Chess, type Move } from 'chess.js';
import { CathedralSoundEngine } from './audio/CathedralSoundEngine';
import { computeMinimaxMove } from './engine/ai';
import { computeMicroNeuralAIMove } from './engine/neuralAI';
import { checkGeminiNanoStatus, computeGeminiNanoAIMove } from './engine/geminiNanoAI';
import { indicesToSquare, squareToWorld } from './engine/coordinates';
import { buildChessboardGrid, updateBoardHighlights } from './graphics/board';
import { buildGothicCathedral } from './graphics/cathedral';
import { buildDustParticles } from './graphics/dust';
import { createMaterials } from './graphics/materials';
import { buildWizardPieceMesh } from './graphics/pieces';
import { initScene } from './graphics/scene';
import { ShatterSystem } from './graphics/shatter';
import { CameraController } from './interaction/camera';
import { UIController } from './ui/uiController';
import type { GameMode, GameModeConfig, PieceColor, PieceMeshGroup, PieceType, SavedCamState } from './types';
import { fromNullable, match } from './utils/fp';

// Entry point initialization
function main(): void {
  const container = document.getElementById('canvas-container');
  if (!container) throw new Error('Canvas container (#canvas-container) not found in DOM');

  // 1. Scene, Renderer, Lights
  const { scene, camera, renderer, strikeFlashLight, altarWarmLight } = initScene(container);

  // 2. Audio & Materials
  const soundFX = new CathedralSoundEngine();
  const materials = createMaterials();

  // 3. 3D Gothic Basilica Architecture
  const { swingingThuribles, candleFlames } = buildGothicCathedral(scene, materials);

  // 4. 64-Square Board Grid
  const { squareMeshes, highlightGroup } = buildChessboardGrid(scene, materials);

  // 5. Shatter Physics System & Ambient Dust
  const shatterSystem = new ShatterSystem(scene, materials, soundFX, strikeFlashLight);
  const { updateDust } = buildDustParticles(scene);

  // 6. Camera & UI Controllers
  const camController = new CameraController(camera);
  const ui = new UIController();

  // 7. Chess State
  const chess = new Chess();
  const pieceMap: Record<string, PieceMeshGroup> = {};

  let selectedSquare: string | null = null;
  let legalMovesForSelected: Move[] = [];
  const GAME_MODES: GameModeConfig[] = [
    {
      id: 'minimax',
      label: 'Minimax Engine',
      badge: 'MINIMAX',
      icon: 'memory',
      description: 'Classical 2-ply algorithmic search with capture-ordering heuristic'
    },
    {
      id: 'micro-neural',
      label: 'Micro-Neural AI',
      badge: 'NEURAL AI',
      icon: 'psychology',
      description: 'Embedded zero-dependency neural network evaluator'
    },
    {
      id: 'gemini-nano',
      label: 'Gemini Nano (Local)',
      badge: 'NANO AI',
      icon: 'auto_awesome',
      description: 'On-device LLM via Chrome Canary Prompt API'
    },
    {
      id: 'pass-and-play',
      label: 'Pass & Play',
      badge: '2P DUEL',
      icon: 'group',
      description: 'Two players alternating turns on this device'
    }
  ];

  let isAnimating = false;
  let currentMode: GameMode = 'minimax';
  let useActionCam = true;
  let pendingPromotionMove: { from: string; to: string } | null = null;

  function syncBoardPiecesWithChessState(): void {
    Object.keys(pieceMap).forEach(sq => {
      const piece = pieceMap[sq];
      if (piece) {
        scene.remove(piece);
      }
      delete pieceMap[sq];
    });

    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const cell = board[r]?.[f];
        if (cell) {
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
        }
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
      const rank = moveObj.color === 'w' ? '1' : '8';
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
    ui.update(chess, currentMode);
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
      const epRank = moveObj.color === 'w' ? '5' : '4';
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

        attacker.position.lerpVectors(startPos, endPos, ease);
        if (isKnight) {
          attacker.position.y = Math.sin(p * Math.PI) * 2.85;
          attacker.rotation.x = Math.sin(p * Math.PI * 2) * 0.25;
        } else {
          attacker.position.y = Math.sin(p * Math.PI) * 0.18;
        }

        if (p < 1) {
          requestAnimationFrame(stepQuiet);
        } else {
          attacker.position.copy(endPos);
          attacker.rotation.x = 0;
          attacker.rotation.y = attacker.userData.baseRotY;
          finishMoveState(moveObj, attacker, savedCamState, onComplete);
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
        const weaponGroup = attacker.userData.weaponGroup;

        if (p < 0.48) {
          const subP = p / 0.48;
          const ease = 1 - Math.pow(1 - subP, 2);
          attacker.position.lerpVectors(startPos, stopPos, ease);
          if (isKnight) {
            attacker.position.y = Math.sin(subP * Math.PI) * 2.1;
          }
        } else if (p < 0.68) {
          const subP = (p - 0.48) / 0.20;
          attacker.rotation.x = -subP * 0.28;
          if (weaponGroup) weaponGroup.rotation.x = -subP * 1.15;
        } else if (p < 0.80) {
          const subP = (p - 0.68) / 0.12;
          attacker.rotation.x = -0.28 + subP * 0.54;
          if (weaponGroup) weaponGroup.rotation.x = -1.15 + subP * 2.38;
          if (!hasShattered && subP >= 0.45) {
            hasShattered = true;
            if (victim) {
              shatterSystem.spawnShatterExplosion(victim, dirNorm);
              delete pieceMap[victimSquare];
            }
          }
        } else {
          const subP = (p - 0.80) / 0.20;
          attacker.position.lerpVectors(stopPos, endPos, subP);
          attacker.rotation.x = (1 - subP) * 0.26;
          if (weaponGroup) weaponGroup.rotation.x = (1 - subP) * 1.23;
        }

        if (p < 1) {
          requestAnimationFrame(stepCombat);
        } else {
          attacker.position.copy(endPos);
          attacker.rotation.x = 0;
          attacker.rotation.y = attacker.userData.baseRotY;
          if (attacker.userData.weaponGroup) {
            attacker.userData.weaponGroup.rotation.set(0, 0, 0);
          }
          finishMoveState(moveObj, attacker, savedCamState, onComplete);
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

    if (currentMode !== 'pass-and-play' && chess.turn() === 'b' && !isAnimating) {
      setTimeout(async () => {
        const aiMove = await match(currentMode, {
          'pass-and-play': async () => null,
          'minimax': async () => computeMinimaxMove(chess),
          'micro-neural': async () => computeMicroNeuralAIMove(chess),
          'gemini-nano': async () => {
            ui.update(chess, currentMode, 'Gemini Nano (Local LLM) Thinking...');
            const result = await computeGeminiNanoAIMove(chess, (statusText) => {
              ui.showTemporaryBanner(statusText, 3200);
            });
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
            animateChessMove(executed!, () => {
              if (chess.in_check()) soundFX.playCathedralOrganAndBell();
              if (chess.game_over()) {
                ui.showGameOver(chess);
              } else {
                ui.update(chess, currentMode);
              }
            });
          });
      }, 480);
    }
  }

  function executeMoveOnBoard(moveAttempt: { from: string; to: string; promotion?: string }): void {
    const executed = chess.move(moveAttempt);
    if (!executed) return;

    selectedSquare = null;
    legalMovesForSelected = [];
    updateHighlights();

    animateChessMove(executed, () => {
      if (chess.in_check()) soundFX.playCathedralOrganAndBell();
      triggerTurnOrAI();
    });
  }

  // Pointer Interaction & Raycasting
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let isDragging = false;
  let dragStartPos = { x: 0, y: 0 };
  let prevPointer = { x: 0, y: 0 };

  const canvasEl = renderer.domElement;

  canvasEl.addEventListener('pointerdown', (e: PointerEvent) => {
    isDragging = true;
    dragStartPos = { x: e.clientX, y: e.clientY };
    prevPointer = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - prevPointer.x;
    const dy = e.clientY - prevPointer.y;
    prevPointer = { x: e.clientX, y: e.clientY };

    camController.camState.theta -= dx * 0.0065;
    camController.camState.phi = Math.max(0.18, Math.min(1.42, camController.camState.phi - dy * 0.0055));
  });

  function handleBoardClick(clientX: number, clientY: number): void {
    if (isAnimating || chess.game_over()) return;
    if (currentMode !== 'pass-and-play' && chess.turn() === 'b') return;

    pointer.x = (clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);

    const interactables: THREE.Object3D[] = [
      ...Object.values(squareMeshes),
      ...Object.values(pieceMap)
    ];

    const intersects = raycaster.intersectObjects(interactables, true);
    if (intersects.length === 0) return;

    let hitObj: THREE.Object3D | null = intersects[0]?.object ?? null;
    while (hitObj && !hitObj.userData?.['square'] && hitObj.parent) {
      hitObj = hitObj.parent;
    }
    const clickedSquare = hitObj?.userData?.['square'] as string | undefined;
    if (!clickedSquare) return;

    const candidateMove = legalMovesForSelected.find(m => m.to === clickedSquare);
    if (selectedSquare && candidateMove) {
      if (candidateMove.flags.includes('p')) {
        pendingPromotionMove = { from: selectedSquare, to: clickedSquare };
        ui.showPromotionModal();
        return;
      }
      executeMoveOnBoard({ from: selectedSquare, to: clickedSquare });
      return;
    }

    const pieceOnSq = chess.get(clickedSquare as any);
    if (pieceOnSq && pieceOnSq.color === chess.turn()) {
      selectedSquare = clickedSquare;
      legalMovesForSelected = chess.moves({ square: clickedSquare as any, verbose: true });
      soundFX.playSelect();
      updateHighlights();
    } else {
      selectedSquare = null;
      legalMovesForSelected = [];
      updateHighlights();
    }
  }

  window.addEventListener('pointerup', (e: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false;
    const dist = Math.hypot(e.clientX - dragStartPos.x, e.clientY - dragStartPos.y);
    if (dist < 6) {
      handleBoardClick(e.clientX, e.clientY);
    }
  });

  canvasEl.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    camController.camState.radius = Math.max(12, Math.min(44, camController.camState.radius + e.deltaY * 0.018));
  }, { passive: false });

  // UI Event Listeners
  const btnMode = document.getElementById('btn-mode');
  const modeLabel = document.getElementById('mode-label');
  const modeIcon = document.getElementById('mode-icon');
  const gameModeBadge = document.getElementById('game-mode-badge');

  btnMode?.addEventListener('click', async () => {
    const currentIndex = GAME_MODES.findIndex(m => m.id === currentMode);
    const nextConfig = GAME_MODES[(currentIndex + 1) % GAME_MODES.length]!;
    currentMode = nextConfig.id;

    if (modeLabel) modeLabel.textContent = nextConfig.label;
    if (modeIcon) modeIcon.textContent = nextConfig.icon;
    if (gameModeBadge) gameModeBadge.textContent = nextConfig.badge;
    btnMode.title = `${nextConfig.label}: ${nextConfig.description} (Click to cycle)`;

    if (currentMode === 'gemini-nano') {
      const nanoStatus = await checkGeminiNanoStatus();
      if (!nanoStatus.available) {
        ui.showTemporaryBanner('Chrome Canary with window.ai needed. Auto-fallback to Neural AI.', 3500);
      } else {
        ui.showTemporaryBanner('Gemini Nano On-Device AI Active', 2500);
      }
    }

    ui.update(chess, currentMode);
    triggerTurnOrAI();
  });

  const btnCamCycle = document.getElementById('btn-cam-cycle');
  const camLabel = document.getElementById('cam-label');
  btnCamCycle?.addEventListener('click', () => {
    const preset = camController.cyclePreset();
    if (camLabel) camLabel.textContent = preset.name;
  });

  const btnCinematic = document.getElementById('btn-cinematic');
  btnCinematic?.addEventListener('click', (e) => {
    useActionCam = !useActionCam;
    (e.currentTarget as HTMLElement).classList.toggle('active-chip', useActionCam);
  });

  const btnUndo = document.getElementById('btn-undo');
  btnUndo?.addEventListener('click', () => {
    if (isAnimating || chess.history().length === 0) return;
    chess.undo();
    if (currentMode !== 'pass-and-play' && chess.turn() === 'b' && chess.history().length > 0) {
      chess.undo();
    }
    selectedSquare = null;
    legalMovesForSelected = [];
    syncBoardPiecesWithChessState();
    updateHighlights();
    ui.update(chess, currentMode);
    soundFX.playSelect();
  });

  function resetGame(): void {
    chess.reset();
    selectedSquare = null;
    legalMovesForSelected = [];
    syncBoardPiecesWithChessState();
    updateHighlights();
    ui.update(chess, currentMode);
    ui.hideGameOver();
    soundFX.playSelect();
  }

  document.getElementById('btn-reset')?.addEventListener('click', resetGame);
  document.getElementById('modal-new-game')?.addEventListener('click', resetGame);
  document.getElementById('modal-inspect')?.addEventListener('click', () => {
    ui.hideGameOver();
  });

  const btnAudio = document.getElementById('btn-audio');
  const audioIcon = document.getElementById('audio-icon');
  btnAudio?.addEventListener('click', (e) => {
    soundFX.enabled = !soundFX.enabled;
    if (audioIcon) audioIcon.textContent = soundFX.enabled ? 'volume_up' : 'volume_off';
    (e.currentTarget as HTMLElement).classList.toggle('active-chip', soundFX.enabled);
  });

  document.getElementById('btn-drawer')?.addEventListener('click', () => ui.toggleDrawer());
  document.getElementById('close-drawer-btn')?.addEventListener('click', () => ui.toggleDrawer());

  document.querySelectorAll('.promo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const promoPiece = btn.getAttribute('data-promo');
      ui.hidePromotionModal();
      if (pendingPromotionMove && promoPiece) {
        executeMoveOnBoard({
          from: pendingPromotionMove.from,
          to: pendingPromotionMove.to,
          promotion: promoPiece
        });
        pendingPromotionMove = null;
      }
    });
  });

  // Initial Sync
  syncBoardPiecesWithChessState();
  ui.update(chess, currentMode);

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
      const flicker = 0.88 + Math.sin(elapsed * 14 + cf.phase) * 0.14 + Math.cos(elapsed * 23 + cf.phase) * 0.08;
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
