import { describe, expect, it } from 'bun:test';
import {
  validatePlayerName,
  containsOffensiveLanguage,
  normalizeForProfanityCheck,
  sanitizePlayerNameOrDefault
} from '../src/utils/playerValidation';
import { some, none } from '../src/utils/fp';

describe('Player Validation & Offensive Language Filtering', () => {
  it('accepts clean, real player names with valid characters', () => {
    const validNames = [
      'Alice',
      'Bob Dylan',
      "O'Connor",
      'Jean-Luc',
      'Knight 99',
      'Galahad The Pure',
      'HighRoller',
      'Pilgrim 7'
    ];

    validNames.forEach(name => {
      const res = validatePlayerName(name);
      expect(res.isSuccess()).toBe(true);
      expect(res.getOrThrow()).toBe(name.trim());
    });
  });

  it('rejects names that are too short or too long', () => {
    expect(validatePlayerName('A').isFailure()).toBe(true);
    expect(validatePlayerName(' ').isFailure()).toBe(true);
    expect(validatePlayerName('').isFailure()).toBe(true);

    const longName = 'A'.repeat(25);
    expect(validatePlayerName(longName).isFailure()).toBe(true);
  });

  it('rejects names with invalid symbols, HTML tags, or digits only', () => {
    expect(validatePlayerName('123456').isFailure()).toBe(true);
    expect(validatePlayerName('<script>alert(1)</script>').isFailure()).toBe(true);
    expect(validatePlayerName('Player$$$').isFailure()).toBe(true);
    expect(validatePlayerName('User@Host').isFailure()).toBe(true);
    expect(validatePlayerName('???!!!').isFailure()).toBe(true);
  });

  it('rejects offensive language and profanity in plain text and leetspeak', () => {
    const offensiveNames = [
      'fuckyou',
      'f u c k',
      'fux',
      'b!tch',
      'b1tch',
      'asshole',
      'dumbass',
      'bastard',
      'cunt',
      'nigger',
      'n1gga',
      'faggot',
      'whore',
      'slut',
      'hitler'
    ];

    offensiveNames.forEach(bad => {
      expect(containsOffensiveLanguage(bad)).toBe(true);
      const res = validatePlayerName(bad);
      expect(res.isFailure()).toBe(true);
      expect(res.match({ Ok: () => '', Err: e => e })).toContain('respectful');
    });
  });

  it('detects duplicate active player names in the same session', () => {
    const activeNames = ['Alice', 'Bob', 'Charlie'];

    const duplicateRes = validatePlayerName('alice', { activeSessionNames: activeNames });
    expect(duplicateRes.isFailure()).toBe(true);
    expect(duplicateRes.match({ Ok: () => '', Err: e => e })).toContain('already seated');

    const freshRes = validatePlayerName('David', { activeSessionNames: activeNames });
    expect(freshRes.isSuccess()).toBe(true);
  });

  it('normalizes leetspeak and tests condensed profanities correctly', () => {
    expect(normalizeForProfanityCheck('b!tch')).toBe('bitch');
    expect(normalizeForProfanityCheck('f@gg0t')).toBe('faggot');
  });

  it('safely sanitizes or falls back using sanitizePlayerNameOrDefault', () => {
    expect(sanitizePlayerNameOrDefault(some('ValidName'))).toBe('ValidName');
    expect(sanitizePlayerNameOrDefault(some(''))).toBe('Pilgrim');
    expect(sanitizePlayerNameOrDefault(some('bitch'))).toBe('Pilgrim');
    expect(sanitizePlayerNameOrDefault(none(), 'SanctuaryGuest')).toBe('SanctuaryGuest');
  });
});
