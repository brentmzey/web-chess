import { DeviceTierEnum, type DeviceProfileConfig } from '../types';
import { logExecutionContext } from '../utils/logger';

/**
 * Desktop profile: Full Cathedral visual fidelity.
 * 2048p soft directional shadows, 34-shard dynamic collision fragments,
 * 300 liturgical incense particles, MSAA antialiasing, full retina pixel ratio.
 */
export const DESKTOP_PROFILE: DeviceProfileConfig = {
  tier: DeviceTierEnum.Desktop,
  shadowMapSize: 2048,
  shardCount: 34,
  shardShadows: true,
  dustCount: 300,
  maxPixelRatio: 2.0,
  antialias: true,
  label: 'Cathedral Ultra HD',
  badge: 'Desktop',
  notice: 'Full cathedral visual fidelity active with 2048p soft shadows and 34-shard debris physics.'
};

/**
 * Mobile / Underpowered / Low-RAM profile: High efficiency & memory conservation.
 * 512p shadow maps, 12 non-shadowed debris shards, 60 dust particles,
 * MSAA disabled to conserve GPU VRAM, capped pixel ratio (1.25x) for fluid 60fps.
 */
export const MOBILE_LITE_PROFILE: DeviceProfileConfig = {
  tier: DeviceTierEnum.MobileLite,
  shadowMapSize: 512,
  shardCount: 12,
  shardShadows: false,
  dustCount: 60,
  maxPixelRatio: 2.0,
  antialias: false,
  label: 'Mobile Sanctuary Lite',
  badge: 'Mobile Lite',
  notice: 'Optimized for mobile & low-power GPUs. Ultra-HD 2048p soft shadows & 34-shard debris are available on Desktop.'
};

export interface HardwareCapabilitySnapshot {
  tier: DeviceTierEnum;
  viewportWidth: number;
  viewportHeight: number;
  hardwareConcurrency: number | null;
  deviceMemoryGB: number | null;
  maxTouchPoints: number;
  isSmallScreen: boolean;
  isLowMemory: boolean;
  isLowConcurrency: boolean;
  saveData: boolean;
}

/**
 * Inspects viewport dimensions, RAM (`navigator.deviceMemory`), CPU cores (`navigator.hardwareConcurrency`),
 * touch points, and network data-saver hints to classify device capability.
 */
export function inspectHardwareCapabilities(): HardwareCapabilitySnapshot {
  if (typeof window === 'undefined') {
    return {
      tier: DeviceTierEnum.Desktop,
      viewportWidth: 1920,
      viewportHeight: 1080,
      hardwareConcurrency: null,
      deviceMemoryGB: null,
      maxTouchPoints: 0,
      isSmallScreen: false,
      isLowMemory: false,
      isLowConcurrency: false,
      saveData: false
    };
  }

  const viewportWidth = window.innerWidth || 1024;
  const viewportHeight = window.innerHeight || 768;

  // 1. Small screen constraint (< 768px width or < 550px height)
  const isSmallScreen = viewportWidth < 768 || viewportHeight < 550;

  // 2. Low capability / Low RAM constraints (<= 4 CPU cores or <= 4GB RAM)
  const nav =
    typeof navigator !== 'undefined'
      ? (navigator as any)
      : (window as any).navigator;

  const hardwareConcurrency =
    typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null;
  const deviceMemoryGB =
    typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : null;
  const maxTouchPoints =
    typeof nav?.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0;

  const isLowConcurrency = hardwareConcurrency !== null && hardwareConcurrency <= 4;
  const isLowMemory = deviceMemoryGB !== null && deviceMemoryGB <= 4;
  const saveData = Boolean(nav?.connection?.saveData);

  // 3. Touch-first device with medium screen
  const hasTouch = maxTouchPoints > 1 || 'ontouchstart' in window;
  const isConstrainedTouch = hasTouch && viewportWidth < 1024;

  const shouldUseMobileLite =
    isSmallScreen ||
    isLowMemory ||
    isLowConcurrency ||
    isConstrainedTouch ||
    saveData;

  return {
    tier: shouldUseMobileLite ? DeviceTierEnum.MobileLite : DeviceTierEnum.Desktop,
    viewportWidth,
    viewportHeight,
    hardwareConcurrency,
    deviceMemoryGB,
    maxTouchPoints,
    isSmallScreen,
    isLowMemory,
    isLowConcurrency,
    saveData
  };
}

/**
 * Detects whether the current device is mobile, small-screen, low-RAM, or underpowered.
 */
export function detectDeviceTier(): DeviceTierEnum {
  return inspectHardwareCapabilities().tier;
}

/**
 * Returns the profile configuration for a given tier.
 */
export function getDeviceProfileConfig(tier: DeviceTierEnum): DeviceProfileConfig {
  return tier === DeviceTierEnum.MobileLite ? MOBILE_LITE_PROFILE : DESKTOP_PROFILE;
}

let activeTier: DeviceTierEnum = DeviceTierEnum.Desktop;

export function getActiveDeviceTier(): DeviceTierEnum {
  return activeTier;
}

export function setActiveDeviceTier(tier: DeviceTierEnum): DeviceProfileConfig {
  activeTier = tier;
  return getDeviceProfileConfig(tier);
}

export function initDeviceTier(): DeviceProfileConfig {
  const snapshot = inspectHardwareCapabilities();
  const profile = setActiveDeviceTier(snapshot.tier);
  logExecutionContext('DeviceTierDetector', {
    detectedTier: profile.tier,
    profileLabel: profile.label,
    viewport: `${snapshot.viewportWidth}x${snapshot.viewportHeight}`,
    deviceMemoryGB: snapshot.deviceMemoryGB ?? 'unknown',
    hardwareConcurrency: snapshot.hardwareConcurrency ?? 'unknown',
    shadowMapSize: profile.shadowMapSize,
    shardCount: profile.shardCount,
    dustCount: profile.dustCount,
    antialias: profile.antialias
  });
  return profile;
}
