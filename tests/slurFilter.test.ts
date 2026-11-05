import { describe, expect, it } from 'bun:test';
import { censorSlurs } from '../src/utils/slurFilter';

describe('censorSlurs', () => {
  it('leaves swearing and clean text completely untouched', () => {
    expect(censorSlurs('this is such bullshit, you fucking cheated')).toEqual({
      censoredText: 'this is such bullshit, you fucking cheated',
      slurDetected: false
    });
    expect(censorSlurs('good move, well played!')).toEqual({
      censoredText: 'good move, well played!',
      slurDetected: false
    });
    expect(censorSlurs('')).toEqual({ censoredText: '', slurDetected: false });
  });

  it('blurs a detected slur with a deterministic emoji cluster when rng is injected', () => {
    const rng = () => 0;
    const result = censorSlurs('you are such a retard honestly', rng);
    expect(result.slurDetected).toBe(true);
    expect(result.censoredText.startsWith('you are such a ')).toBe(true);
    expect(result.censoredText.endsWith(' honestly')).toBe(true);
    expect(result.censoredText).not.toContain('retard');
    // rng() === 0 always picks the minimum count (2) of the first pool entry
    expect(result.censoredText).toBe('you are such a 🦆🦆 honestly');
  });

  it('never blurs swear words even when a slur appears in the same message', () => {
    const result = censorSlurs('fuck you, you absolute faggot', () => 0.5);
    expect(result.slurDetected).toBe(true);
    expect(result.censoredText).toContain('fuck you, you absolute ');
    expect(result.censoredText).not.toContain('faggot');
  });

  it('resolves common leetspeak obfuscation of a slur', () => {
    const result = censorSlurs('n1gg3r', () => 0);
    expect(result.slurDetected).toBe(true);
    expect(result.censoredText).not.toMatch(/n1gg3r/i);
  });

  it('matches a slur regardless of surrounding case', () => {
    const result = censorSlurs('RETARD', () => 0);
    expect(result.slurDetected).toBe(true);
    expect(result.censoredText).toBe('🦆🦆');
  });

  it('produces varied-length disguises across the injected rng range', () => {
    const high = censorSlurs('retard', () => 0.999);
    expect(high.slurDetected).toBe(true);
    expect([...high.censoredText].length).toBeGreaterThanOrEqual(2);
    expect([...high.censoredText].length).toBeLessThanOrEqual(4);
  });

  it('requires an exact word match for "spic" so it never clobbers unrelated words like "spice"', () => {
    expect(censorSlurs('pass the spice please', () => 0).slurDetected).toBe(false);
    expect(censorSlurs('spic', () => 0).slurDetected).toBe(true);
  });

  it('defaults to Math.random and always returns only emoji from the pool', () => {
    const result = censorSlurs('you nigger');
    expect(result.slurDetected).toBe(true);
    expect(result.censoredText.startsWith('you ')).toBe(true);
    expect([...result.censoredText.slice(4)].length).toBeGreaterThanOrEqual(2);
  });
});
