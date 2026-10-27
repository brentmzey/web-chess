import { describe, expect, it } from 'bun:test';
import {
  some,
  none,
  fromNullable,
  success,
  failure,
  fromResult,
  toResult,
  zipOptions,
  zip3Options,
  domById,
  ImmutableBuilder,
  match,
  matchBool,
  tryCatch,
  tryCatchAsync,
  type Option
} from '../src/utils/fp';

describe('Functional Programming Utilities (Scala/Rust Style)', () => {
  describe('Optional (Some / None)', () => {
    it('fromNullable converts non-null/undefined to Some and null/undefined to None', () => {
      expect(fromNullable('valid').isSome()).toBe(true);
      expect(fromNullable(0).isSome()).toBe(true);
      expect(fromNullable(false).isSome()).toBe(true);
      expect(fromNullable(null).isNone()).toBe(true);
      expect(fromNullable(undefined).isNone()).toBe(true);
    });

    it('maps over Some and preserves None', () => {
      const someVal = some(10).map(x => x * 2);
      expect(someVal.isSome()).toBe(true);
      expect(someVal.getOrElse(0)).toBe(20);

      const noneVal = none<number>().map(x => x * 2);
      expect(noneVal.isNone()).toBe(true);
      expect(noneVal.getOrElse(0)).toBe(0);
    });

    it('flatMaps over Some and returns inner Optional', () => {
      const res = some('hello').flatMap(s => some(s.toUpperCase()));
      expect(res.getOrElse('')).toBe('HELLO');
      expect(res.isNone()).toBe(false);

      const noneRes = some('hello').flatMap(() => none<string>());
      expect(noneRes.isNone()).toBe(true);
      expect(noneRes.isSome()).toBe(false);

      const flatNone = none<string>().flatMap(s => some(s));
      expect(flatNone.isNone()).toBe(true);
    });

    it('filters values matching predicate', () => {
      const kept = some(42).filter(x => x > 40);
      expect(kept.isSome()).toBe(true);

      const discarded = some(42).filter(x => x > 50);
      expect(discarded.isNone()).toBe(true);

      const noneFiltered = none<number>().filter(x => x > 0);
      expect(noneFiltered.isNone()).toBe(true);
    });

    it('folds and pattern-matches (match({ Some, None })) correctly for Some and None', () => {
      const someRes = some('found').fold(
        () => 'fallback',
        val => `got:${val}`
      );
      expect(someRes).toBe('got:found');

      const noneRes = none<string>().fold(
        () => 'fallback',
        val => `got:${val}`
      );
      expect(noneRes).toBe('fallback');

      const matchedSome = some(99).match({
        Some: val => `val=${val}`,
        None: () => 'empty'
      });
      expect(matchedSome).toBe('val=99');

      const matchedNone = none<number>().match({
        Some: val => `val=${val}`,
        None: () => 'empty'
      });
      expect(matchedNone).toBe('empty');
    });

    it('getOrThrow unwraps Some and throws descriptive Error on None', () => {
      expect(some('sanctuary').getOrThrow()).toBe('sanctuary');
      expect(() => none<string>().getOrThrow()).toThrow('Expected Some(value), found None');
      expect(() => none<string>().getOrThrow('Custom missing element')).toThrow(
        'Custom missing element'
      );
      expect(() => none<string>().getOrThrow(() => new Error('Lazy error instance'))).toThrow(
        'Lazy error instance'
      );
    });
  });

  describe('Result (Success / Failure)', () => {
    it('maps over Success and preserves Failure', () => {
      const s = success(5).map(x => x * 3);
      expect(s.isSuccess()).toBe(true);
      expect(s.isFailure()).toBe(false);
      expect(s.fold(() => 0, v => v)).toBe(15);

      const f = failure<number, string>('network error').map(x => x * 3);
      expect(f.isFailure()).toBe(true);
      expect(f.isSuccess()).toBe(false);
      expect(f.fold(err => err, () => 'ok')).toBe('network error');
    });

    it('flatMaps through Result chain', () => {
      const s = success<string, string>('123').flatMap(str => {
        const n = parseInt(str, 10);
        return isNaN(n) ? failure('NaN') : success(n);
      });
      expect(s.isSuccess()).toBe(true);
      expect(s.fold(() => -1, v => v)).toBe(123);

      const f = failure<string, string>('initial error').flatMap(() => success('ok'));
      expect(f.isFailure()).toBe(true);
    });

    it('pattern-matches Result with match({ Ok, Err }) and unwraps with getOrThrow', () => {
      const okVal = success<number, string>(42);
      expect(
        okVal.match({
          Ok: v => `ok:${v}`,
          Err: e => `err:${e}`
        })
      ).toBe('ok:42');
      expect(okVal.getOrThrow()).toBe(42);

      const errVal = failure<number, string>('corrupted cipher');
      expect(
        errVal.match({
          Ok: v => `ok:${v}`,
          Err: e => `err:${e}`
        })
      ).toBe('err:corrupted cipher');
      expect(() => errVal.getOrThrow()).toThrow('corrupted cipher');
      expect(() => errVal.getOrThrow('Override failure')).toThrow('Override failure');
      expect(() => errVal.getOrThrow(e => new Error(`Wrapped: ${e}`))).toThrow(
        'Wrapped: corrupted cipher'
      );
    });

    it('converts between Optional and Result', () => {
      const s = success('alpha');
      expect(fromResult(s).isSome()).toBe(true);

      const f = failure('oops');
      expect(fromResult(f).isNone()).toBe(true);

      const opt: Option<string> = some('beta');
      expect(toResult(opt, () => 'err').isSuccess()).toBe(true);
      expect(toResult(opt, () => 'err').getOrElse('fallback')).toBe('beta');

      const noOpt: Option<string> = none<string>();
      expect(toResult(noOpt, () => 'missing').isFailure()).toBe(true);
      expect(toResult(noOpt, () => 'missing').getOrElse('fallback')).toBe('fallback');
    });

    it('supports asynchronous flatMapAsync across Optional and Result monads', async () => {
      const someAsync = await some(7).flatMapAsync(async n => some(n * 3));
      expect(someAsync.getOrElse(0)).toBe(21);

      const noneAsync = await none<number>().flatMapAsync(async n => some(n * 3));
      expect(noneAsync.isNone()).toBe(true);

      const okAsync = await success<number, string>(10).flatMapAsync(async n => success(n + 5));
      expect(okAsync.getOrElse(0)).toBe(15);

      const errAsync = await failure<number, string>('failed').flatMapAsync(async n =>
        success(n + 5)
      );
      expect(errAsync.isFailure()).toBe(true);
    });
  });

  describe('Pattern Matching (match & matchBool)', () => {
    type Light = 'red' | 'yellow' | 'green';

    it('exhaustively matches string union branches and boolean conditions', () => {
      const getAction = (color: Light): string =>
        match(color, {
          red: () => 'stop',
          yellow: () => 'caution',
          green: () => 'go'
        });

      expect(getAction('red')).toBe('stop');
      expect(getAction('yellow')).toBe('caution');
      expect(getAction('green')).toBe('go');

      expect(
        matchBool(true, {
          true: () => 'yes',
          false: () => 'no'
        })
      ).toBe('yes');
      expect(
        matchBool(false, {
          true: () => 'yes',
          false: () => 'no'
        })
      ).toBe('no');
    });
  });

  describe('tryCatch and tryCatchAsync', () => {
    it('captures synchronous exceptions into Failure', () => {
      const ok = tryCatch(() => JSON.parse('{"a":1}'), e => (e as Error).message);
      expect(ok.isSuccess()).toBe(true);

      const bad = tryCatch(() => JSON.parse('{invalid json'), e => (e as Error).message);
      expect(bad.isFailure()).toBe(true);
    });

    it('captures rejected promises into Failure', async () => {
      const ok = await tryCatchAsync(async () => 100, e => (e as Error).message);
      expect(ok.isSuccess()).toBe(true);

      const bad = await tryCatchAsync(async () => {
        throw new Error('Async explosion');
      }, e => (e as Error).message);
      expect(bad.isFailure()).toBe(true);
    });
  });

  describe('zipOptions, zip3Options, domById, and ImmutableBuilder', () => {
    it('zips 2 and 3 Option instances into readonly tuples when all are Some', () => {
      const z2 = zipOptions(some('a'), some(2));
      expect(z2.isSome()).toBe(true);
      expect(z2.getOrThrow()).toEqual(['a', 2]);

      expect(zipOptions(some('a'), none<number>()).isNone()).toBe(true);
      expect(zipOptions(none<string>(), some(2)).isNone()).toBe(true);

      const z3 = zip3Options(some(1), some('two'), some(true));
      expect(z3.isSome()).toBe(true);
      expect(z3.getOrThrow()).toEqual([1, 'two', true]);
      expect(zip3Options(some(1), none<string>(), some(true)).isNone()).toBe(true);
    });

    it('domById safely wraps document.getElementById into Option<HTMLElement>', () => {
      const fakeEl = { id: 'sanctuary-node' } as unknown as HTMLElement;
      const fakeDoc = {
        getElementById: (id: string) => (id === 'sanctuary-node' ? fakeEl : null)
      } as unknown as Document;

      expect(domById('sanctuary-node', fakeDoc).isSome()).toBe(true);
      expect(domById('missing-node', fakeDoc).isNone()).toBe(true);
    });

    it('ImmutableBuilder produces frozen immutable snapshots with fluent updates', () => {
      interface SampleConfig {
        readonly host: string;
        readonly port: number;
        readonly tls: boolean;
      }

      const initial: SampleConfig = { host: 'localhost', port: 8080, tls: false };
      const built = ImmutableBuilder.from(initial)
        .with('port', 8443)
        .withOverrides({ tls: true })
        .build();

      expect(Object.isFrozen(built)).toBe(true);
      expect(built).toEqual({ host: 'localhost', port: 8443, tls: true });
      expect(initial.port).toBe(8080);
    });
  });
});

