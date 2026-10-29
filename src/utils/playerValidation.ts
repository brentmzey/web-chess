import { Option, Result, success, failure, fromNullable } from './fp';

/**
 * Curated list of offensive keywords, slurs, profanities, and inappropriate terms.
 * All checks are performed after normalizing leetspeak and whitespace.
 */
const PROFANITY_PATTERNS: readonly RegExp[] = [
  /fuck|fuk|fuq|fck|fux|phuck/i,
  /shit|shyt|sh1t|sh!t/i,
  /bitch|b1tch|b!tch|bytch/i,
  /asshole|asswipe|arsehole|dumbass|jackass/i,
  /bastard|b@stard/i,
  /cunt|kunt/i,
  /dick|dik|dyck|penis|cock|kok|c0ck/i,
  /pussy|puss|vagina|clit/i,
  /nigger|nigga|n1gger|n1gga|chink|gook|kike|spic|wetback/i,
  /faggot|fag|dyke|homo/i,
  /retard|spastic/i,
  /whore|slut|skank|prostitute/i,
  /nazi|hitler|swastika|holocaust/i,
  /porn|porno|hentai|dildo/i
];

/**
 * Normalizes input string for profanity detection by resolving common leetspeak substitutions
 * and stripping non-alphanumeric separators.
 */
export function normalizeForProfanityCheck(raw: string): string {
  let normalized = raw.toLowerCase().trim();

  // Substitute common leetspeak glyphs
  normalized = normalized
    .replace(/@/g, 'a')
    .replace(/1/g, 'i')
    .replace(/!/g, 'i')
    .replace(/\|/g, 'i')
    .replace(/0/g, 'o')
    .replace(/\$/g, 's')
    .replace(/3/g, 'e')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/\+/g, 't')
    .replace(/8/g, 'b');

  // Strip non-letter separators between characters to detect spaced/separated bad words
  return normalized;
}

/**
 * Detects whether a string contains prohibited offensive or profane terms.
 */
export function containsOffensiveLanguage(name: string): boolean {
  const normalized = normalizeForProfanityCheck(name);
  // Also check condensed version without spaces or symbols (e.g. "f u c k" -> "fuck")
  const condensed = normalized.replace(/[^a-z0-9]/g, '');

  for (const pattern of PROFANITY_PATTERNS) {
    if (pattern.test(normalized) || pattern.test(condensed)) {
      return true;
    }
  }

  return false;
}

export interface PlayerNameValidationOptions {
  minLength?: number;
  maxLength?: number;
  activeSessionNames?: readonly string[];
}

/**
 * Validates that a player display name is a real, un-offensive name tied to that session.
 *
 * Rules:
 * 1. Must be between minLength (default 2) and maxLength (default 20) characters.
 * 2. Must contain valid display characters (letters, numbers, spaces, apostrophes, hyphens).
 * 3. Must contain at least one letter (cannot be digits only or punctuation only).
 * 4. Cannot contain HTML tags, scripts, or invalid control characters.
 * 5. Cannot contain offensive language, hate speech, or slurs.
 * 6. Must not collide with an active player already at the table.
 */
export function validatePlayerName(rawName: string,
                                   options: PlayerNameValidationOptions = {}): Result<string, string> {
  const minLength = options.minLength ?? 2;
  const maxLength = options.maxLength ?? 20;

  if (typeof rawName !== 'string') {
    return failure('Please enter a valid player name.');
  }

  // Collapse multiple consecutive whitespaces and trim
  const trimmed = rawName.replace(/\s+/g, ' ').trim();

  if (trimmed.length < minLength) {
    return failure(`Player name must be at least ${minLength} characters long.`);
  }

  if (trimmed.length > maxLength) {
    return failure(`Player name cannot exceed ${maxLength} characters.`);
  }

  // Offensive language check first
  if (containsOffensiveLanguage(trimmed)) {
    return failure('Please choose a respectful, appropriate player name.');
  }

  // Check for allowed characters: Unicode letters, numbers, spaces, apostrophes, hyphens
  const validCharsRegex = /^[\p{L}\p{N}\s'\-]+$/u;
  if (!validCharsRegex.test(trimmed)) {
    return failure('Player name can only contain letters, numbers, spaces, apostrophes, and hyphens.');
  }

  // Must contain at least one letter
  const hasLetter = /\p{L}/u.test(trimmed);
  if (!hasLetter) {
    return failure('Player name must contain at least one letter.');
  }

  // Reject raw HTML, tags, or script-like patterns
  if (/<[^>]*>/i.test(trimmed) || /javascript:/i.test(trimmed)) {
    return failure('Player name contains invalid formatting.');
  }

  // Session duplicate check
  if (options.activeSessionNames && options.activeSessionNames.length > 0) {
    const isTaken = options.activeSessionNames.some(
      active => active.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (isTaken) {
      return failure(`The name "${trimmed}" is already seated at this table. Please choose another name.`);
    }
  }

  return success(trimmed);
}

/**
 * Safely sanitizes or falls back to an anonymous sanctuary moniker.
 */
export function sanitizePlayerNameOrDefault(rawName: Option<string>,
                                            defaultName: string = 'Pilgrim'): string {
  return rawName
    .flatMap(name => {
      const res = validatePlayerName(name);
      return res.match({
        Ok: (clean: string) => fromNullable(clean),
        Err: () => fromNullable(defaultName)
      });
    })
    .getOrElse(defaultName);
}
