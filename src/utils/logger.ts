import { Logger, type ILogObj } from 'tslog';
import { ExecutionSideEnum } from '../types';
import { fromNullable, match } from './fp';

export interface ExecutionProbeInput {
  hasWindow?: boolean;
  hasDocument?: boolean;
  hasBunOrNodeProcess?: boolean;
  userAgent?: string;
}

export interface ExecutionContextInfo {
  side: ExecutionSideEnum;
  runtimeLabel: string;
  isClient: boolean;
  isServer: boolean;
  timestamp: string;
}

/**
 * Pure, deterministic detector for whether code is executing CLIENT_SIDE (Browser DOM/WebGL)
 * or SERVER_SIDE (Bun / Node.js / SSR / CLI Test Runner).
 */
export function detectExecutionSide(probe?: ExecutionProbeInput): ExecutionSideEnum {
  return fromNullable(probe).fold(
    () => {
      const isServerRuntime =
        typeof process !== 'undefined' &&
        Boolean((process as any)?.versions?.bun || (process as any)?.versions?.node);
      const hasRealBrowserDOM =
        typeof window !== 'undefined' &&
        typeof document !== 'undefined' &&
        typeof HTMLCanvasElement !== 'undefined' &&
        !isServerRuntime;

      return hasRealBrowserDOM
        ? ExecutionSideEnum.ClientSide
        : ExecutionSideEnum.ServerSide;
    },
    p => {
      if (p.hasBunOrNodeProcess && !p.hasWindow) {
        return ExecutionSideEnum.ServerSide;
      }
      return p.hasWindow && p.hasDocument
        ? ExecutionSideEnum.ClientSide
        : ExecutionSideEnum.ServerSide;
    }
  );
}

/**
 * Builds structured metadata describing the current execution side (Client vs Server).
 */
export function getExecutionContextInfo(probe?: ExecutionProbeInput): ExecutionContextInfo {
  const side = detectExecutionSide(probe);

  const runtimeLabel = match(side, {
    [ExecutionSideEnum.ClientSide]: () => {
      const ua =
        probe?.userAgent ??
        (typeof navigator !== 'undefined' ? navigator.userAgent : 'Browser WebGL Client');
      return `Browser Client (${ua})`;
    },
    [ExecutionSideEnum.ServerSide]: () => {
      const runtimeVer =
        typeof process !== 'undefined'
          ? (process as any)?.versions?.bun || (process as any)?.versions?.node || 'Headless'
          : 'Headless';
      return `Bun/Node Server Runtime (v${runtimeVer})`;
    }
  });

  return {
    side,
    runtimeLabel,
    isClient: side === ExecutionSideEnum.ClientSide,
    isServer: side === ExecutionSideEnum.ServerSide,
    timestamp: new Date().toISOString()
  };
}

/**
 * Creates a pretty-formatted `tslog` Logger that automatically prefixes and tags
 * whether logs originate from CLIENT_SIDE or SERVER_SIDE.
 */
export function createSanctuaryLogger(
  name: string = 'SanctuaryChess',
  probe?: ExecutionProbeInput
): Logger<ILogObj> {
  const initialSide = detectExecutionSide(probe);

  const instance = new Logger<ILogObj>({
    name,
    type: 'pretty',
    minLevel: 2, // DEBUG and above
    prefix: [`[${initialSide}]`]
  });

  instance.use(ctx => {
    const activeSide = detectExecutionSide(probe);
    ctx.meta['executionSide'] = activeSide;
    return ctx;
  });

  return instance;
}

/** Shared application pretty logger powered by tslog */
export const logger: Logger<ILogObj> = createSanctuaryLogger('SanctuaryChess');

/**
 * Emits a pretty `tslog` diagnostic log explicitly reporting whether execution
 * is happening on CLIENT_SIDE or SERVER_SIDE, along with optional hardware/session details.
 */
export function logExecutionContext(
  scope: string,
  details: Record<string, unknown> = {},
  probe?: ExecutionProbeInput
): ExecutionContextInfo {
  const info = getExecutionContextInfo(probe);
  const scopedLogger = probe ? createSanctuaryLogger(scope, probe) : logger;

  scopedLogger.info(
    `${scope} initialized on ${info.runtimeLabel}`,
    {
      executionSide: info.side,
      isClientSide: info.isClient,
      isServerSide: info.isServer,
      runtime: info.runtimeLabel,
      ...details
    }
  );

  return info;
}
