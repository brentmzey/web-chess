import { describe, expect, it } from 'bun:test';
import {
  some,
  none,
  fromNullable,
  success,
  failure,
  fromResult,
  toResult,
  match,
  tryCatch,
  tryCatchAsync
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

    it('folds correctly for Some and None', () => {
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

    it('converts between Optional and Result', () => {
      const s = success('alpha');
      expect(fromResult(s).isSome()).toBe(true);

      const f = failure('oops');
      expect(fromResult(f).isNone()).toBe(true);

      const opt = some('beta');
      expect(toResult(opt, () => 'err').isSuccess()).toBe(true);

      const noOpt = none<string>();
      expect(toResult(noOpt, () => 'missing').isFailure()).toBe(true);
    });
  });

  describe('Pattern Matching (match)', () => {
    type Light = 'red' | 'yellow' | 'green';

    it('exhaustively matches string union branches', () => {
      const getAction = (color: Light): string =>
        match(color, {
          red: () => 'stop',
          yellow: () => 'caution',
          green: () => 'go'
        });

      expect(getAction('red')).toBe('stop');
      expect(getAction('yellow')).toBe('caution');
      expect(getAction('green')).toBe('go');
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
});
