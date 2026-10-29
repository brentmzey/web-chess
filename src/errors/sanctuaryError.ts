import type { Logger, ILogObj } from 'tslog';
import { currentEpochMs, epochMsToIso } from '../utils/dateTime';
import { logger } from '../utils/logger';
import { failure, success, Failure, type Result } from '../utils/fp';
import type { TraceId } from '../utils/uuid';

export enum ErrorNamespaceEnum {
  Database = 'DATABASE',
  Engine = 'ENGINE',
  Realtime = 'REALTIME',
  Validation = 'VALIDATION',
  Storage = 'STORAGE',
  Session = 'SESSION',
  Audio = 'AUDIO',
  Config = 'CONFIG',
  Network = 'NETWORK',
  System = 'SYSTEM'
}

export type ErrorNamespace = ErrorNamespaceEnum | string;

export interface ErrorDataPayload {
  readonly [key: string]: unknown;
}

export interface SanctuaryErrorOptions<TData extends ErrorDataPayload = ErrorDataPayload> {
  readonly namespace?: ErrorNamespace;
  readonly code?: string;
  readonly message: string;
  readonly data?: Readonly<TData>;
  readonly cause?: unknown;
  readonly traceId?: TraceId | string;
  readonly timestamp?: number;
}

export interface ErrorSerializedFormat {
  readonly name: string;
  readonly namespace: string;
  readonly code: string;
  readonly message: string;
  readonly data: Record<string, unknown>;
  readonly timestamp: number;
  readonly isoTime: string;
  readonly traceId?: TraceId | string;
  readonly stack?: string;
  readonly cause?: unknown;
}

/**
 * Standard Namespaced Error Data Class / Model for Sanctuary applications.
 * Carries human-readable messages, namespaced domain scopes, structured contextual data,
 * distributed trace IDs, and timestamps.
 */
export class SanctuaryError<TData extends ErrorDataPayload = ErrorDataPayload> extends Error {
  public readonly namespace: ErrorNamespace;
  public readonly code: string;
  public readonly data: Readonly<TData>;
  public readonly timestamp: number;
  public readonly traceId?: TraceId | string;
  public readonly cause?: unknown;

  constructor(options: SanctuaryErrorOptions<TData>) {
    super(options.message);
    this.name = 'SanctuaryError';
    this.namespace = options.namespace ?? ErrorNamespaceEnum.System;
    this.code = options.code ?? 'ERR_UNKNOWN';
    this.data = Object.freeze({ ...(options.data ?? ({} as TData)) });
    this.timestamp = options.timestamp ?? currentEpochMs();
    this.traceId = options.traceId;
    this.cause = options.cause;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Semantic alias for structured error data payload.
   */
  public get context(): Readonly<TData> {
    return this.data;
  }

  /**
   * Returns a dictionary representation of error details.
   */
  public get details(): Record<string, unknown> {
    return {
      name: this.name,
      namespace: this.namespace,
      code: this.code,
      message: this.message,
      data: this.data,
      timestamp: this.timestamp,
      traceId: this.traceId,
      cause: this.cause
    };
  }

  /**
   * Immutably creates a new SanctuaryError merging additional structured context data,
   * preserving the underlying subclass.
   */
  public withData<TNewData extends ErrorDataPayload>(
    extraData: Readonly<TNewData>
  ): SanctuaryError<TData & TNewData> {
    const ctor = this.constructor as new (opts: SanctuaryErrorOptions<any>) => SanctuaryError<any>;
    return new ctor({
      namespace: this.namespace,
      code: this.code,
      message: this.message,
      data: Object.freeze({ ...this.data, ...extraData }),
      cause: this.cause,
      traceId: this.traceId,
      timestamp: this.timestamp
    }) as SanctuaryError<TData & TNewData>;
  }

  /**
   * Immutably creates a new SanctuaryError with an attached distributed trace ID,
   * preserving the underlying subclass.
   */
  public withTraceId(traceId: TraceId | string): SanctuaryError<TData> {
    const ctor = this.constructor as new (opts: SanctuaryErrorOptions<any>) => SanctuaryError<any>;
    return new ctor({
      namespace: this.namespace,
      code: this.code,
      message: this.message,
      data: this.data,
      cause: this.cause,
      traceId,
      timestamp: this.timestamp
    }) as SanctuaryError<TData>;
  }

  /**
   * Immutably creates a new SanctuaryError with an updated underlying cause,
   * preserving the underlying subclass.
   */
  public withCause(cause: unknown): SanctuaryError<TData> {
    const ctor = this.constructor as new (opts: SanctuaryErrorOptions<any>) => SanctuaryError<any>;
    return new ctor({
      namespace: this.namespace,
      code: this.code,
      message: this.message,
      data: this.data,
      cause,
      traceId: this.traceId,
      timestamp: this.timestamp
    }) as SanctuaryError<TData>;
  }

  /**
   * Formats this error into a serializable log object carrying full context.
   */
  public toLogObject(): ErrorSerializedFormat {
    return {
      name: this.name,
      namespace: String(this.namespace),
      code: this.code,
      message: this.message,
      data: { ...this.data },
      timestamp: this.timestamp,
      isoTime: epochMsToIso(this.timestamp),
      traceId: this.traceId,
      stack: this.stack,
      cause: this.cause
    };
  }

  /**
   * Formats this error into a single-line summary string for tracing and log headers.
   */
  public toLogString(): string {
    const traceSnippet = this.traceId ? ` [traceId=${this.traceId}]` : '';
    const hasData = Object.keys(this.data).length > 0;
    const dataSnippet = hasData ? ` Context: ${JSON.stringify(this.data)}` : '';
    return `[${this.namespace}::${this.code}] ${this.message}${traceSnippet}${dataSnippet}`;
  }

  /**
   * Emits this error with all structured context directly to the tslog logger.
   */
  public log(targetLogger: Logger<ILogObj> = logger,
             level: 'error' | 'warn' | 'info' | 'debug' = 'error',
             customPrefix?: string): void {
    const prefix = customPrefix ? `${customPrefix} -> ` : '';
    targetLogger[level](`${prefix}${this.toLogString()}`, this.toLogObject());
  }

  public toJSON(): ErrorSerializedFormat {
    return this.toLogObject();
  }

  public override toString(): string {
    return this.toLogString();
  }

  // ============================================================================
  // Static Factory Methods for Namespaced Errors
  // ============================================================================

  public static database<TData extends ErrorDataPayload = ErrorDataPayload>(
    code: string,
    message: string,
    data?: Readonly<TData>,
    options?: Partial<SanctuaryErrorOptions<TData>>
  ): DatabaseError<TData> {
    return new DatabaseError<TData>(code, message, data, options);
  }

  public static engine<TData extends ErrorDataPayload = ErrorDataPayload>(
    code: string,
    message: string,
    data?: Readonly<TData>,
    options?: Partial<SanctuaryErrorOptions<TData>>
  ): GameEngineError<TData> {
    return new GameEngineError<TData>(code, message, data, options);
  }

  public static realtime<TData extends ErrorDataPayload = ErrorDataPayload>(
    code: string,
    message: string,
    data?: Readonly<TData>,
    options?: Partial<SanctuaryErrorOptions<TData>>
  ): RealtimeError<TData> {
    return new RealtimeError<TData>(code, message, data, options);
  }

  public static validation<TData extends ErrorDataPayload = ErrorDataPayload>(
    code: string,
    message: string,
    data?: Readonly<TData>,
    options?: Partial<SanctuaryErrorOptions<TData>>
  ): ValidationError<TData> {
    return new ValidationError<TData>(code, message, data, options);
  }

  public static storage<TData extends ErrorDataPayload = ErrorDataPayload>(
    code: string,
    message: string,
    data?: Readonly<TData>,
    options?: Partial<SanctuaryErrorOptions<TData>>
  ): StorageError<TData> {
    return new StorageError<TData>(code, message, data, options);
  }

  public static session<TData extends ErrorDataPayload = ErrorDataPayload>(
    code: string,
    message: string,
    data?: Readonly<TData>,
    options?: Partial<SanctuaryErrorOptions<TData>>
  ): SessionError<TData> {
    return new SessionError<TData>(code, message, data, options);
  }

  public static audio<TData extends ErrorDataPayload = ErrorDataPayload>(
    code: string,
    message: string,
    data?: Readonly<TData>,
    options?: Partial<SanctuaryErrorOptions<TData>>
  ): AudioError<TData> {
    return new AudioError<TData>(code, message, data, options);
  }

  public static config<TData extends ErrorDataPayload = ErrorDataPayload>(
    code: string,
    message: string,
    data?: Readonly<TData>,
    options?: Partial<SanctuaryErrorOptions<TData>>
  ): ConfigError<TData> {
    return new ConfigError<TData>(code, message, data, options);
  }

  public static network<TData extends ErrorDataPayload = ErrorDataPayload>(
    code: string,
    message: string,
    data?: Readonly<TData>,
    options?: Partial<SanctuaryErrorOptions<TData>>
  ): NetworkError<TData> {
    return new NetworkError<TData>(code, message, data, options);
  }

  public static system<TData extends ErrorDataPayload = ErrorDataPayload>(
    code: string,
    message: string,
    data?: Readonly<TData>,
    options?: Partial<SanctuaryErrorOptions<TData>>
  ): SystemError<TData> {
    return new SystemError<TData>(code, message, data, options);
  }

  /**
   * Safely adapts any unknown error, exception, or string into a namespaced SanctuaryError.
   */
  public static from(
    errOrMsg: unknown,
    defaultNamespace: ErrorNamespace = ErrorNamespaceEnum.System,
    defaultCode: string = 'ERR_UNKNOWN',
    defaultData?: ErrorDataPayload
  ): SanctuaryError {
    if (errOrMsg instanceof SanctuaryError) {
      return defaultData ? errOrMsg.withData(defaultData) : errOrMsg;
    }
    if (errOrMsg instanceof Error) {
      return new SanctuaryError({
        namespace: defaultNamespace,
        code: defaultCode,
        message: errOrMsg.message,
        data: defaultData,
        cause: errOrMsg
      });
    }
    return new SanctuaryError({
      namespace: defaultNamespace,
      code: defaultCode,
      message: String(errOrMsg),
      data: defaultData
    });
  }
}

// ============================================================================
// Concrete Namespaced Subclasses
// ============================================================================

export class DatabaseError<TData extends ErrorDataPayload = ErrorDataPayload> extends SanctuaryError<TData> {
  constructor(codeOrOptions: string | SanctuaryErrorOptions<TData>,
              message?: string,
              data?: Readonly<TData>,
              options?: Partial<SanctuaryErrorOptions<TData>>) {
    if (typeof codeOrOptions === 'object') {
      super({
        ...codeOrOptions,
        namespace: codeOrOptions.namespace ?? ErrorNamespaceEnum.Database
      });
    } else {
      super({
        namespace: ErrorNamespaceEnum.Database,
        code: codeOrOptions,
        message: message ?? '',
        data,
        ...options
      });
    }
    this.name = 'DatabaseError';
  }
}

export class GameEngineError<TData extends ErrorDataPayload = ErrorDataPayload> extends SanctuaryError<TData> {
  constructor(codeOrOptions: string | SanctuaryErrorOptions<TData>,
              message?: string,
              data?: Readonly<TData>,
              options?: Partial<SanctuaryErrorOptions<TData>>) {
    if (typeof codeOrOptions === 'object') {
      super({
        ...codeOrOptions,
        namespace: codeOrOptions.namespace ?? ErrorNamespaceEnum.Engine
      });
    } else {
      super({
        namespace: ErrorNamespaceEnum.Engine,
        code: codeOrOptions,
        message: message ?? '',
        data,
        ...options
      });
    }
    this.name = 'GameEngineError';
  }
}

export class RealtimeError<TData extends ErrorDataPayload = ErrorDataPayload> extends SanctuaryError<TData> {
  constructor(codeOrOptions: string | SanctuaryErrorOptions<TData>,
              message?: string,
              data?: Readonly<TData>,
              options?: Partial<SanctuaryErrorOptions<TData>>) {
    if (typeof codeOrOptions === 'object') {
      super({
        ...codeOrOptions,
        namespace: codeOrOptions.namespace ?? ErrorNamespaceEnum.Realtime
      });
    } else {
      super({
        namespace: ErrorNamespaceEnum.Realtime,
        code: codeOrOptions,
        message: message ?? '',
        data,
        ...options
      });
    }
    this.name = 'RealtimeError';
  }
}

export class ValidationError<TData extends ErrorDataPayload = ErrorDataPayload> extends SanctuaryError<TData> {
  constructor(codeOrOptions: string | SanctuaryErrorOptions<TData>,
              message?: string,
              data?: Readonly<TData>,
              options?: Partial<SanctuaryErrorOptions<TData>>) {
    if (typeof codeOrOptions === 'object') {
      super({
        ...codeOrOptions,
        namespace: codeOrOptions.namespace ?? ErrorNamespaceEnum.Validation
      });
    } else {
      super({
        namespace: ErrorNamespaceEnum.Validation,
        code: codeOrOptions,
        message: message ?? '',
        data,
        ...options
      });
    }
    this.name = 'ValidationError';
  }
}

export class StorageError<TData extends ErrorDataPayload = ErrorDataPayload> extends SanctuaryError<TData> {
  constructor(codeOrOptions: string | SanctuaryErrorOptions<TData>,
              message?: string,
              data?: Readonly<TData>,
              options?: Partial<SanctuaryErrorOptions<TData>>) {
    if (typeof codeOrOptions === 'object') {
      super({
        ...codeOrOptions,
        namespace: codeOrOptions.namespace ?? ErrorNamespaceEnum.Storage
      });
    } else {
      super({
        namespace: ErrorNamespaceEnum.Storage,
        code: codeOrOptions,
        message: message ?? '',
        data,
        ...options
      });
    }
    this.name = 'StorageError';
  }
}

export class SessionError<TData extends ErrorDataPayload = ErrorDataPayload> extends SanctuaryError<TData> {
  constructor(codeOrOptions: string | SanctuaryErrorOptions<TData>,
              message?: string,
              data?: Readonly<TData>,
              options?: Partial<SanctuaryErrorOptions<TData>>) {
    if (typeof codeOrOptions === 'object') {
      super({
        ...codeOrOptions,
        namespace: codeOrOptions.namespace ?? ErrorNamespaceEnum.Session
      });
    } else {
      super({
        namespace: ErrorNamespaceEnum.Session,
        code: codeOrOptions,
        message: message ?? '',
        data,
        ...options
      });
    }
    this.name = 'SessionError';
  }
}

export class AudioError<TData extends ErrorDataPayload = ErrorDataPayload> extends SanctuaryError<TData> {
  constructor(codeOrOptions: string | SanctuaryErrorOptions<TData>,
              message?: string,
              data?: Readonly<TData>,
              options?: Partial<SanctuaryErrorOptions<TData>>) {
    if (typeof codeOrOptions === 'object') {
      super({
        ...codeOrOptions,
        namespace: codeOrOptions.namespace ?? ErrorNamespaceEnum.Audio
      });
    } else {
      super({
        namespace: ErrorNamespaceEnum.Audio,
        code: codeOrOptions,
        message: message ?? '',
        data,
        ...options
      });
    }
    this.name = 'AudioError';
  }
}

export class ConfigError<TData extends ErrorDataPayload = ErrorDataPayload> extends SanctuaryError<TData> {
  constructor(codeOrOptions: string | SanctuaryErrorOptions<TData>,
              message?: string,
              data?: Readonly<TData>,
              options?: Partial<SanctuaryErrorOptions<TData>>) {
    if (typeof codeOrOptions === 'object') {
      super({
        ...codeOrOptions,
        namespace: codeOrOptions.namespace ?? ErrorNamespaceEnum.Config
      });
    } else {
      super({
        namespace: ErrorNamespaceEnum.Config,
        code: codeOrOptions,
        message: message ?? '',
        data,
        ...options
      });
    }
    this.name = 'ConfigError';
  }
}

export class NetworkError<TData extends ErrorDataPayload = ErrorDataPayload> extends SanctuaryError<TData> {
  constructor(codeOrOptions: string | SanctuaryErrorOptions<TData>,
              message?: string,
              data?: Readonly<TData>,
              options?: Partial<SanctuaryErrorOptions<TData>>) {
    if (typeof codeOrOptions === 'object') {
      super({
        ...codeOrOptions,
        namespace: codeOrOptions.namespace ?? ErrorNamespaceEnum.Network
      });
    } else {
      super({
        namespace: ErrorNamespaceEnum.Network,
        code: codeOrOptions,
        message: message ?? '',
        data,
        ...options
      });
    }
    this.name = 'NetworkError';
  }
}

export class SystemError<TData extends ErrorDataPayload = ErrorDataPayload> extends SanctuaryError<TData> {
  constructor(codeOrOptions: string | SanctuaryErrorOptions<TData>,
              message?: string,
              data?: Readonly<TData>,
              options?: Partial<SanctuaryErrorOptions<TData>>) {
    if (typeof codeOrOptions === 'object') {
      super({
        ...codeOrOptions,
        namespace: codeOrOptions.namespace ?? ErrorNamespaceEnum.System
      });
    } else {
      super({
        namespace: ErrorNamespaceEnum.System,
        code: codeOrOptions,
        message: message ?? '',
        data,
        ...options
      });
    }
    this.name = 'SystemError';
  }
}

// Aliases for user flexibility
export type AppError<TData extends ErrorDataPayload = ErrorDataPayload> = SanctuaryError<TData>;
export const AppError = SanctuaryError;
export type NamespacedError<TData extends ErrorDataPayload = ErrorDataPayload> = SanctuaryError<TData>;
export const NamespacedError = SanctuaryError;

/**
 * Creates a Failure Result containing a namespaced SanctuaryError.
 */
export const failureWith = <T, TData extends ErrorDataPayload = ErrorDataPayload>(
  namespace: ErrorNamespace,
  code: string,
  message: string,
  data?: Readonly<TData>,
  options?: Partial<SanctuaryErrorOptions<TData>>
): Result<T, SanctuaryError<TData>> =>
  new Failure(new SanctuaryError<TData>({
    namespace,
    code,
    message,
    data,
    ...options
  }));

/**
 * Evaluates a synchronous function into a Result, capturing any thrown exception
 * into a structured, namespaced SanctuaryError with rich contextual error data.
 */
export const tryCatchWithSanctuaryError = <T, TData extends ErrorDataPayload = ErrorDataPayload>(
  fn: () => T,
  namespace: ErrorNamespace = ErrorNamespaceEnum.System,
  code: string = 'ERR_TRY_CATCH',
  data?: Readonly<TData>
): Result<T, SanctuaryError<TData>> => {
  try {
    return success(fn());
  } catch (err) {
    return failure(SanctuaryError.from(err, namespace, code, data) as SanctuaryError<TData>);
  }
};

/**
 * Evaluates an asynchronous Promise into a Result, capturing any rejected error
 * into a structured, namespaced SanctuaryError with rich contextual error data.
 */
export const tryCatchAsyncWithSanctuaryError = async <T, TData extends ErrorDataPayload = ErrorDataPayload>(
  fn: () => Promise<T>,
  namespace: ErrorNamespace = ErrorNamespaceEnum.System,
  code: string = 'ERR_TRY_CATCH_ASYNC',
  data?: Readonly<TData>
): Promise<Result<T, SanctuaryError<TData>>> => {
  try {
    const val = await fn();
    return success(val);
  } catch (err) {
    return failure(SanctuaryError.from(err, namespace, code, data) as SanctuaryError<TData>);
  }
};
