import type { ArcadeTableSnapshot } from './tableSnapshot';

/**
 * Hidden-information policies for live arcade tables.
 *
 * The host's browser keeps the full table. Everyone else receives a redacted public snapshot in which
 * hidden values are replaced by same-sized placeholders (so opponents' card counts still render), plus
 * a private record holding only their own seat's secrets, readable by them alone.
 */

/** One seat's secrets, e.g. `{ hand: [...] }` or `{ role, alignment }`. */
export type SeatSecrets = Readonly<Record<string, unknown>>;

export interface HiddenInfoPolicy {
  /** The public view: every secret replaced by a placeholder. */
  readonly redact: (snapshot: ArcadeTableSnapshot) => ArcadeTableSnapshot;
  /** The secrets that belong to one seat. */
  readonly secretsFor: (snapshot: ArcadeTableSnapshot, seatKey: string) => SeatSecrets;
  /** A redacted snapshot with one seat's secrets put back (the viewer's own perspective). */
  readonly reveal: (snapshot: ArcadeTableSnapshot, seatKey: string, secrets: SeatSecrets) => ArcadeTableSnapshot;
}

type Json = Record<string, any>;

/** Placeholder for a hidden card: renders as a face-down card and carries no value. */
export const HIDDEN_CARD: Readonly<Json> = Object.freeze({ hidden: true, faceUp: false });
export const HIDDEN_TEXT = 'hidden';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const placeholderFor = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(() => ({ ...HIDDEN_CARD })) : typeof value === 'string' ? HIDDEN_TEXT : null;

/** Hides every element of an array except the last `keep` (e.g. a Skip-Bo stockpile's visible top card). */
const hideAllButLast = (cards: unknown, keep: number): unknown =>
  Array.isArray(cards) ? cards.map((card, i) => (i >= cards.length - keep ? card : { ...HIDDEN_CARD })) : cards;

const statePlayers = (snapshot: ArcadeTableSnapshot): Json[] =>
  Array.isArray((snapshot.state as Json)?.players) ? (snapshot.state as Json).players : [];

const seatList = (snapshot: ArcadeTableSnapshot): Json[] => (Array.isArray(snapshot.seats) ? (snapshot.seats as Json[]) : []);

/** Engines that mirror player state into seat `extraData` keep the same secrets in both places. */
const seatDataFor = (snapshot: ArcadeTableSnapshot, playerId: string): Json[] =>
  seatList(snapshot)
    .filter(seat => seat.playerId === playerId || seat.extraData?.id === playerId)
    .map(seat => seat.extraData)
    .filter((data): data is Json => typeof data === 'object' && data !== null);

export interface PlayerListPolicyOptions {
  /** Per-player fields only their owner may see (e.g. `hand`, `role`). */
  readonly privateFields: readonly string[];
  /** Top-level state arrays nobody may see (e.g. `drawPile`). */
  readonly hiddenStateArrays?: readonly string[];
  /** Per-player arrays where only the last N entries are public (e.g. Skip-Bo stockpile tops). */
  readonly partiallyHidden?: Readonly<Record<string, number>>;
  /** When true for the full state, nothing is hidden (e.g. a finished Avalon game reveals all roles). */
  readonly revealAllWhen?: (state: Json) => boolean;
  /** Extra state scrubbing (e.g. Avalon votes while voting is open). */
  readonly redactState?: (state: Json) => void;
}

/**
 * Policy for engines that model the table as `state.players[]`, with seats keyed by player id.
 */
export const playerListPolicy = (options: PlayerListPolicyOptions): HiddenInfoPolicy => ({
  redact: snapshot => {
    if (options.revealAllWhen?.(snapshot.state as Json)) return snapshot;
    const next = clone(snapshot);
    const state = next.state as Json;
    statePlayers(next).forEach(player => {
      [player, ...seatDataFor(next, player.id)].forEach(target => {
        options.privateFields.forEach(field => {
          if (field in target) target[field] = placeholderFor(target[field]);
        });
        Object.entries(options.partiallyHidden ?? {}).forEach(([field, keep]) => {
          if (field in target) target[field] = hideAllButLast(target[field], keep);
        });
      });
    });
    (options.hiddenStateArrays ?? []).forEach(field => {
      if (Array.isArray(state[field])) state[field] = placeholderFor(state[field]);
    });
    options.redactState?.(state);
    return next;
  },
  secretsFor: (snapshot, seatKey) => {
    const player = statePlayers(snapshot).find(p => p.id === seatKey);
    return player ? Object.fromEntries(options.privateFields.map(field => [field, clone(player[field])])) : {};
  },
  reveal: (snapshot, seatKey, secrets) => {
    const next = clone(snapshot);
    statePlayers(next)
      .filter(player => player.id === seatKey)
      .forEach(player => {
        [player, ...seatDataFor(next, player.id)].forEach(target => {
          options.privateFields.forEach(field => {
            // Without secrets yet, an own hand shows empty rather than as unreadable placeholders
            target[field] = field in secrets ? clone(secrets[field]) : Array.isArray(target[field]) ? [] : target[field];
          });
        });
      });
    return next;
  }
});

const seatNumberOf = (seat: Json): string => String(seat.seatNumber);

export interface SeatPolicyOptions {
  /** Fields of a seat's `extraData` only its owner may see (e.g. Poker `holeCards`). */
  readonly privateSeatFields: readonly string[];
  /** Dotted paths of state arrays nobody may see (e.g. `multi.shoe`). */
  readonly hiddenStatePaths?: readonly string[];
  /** Dotted paths of card arrays whose face-down cards must stay hidden (e.g. a dealer hole card). */
  readonly faceDownPaths?: readonly string[];
  /** Hide the snapshot `extras` entirely (e.g. the Poker shoe). */
  readonly hideExtras?: boolean;
  readonly revealAllWhen?: (state: Json) => boolean;
}

const atPath = (root: Json, path: string): { readonly parent: Json | undefined; readonly key: string } => {
  const parts = path.split('.');
  const key = parts.pop()!;
  const parent = parts.reduce<Json | undefined>((node, part) => (node && typeof node === 'object' ? node[part] : undefined), root);
  return { parent, key };
};

/**
 * Policy for engines whose seats are numbered (`TableSeatManager` seats), with secrets in `extraData`.
 */
export const seatPolicy = (options: SeatPolicyOptions): HiddenInfoPolicy => ({
  redact: snapshot => {
    if (options.revealAllWhen?.(snapshot.state as Json)) return snapshot;
    const next = clone(snapshot) as ArcadeTableSnapshot & { extras: unknown };
    seatList(next).forEach(seat => {
      options.privateSeatFields.forEach(field => {
        if (seat.extraData && field in seat.extraData) seat.extraData[field] = placeholderFor(seat.extraData[field]);
      });
    });
    (options.hiddenStatePaths ?? []).forEach(path => {
      const { parent, key } = atPath(next.state as Json, path);
      if (parent && Array.isArray(parent[key])) parent[key] = placeholderFor(parent[key]);
    });
    (options.faceDownPaths ?? []).forEach(path => {
      const { parent, key } = atPath(next.state as Json, path);
      if (parent && Array.isArray(parent[key])) {
        parent[key] = parent[key].map((card: Json) => (card && card.faceUp === false ? { ...HIDDEN_CARD } : card));
      }
    });
    if (options.hideExtras) {
      const extras = next.extras as Json | null;
      if (extras && 'game' in extras) extras.game = null;
    }
    return next;
  },
  secretsFor: (snapshot, seatKey) => {
    const seat = seatList(snapshot).find(s => seatNumberOf(s) === seatKey);
    return seat?.extraData
      ? Object.fromEntries(options.privateSeatFields.map(field => [field, clone(seat.extraData[field])]))
      : {};
  },
  reveal: (snapshot, seatKey, secrets) => {
    const next = clone(snapshot);
    seatList(next)
      .filter(seat => seatNumberOf(seat) === seatKey && seat.extraData)
      .forEach(seat => {
        options.privateSeatFields.forEach(field => {
          seat.extraData[field] = field in secrets ? clone(secrets[field]) : Array.isArray(seat.extraData[field]) ? [] : seat.extraData[field];
        });
      });
    return next;
  }
});

const pokerShowdown = (state: Json): boolean => state.stage === 'showdown' || state.stage === 'settled';

/** Hidden-information policy per arcade game; games without one (Solitaire) publish full state. */
export const HIDDEN_INFO_POLICIES: Readonly<Record<string, HiddenInfoPolicy>> = {
  uno: playerListPolicy({ privateFields: ['hand'], hiddenStateArrays: ['drawPile'] }),
  skipbo: playerListPolicy({
    privateFields: ['hand'],
    hiddenStateArrays: ['drawPile', 'recyclePile'],
    partiallyHidden: { stockpile: 1 }
  }),
  phase10: playerListPolicy({ privateFields: ['hand'], hiddenStateArrays: ['drawPile'] }),
  avalon: playerListPolicy({
    privateFields: ['role', 'alignment'],
    revealAllWhen: state => state.stage === 'settled',
    // Individual votes stay secret until every knight has voted
    redactState: state => {
      if (state.stage !== 'voting' || !Array.isArray(state.quests)) return;
      const quest = state.quests[state.currentQuestIndex];
      if (quest?.votes) quest.votes = Object.fromEntries(Object.keys(quest.votes).map(id => [id, null]));
    }
  }),
  set: playerListPolicy({ privateFields: [], hiddenStateArrays: ['deck'] }),
  poker: seatPolicy({ privateSeatFields: ['holeCards'], hideExtras: true, revealAllWhen: pokerShowdown }),
  blackjack: seatPolicy({
    privateSeatFields: [],
    hiddenStatePaths: ['single.shoe', 'multi.shoe'],
    faceDownPaths: ['single.dealerHand', 'multi.dealerHand']
  })
};
