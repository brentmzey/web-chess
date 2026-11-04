import { fromNullable } from './fp';

/**
 * Chat is never blocked for language, only visually obfuscated: a detected word is swapped for a
 * short, silly emoji sequence so the message still reads naturally without displaying the word.
 */

export interface ProfanityCensorResult {
  readonly censoredText: string;
  readonly profanityDetected: boolean;
}

const PROFANITY_WORDS: ReadonlyArray<string> = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'piss', 'cunt',
  'douche', 'whore', 'slut', 'cock', 'pussy', 'fag', 'faggot', 'retard',
  'nigger', 'nigga', 'twat', 'wanker', 'motherfucker', 'bullshit', 'dumbass',
  'jackass', 'dipshit', 'horseshit', 'shithead', 'asswipe', 'cocksucker'
];

const SILLY_EMOJI_DISGUISES: ReadonlyArray<string> = [
  '🦆💥', '🐸✨', '🧇😵', '🍩🙈', '🦄💫', '🐙🙊', '🥔😳', '🦕🫣',
  '🐌🎉', '🧦🙃', '🍄😶', '🦔💨', '🐢🤪', '🥨😬', '🐝🫠', '🦦🎈'
];

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

const buildProfanityRegex = (): RegExp =>
  new RegExp(`\\b(?:${PROFANITY_WORDS.join('|')})[a-z]*\\b`, 'gi');

const pickDisguise = (index: number): string =>
  SILLY_EMOJI_DISGUISES[index % SILLY_EMOJI_DISGUISES.length];

interface CensorAccumulator {
  readonly censoredText: string;
  readonly cursor: number;
}

const applyMatch = (text: string,
                    acc: CensorAccumulator,
                    match: RegExpMatchArray,
                    disguiseIndex: number): CensorAccumulator => {
  const start = match.index ?? 0;
  const end = start + match[0].length;
  return {
    censoredText: acc.censoredText + text.slice(acc.cursor, start) + pickDisguise(disguiseIndex),
    cursor: end
  };
};

export const censorProfanity = (text: string): ProfanityCensorResult => {
  const matches = [...normalizeForMatching(text).matchAll(buildProfanityRegex())];

  const result = matches.reduce<CensorAccumulator>(
    (acc, match, index) => applyMatch(text, acc, match, index),
    { censoredText: '', cursor: 0 }
  );

  return {
    censoredText: result.censoredText + text.slice(result.cursor),
    profanityDetected: matches.length > 0
  };
};
