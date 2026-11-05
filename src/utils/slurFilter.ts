import { fromNullable } from './fp';

/**
 * Chat allows swearing through untouched. Only real slurs (the same hate-speech category already
 * curated in `playerValidation.ts`'s `PROFANITY_PATTERNS`, not its general profanity entries) get
 * swapped for a short, randomized, silly emoji cluster so the message still reads naturally.
 */

export interface SlurCensorResult {
  readonly censoredText: string;
  readonly slurDetected: boolean;
}

interface SlurEntry {
  readonly word: string;
  /** False only for words whose suffix-wildcard match would also clobber common unrelated words (e.g. "spic" inside "spice"). */
  readonly allowSuffix: boolean;
}

const SLUR_WORDS: ReadonlyArray<SlurEntry> = [
  { word: 'nigger', allowSuffix: true },
  { word: 'nigga', allowSuffix: true },
  { word: 'chink', allowSuffix: true },
  { word: 'gook', allowSuffix: true },
  { word: 'kike', allowSuffix: true },
  { word: 'wetback', allowSuffix: true },
  { word: 'faggot', allowSuffix: true },
  { word: 'fag', allowSuffix: true },
  { word: 'dyke', allowSuffix: true },
  { word: 'retard', allowSuffix: true },
  { word: 'spastic', allowSuffix: true },
  { word: 'spic', allowSuffix: false }
];

const BLUR_EMOJI_POOL: ReadonlyArray<string> = [
  '🦆', '🐸', '🧇', '🍩', '🦄', '🙈', '🙊', '🙉', '🥔', '🦕', '🐌', '🧦',
  '🍄', '🦔', '🐢', '🥨', '🐝', '🫠', '🎪', '🤡', '🪩', '🧁', '🦦', '🐙',
  '🫣', '🦩', '🐬', '🧃', '🪄', '🍉'
];

const MIN_BLUR_EMOJI_COUNT = 2;
const MAX_BLUR_EMOJI_COUNT = 4;

const LEETSPEAK_SUBSTITUTIONS: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '!': 'i',
  '3': 'e',
  '4': 'a',
  '@': 'a',
  '$': 's',
  '5': 's',
  '7': 't'
};

const normalizeForMatching = (text: string): string =>
  text
    .toLowerCase()
    .split('')
    .map(ch => fromNullable(LEETSPEAK_SUBSTITUTIONS[ch]).getOrElse(ch))
    .join('');

const buildSlurRegex = (): RegExp => {
  const alternatives = SLUR_WORDS.map(({ word, allowSuffix }) => `${word}${allowSuffix ? '[a-z]*' : ''}`);
  return new RegExp(`\\b(?:${alternatives.join('|')})\\b`, 'gi');
};

/** Picks a random, good-natured emoji cluster of random length so the same slur never blurs the same way twice. */
const randomBlurDisguise = (rng: () => number): string => {
  const count = MIN_BLUR_EMOJI_COUNT + Math.floor(rng() * (MAX_BLUR_EMOJI_COUNT - MIN_BLUR_EMOJI_COUNT + 1));
  return Array.from({ length: count }, () => fromNullable(BLUR_EMOJI_POOL[Math.floor(rng() * BLUR_EMOJI_POOL.length)]).getOrElse('🦆'))
    .join('');
};

interface SlurCensorAccumulator {
  readonly censoredText: string;
  readonly cursor: number;
}

const applySlurMatch = (text: string,
                        acc: SlurCensorAccumulator,
                        slurMatch: RegExpMatchArray,
                        rng: () => number): SlurCensorAccumulator => {
  const start = slurMatch.index ?? 0;
  const end = start + slurMatch[0].length;
  return {
    censoredText: acc.censoredText + text.slice(acc.cursor, start) + randomBlurDisguise(rng),
    cursor: end
  };
};

/**
 * Blurs every detected slur with a random emoji cluster. `rng` defaults to `Math.random` and is
 * injectable so callers (and tests) can get deterministic, reproducible disguises.
 */
export const censorSlurs = (text: string,
                            rng: () => number = Math.random): SlurCensorResult => {
  const matches = [...normalizeForMatching(text).matchAll(buildSlurRegex())];

  const result = matches.reduce<SlurCensorAccumulator>(
    (acc, slurMatch) => applySlurMatch(text, acc, slurMatch, rng),
    { censoredText: '', cursor: 0 }
  );

  return {
    censoredText: result.censoredText + text.slice(result.cursor),
    slurDetected: matches.length > 0
  };
};
