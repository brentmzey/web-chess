import type * as THREE from 'three';
import { fromNullable } from '../utils/fp';

export interface DisplaySettings {
  contrast: number;   // 60 - 180%
  brightness: number; // 60 - 200%
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  contrast: 100,
  brightness: 100
};

export const DISPLAY_PRESETS: Record<string, DisplaySettings> = {
  'default': { contrast: 100, brightness: 100 },
  'high-clarity': { contrast: 120, brightness: 135 },
  'max-vis': { contrast: 110, brightness: 175 }
};

let currentDisplaySettings: DisplaySettings = { ...DEFAULT_DISPLAY_SETTINGS };

/**
 * Returns the active in-memory display settings (zero localStorage dependencies).
 */
export function getDisplaySettings(): DisplaySettings {
  return { ...currentDisplaySettings };
}

/**
 * Updates the active display settings in memory.
 */
export function setDisplaySettings(settings: Partial<DisplaySettings>): DisplaySettings {
  currentDisplaySettings = {
    contrast: Math.max(50, Math.min(250, settings.contrast ?? currentDisplaySettings.contrast)),
    brightness: Math.max(50, Math.min(250, settings.brightness ?? currentDisplaySettings.brightness))
  };
  return { ...currentDisplaySettings };
}

/**
 * Applies contrast and brightness settings to WebGL Tone Mapping,
 * Cathedral Ambient Lighting, and CSS Filter Compositing in real time.
 */
export function applyDisplaySettings(
  settings: DisplaySettings,
  renderer: THREE.WebGLRenderer,
  hemiLight: THREE.HemisphereLight,
  boardKeyLight: THREE.PointLight,
  container: HTMLElement | null
): void {
  setDisplaySettings(settings);
  const brightnessFactor = currentDisplaySettings.brightness / 100;

  // 1. WebGL ACES Filmic Tone Mapping Exposure
  renderer.toneMappingExposure = 1.18 * brightnessFactor;

  // 2. Cathedral Ambient Fill Light (lifts dark crevices & obsidian pieces)
  hemiLight.intensity = 0.58 * brightnessFactor;

  // 3. Overhead Board Illumination Key Light
  boardKeyLight.intensity = 1.15 * Math.sqrt(brightnessFactor);

  // 4. CSS Canvas Compositor Contrast Filter
  fromNullable(container).map(c => {
    c.style.filter = `contrast(${currentDisplaySettings.contrast}%)`;
  });
}
