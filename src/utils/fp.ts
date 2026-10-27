/**
 * Functional Programming Utilities inspired by Scala and Rust:
 * - Optional<T> (Some<T> | None<T>) with map, flatMap, filter, fold, getOrElse
 * - Result<T, E> (Success<T, E> | Failure<T, E>) with map, flatMap, fold
 * - Exhaustive pattern matching (match / matchPattern)
 * - Safe monadic constructors (fromNullable, tryCatch, tryCatchAsync)
 */

const toError = (errOrMsg: unknown): Error =>
  errOrMsg instanceof Error ? errOrMsg : new Error(String(errOrMsg));

export type Result<T, E = Error> = Success<T, E> | Failure<T, E>;

export class Success<T, E> {
  constructor(public readonly value: T) {}
  isSuccess(): this is Success<T, E> { return true; }
  isFailure(): this is Failure<T, E> { return false; }

  map<U>(fn: (val: T) => U): Result<U, E> {
    return new Success(fn(this.value));
  }

  flatMap<U>(fn: (val: T) => Result<U, E>): Result<U, E> {
    return fn(this.value);
  }

  async flatMapAsync<U>(fn: (val: T) => Promise<Result<U, E>>): Promise<Result<U, E>> {
    return fn(this.value);
  }

  getOrElse(_defaultVal: T): T {
    return this.value;
  }

  getOrThrow(_errorOrMessage?: Error | string | ((err: E) => Error | string)): T {
    return this.value;
  }

  fold<U>(_onFailure: (err: E) => U, onSuccess: (val: T) => U): U {
    return onSuccess(this.value);
  }

  match<U>(branches: { Ok: (val: T) => U; Err: (err: E) => U }): U {
    return branches.Ok(this.value);
  }
}

export class Failure<T, E> {
  constructor(public readonly error: E) {}
  isSuccess(): this is Success<T, E> { return false; }
  isFailure(): this is Failure<T, E> { return true; }

  map<U>(_fn: (val: T) => U): Result<U, E> {
    return new Failure<U, E>(this.error);
  }

  flatMap<U>(_fn: (val: T) => Result<U, E>): Result<U, E> {
    return new Failure<U, E>(this.error);
  }

  async flatMapAsync<U>(_fn: (val: T) => Promise<Result<U, E>>): Promise<Result<U, E>> {
    return new Failure<U, E>(this.error);
  }

  getOrElse(defaultVal: T): T {
    return defaultVal;
  }

  getOrThrow(errorOrMessage?: Error | string | ((err: E) => Error | string)): T {
    if (errorOrMessage !== undefined) {
      const resolved =
        typeof errorOrMessage === 'function' ? errorOrMessage(this.error) : errorOrMessage;
      throw toError(resolved);
    }
    throw toError(this.error);
  }

  fold<U>(onFailure: (err: E) => U, _onSuccess: (val: T) => U): U {
    return onFailure(this.error);
  }

  match<U>(branches: { Ok: (val: T) => U; Err: (err: E) => U }): U {
    return branches.Err(this.error);
  }
}

export const success = <T, E = Error>(value: T): Result<T, E> => new Success(value);
export const failure = <T, E = Error>(error: E): Result<T, E> => new Failure<T, E>(error);

export type Optional<T> = Some<T> | None<T>;
export type Option<T> = Optional<T>;

export class Some<T> {
  constructor(public readonly value: T) {}
  isSome(): this is Some<T> { return true; }
  isNone(): this is None<T> { return false; }

  map<U>(fn: (val: T) => U): Optional<U> {
    return new Some(fn(this.value));
  }

  flatMap<U>(fn: (val: T) => Optional<U>): Optional<U> {
    return fn(this.value);
  }

  async flatMapAsync<U>(fn: (val: T) => Promise<Optional<U>>): Promise<Optional<U>> {
    return fn(this.value);
  }

  getOrElse(_defaultVal: T): T {
    return this.value;
  }

  getOrThrow(_errorOrMessage?: Error | string | (() => Error | string)): T {
    return this.value;
  }

  filter(predicate: (val: T) => boolean): Optional<T> {
    return predicate(this.value) ? this : new None<T>();
  }

  fold<U>(_onNone: () => U, onSome: (val: T) => U): U {
    return onSome(this.value);
  }

  match<U>(branches: { Some: (val: T) => U; None: () => U }): U {
    return branches.Some(this.value);
  }
}

export class None<T> {
  constructor() {}
  isSome(): this is Some<T> { return false; }
  isNone(): this is None<T> { return true; }

  map<U>(_fn: (val: T) => U): Optional<U> {
    return new None<U>();
  }

  flatMap<U>(_fn: (val: T) => Optional<U>): Optional<U> {
    return new None<U>();
  }

  async flatMapAsync<U>(_fn: (val: T) => Promise<Optional<U>>): Promise<Optional<U>> {
    return new None<U>();
  }

  getOrElse(defaultVal: T): T {
    return defaultVal;
  }

  getOrThrow(
    errorOrMessage: Error | string | (() => Error | string) = 'Expected Some(value), found None'
  ): T {
    const resolved = typeof errorOrMessage === 'function' ? errorOrMessage() : errorOrMessage;
    throw toError(resolved);
  }

  filter(_predicate: (val: T) => boolean): Optional<T> {
    return new None<T>();
  }

  fold<U>(onNone: () => U, _onSome: (val: T) => U): U {
    return onNone();
  }

  match<U>(branches: { Some: (val: T) => U; None: () => U }): U {
    return branches.None();
  }
}

export const some = <T>(value: T): Optional<T> => new Some(value);
export const none = <T>(): Optional<T> => new None<T>();

export const fromNullable = <T>(value: T | null | undefined): Optional<T> =>
  value !== null && value !== undefined ? some(value) : none<T>();

export const fromResult = <T, E>(result: Readonly<Result<T, E>>): Optional<T> =>
  result.isSuccess() ? some(result.value) : none<T>();

export const toResult = <T, E>(optional: Readonly<Optional<T>>,
                               onNone: () => E): Result<T, E> =>
  optional.isSome() ? success(optional.value) : failure(onNone());

/**
 * Combines two Option values into a single Option of a readonly tuple if both are Some.
 */
export const zipOptions = <A, B>(first: Readonly<Optional<A>>,
                                 second: Readonly<Optional<B>>): Optional<readonly [A, B]> =>
  first.flatMap(a => second.map(b => [a, b] as const));

/**
 * Combines three Option values into a single Option of a readonly 3-tuple if all are Some.
 */
export const zip3Options = <A, B, C>(first: Readonly<Optional<A>>,
                                     second: Readonly<Optional<B>>,
                                     third: Readonly<Optional<C>>): Optional<readonly [A, B, C]> =>
  first.flatMap(a => second.flatMap(b => third.map(c => [a, b, c] as const)));

/**
 * Pure functional DOM lookup returning Option<T> instead of T | null.
 */
export const domById = <T extends HTMLElement = HTMLElement>(id: string,
                                                             rootDoc?: Document): Optional<T> => {
  const doc = rootDoc ?? (typeof document !== 'undefined' ? document : undefined);
  return fromNullable(doc).flatMap(d => fromNullable(d.getElementById(id) as T | null));
};

/**
 * Generic Immutable Builder pattern (Java-style fluent builder producing frozen Readonly<T> snapshots).
 */
export class ImmutableBuilder<T extends object> {
  private readonly state: Readonly<T>;

  private constructor(initialState: Readonly<T>) {
    this.state = Object.freeze({ ...initialState });
  }

  public static from<T extends object>(initialState: Readonly<T>): ImmutableBuilder<T> {
    return new ImmutableBuilder<T>(initialState);
  }

  public with<K extends keyof T>(key: K,
                                 value: T[K]): ImmutableBuilder<T> {
    return new ImmutableBuilder<T>({
      ...this.state,
      [key]: value
    });
  }

  public withOverrides(overrides: Readonly<Partial<T>>): ImmutableBuilder<T> {
    return new ImmutableBuilder<T>({
      ...this.state,
      ...overrides
    });
  }

  public build(): Readonly<T> {
    return this.state;
  }
}

/**
 * Scala / Rust-like exhaustive pattern matching for union / enum types.
 */
export const match = <K extends string | number, R>(target: K,
                                                    branches: { [P in K]: () => R }): R => {
  const handler = branches[target];
  return handler();
};

/**
 * Rust / Scala-like exhaustive pattern matching for boolean conditions.
 */
export const matchBool = <R>(condition: boolean,
                             branches: Readonly<{ true: () => R; false: () => R }>): R =>
  condition ? branches.true() : branches.false();


/**
 * Evaluates a synchronous function into a Result monad.
 */
export const tryCatch = <T, E = Error>(fn: () => T,
                                       onError: (err: unknown) => E): Result<T, E> => {
  try {
    return success(fn());
  } catch (err) {
    return failure(onError(err));
  }
};

/**
 * Evaluates an asynchronous Promise into a Result monad.
 */
export const tryCatchAsync = async <T, E = Error>(fn: () => Promise<T>,
                                                  onError: (err: unknown) => E): Promise<Result<T, E>> => {
  try {
    const val = await fn();
    return success(val);
  } catch (err) {
    return failure(onError(err));
  }
};
