export interface GameRuleInfo {
  readonly id: string;
  readonly title: string;
  readonly realLifeName: string;
  readonly objective: string;
  readonly summary: string;
  readonly keyRules: readonly string[];
  readonly officialUrl: string;
  readonly urlLabel: string;
}

export const ARCADE_GAME_RULES: Readonly<Record<string, GameRuleInfo>> = Object.freeze({
  chess: {
    id: 'chess',
    title: "Wizard's Chess 3D",
    realLifeName: 'Classical Chess (FIDE)',
    objective: "Checkmate the opponent's King so it cannot escape capture.",
    summary: 'The timeless two-player strategy game played on an 8×8 checkered board.',
    keyRules: [
      'Each piece moves uniquely: Pawns advance forward, Knights jump in an L-shape, Bishops move diagonally, Rooks move orthogonally, Queens combine Rook and Bishop moves, and Kings move one square in any direction.',
      'Pawns promote to any chosen piece (Queen, Rook, Bishop, or Knight) upon reaching the 8th rank.',
      'Special moves include Castling (King and Rook move together for King safety) and En Passant.',
      'A player cannot make any move that leaves or places their own King in check.'
    ],
    officialUrl: 'https://en.wikipedia.org/wiki/Rules_of_chess',
    urlLabel: 'Official FIDE Rules of Chess (Wikipedia)'
  },
  blackjack: {
    id: 'blackjack',
    title: 'Gothic Blackjack',
    realLifeName: 'Blackjack (Twenty-One)',
    objective: "Build a hand whose card total is closer to 21 than the dealer's hand without exceeding 21.",
    summary: 'The classic casino banking game of probability, risk, and card counting.',
    keyRules: [
      'Number cards (2–10) are worth face value; face cards (J, Q, K) are worth 10; Aces are worth 1 or 11 (whichever makes the best hand without busting).',
      'Players are dealt 2 cards face-up; the Dealer receives 1 card face-up and 1 hole card face-down.',
      'Natural Blackjack (Ace + 10-value card on the first two cards) pays 3:2 payout immediately unless the Dealer also has Blackjack (push).',
      'Hit to draw another card; Stand to keep your current hand; Double Down to double your bet on the initial two cards and take exactly one final card.',
      'Dealer must draw cards until their total reaches at least 17, and must stand on 17 or higher.'
    ],
    officialUrl: 'https://en.wikipedia.org/wiki/Blackjack',
    urlLabel: 'Official Blackjack Rules & Basic Strategy (Wikipedia)'
  },
  poker: {
    id: 'poker',
    title: 'Cathedral Poker',
    realLifeName: "Poker (Texas Hold'em, Omaha, 7-Card Stud, 5-Card Draw)",
    objective: 'Win chips by assembling the highest-ranking 5-card poker hand or bluffing opponents into folding.',
    summary: 'The world-renowned family of card games combining psychology, probability, and betting rounds.',
    keyRules: [
      'Hand Ranking (Highest to Lowest): Royal Flush, Straight Flush, Four of a Kind, Full House, Flush, Straight, Three of a Kind, Two Pair, One Pair, High Card.',
      'In Texas Hold\'em: each player receives 2 private hole cards, and 5 shared community cards are dealt across 3 rounds (Flop [3 cards], Turn [1 card], River [1 card]).',
      'On each betting round, players may Check (pass action if no bet), Bet/Raise (wager chips), Call (match the current highest bet), or Fold (forfeit hand).',
      'In Omaha: players receive 4 hole cards and MUST use exactly 2 hole cards plus exactly 3 community cards.'
    ],
    officialUrl: 'https://en.wikipedia.org/wiki/Texas_hold_%27em',
    urlLabel: "Official Texas Hold'em & Poker Rules (Wikipedia)"
  },
  skipbo: {
    id: 'skipbo',
    title: 'Sacred Skip-Bo',
    realLifeName: 'Skip-Bo (Spite and Malice)',
    objective: 'Be the first player to play all cards from your personal 15-card Stockpile.',
    summary: 'A fast-paced sequential card sequencing game based on traditional Spite and Malice.',
    keyRules: [
      'Cards are numbered 1 through 12. Skip-Bo (★) cards are Wild and can represent any number.',
      'Up to 4 shared Building Piles are built in the center of the table in numerical sequence from 1 up to 12. Once a pile reaches 12, it is cleared.',
      'You can play cards to building piles from: the top of your Stockpile, your 5-card Hand, or the top of any of your 4 personal Discard Piles.',
      'You MUST conclude your turn by discarding one card from your hand face-up onto any of your 4 personal discard piles.'
    ],
    officialUrl: 'https://en.wikipedia.org/wiki/Skip-Bo',
    urlLabel: 'Official Skip-Bo Rules & Guidelines (Wikipedia)'
  },
  phase10: {
    id: 'phase10',
    title: 'Ten Rites (Phase 10)',
    realLifeName: 'Phase 10',
    objective: 'Be the first player to complete all 10 consecutive contract phases in order with the lowest penalty points.',
    summary: 'A rummy-type card game where players compete to complete specific melds across sequential rounds.',
    keyRules: [
      'The 10 phases must be completed in order: 1) 2 sets of 3, 2) 1 set of 3 + 1 run of 4, 3) 1 set of 4 + 1 run of 4, 4) 1 run of 7, 5) 1 run of 8, 6) 1 run of 9, 7) 2 sets of 4, 8) 7 cards of 1 color, 9) 1 set of 5 + 1 set of 2, 10) 1 set of 5 + 1 set of 3.',
      'Turn structure: Draw 1 card from deck or discard pile, optionally Lay Down your completed phase, optionally Hit remaining cards onto any laid phase, and Discard 1 card to end turn.',
      'Wild cards (★) substitute for any number or color; Skip cards (⊘) force an opponent to lose their turn.',
      'When one player empties their hand ("goes out"), the round ends. Players who completed their phase advance to the next; others retry the same phase. Unplayed cards score penalty points (5-25 pts).'
    ],
    officialUrl: 'https://en.wikipedia.org/wiki/Phase_10',
    urlLabel: 'Official Phase 10 Rules & Phase Chart (Wikipedia)'
  },
  uno: {
    id: 'uno',
    title: 'Cardinal Uno',
    realLifeName: 'UNO',
    objective: 'Be the first player to shed all cards from your hand by matching the top discard card.',
    summary: 'The beloved American card game created by Merle Robbins and published by Mattel.',
    keyRules: [
      'Play a card from your hand that matches the current top discard card by Color, Number, or Symbol.',
      'Action Cards: Skip (next player loses turn), Reverse (⇄ changes turn direction), Draw Two (+2 next player draws 2 and misses turn).',
      'Wild Cards: Wild (choose the active color) and Wild Draw Four (+4 next player draws 4 cards and loses turn).',
      'If you cannot or choose not to play a card, you must draw one card from the draw deck.',
      'CRITICAL: When you have only ONE card remaining in your hand, you must press "CALL UNO!" before playing your penultimate card, or risk drawing penalty cards.'
    ],
    officialUrl: 'https://en.wikipedia.org/wiki/Uno_(card_game)',
    urlLabel: 'Official Mattel UNO Card Game Rules (Wikipedia)'
  },
  avalon: {
    id: 'avalon',
    title: 'The Resistance: Avalon',
    realLifeName: 'The Resistance: Avalon',
    objective: 'Loyal Servants of Arthur aim to pass 3 quests; Minions of Mordred aim to fail 3 quests or assassinate Merlin.',
    summary: 'The acclaimed social deduction and hidden identity game designed by Don Eskridge.',
    keyRules: [
      'Secret roles are dealt at the start. Good (Loyal Servants, Merlin, Percival) do not know who is evil, except Merlin (who knows all evil except Mordred). Evil (Mordred, Morgana, Assassin, Minions) know each other.',
      'The Leader proposes a team of knights for the current quest. The entire table publicly votes to Approve or Reject the team.',
      'If 5 consecutive proposals are rejected, Evil wins automatically.',
      'If a proposed team is approved, selected team members secretly submit Success or Fail cards. Good players MUST submit Success; Evil players may submit Success or Fail.',
      'If Good successfully passes 3 quests, Evil gets one final opportunity: the Assassin may name who they believe is Merlin. If correct, Evil snatches victory!'
    ],
    officialUrl: 'https://en.wikipedia.org/wiki/The_Resistance_(game)',
    urlLabel: 'Official The Resistance: Avalon Game Rules (Wikipedia)'
  },
  set: {
    id: 'set',
    title: 'Sacred Geometry SET',
    realLifeName: 'SET: The Family Game of Visual Perception',
    objective: 'Spot and claim 3-card SETs from the 12 table cards as fast as possible.',
    summary: 'An award-winning mathematical card game of combinatorial geometry based on GF(3)⁴.',
    keyRules: [
      'Each card has 4 attributes with 3 variations each: Number (1, 2, or 3), Shape (Diamond, Oval, Squiggle), Shading (Solid, Striped, Open), and Color (Red, Green, Purple).',
      'A SET consists of exactly 3 cards in which each of the 4 individual attributes is EITHER all the same on all 3 cards OR all different on all 3 cards.',
      'In other words: for each attribute, you cannot have 2 cards sharing a trait while the 3rd differs.',
      'When you spot a SET, select all 3 cards and click "Claim SET". If valid, 3 new cards are dealt from the 81-card deck to replenish the table.'
    ],
    officialUrl: 'https://en.wikipedia.org/wiki/Set_(card_game)',
    urlLabel: 'Official SET Game Rules & Mathematical Theory (Wikipedia)'
  },
  solitaire: {
    id: 'solitaire',
    title: 'Cathedral Solitaire',
    realLifeName: 'Klondike Solitaire (Patience)',
    objective: 'Transfer all 52 cards onto the 4 Foundation piles in ascending sequence from Ace to King by suit.',
    summary: 'The timeless single-player card game of patience and tactical cascade arrangement with live multiplayer spectator tables.',
    keyRules: [
      'Build 7 Tableau columns in descending value (King down to 2) with strictly alternating colors (Red on Black, Black on Red).',
      'The 4 Foundations build upwards in suit from Ace to King (Ace -> 2 -> 3 ... King).',
      'Draw cards from the Stock pile into the Waste pile when you need more options. When the Stock is exhausted, recycle the Waste back into the Stock.',
      'Only Kings (or card stacks led by a King) may be placed into empty Tableau spaces.',
      'Controls: tap a card (or a face-up run) to select it, then tap where it should go. Tap a selected card again to send it to its Foundation. A Foundation\'s top card can come back down onto the Tableau (-15 pts).',
      'You win when all 52 cards are on the Foundations. Auto-Foundation moves every eligible card for you; Undo steps back one move.',
      'Live multiplayer spectator mode enables friends to watch the match in real time over SSE without interfering.'
    ],
    officialUrl: 'https://en.wikipedia.org/wiki/Klondike_(solitaire)',
    urlLabel: 'Official Klondike Solitaire Rules (Wikipedia)'
  }
});
