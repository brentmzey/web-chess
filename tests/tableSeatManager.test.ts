import { describe, expect, it } from 'bun:test';
import { TableSeatManager } from '../src/games/multiplayer/tableSeatManager';

describe('TableSeatManager - Dynamic Multi-Seat Allocation & Bot Hot-Swapping', () => {
  it('initializes empty table seats with configured capacities', () => {
    const manager = new TableSeatManager(5, 2, 'micro-neural');
    expect(manager.getMaxSeats()).toBe(5);
    expect(manager.getMinSeats()).toBe(2);
    expect(manager.getAllSeats().length).toBe(5);
    expect(manager.getTotalOccupants()).toBe(0);
    expect(manager.getHumanCount()).toBe(0);
    expect(manager.getBotCount()).toBe(0);
  });

  it('fills empty seats with AI bots until human players join', () => {
    const manager = new TableSeatManager(5, 2, 'micro-neural');
    const filled = manager.fillEmptySeatsWithBots('minimax', 'Templar Bot');
    expect(filled).toBe(5);
    expect(manager.getTotalOccupants()).toBe(5);
    expect(manager.getBotCount()).toBe(5);
    expect(manager.getHumanCount()).toBe(0);

    const seat1 = manager.getSeat(1);
    expect(seat1.isSome()).toBe(true);
    seat1.map(s => {
      expect(s.isBot).toBe(true);
      expect(s.isOccupied).toBe(true);
      expect(s.playerName).toBe('Templar Bot #1');
      expect(s.botModel.getOrElse('')).toBe('minimax');
    });

    // Calling fill again when already full does not add more
    expect(manager.fillEmptySeatsWithBots()).toBe(0);
  });

  it('hot-swaps a bot seat out when a human player claims the seat', () => {
    const manager = new TableSeatManager(5, 2, 'micro-neural');
    manager.fillEmptySeatsWithBots('micro-neural', 'Abbot Bot');

    // Human player joins Seat 2
    const claimRes = manager.claimSeat(2, 'usr_human_1', 'Soror Elena');
    expect(claimRes.isSuccess()).toBe(true);

    expect(manager.getHumanCount()).toBe(1);
    expect(manager.getBotCount()).toBe(4);

    const seat2 = manager.getSeat(2).getOrThrow('Seat 2 should exist');
    expect(seat2.isBot).toBe(false);
    expect(seat2.playerId).toBe('usr_human_1');
    expect(seat2.playerName).toBe('Soror Elena');
    expect(seat2.botModel.isNone()).toBe(true);

    // Event history includes hot swap record
    const history = manager.getHistory();
    const hotSwapEv = history.find(h => h.seatNumber === 2 && h.action === 'human_claimed');
    expect(hotSwapEv).toBeDefined();
    expect(hotSwapEv?.previousPlayerName).toBe('Abbot Bot #2');
    expect(hotSwapEv?.newPlayerName).toBe('Soror Elena');
  });

  it('rejects claiming a seat if occupied by another human player', () => {
    const manager = new TableSeatManager(5, 2, 'micro-neural');
    manager.claimSeat(1, 'usr_human_1', 'Frater Marcus');

    const duplicateClaim = manager.claimSeat(1, 'usr_human_2', 'Frater Thomas');
    expect(duplicateClaim.isFailure()).toBe(true);
    if (duplicateClaim.isFailure()) {
      expect(duplicateClaim.error).toContain('already occupied by human player');
    }

    // Re-claiming the same seat by the same human player is idempotent and succeeds
    const sameClaim = manager.claimSeat(1, 'usr_human_1', 'Frater Marcus');
    expect(sameClaim.isSuccess()).toBe(true);
  });

  it('hot-swaps a vacant seat back to an AI bot when a human player leaves', () => {
    const manager = new TableSeatManager(5, 2, 'micro-neural');
    manager.claimSeat(3, 'usr_human_1', 'Soror Elena');
    expect(manager.getHumanCount()).toBe(1);

    // Human player leaves
    const vacateRes = manager.vacateSeat(3, 'gemini-nano', 'Guardian Bot');
    expect(vacateRes.isSuccess()).toBe(true);

    expect(manager.getHumanCount()).toBe(0);
    expect(manager.getBotCount()).toBe(1);

    const seat3 = manager.getSeat(3).getOrThrow('Seat 3 should exist');
    expect(seat3.isBot).toBe(true);
    expect(seat3.playerName).toBe('Guardian Bot #3');
    expect(seat3.botModel.getOrElse('')).toBe('gemini-nano');

    // Event history recorded vacate hot-swap
    const history = manager.getHistory();
    const vacateEv = history.find(h => h.seatNumber === 3 && h.action === 'human_vacated_bot_restored');
    expect(vacateEv).toBeDefined();
    expect(vacateEv?.previousPlayerName).toBe('Soror Elena');
  });

  it('claims any available seat dynamically up to maximum capacity', () => {
    const manager = new TableSeatManager(3, 2, 'micro-neural');
    manager.fillEmptySeatsWithBots();

    // 3 humans claim seats
    const claim1 = manager.claimAnyAvailableSeat('h1', 'Player One');
    const claim2 = manager.claimAnyAvailableSeat('h2', 'Player Two');
    const claim3 = manager.claimAnyAvailableSeat('h3', 'Player Three');

    expect(claim1.isSuccess()).toBe(true);
    expect(claim2.isSuccess()).toBe(true);
    expect(claim3.isSuccess()).toBe(true);
    expect(manager.getHumanCount()).toBe(3);

    // 4th human tries to join a 3-seat table -> table full error
    const claim4 = manager.claimAnyAvailableSeat('h4', 'Player Four');
    expect(claim4.isFailure()).toBe(true);
    if (claim4.isFailure()) {
      expect(claim4.error).toContain('completely full with 3 human players');
    }
  });

  it('handles edge cases: invalid seat bounds and updates custom seat data', () => {
    const manager = new TableSeatManager<number>(5);
    expect(manager.claimSeat(0, 'x', 'x').isFailure()).toBe(true);
    expect(manager.claimSeat(6, 'x', 'x').isFailure()).toBe(true);
    expect(manager.vacateSeat(0).isFailure()).toBe(true);
    expect(manager.vacateSeat(99).isFailure()).toBe(true);

    // Vacating an unallocated seat fails safely
    expect(manager.vacateSeat(1).isFailure()).toBe(true);

    // updateSeatData
    const manager2 = new TableSeatManager<{ score: number }>(5);
    const updateRes = manager2.updateSeatData(1, prev => ({ score: (prev?.score ?? 0) + 100 }));
    expect(updateRes.isSuccess()).toBe(true);
    expect(manager2.getSeat(1).getOrThrow().extraData.score).toBe(100);

    // Non-existent seat data update returns Err
    expect(manager2.updateSeatData(999, p => p).isFailure()).toBe(true);
  });
});
