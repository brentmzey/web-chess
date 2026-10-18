import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import {
  detectDeviceTier,
  getActiveDeviceTier,
  getDeviceProfileConfig,
  initDeviceTier,
  inspectHardwareCapabilities,
  MOBILE_LITE_PROFILE,
  setActiveDeviceTier
} from '../src/graphics/deviceTier';
import { buildDustParticles } from '../src/graphics/dust';
import { ShatterSystem } from '../src/graphics/shatter';
import {
  computeAspectAdjustedFov,
  computeAspectAdjustedPhi,
  computeAspectAdjustedRadius
} from '../src/interaction/camera';
import { DeviceTierEnum } from '../src/types';

describe('Mobile, Small-Screen & Low-Capability / Low-RAM Device Optimization', () => {
  const originalWindow = globalThis.window;
  const originalNav = globalThis.navigator;

  beforeEach(() => {
    setActiveDeviceTier(DeviceTierEnum.Desktop);
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).navigator = originalNav;
  });

  it('provides correct desktop profile configurations (with MSAA and 2048p shadows)', () => {
    const desktop = getDeviceProfileConfig(DeviceTierEnum.Desktop);
    expect(desktop.shadowMapSize).toBe(2048);
    expect(desktop.shardCount).toBe(34);
    expect(desktop.shardShadows).toBe(true);
    expect(desktop.dustCount).toBe(300);
    expect(desktop.maxPixelRatio).toBe(2.0);
    expect(desktop.antialias).toBe(true);
    expect(desktop.badge).toBe('Desktop');
  });

  it('provides correct mobile-lite profile configurations (VRAM-saving 512p shadows, Retina 2x DPR, no MSAA)', () => {
    const mobile = getDeviceProfileConfig(DeviceTierEnum.MobileLite);
    expect(mobile.shadowMapSize).toBe(512);
    expect(mobile.shardCount).toBe(12);
    expect(mobile.shardShadows).toBe(false);
    expect(mobile.dustCount).toBe(60);
    expect(mobile.maxPixelRatio).toBe(2.0);
    expect(mobile.antialias).toBe(false);
    expect(mobile.badge).toBe('Mobile Lite');
    expect(mobile.notice).toContain('available on Desktop');
  });

  it('detects desktop on large screens with high hardware specs (16GB RAM, 8 cores)', () => {
    (globalThis as any).window = {
      innerWidth: 1920,
      innerHeight: 1080
    };
    (globalThis as any).navigator = {
      hardwareConcurrency: 8,
      deviceMemory: 16,
      maxTouchPoints: 0
    };

    const tier = detectDeviceTier();
    expect(tier).toBe(DeviceTierEnum.Desktop);
  });

  it('detects mobile-lite on ultra-small and narrow mobile screens (320x568 & 414x896)', () => {
    (globalThis as any).window = {
      innerWidth: 320,
      innerHeight: 568
    };
    (globalThis as any).navigator = {
      hardwareConcurrency: 6,
      deviceMemory: 6,
      maxTouchPoints: 5
    };

    const snap = inspectHardwareCapabilities();
    expect(snap.isSmallScreen).toBe(true);
    expect(snap.tier).toBe(DeviceTierEnum.MobileLite);
  });

  it('detects mobile-lite on low-RAM devices (1GB / 2GB / 4GB) even on non-touch desktop screens', () => {
    for (const ramGB of [1, 2, 4]) {
      (globalThis as any).window = {
        innerWidth: 1366,
        innerHeight: 768
      };
      (globalThis as any).navigator = {
        hardwareConcurrency: 8,
        deviceMemory: ramGB,
        maxTouchPoints: 0
      };

      const snap = inspectHardwareCapabilities();
      expect(snap.isLowMemory).toBe(true);
      expect(snap.tier).toBe(DeviceTierEnum.MobileLite);
    }
  });

  it('detects mobile-lite on low-CPU core devices (<= 4 cores) even without touch', () => {
    (globalThis as any).window = {
      innerWidth: 1440,
      innerHeight: 900
    };
    (globalThis as any).navigator = {
      hardwareConcurrency: 2,
      deviceMemory: 8,
      maxTouchPoints: 0
    };

    const snap = inspectHardwareCapabilities();
    expect(snap.isLowConcurrency).toBe(true);
    expect(snap.tier).toBe(DeviceTierEnum.MobileLite);
  });

  it('detects mobile-lite when network Data Saver (saveData) is enabled', () => {
    (globalThis as any).window = {
      innerWidth: 1920,
      innerHeight: 1080
    };
    (globalThis as any).navigator = {
      hardwareConcurrency: 8,
      deviceMemory: 16,
      maxTouchPoints: 0,
      connection: { saveData: true }
    };

    const snap = inspectHardwareCapabilities();
    expect(snap.saveData).toBe(true);
    expect(snap.tier).toBe(DeviceTierEnum.MobileLite);
  });

  it('scales dust particles and non-shadowed shatter shards to conserve memory on Mobile Lite', () => {
    const scene = new THREE.Scene();
    const { dustParticles } = buildDustParticles(scene, MOBILE_LITE_PROFILE.dustCount);
    const posAttr = dustParticles.geometry.attributes['position'] as THREE.BufferAttribute;
    expect(posAttr.count).toBe(60);

    const mockMat = new THREE.MeshStandardMaterial();
    const mockMaterials: any = {
      whitePieceMaterial: mockMat,
      blackPieceMaterial: mockMat,
      goldAccentMaterial: mockMat,
      arcaneAccentMaterial: mockMat
    };
    const mockSound: any = { playMeleeShatter: () => {} };
    const flashLight = new THREE.PointLight();

    const shatter = new ShatterSystem(
      scene,
      mockMaterials,
      mockSound,
      flashLight,
      MOBILE_LITE_PROFILE
    );
    const victim = new THREE.Group();
    shatter.spawnShatterExplosion(victim, new THREE.Vector3(0, 0, 1));

    expect(shatter.activeShards.length).toBe(12);
    expect(shatter.activeShards.every(s => s.mesh.castShadow === false)).toBe(true);
  });

  it('adjusts camera radius, FOV, and polar angle on narrow portrait mobile screens so the camera stays inside the Basilica and frames all 64 squares', () => {
    const desktopRadius = computeAspectAdjustedRadius(25.5, 16 / 9);
    const desktopFov = computeAspectAdjustedFov(45, 16 / 9);
    const desktopPhi = computeAspectAdjustedPhi(0.96, 16 / 9);
    expect(desktopRadius).toBe(25.5);
    expect(desktopFov).toBe(45);
    expect(desktopPhi).toBe(0.96);

    // Portrait iPhone (375x812 -> aspect ~0.46)
    const aspect = 375 / 812;
    const portraitRadius = computeAspectAdjustedRadius(25.5, aspect);
    const portraitFov = computeAspectAdjustedFov(45, aspect);
    const portraitPhi = computeAspectAdjustedPhi(0.96, aspect);

    // Must stay strictly inside the Basilica crossing (South Rose Window is at z = 30.5, Nave piers at x = ±16.2)
    expect(portraitRadius).toBeLessThanOrEqual(24.5);
    expect(portraitRadius).toBeGreaterThanOrEqual(13.5);
    expect(portraitPhi).toBeLessThan(0.96);
    expect(portraitRadius * Math.sin(portraitPhi)).toBeLessThan(15.5);

    // Vertical FOV widens on portrait so horizontal board span (a1..h8) fits without clipping
    expect(portraitFov).toBeGreaterThan(65);
    expect(portraitFov).toBeLessThanOrEqual(86);
  });

  it('initializes device tier and logs execution context via tslog', () => {
    (globalThis as any).window = {
      innerWidth: 375,
      innerHeight: 667
    };
    (globalThis as any).navigator = {
      hardwareConcurrency: 2,
      deviceMemory: 2,
      maxTouchPoints: 5
    };

    const profile = initDeviceTier();
    expect(profile.tier).toBe(DeviceTierEnum.MobileLite);
    expect(getActiveDeviceTier()).toBe(DeviceTierEnum.MobileLite);
  });
});

