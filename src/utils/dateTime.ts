import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import advancedFormat from 'dayjs/plugin/advancedFormat';
import {
  fromNullable,
  matchBool,
  none,
  tryCatch,
  type Option
} from './fp';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advancedFormat);

let temporalOverrideOpt: Option<unknown> = none();

/**
 * Sets a testing override for Temporal availability.
 * Pass `some(mockTemporal)` to simulate Temporal support,
 * `some(false)` or `some(null)` to simulate absence (triggering Day.js fallback),
 * or `none()` to use the runtime environment detection.
 */
export function setTemporalOverride(overrideOpt: Option<unknown>): void {
  temporalOverrideOpt = overrideOpt;
}

/**
 * Checks whether the ECMAScript Temporal API is supported in the current environment.
 */
export function isTemporalSupported(): boolean {
  return temporalOverrideOpt.fold(
    () => typeof (globalThis as unknown as { readonly Temporal?: unknown }).Temporal !== 'undefined',
    override => override !== null && override !== undefined && override !== false
  );
}

const getTemporal = (): Record<string, any> => {
  return temporalOverrideOpt.fold(
    () => (globalThis as unknown as Record<string, any>).Temporal,
    override => override as Record<string, any>
  );
};

const toError = (err: unknown): Error =>
  err instanceof Error ? err : new Error(String(err));

/**
 * Executes a date/datetime operation using Temporal, with graceful Day.js fallback
 * if Temporal is unsupported or throws an unexpected runtime exception.
 */
export function withFallback<T>(operationName: string,
                                temporalFn: (temporal: Record<string, any>) => T,
                                fallbackFn: () => T): T {
  return matchBool(isTemporalSupported(), {
    true: () => {
      const res = tryCatch(() => temporalFn(getTemporal()), toError);
      return res.match({
        Ok: val => val,
        Err: err => {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn(`Temporal failure in ${operationName}, falling back to Day.js:`, err);
          }
          return fallbackFn();
        }
      });
    },
    false: () => fallbackFn()
  });
}

/**
 * Returns current timestamp in epoch milliseconds.
 * Uses Temporal.Now.instant().epochMilliseconds if available, falling back to dayjs().valueOf().
 */
export function currentEpochMs(): number {
  return withFallback(
    'currentEpochMs',
    Temporal => Temporal.Now.instant().epochMilliseconds,
    () => dayjs().valueOf()
  );
}

/**
 * Returns the current date/time as an ISO 8601 string.
 * Uses Temporal.Now.instant().toString() if available, falling back to dayjs().toISOString().
 */
export function nowIso(): string {
  return withFallback(
    'nowIso',
    Temporal => Temporal.Now.instant().toString(),
    () => dayjs().toISOString()
  );
}

/**
 * Converts epoch milliseconds to an ISO 8601 string.
 * Uses Temporal.Instant.fromEpochMilliseconds(millis).toString(), falling back to dayjs(millis).toISOString().
 */
export function epochMsToIso(millis: number): string {
  return withFallback(
    'epochMsToIso',
    Temporal => Temporal.Instant.fromEpochMilliseconds(millis).toString(),
    () => dayjs(millis).toISOString()
  );
}

/**
 * Parses an ISO string or date string to epoch milliseconds.
 * Uses Temporal.Instant.from(iso).epochMilliseconds, falling back to dayjs(iso).valueOf().
 */
export function isoToEpochMs(iso: string): number {
  return withFallback(
    'isoToEpochMs',
    Temporal => Temporal.Instant.from(iso).epochMilliseconds,
    () => dayjs(iso).valueOf()
  );
}

/**
 * Subtracts a given number of days from an epoch millisecond timestamp and returns epoch milliseconds.
 * Uses Temporal.Instant.fromEpochMilliseconds(baseMs).subtract({ hours: days * 24 }), falling back to Day.js.
 */
export function subtractDaysEpochMs(days: number,
                                    baseEpochMs: number = currentEpochMs()): number {
  return withFallback(
    'subtractDaysEpochMs',
    Temporal => Temporal.Instant.fromEpochMilliseconds(baseEpochMs)
      .subtract({ hours: Math.round(days * 24) })
      .epochMilliseconds,
    () => dayjs(baseEpochMs).subtract(days, 'day').valueOf()
  );
}

/**
 * Subtracts a given number of days from an epoch millisecond timestamp and returns an ISO 8601 string.
 * Uses Temporal.Instant.fromEpochMilliseconds(baseMs).subtract({ hours: days * 24 }).toString(), falling back to Day.js.
 */
export function subtractDaysIso(days: number,
                                baseEpochMs: number = currentEpochMs()): string {
  return withFallback(
    'subtractDaysIso',
    Temporal => Temporal.Instant.fromEpochMilliseconds(baseEpochMs)
      .subtract({ hours: Math.round(days * 24) })
      .toString(),
    () => dayjs(baseEpochMs).subtract(days, 'day').toISOString()
  );
}

/**
 * Formats a date string (ISO or standard format) into a localized readable string (e.g. "MM/DD/YYYY, hh:mm A").
 * Accepts Option<string> or string | null | undefined.
 */
export function formatDateTime(value: Option<string> | string | undefined | null): string {
  const opt = typeof (value as any)?.fold === 'function'
    ? (value as Option<string>)
    : fromNullable(value as string | undefined | null);

  return opt.fold(
    () => '—',
    val => {
      if (!val || val.trim() === '') return '—';
      return withFallback(
        'formatDateTime',
        Temporal => {
          const isOffset = val.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(val);
          const dt = isOffset
            ? Temporal.Instant.from(val).toZonedDateTimeISO(Temporal.Now.timeZoneId()).toPlainDateTime()
            : Temporal.PlainDateTime.from(val);
          return dt.toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          });
        },
        () => dayjs(val).format('MM/DD/YYYY, hh:mm A')
      );
    }
  );
}
