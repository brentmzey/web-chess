import { describe, expect, it } from 'bun:test';
import { censorProfanity } from '../src/utils/profanityFilter';

describe('censorProfanity', () => {
  it('leaves clean text completely unchanged', () => {
    const res = censorProfanity('Good game, well played! See you next round.');
    expect(res.profanityDetected).toBe(false);
    expect(res.censoredText).toBe('Good game, well played! See you next round.');
  });

  it('censors a single profane word with a silly emoji disguise, preserving surrounding text', () => {
    const res = censorProfanity('this is such bullshit honestly');
    expect(res.profanityDetected).toBe(true);
    expect(res.censoredText).not.toContain('bullshit');
    expect(res.censoredText.startsWith('this is such ')).toBe(true);
    expect(res.censoredText.endsWith(' honestly')).toBe(true);
  });

  it('censors multiple profane words in one message with varied disguises', () => {
    const res = censorProfanity('fuck this shit');
    expect(res.profanityDetected).toBe(true);
    expect(res.censoredText).not.toContain('fuck');
    expect(res.censoredText).not.toContain('shit');
    expect(res.censoredText).toContain(' this ');
  });

  it('matches case-insensitively and across common suffixes', () => {
    const upper = censorProfanity('What the FUCK was that move');
    expect(upper.profanityDetected).toBe(true);
    expect(upper.censoredText.toLowerCase()).not.toContain('fuck');

    const suffixed = censorProfanity('stop being such an asshat and an asshole');
    expect(suffixed.profanityDetected).toBe(true);
    expect(suffixed.censoredText).not.toContain('asshole');
  });

  it('catches simple leetspeak obfuscation while preserving the original surrounding characters', () => {
    const res = censorProfanity('you are a b1tch about this');
    expect(res.profanityDetected).toBe(true);
    expect(res.censoredText).not.toContain('b1tch');
    expect(res.censoredText.startsWith('you are a ')).toBe(true);
    expect(res.censoredText.endsWith(' about this')).toBe(true);
  });

  it('does not false-positive on benign words that merely contain a substring of a filtered word', () => {
    const res = censorProfanity('Pass the dishes, this class is a classic, grass needed cutting');
    expect(res.profanityDetected).toBe(false);
    expect(res.censoredText).toBe('Pass the dishes, this class is a classic, grass needed cutting');
  });

  it('handles an empty string without throwing', () => {
    const res = censorProfanity('');
    expect(res.profanityDetected).toBe(false);
    expect(res.censoredText).toBe('');
  });
});
