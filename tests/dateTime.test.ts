import { describe, expect, it, afterEach } from 'bun:test';
import { some, none } from '../src/utils/fp';
import {
  currentEpochMs,
  epochMsToIso,
  formatDateTime,
  isTemporalSupported,
  isoToEpochMs,
  nowIso,
  setTemporalOverride,
  subtractDaysEpochMs,
  subtractDaysIso,
  withFallback
} from '../src/utils/dateTime';

describe('Temporal & Day.js Unified DateTime Utility', () => {
  afterEach(() => {
    setTemporalOverride(none());
  });

  describe('Native Temporal Support (when available)', () => {
    it('detects Temporal support in runtime', () => {
      expect(typeof isTemporalSupported()).toBe('boolean');
    });

    it('returns current epoch milliseconds via Temporal', () => {
      const ms = currentEpochMs();
      expect(ms).toBeGreaterThan(1700000000000);
      expect(typeof ms).toBe('number');
    });

    it('returns current ISO string via Temporal', () => {
      const iso = nowIso();
      expect(iso).toContain('T');
      expect(iso).toContain('Z');
    });

    it('converts epoch ms to ISO string and parses back', () => {
      const testMs = 1710000000000;
      const iso = epochMsToIso(testMs);
      expect(iso).toContain('2024');
      const parsedMs = isoToEpochMs(iso);
      expect(parsedMs).toBe(testMs);

      const threeDaysAgoMs = subtractDaysEpochMs(3, testMs);
      expect(threeDaysAgoMs).toBe(testMs - 3 * 24 * 60 * 60 * 1000);
      expect(subtractDaysEpochMs(1)).toBeLessThan(currentEpochMs() + 1000);

      const threeDaysAgoIso = subtractDaysIso(3, testMs);
      expect(isoToEpochMs(threeDaysAgoIso)).toBe(threeDaysAgoMs);
      expect(subtractDaysIso(1)).toContain('T');
    });

    it('formats ISO datetime strings with timezone offsets and plain datetimes', () => {
      const formattedUtc = formatDateTime(some('2024-05-15T14:30:00Z'));
      expect(formattedUtc).toContain('05/15/2024');

      const formattedOffset = formatDateTime(some('2024-05-15T14:30:00-04:00'));
      expect(formattedOffset).toContain('05/15/2024');

      const formattedPlain = formatDateTime('2024-05-15T14:30:00');
      expect(formattedPlain).toContain('05/15/2024');

      expect(formatDateTime(none())).toBe('—');
      expect(formatDateTime(some(''))).toBe('—');
      expect(formatDateTime(some('   '))).toBe('—');
      expect(formatDateTime(null)).toBe('—');
      expect(formatDateTime(undefined)).toBe('—');
    });
  });

  describe('Day.js Graceful Fallback Mode (when Temporal is disabled)', () => {
    it('falls back to Day.js when Temporal is unsupported', () => {
      setTemporalOverride(some(false));
      expect(isTemporalSupported()).toBe(false);

      const ms = currentEpochMs();
      expect(ms).toBeGreaterThan(1700000000000);

      const iso = nowIso();
      expect(iso).toContain('T');
      expect(iso).toContain('Z');

      const testMs = 1715000000000;
      const testIso = epochMsToIso(testMs);
      expect(testIso).toContain('2024');
      expect(isoToEpochMs(testIso)).toBe(testMs);

      const threeDaysAgoMs = subtractDaysEpochMs(3, testMs);
      expect(threeDaysAgoMs).toBe(testMs - 3 * 24 * 60 * 60 * 1000);

      const threeDaysAgoIso = subtractDaysIso(3, testMs);
      expect(isoToEpochMs(threeDaysAgoIso)).toBe(threeDaysAgoMs);

      const formatted = formatDateTime(some('2024-10-25T18:00:00Z'));
      expect(formatted).toContain('10/25/2024');
    });

    it('falls back to Day.js when Temporal operation throws an exception', () => {
      const faultyTemporal = {
        Now: {
          instant: () => {
            throw new Error('Simulated Temporal engine error');
          }
        }
      };
      setTemporalOverride(some(faultyTemporal));
      expect(isTemporalSupported()).toBe(true);

      const ms = currentEpochMs();
      expect(ms).toBeGreaterThan(1700000000000);

      const iso = nowIso();
      expect(iso).toContain('T');
      expect(iso).toContain('Z');
    });

    it('handles formatDateTime fallback when Temporal throws on parsing', () => {
      const faultyTemporal = {
        Instant: {
          from: () => {
            throw new Error('Temporal parse failure');
          }
        }
      };
      setTemporalOverride(some(faultyTemporal));

      const formatted = formatDateTime(some('2024-10-25T18:00:00Z'));
      expect(formatted).toContain('10/25/2024');
    });

    it('withFallback helper executes fallbackFn directly when isTemporalSupported is false', () => {
      setTemporalOverride(some(false));
      const res = withFallback(
        'testOp',
        () => 'temporalResult',
        () => 'fallbackResult'
      );
      expect(res).toBe('fallbackResult');
    });
  });
});
