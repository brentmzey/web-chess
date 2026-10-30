import { Some, None, some, none, failure, tryCatch, type Result } from '../../utils/fp';
import type { TableSeat, TableSeatManager } from './tableSeatManager';

export const TABLE_SNAPSHOT_VERSION = 1;

/** Full, JSON-safe picture of one arcade table, broadcast as a `state_sync` action. */
export interface ArcadeTableSnapshot {
  readonly version: number;
  readonly state: unknown;
  readonly seats: unknown;
  readonly extras: unknown;
}

/** Any arcade engine whose whole table is described by `state` plus an optional seat manager. */
export interface SnapshotableEngine {
  state: unknown;
  readonly seatManager?: TableSeatManager<any>;
}

const OPTION_TAG = '__opt';
const MAP_TAG = '__map';

/**
 * Converts engine values into plain JSON, tagging `Option` and `Map` values so they can be revived.
 */
export const encodeSnapshotValue = (value: unknown): unknown => {
  if (value instanceof Some) return { [OPTION_TAG]: 1, v: encodeSnapshotValue(value.value) };
  if (value instanceof None) return { [OPTION_TAG]: 0 };
  if (value instanceof Map) return { [MAP_TAG]: Array.from(value.entries()).map(([k, v]) => [k, encodeSnapshotValue(v)]) };
  if (Array.isArray(value)) return value.map(encodeSnapshotValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeSnapshotValue(v)]));
  }
  return value;
};

/**
 * Reverses `encodeSnapshotValue`, rebuilding `Some`/`None` and `Map` instances.
 */
export const decodeSnapshotValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(decodeSnapshotValue);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  if (OPTION_TAG in record) return record[OPTION_TAG] === 1 ? some(decodeSnapshotValue(record.v)) : none();
  if (MAP_TAG in record && Array.isArray(record[MAP_TAG])) {
    return new Map((record[MAP_TAG] as [unknown, unknown][]).map(([k, v]) => [k, decodeSnapshotValue(v)]));
  }
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, decodeSnapshotValue(v)]));
};

export const exportTableSnapshot = (engine: SnapshotableEngine,
                                    extras: unknown = null): ArcadeTableSnapshot => ({
  version: TABLE_SNAPSHOT_VERSION,
  state: encodeSnapshotValue(engine.state),
  seats: encodeSnapshotValue(engine.seatManager?.exportSeats() ?? []),
  extras: encodeSnapshotValue(extras)
});

/**
 * Applies a received snapshot to an engine. Returns the decoded `extras` for engine-specific state.
 */
export const importTableSnapshot = (engine: SnapshotableEngine,
                                    raw: unknown): Result<unknown, string> => {
  const snapshot = raw as Partial<ArcadeTableSnapshot> | null;
  if (typeof snapshot !== 'object' || snapshot === null || snapshot.version !== TABLE_SNAPSHOT_VERSION) {
    return failure('Unsupported table snapshot.');
  }
  if (typeof snapshot.state !== 'object' || snapshot.state === null) {
    return failure('Table snapshot is missing game state.');
  }
  return tryCatch(() => {
    engine.state = decodeSnapshotValue(snapshot.state);
    const seats = decodeSnapshotValue(snapshot.seats);
    if (Array.isArray(seats) && engine.seatManager) {
      engine.seatManager.importSeats(seats as TableSeat<any>[]);
    }
    return decodeSnapshotValue(snapshot.extras);
  }, err => `Failed to apply table snapshot: ${String(err)}`);
};
