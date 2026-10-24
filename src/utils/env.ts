import { fromNullable, matchBool, none, some, type Option } from './fp';

export interface DevModeEnvProbe {
  viteDev?: boolean;
  nodeEnv?: string;
}

let devModeOverrideOpt: Option<boolean> = none();

/**
 * Explicitly sets or resets a development mode override (primarily for automated testing).
 * Passing `none()` or `null` restores automated environment detection.
 */
export function setDevModeOverride(
  overrideOpt: Option<boolean> | null | undefined | boolean
): void {
  devModeOverrideOpt = fromNullable(overrideOpt).fold(
    () => none<boolean>(),
    opt =>
      typeof (opt as any)?.fold === 'function'
        ? (opt as Option<boolean>)
        : some(Boolean(opt))
  );
}

/**
 * Pure environment probe for dev mode (Vite client DEV flag or local development NODE_ENV).
 */
export function detectDevMode(probe?: DevModeEnvProbe): boolean {
  return fromNullable(probe).fold(
    () => {
      const isViteDev =
        typeof import.meta !== 'undefined' &&
        Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
      return isViteDev || (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development');
    },
    p =>
      matchBool(Boolean(p.viteDev), {
        true: () => true,
        false: () => p.nodeEnv === 'development'
      })
  );
}

/**
 * Returns whether client is operating in "dev mode" (local/non-deployed environment).
 * Evaluates `devModeOverrideOpt` first, falling back to `detectDevMode(probe)`.
 */
export function isDevMode(probe?: DevModeEnvProbe): boolean {
  return devModeOverrideOpt.fold(
    () => detectDevMode(probe),
    forced => forced
  );
}
