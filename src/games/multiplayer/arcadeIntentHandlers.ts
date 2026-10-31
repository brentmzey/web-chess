import { failure, fromNullable, success, type Option, type Result } from '../../utils/fp';
import { PokerActionEnum, SkipBoSourcePileEnum } from '../../constants/gameEnums';
import type { SeatOwners } from './liveSeats';
import type { BlackjackMultiSeatEngine } from '../blackjack/blackjackMultiSeatEngine';
import type { CathedralPokerEngine } from '../poker/pokerEngine';
import type { SkipBoEngine } from '../skipbo/skipboEngine';
import type { Phase10Engine } from '../phase10/phase10Engine';
import type { CardinalUnoEngine } from '../uno/unoEngine';
import type { AvalonEngine } from '../avalon/avalonEngine';
import type { SetEngine } from '../set/setEngine';
import {
  parseArcadeIntent,
  type ArcadeIntent,
  type ArcadeIntentPayload,
  type ArcadeIntentType
} from '../../validation/arcadeIntents';

/**
 * The live engines a table host runs, read through getters because the page replaces engines when a
 * new match starts. The hooks are host-side follow-ups some moves need (a fresh betting round, bot quest cards).
 */
export interface ArcadeIntentEngines {
  readonly uno: () => CardinalUnoEngine;
  readonly skipbo: () => SkipBoEngine;
  readonly phase10: () => Phase10Engine;
  readonly poker: () => CathedralPokerEngine;
  readonly blackjack: () => BlackjackMultiSeatEngine;
  readonly avalon: () => AvalonEngine;
  readonly set: () => SetEngine;
  readonly ensureBjkBettingStage: () => void;
  readonly castAvalonBotQuestCards: () => void;
}

export type ArcadeIntentHandlers = {
  readonly [T in ArcadeIntentType]: (payload: ArcadeIntentPayload<T>, seatKey: string) => boolean
};

const playerTurnIs = (players: readonly { readonly id: string }[],
                      turnIndex: number,
                      seatKey: string): boolean =>
  fromNullable(players[turnIndex]).map(player => player.id === seatKey).getOrElse(false);

const seatTurnIs = (activeSeat: Option<number>,
                    seatKey: string): boolean =>
  activeSeat.map(seatNumber => String(seatNumber) === seatKey).getOrElse(false);

/** Host only: each guest move, applied to the sender's own seat and only on their turn. */
export const createArcadeIntentHandlers = (e: ArcadeIntentEngines): ArcadeIntentHandlers => ({
  uno_play: (p, seat) => playerTurnIs(e.uno().state.players, e.uno().state.currentTurnIndex, seat) &&
    e.uno().playCard(p.handIndex, p.wildColor).isSuccess(),
  uno_draw: (_p, seat) => playerTurnIs(e.uno().state.players, e.uno().state.currentTurnIndex, seat) &&
    e.uno().drawCard().isSuccess(),
  uno_call: (_p, seat) => e.uno().callUno(seat).isSuccess(),
  skipbo_play: (p, seat) => playerTurnIs(e.skipbo().state.players, e.skipbo().state.currentTurnIndex, seat) &&
    e.skipbo().playToBuilding(p.source as SkipBoSourcePileEnum, p.sourceIndex, p.buildingIndex).isSuccess(),
  skipbo_discard: (p, seat) => playerTurnIs(e.skipbo().state.players, e.skipbo().state.currentTurnIndex, seat) &&
    e.skipbo().discardAndEndTurn(p.handIndex, p.targetIndex).isSuccess(),
  p10_draw: (p, seat) => playerTurnIs(e.phase10().state.players, e.phase10().state.currentTurnIndex, seat) &&
    e.phase10().drawCard(p.fromDiscard).isSuccess(),
  p10_lay: (p, seat) => playerTurnIs(e.phase10().state.players, e.phase10().state.currentTurnIndex, seat) &&
    e.phase10().layDownPhase(p.g1, p.g2).isSuccess(),
  p10_hit: (p, seat) => playerTurnIs(e.phase10().state.players, e.phase10().state.currentTurnIndex, seat) &&
    e.phase10().hitCard(p.cardIndex, p.targetPlayerId, p.groupIndex).isSuccess(),
  p10_discard: (p, seat) => playerTurnIs(e.phase10().state.players, e.phase10().state.currentTurnIndex, seat) &&
    e.phase10().discardAndEndTurn(p.cardIndex).isSuccess(),
  poker_action: (p, seat) => seatTurnIs(e.poker().state.activeSeatTurn, seat) &&
    e.poker().playerAction(Number(seat), p.action as PokerActionEnum, p.amount).isSuccess(),
  poker_draw: (p, seat) => e.poker().drawCardsFiveCardDraw(Number(seat), p.discardIndices).isSuccess(),
  bjk_bet: (p, seat) => {
    e.ensureBjkBettingStage();
    return e.blackjack().placeBet(Number(seat), p.amount).isSuccess();
  },
  bjk_hit: (_p, seat) => seatTurnIs(e.blackjack().state.activeSeatTurn, seat) && e.blackjack().playerHit(Number(seat)).isSuccess(),
  bjk_stand: (_p, seat) => seatTurnIs(e.blackjack().state.activeSeatTurn, seat) && e.blackjack().playerStand(Number(seat)).isSuccess(),
  bjk_double: (_p, seat) => seatTurnIs(e.blackjack().state.activeSeatTurn, seat) && e.blackjack().playerDoubleDown(Number(seat)).isSuccess(),
  avalon_propose: (p, seat) => e.avalon().getCurrentLeader().id === seat && e.avalon().proposeTeam(p.team).isSuccess(),
  avalon_vote: (p, seat) => e.avalon().castVote(seat, p.approve).isSuccess(),
  avalon_assassinate: (p, seat) =>
    fromNullable(e.avalon().state.players.find(player => player.id === seat)).map(player => player.role === 'Assassin').getOrElse(false) &&
    e.avalon().assassinateMerlin(p.targetId).isSuccess(),
  avalon_quest: (p, seat) => {
    const cast = e.avalon().castQuestCard(seat, p.pass).isSuccess();
    e.castAvalonBotQuestCards();
    return cast;
  },
  set_claim: (p, seat) => {
    // Cards are named by id, so a claim made against a slightly older table still finds the right cards
    const indices = p.cardIds.map(id => e.set().state.tableCards.findIndex(card => card.id === id));
    return indices.every(i => i >= 0) &&
      e.set().claimSet(seat, [indices[0]!, indices[1]!, indices[2]!]).isSuccess();
  }
});

/**
 * Host only: validates a guest's action and runs it on the seat that guest owns. Ok(true) means the
 * table changed; Ok(false) means a well-formed move the engine refused (wrong turn, illegal play).
 */
export const applyArcadeIntent = (handlers: ArcadeIntentHandlers,
                                  owners: SeatOwners,
                                  senderId: string,
                                  actionType: string,
                                  payload: unknown): Result<boolean, string> =>
  parseArcadeIntent(actionType, payload).flatMap((intent: ArcadeIntent) =>
    fromNullable(Object.entries(owners).find(([, owner]) => owner === senderId))
      .map(([seatKey]) => (handlers[intent.type] as (p: unknown, seat: string) => boolean)(intent.payload, seatKey))
      .match({
        Some: changed => success<boolean, string>(changed),
        None: () => failure<boolean, string>(`Ignored ${actionType} from a participant without a seat.`)
      }));
