import type { Chess, Move } from 'chess.js';
import { OpponentDifficultyEnum, type OpponentDifficulty } from '../types';
import { fromNullable, match, none, tryCatchAsync, type Optional } from '../utils/fp';
import { computeMicroNeuralAIMove } from './neuralAI';

export interface GeminiNanoStatus {
  available: boolean;
  status: 'ready' | 'downloadable' | 'unsupported';
  message: string;
}

/**
 * Checks for the Chrome Built-in AI / W3C Prompt API (Gemini Nano)
 * using monadic composition (fromNullable, flatMap, tryCatchAsync).
 */
export async function checkGeminiNanoStatus(): Promise<GeminiNanoStatus> {
  const windowOpt = fromNullable(typeof window !== 'undefined' ? window : null);

  const factoryOpt = windowOpt
    .flatMap(win => fromNullable((win as any).ai))
    .flatMap(ai => fromNullable(ai.languageModel || ai.assistant));

  if (!factoryOpt.isSome()) {
    return {
      available: false,
      status: 'unsupported',
      message: 'Chrome Built-in AI (window.ai) not found. Requires Chrome Canary with Prompt API enabled.'
    };
  }

  const factory = factoryOpt.value;
  const capsResult = await tryCatchAsync(
    () => factory.capabilities(),
    err => (err as Error)?.message || 'Error querying languageModel capabilities.'
  );

  return capsResult.fold(
    errMsg => ({
      available: false,
      status: 'unsupported',
      message: errMsg
    }),
    (caps: any) => {
      const avail = String(caps?.available);
      const branches: Record<string, () => GeminiNanoStatus> = {
        readily: () => ({
          available: true,
          status: 'ready',
          message: 'Gemini Nano is loaded and ready on-device.'
        }),
        'after-download': () => ({
          available: true,
          status: 'downloadable',
          message: 'Gemini Nano model is downloading in Chrome.'
        })
      };
      const handler = branches[avail];
      return handler
        ? handler()
        : {
            available: false,
            status: 'unsupported',
            message: `Gemini Nano availability reported as: ${avail}`
          };
    }
  );
}

/**
 * Matches a raw LLM response string to one of the currently legal moves
 * using functional Option pipeline (fromNullable, map, flatMap, fold).
 */
export function matchResponseToLegalMove(rawResponse: string, legalMoves: Move[]): Move | null {
  return fromNullable(rawResponse)
    .filter(raw => raw.trim().length > 0 && legalMoves.length > 0)
    .map(raw => raw.replace(/[`*"'#]/g, '').trim())
    .flatMap<Move>((clean): Optional<Move> => {
      // 1. Exact SAN match
      const sanMatch = fromNullable(
        legalMoves.find(m => m.san.toLowerCase() === clean.toLowerCase())
      );
      if (sanMatch.isSome()) return sanMatch;

      // 2. Exact UCI match
      const uciMatch = fromNullable(
        legalMoves.find(
          m =>
            (m.from + m.to).toLowerCase() === clean.toLowerCase() ||
            (m.from + m.to + (m.promotion || '')).toLowerCase() === clean.toLowerCase()
        )
      );
      if (uciMatch.isSome()) return uciMatch;

      // 3. Scan words/tokens in output
      const tokens = clean.split(/[\s,;:.]+/);
      for (const token of tokens) {
        const tokenMatch = fromNullable(
          legalMoves.find(
            m =>
              m.san.toLowerCase() === token.toLowerCase() ||
              (m.from + m.to).toLowerCase() === token.toLowerCase()
          )
        );
        if (tokenMatch.isSome()) return tokenMatch;
      }

      return none<Move>();
    })
    .fold(
      () => null,
      move => move
    );
}

/**
 * Builds the persona system prompt for Gemini Nano based on selected difficulty/aggressiveness.
 */
export function buildGeminiNanoSystemPrompt(
  difficulty: OpponentDifficulty = OpponentDifficultyEnum.Balanced
): string {
  return match(difficulty as OpponentDifficultyEnum, {
    [OpponentDifficultyEnum.Cautious]: () =>
      'You are a cautious, defensive chess monk playing as Black. Prioritize king safety, solid pawn structure, and avoiding risky exchanges. Respond with ONLY the chosen legal move notation.',
    [OpponentDifficultyEnum.Balanced]: () =>
      'You are a balanced chess master playing as Black. Balance positional control of the center with sound tactical opportunities. Respond with ONLY the chosen legal move notation.',
    [OpponentDifficultyEnum.Aggressive]: () =>
      'You are a ruthless, hyper-aggressive chess grand inquisitor playing as Black. Prioritize relentless attacks, captures, checks, and aggressive invasion of White territory. Respond with ONLY the chosen legal move notation.'
  });
}

/**
 * Queries Chrome's on-device Gemini Nano model to pick the best move for Black
 * using functional Result and Option monads for fallback safety.
 */
export async function computeGeminiNanoAIMove(
  game: Chess,
  onStatusUpdate?: (statusText: string) => void,
  difficulty: OpponentDifficulty = OpponentDifficultyEnum.Balanced
): Promise<{ move: Move | null; source: 'nano' | 'fallback' }> {
  const legalMoves = game.moves({ verbose: true });
  if (legalMoves.length === 0) {
    return { move: null, source: 'nano' };
  }

  const status = await checkGeminiNanoStatus();
  if (!status.available) {
    onStatusUpdate?.('Gemini Nano not available in this browser. Falling back to Micro-Neural AI.');
    const fallbackMove = computeMicroNeuralAIMove(game, difficulty);
    return { move: fallbackMove, source: 'fallback' };
  }

  const promptExecutionResult = await tryCatchAsync(
    async () => {
      const ai = (window as any).ai;
      const modelFactory = ai.languageModel || ai.assistant;

      const session = await modelFactory.create({
        systemPrompt: buildGeminiNanoSystemPrompt(difficulty)
      });

      const sanList = legalMoves.map(m => m.san).join(', ');
      const historySlice = game.history().slice(-6).join(' ') || 'Opening move';
      const styleDirective = match(difficulty as OpponentDifficultyEnum, {
        [OpponentDifficultyEnum.Cautious]: () => 'Play cautiously and defensively.',
        [OpponentDifficultyEnum.Balanced]: () => 'Play a balanced, principled move.',
        [OpponentDifficultyEnum.Aggressive]: () => 'Play the most aggressive, attacking move (preferring captures and checks).'
      });

      const prompt = `Game: Chess. You are playing Black. Style: ${styleDirective}
FEN: ${game.fen()}
Recent moves: ${historySlice}
Legal moves: [${sanList}]

Select the single best move for Black from the legal moves list.
Respond ONLY with the exact move string from the list.`;

      const rawResponse = await session.prompt(prompt);
      if (session.destroy) {
        try {
          session.destroy();
        } catch {
          /* ignore */
        }
      }
      return rawResponse;
    },
    err => (err as Error)?.message || 'Prompt execution failure'
  );

  return promptExecutionResult.fold(
    errMsg => {
      onStatusUpdate?.(`Gemini Nano error (${errMsg}), falling back to Micro-Neural AI.`);
      return { move: computeMicroNeuralAIMove(game, difficulty), source: 'fallback' };
    },
    rawResponse => {
      return fromNullable(matchResponseToLegalMove(rawResponse, legalMoves)).fold<{
        move: Move | null;
        source: 'nano' | 'fallback';
      }>(
        () => {
          onStatusUpdate?.(
            `Gemini Nano suggested "${rawResponse.trim()}", falling back to Micro-Neural AI.`
          );
          return { move: computeMicroNeuralAIMove(game, difficulty), source: 'fallback' };
        },
        matchedMove => {
          onStatusUpdate?.(`Gemini Nano (${difficulty}) selected: ${matchedMove.san}`);
          return { move: matchedMove, source: 'nano' };
        }
      );
    }
  );
}
