import { Option, Result, fromNullable, success, failure } from './fp';
import { ValidationError } from '../errors/sanctuaryError';

declare const UuidV4Brand: unique symbol;

/**
 * Branded nominal type for validated canonical UUID version 4 strings.
 * Represents an RFC 4122 compliant UUID v4 while compiling down to a primitive
 * string for seamless persistence in SQLite and PocketBase.
 */
export type UuidV4 = string & { readonly [UuidV4Brand]: true };

/**
 * Branded nominal type for distributed trace identifiers, backed by UUID v4.
 */
export type TraceId = UuidV4;

/**
 * Branded nominal type for multi-game arcade session identifiers.
 */
export type SessionId = UuidV4;

/**
 * Branded nominal type for entity identifiers across models.
 */
export type EntityId = UuidV4;

/**
 * Standard RFC 4122 UUID v4 regex pattern:
 * 8 hex digits - 4 hex digits - '4' + 3 hex digits - [8, 9, a, or b] + 3 hex digits - 12 hex digits.
 */
export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Pure type-guard function verifying whether an arbitrary value is a valid UUID v4.
 */
export function isValidUuidV4(val: unknown): val is UuidV4 {
  return typeof val === 'string' && UUID_V4_REGEX.test(val);
}

/**
 * Generates a fresh, cryptographically secure canonical UUID v4 string.
 * Uses `globalThis.crypto.randomUUID()` available in Node.js, Bun, and modern browsers.
 */
export function generateUuidV4(): UuidV4 {
  return globalThis.crypto.randomUUID() as UuidV4;
}

/**
 * Generates a fresh distributed trace identifier backed by a canonical UUID v4.
 */
export function generateTraceId(): TraceId {
  return generateUuidV4();
}

/**
 * Safely parses an arbitrary input into an `Option<UuidV4>`.
 * Returns `Some(uuid)` if valid, or `None` if invalid, null, or undefined.
 */
export function parseUuidV4(val: unknown): Option<UuidV4> {
  return fromNullable(val).filter(isValidUuidV4);
}

/**
 * Validates an arbitrary value as a UUID v4 in a monadic `Result<UuidV4, ValidationError>`.
 * Returns `Ok(uuid)` when valid, or `Err(ValidationError)` carrying structured contextual metadata.
 */
export function validateUuidV4(val: unknown,
                               fieldName: string = 'id'): Result<UuidV4, ValidationError> {
  return parseUuidV4(val).fold(
    () =>
      failure(
        new ValidationError({
          code: 'ERR_INVALID_UUID_V4',
          message: `Invalid UUID v4 for field '${fieldName}': ${String(val)}`,
          data: {
            fieldName,
            value: val,
            expectedFormat: 'xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx'
          }
        })
      ),
    validUuid => success(validUuid)
  );
}

/**
 * Ensures a value is a valid UUID v4. If valid, returns it; otherwise generates a new UUID v4.
 */
export function ensureUuidV4(val?: unknown): UuidV4 {
  return parseUuidV4(val).fold(
    () => generateUuidV4(),
    validUuid => validUuid
  );
}

/**
 * Type-casts a validated string to UuidV4 without re-parsing, or throws a ValidationError if invalid.
 */
export function asUuidV4(val: string,
                         fieldName: string = 'id'): UuidV4 {
  return validateUuidV4(val, fieldName).getOrThrow();
}
