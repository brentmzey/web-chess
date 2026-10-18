import { describe, expect, it } from 'bun:test';
import {
  applyDisplaySettings,
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_PRESETS,
  getDisplaySettings,
  setDisplaySettings,
  type DisplaySettings
} from '../src/graphics/displaySettings';

describe('Sanctuary Contrast & Display Settings (Zero-LocalStorage In-Memory Store)', () => {
  it('initializes with default display settings', () => {
    setDisplaySettings(DEFAULT_DISPLAY_SETTINGS);
    const settings = getDisplaySettings();
    expect(settings.contrast).toBe(DEFAULT_DISPLAY_SETTINGS.contrast);
    expect(settings.brightness).toBe(DEFAULT_DISPLAY_SETTINGS.brightness);
  });

  it('updates and clamps contrast and brightness values properly', () => {
    setDisplaySettings({ contrast: 135, brightness: 150 });
    const loaded = getDisplaySettings();
    expect(loaded.contrast).toBe(135);
    expect(loaded.brightness).toBe(150);

    // Clamping checks (<50 and >250)
    setDisplaySettings({ contrast: 10, brightness: 500 });
    const clamped = getDisplaySettings();
    expect(clamped.contrast).toBe(50);
    expect(clamped.brightness).toBe(250);
  });

  it('applies settings to renderer exposure, lights, and CSS filter', () => {
    const mockRenderer: any = { toneMappingExposure: 1.0 };
    const mockHemiLight: any = { intensity: 0.5 };
    const mockBoardKeyLight: any = { intensity: 1.0 };
    const mockContainer: any = { style: { filter: '' } };

    const customSettings: DisplaySettings = { contrast: 120, brightness: 150 };
    applyDisplaySettings(
      customSettings,
      mockRenderer,
      mockHemiLight,
      mockBoardKeyLight,
      mockContainer
    );

    // 1.5x brightness applied to tone mapping exposure (1.18 * 1.5 = 1.77)
    expect(mockRenderer.toneMappingExposure).toBeCloseTo(1.77, 2);
    // 1.5x brightness applied to hemisphere ambient light (0.58 * 1.5 = 0.87)
    expect(mockHemiLight.intensity).toBeCloseTo(0.87, 2);
    // Overhead light scaled with sqrt (1.15 * sqrt(1.5))
    expect(mockBoardKeyLight.intensity).toBeGreaterThan(1.15);
    // CSS filter contrast applied
    expect(mockContainer.style.filter).toBe('contrast(120%)');
  });

  it('provides well-formed clarity presets', () => {
    expect(DISPLAY_PRESETS['default']).toBeDefined();
    expect(DISPLAY_PRESETS['high-clarity']).toBeDefined();
    expect(DISPLAY_PRESETS['max-vis']).toBeDefined();

    expect(DISPLAY_PRESETS['high-clarity']!.contrast).toBeGreaterThan(100);
    expect(DISPLAY_PRESETS['high-clarity']!.brightness).toBeGreaterThan(100);
  });
});
