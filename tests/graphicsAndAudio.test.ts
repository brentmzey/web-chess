import { beforeEach, describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { CathedralSoundEngine } from '../src/audio/CathedralSoundEngine';
import { buildChessboardGrid, updateBoardHighlights } from '../src/graphics/board';
import { buildGothicCathedral } from '../src/graphics/cathedral';
import { DESKTOP_PROFILE } from '../src/graphics/deviceTier';
import { buildDustParticles } from '../src/graphics/dust';
import { createMaterials } from '../src/graphics/materials';
import { buildWizardPieceMesh } from '../src/graphics/pieces';
import { ShatterSystem } from '../src/graphics/shatter';
import {
  createBoardTileTexture,
  createCarraraMarbleTexture,
  createCoordinateTexture,
  createCosmatiPavementTexture,
  createLancetStainedGlassTexture,
  createRoseWindowTexture,
  createVolcanicObsidianTexture
} from '../src/graphics/textures';
import { CAMERA_PRESETS, CameraController } from '../src/interaction/camera';
import type { PieceColor, PieceMeshGroup, PieceType } from '../src/types';

function installMockCanvas2D(nullContext: boolean = false) {
  const mockCtx: any = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    arc: () => {},
    fill: () => {},
    fillText: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} })
  };

  (globalThis as any).document = {
    ...(globalThis as any).document,
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 256,
          height: 256,
          getContext: () => (nullContext ? null : mockCtx)
        };
      }
      return {};
    }
  };
}

describe('3D Graphics, Procedural Textures, Pieces, Physics & Cathedral Audio', () => {
  beforeEach(() => {
    installMockCanvas2D(false);
  });

  it('generates all procedural 2D canvas textures and handles null 2D context gracefully', () => {
    expect(createCarraraMarbleTexture()).toBeInstanceOf(THREE.CanvasTexture);
    expect(createVolcanicObsidianTexture()).toBeInstanceOf(THREE.CanvasTexture);
    expect(createCosmatiPavementTexture()).toBeInstanceOf(THREE.CanvasTexture);
    expect(createLancetStainedGlassTexture(0)).toBeInstanceOf(THREE.CanvasTexture);
    expect(createLancetStainedGlassTexture(1)).toBeInstanceOf(THREE.CanvasTexture);
    expect(createLancetStainedGlassTexture(2)).toBeInstanceOf(THREE.CanvasTexture);
    expect(createRoseWindowTexture()).toBeInstanceOf(THREE.CanvasTexture);
    expect(createBoardTileTexture(true)).toBeInstanceOf(THREE.CanvasTexture);
    expect(createBoardTileTexture(false)).toBeInstanceOf(THREE.CanvasTexture);
    expect(createCoordinateTexture('A')).toBeInstanceOf(THREE.CanvasTexture);

    // Fallback branch when getContext('2d') returns null
    installMockCanvas2D(true);
    expect(createCarraraMarbleTexture()).toBeInstanceOf(THREE.CanvasTexture);
    expect(createVolcanicObsidianTexture()).toBeInstanceOf(THREE.CanvasTexture);
    expect(createCosmatiPavementTexture()).toBeInstanceOf(THREE.CanvasTexture);
    expect(createLancetStainedGlassTexture(0)).toBeInstanceOf(THREE.CanvasTexture);
    expect(createRoseWindowTexture()).toBeInstanceOf(THREE.CanvasTexture);
    expect(createBoardTileTexture(true)).toBeInstanceOf(THREE.CanvasTexture);
    expect(createCoordinateTexture('8')).toBeInstanceOf(THREE.CanvasTexture);
  });

  it('builds PBR materials and all 12 articulated White & Black piece meshes', () => {
    const materials = createMaterials();
    expect(materials.whitePieceMaterial).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(materials.blackPieceMaterial).toBeInstanceOf(THREE.MeshStandardMaterial);

    const types: PieceType[] = ['p', 'r', 'n', 'b', 'q', 'k'];
    const colors: PieceColor[] = ['w', 'b'];

    for (const c of colors) {
      for (const t of types) {
        const piece = buildWizardPieceMesh(t, c, materials);
        expect(piece.userData.type).toBe(t);
        expect(piece.userData.color).toBe(c);
        expect(piece.userData.bodyGroup).toBeInstanceOf(THREE.Group);
        expect(piece.userData.weaponGroup).toBeInstanceOf(THREE.Group);
        expect(piece.userData.baseRotY).toBe(c === 'w' ? Math.PI : 0);
      }
    }
  });

  it('builds the 64-square chessboard grid and updates move, capture, and check highlights', () => {
    const scene = new THREE.Scene();
    const materials = createMaterials();
    const { squareMeshes, highlightGroup } = buildChessboardGrid(scene, materials);

    expect(Object.keys(squareMeshes).length).toBe(64);
    expect(squareMeshes['e4']).toBeDefined();
    expect(squareMeshes['a1']?.userData.isLight).toBe(false);
    expect(squareMeshes['a8']?.userData.isLight).toBe(true);

    const whiteKing = buildWizardPieceMesh('k', 'w', materials);
    const pieceMap: Record<string, PieceMeshGroup> = { e1: whiteKing };

    // Highlight selected square with quiet move and capture move while in check
    updateBoardHighlights(
      highlightGroup,
      squareMeshes,
      'e4',
      [
        { to: 'e5', flags: 'n' },
        { to: 'd5', flags: 'c' }
      ],
      true,
      'w',
      pieceMap
    );

    // 1 selection ring + 2 legal move indicators = 3 children
    expect(highlightGroup.children.length).toBe(3);

    // Clear selection
    updateBoardHighlights(highlightGroup, squareMeshes, null, [], false, 'w', pieceMap);
    expect(highlightGroup.children.length).toBe(0);
  });

  it('builds the High Gothic Basilica architecture with 5 swinging thuribles/lamps and 16 altar/nave candles', () => {
    const scene = new THREE.Scene();
    const materials = createMaterials();
    const { swingingThuribles, candleFlames } = buildGothicCathedral(scene, materials);

    expect(swingingThuribles.length).toBe(5);
    expect(candleFlames.length).toBe(16);
  });

  it('simulates dust particles drift and wrap-around at y > 25', () => {
    const scene = new THREE.Scene();
    const { dustParticles, updateDust } = buildDustParticles(scene, 20);
    const posAttr = dustParticles.geometry.attributes['position'] as THREE.BufferAttribute;

    posAttr.setY(0, 24.95);
    updateDust(0.5, 1.2);
    expect(posAttr.getY(0)).toBeCloseTo(0.2, 2);
  });

  it('simulates ShatterSystem explosion, shard bounce, scale decay, and shockwave cleanup', () => {
    const scene = new THREE.Scene();
    const materials = createMaterials();
    const soundFX = new CathedralSoundEngine();
    soundFX.enabled = false;
    const flashLight = new THREE.PointLight();

    const shatter = new ShatterSystem(
      scene,
      materials,
      soundFX,
      flashLight,
      DESKTOP_PROFILE
    );

    const whiteVictim = buildWizardPieceMesh('q', 'w', materials);
    shatter.spawnShatterExplosion(whiteVictim, new THREE.Vector3(1, 0, 0));
    expect(shatter.activeShards.length).toBe(34);
    expect(shatter.activeShockwaves.length).toBe(1);

    // Force shard downward below floor to test bounce physics and low life shrink
    shatter.activeShards[0]!.mesh.position.y = 0.01;
    shatter.activeShards[0]!.vel.y = -5.0;
    shatter.activeShards[0]!.life = 0.3;
    shatter.update(0.05);
    expect(shatter.activeShards[0]!.mesh.position.y).toBe(0.08);
    expect(shatter.activeShards[0]!.vel.y).toBeGreaterThan(0);

    // Advance enough time to expire all shards and shockwaves
    for (let step = 0; step < 30; step++) {
      shatter.update(0.15);
    }
    expect(shatter.activeShards.length).toBe(0);
    expect(shatter.activeShockwaves.length).toBe(0);
  });

  it('cycles CameraController presets and updates camera position with shake', () => {
    const cam = new THREE.PerspectiveCamera(45, 1.5, 0.1, 180);
    const ctrl = new CameraController(cam);

    const nextPreset = ctrl.cyclePreset();
    expect(nextPreset.name).toBe(CAMERA_PRESETS[1]!.name);

    ctrl.update(0.45);
    expect(cam.position.length()).toBeGreaterThan(0);

    ctrl.update(0);
    expect(cam.position.length()).toBeGreaterThan(0);
  });

  it('synthesizes all procedural cathedral Web Audio effects with mocked AudioContext', () => {
    const nodeBase = {
      connect: () => {},
      start: () => {},
      stop: () => {}
    };

    class MockAudioContext {
      public state = 'suspended';
      public currentTime = 0;
      public sampleRate = 8000;
      public destination = {};
      resume() {
        this.state = 'running';
        return Promise.resolve();
      }
      createOscillator() {
        return {
          ...nodeBase,
          type: 'sine',
          frequency: {
            value: 440,
            setValueAtTime: () => {},
            exponentialRampToValueAtTime: () => {},
            linearRampToValueAtTime: () => {}
          }
        };
      }
      createGain() {
        return {
          ...nodeBase,
          gain: {
            value: 1,
            setValueAtTime: () => {},
            exponentialRampToValueAtTime: () => {},
            linearRampToValueAtTime: () => {}
          }
        };
      }
      createBiquadFilter() {
        return {
          ...nodeBase,
          type: 'lowpass',
          frequency: {
            value: 440,
            setValueAtTime: () => {},
            linearRampToValueAtTime: () => {}
          },
          Q: { value: 1 }
        };
      }
      createBuffer(_channels: number, length: number, _rate: number) {
        const arr = new Float32Array(length);
        return {
          getChannelData: () => arr
        };
      }
      createBufferSource() {
        return {
          ...nodeBase,
          buffer: null
        };
      }
    }

    (globalThis as any).window = {
      AudioContext: MockAudioContext
    };

    const sound = new CathedralSoundEngine();
    sound.playSelect();
    sound.playStoneSlide(0.1);
    sound.playMeleeShatter();
    sound.playCathedralOrganAndBell();

    // When disabled, methods short-circuit cleanly
    sound.enabled = false;
    sound.playSelect();
    sound.playStoneSlide(0.1);
    sound.playMeleeShatter();
    sound.playCathedralOrganAndBell();
    expect(sound.enabled).toBe(false);
  });
});
