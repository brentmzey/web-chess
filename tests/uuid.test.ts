import { describe, expect, it } from 'bun:test';
import {
  isValidUuidV4,
  generateUuidV4,
  generateTraceId,
  parseUuidV4,
  validateUuidV4,
  ensureUuidV4,
  asUuidV4,
  UUID_V4_REGEX
} from '../src/utils/uuid';
import { ValidationError } from '../src/errors/sanctuaryError';

describe('UUID v4 Branded Typing, Validation & Trace ID Utility', () => {
  it('validates canonical UUID version 4 strings with regex and type guard', () => {
    const validUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    expect(isValidUuidV4(validUuid)).toBe(true);
    expect(UUID_V4_REGEX.test(validUuid)).toBe(true);

    // Invalid versions or formats
    expect(isValidUuidV4('f47ac10b-58cc-1372-a567-0e02b2c3d479')).toBe(false); // v1
    expect(isValidUuidV4('f47ac10b-58cc-4372-0567-0e02b2c3d479')).toBe(false); // variant 0
    expect(isValidUuidV4('not-a-uuid')).toBe(false);
    expect(isValidUuidV4('')).toBe(false);
    expect(isValidUuidV4(null)).toBe(false);
    expect(isValidUuidV4(undefined)).toBe(false);
    expect(isValidUuidV4(12345)).toBe(false);
    expect(isValidUuidV4({})).toBe(false);
  });

  it('generates cryptographically secure canonical UUID v4 and Trace IDs', () => {
    const id1 = generateUuidV4();
    const id2 = generateUuidV4();
    const traceId = generateTraceId();

    expect(isValidUuidV4(id1)).toBe(true);
    expect(isValidUuidV4(id2)).toBe(true);
    expect(isValidUuidV4(traceId)).toBe(true);
    expect(id1).not.toBe(id2);
  });

  it('parses UUID v4 into Option<UuidV4> monad', () => {
    const sample = '3d59648a-6b8f-4d92-807d-5a8b27670868';
    const parsedSome = parseUuidV4(sample);
    expect(parsedSome.isSome()).toBe(true);
    expect(parsedSome.getOrElse('' as any)).toBe(sample as any);

    expect(parseUuidV4('invalid').isNone()).toBe(true);
    expect(parseUuidV4(null).isNone()).toBe(true);
    expect(parseUuidV4(undefined).isNone()).toBe(true);
    expect(parseUuidV4(123).isNone()).toBe(true);
  });

  it('validates UUID v4 into Result<UuidV4, ValidationError>', () => {
    const sample = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
    const successRes = validateUuidV4(sample, 'sessionId');
    expect(successRes.isSuccess()).toBe(true);
    expect(successRes.getOrThrow()).toBe(sample as any);

    const failRes = validateUuidV4('bad-uuid', 'customField');
    expect(failRes.isFailure()).toBe(true);
    const err = failRes.match({
      Ok: () => {
        throw new Error('Expected failure');
      },
      Err: e => e
    });
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.namespace).toBe('VALIDATION');
    expect(err.code).toBe('ERR_INVALID_UUID_V4');
    expect(err.data.fieldName).toBe('customField');
    expect(err.data.value).toBe('bad-uuid');
    expect(err.message).toContain("Invalid UUID v4 for field 'customField'");
  });

  it('ensures valid UUID v4 or generates fallback', () => {
    const valid = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b';
    expect(ensureUuidV4(valid)).toBe(valid as any);

    const generated = ensureUuidV4('bad-id');
    expect(isValidUuidV4(generated)).toBe(true);
    expect(generated).not.toBe('bad-id');

    const generatedFromUndefined = ensureUuidV4(undefined);
    expect(isValidUuidV4(generatedFromUndefined)).toBe(true);
  });

  it('casts validated UUID v4 or throws ValidationError', () => {
    const valid = 'e4b9bbd0-252f-4c57-8be6-5776dca306fa';
    expect(asUuidV4(valid, 'testId')).toBe(valid as any);

    expect(() => asUuidV4('invalid', 'strictId')).toThrow();
    try {
      asUuidV4('invalid', 'strictId');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.code).toBe('ERR_INVALID_UUID_V4');
      expect(err.data.fieldName).toBe('strictId');
    }
  });
});
