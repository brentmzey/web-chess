import { describe, expect, it } from 'bun:test';
import { some, none } from '../src/utils/fp';
import {
  detectDevMode,
  isDevMode,
  setDevModeOverride
} from '../src/utils/env';

describe('Environment Probe & DevMode Detection Utility', () => {
  it('detects dev mode via Vite and Node environment probes', () => {
    expect(detectDevMode({ viteDev: true })).toBe(true);
    expect(detectDevMode({ viteDev: false, nodeEnv: 'development' })).toBe(true);
    expect(detectDevMode({ viteDev: false, nodeEnv: 'production' })).toBe(false);
    expect(typeof detectDevMode()).toBe('boolean');
  });

  it('manages dev mode overrides with Option, boolean, null, and undefined values', () => {
    setDevModeOverride(some(true));
    expect(isDevMode()).toBe(true);

    setDevModeOverride(some(false));
    expect(isDevMode()).toBe(false);

    setDevModeOverride(true);
    expect(isDevMode()).toBe(true);

    setDevModeOverride(false);
    expect(isDevMode()).toBe(false);

    setDevModeOverride(null);
    expect(typeof isDevMode()).toBe('boolean');

    setDevModeOverride(undefined);
    expect(typeof isDevMode()).toBe('boolean');

    setDevModeOverride(none());
    expect(typeof isDevMode()).toBe('boolean');
  });
});
