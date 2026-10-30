import { fromNullable, none, some, type Option } from '../../utils/fp';

/** Seat key (engine player id or seat number) → realtime participant id of the human who owns it. */
export type SeatOwners = Readonly<Record<string, string>>;

/** The minimal view of a seat that live seat assignment needs. */
export interface LiveSeatView {
  readonly key: string;
  readonly isBot: boolean;
}

/**
 * Finds the seat this participant owns at a live table.
 */
export const ownedSeatKey = (owners: SeatOwners,
                             participantId: string): Option<string> =>
  fromNullable(Object.entries(owners).find(([, owner]) => owner === participantId)).map(([key]) => key);

/**
 * The seat the local player acts for: the default seat against AI, the owned seat at a live table.
 */
export const resolveLocalSeatKey = (isLive: boolean,
                                    owners: SeatOwners,
                                    participantId: string,
                                    defaultKey: string): Option<string> =>
  isLive ? ownedSeatKey(owners, participantId) : some(defaultKey);

/**
 * Picks a seat for a participant who has none yet: the host prefers the first seat, everyone else
 * takes the first seat still played by a bot and not owned by another human.
 */
export const pickOpenSeat = (seats: readonly LiveSeatView[],
                             owners: SeatOwners,
                             isHost: boolean): Option<string> => {
  const unowned = seats.filter(seat => owners[seat.key] === undefined);
  const preferred = isHost ? unowned.slice(0, 1) : [];
  return fromNullable([...preferred, ...unowned.filter(seat => seat.isBot)][0]).map(seat => seat.key);
};

/**
 * Returns the owners map with this participant seated, or None when they already have a seat or
 * the table is full of humans.
 */
export const claimLiveSeat = (seats: readonly LiveSeatView[],
                              owners: SeatOwners,
                              participantId: string,
                              isHost: boolean): Option<{ readonly key: string; readonly owners: SeatOwners }> =>
  ownedSeatKey(owners, participantId).match({
    Some: () => none(),
    None: () => pickOpenSeat(seats, owners, isHost).map(key => ({ key, owners: { ...owners, [key]: participantId } }))
  });

/**
 * Removes a participant's seat ownership (they left or were removed).
 */
export const releaseLiveSeat = (owners: SeatOwners,
                                participantId: string): SeatOwners =>
  Object.fromEntries(Object.entries(owners).filter(([, owner]) => owner !== participantId));

/**
 * Bots must be driven by exactly one browser per table: always against AI, only the host when live.
 */
export const shouldDriveBots = (isLive: boolean,
                                isHost: boolean): boolean => !isLive || isHost;

/**
 * Whether the seat whose turn it is belongs to the local player.
 */
export const isLocalTurn = (localSeatKey: Option<string>,
                            currentSeatKey: string): boolean =>
  localSeatKey.map(key => key === currentSeatKey).getOrElse(false);

/**
 * Reads a seat owners map from untrusted snapshot data, keeping only string entries.
 */
export const parseSeatOwners = (raw: unknown): SeatOwners =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw).filter(([, owner]) => typeof owner === 'string')) as SeatOwners
    : {};
