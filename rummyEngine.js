/**
 * Party Blaster - Rummy Game Engine
 * 20-Player Custom Indian/Marriage Rummy Variant
 *
 * Updated Rules Implemented:
 * 1. Pick & Discard Turn Loop:
 *    - If the Joker is HIDDEN, taking from the discard pile IS permitted (even if it's a Joker, since its status is unknown to the table).
 *    - If the Joker is OPEN/revealed, picking an open Joker from the discard pile is blocked.
 * 2. Drop Option:
 *    - Available on turn before drawing.
 *    - First Drop (0-1 turns taken): 20 pts.
 *    - Middle Drop (2+ turns taken): 40 pts.
 * 3. Identical Triplets (Sikkan / Sikkans):
 *    - Three identical cards of the same suit and rank from separate packs (e.g., 3x 5♣ or 3x A♠).
 *    - Count as a valid Pure Sequence without Jokers.
 * 4. Hidden Joker Reveal Inspection & Timers:
 *    - When a player unlocks the cut-joker by presenting a valid Pure Sequence (or Sikkan):
 *      a) A popup displaying the cut-joker is shown to EVERYONE for 5 seconds (with an option to close).
 *      b) The unlocking player is granted 15 seconds to view/inspect the Joker before resuming their turn play (with an option to close).
 * 5. Universal Fullscreen & Responsive UI.
 * 6. Minimum 52 cards reserved in stock pile (3-6 decks auto-scaling).
 * 7. Invalid declaration soft-popup with options to fix or discard.
 * 8. Pure + Secondary sequence together >= 7 cards. 80 pts default penalty without pure sequence.
 */

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createDecks(deckCount = 4, jokersPerDeck = 2) {
  const cards = [];
  for (let pack = 0; pack < deckCount; pack++) {
    for (const suit of SUITS) {
      RANKS.forEach((rank, idx) => {
        cards.push({
          id: `${pack}_${rank}${suit}`,
          suit,
          rank,
          val: idx + 2,
          pack,
          isPrintedJoker: false
        });
      });
    }
    for (let pj = 0; pj < jokersPerDeck; pj++) {
      cards.push({
        id: `PJ_${pack}_${pj}`,
        suit: '★',
        rank: 'JKR',
        val: 0,
        pack,
        isPrintedJoker: true
      });
    }
  }

  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

class RummyGame {
  constructor(room, io, options = {}) {
    this.room = room;
    this.io = io;

    let requestedDecks = Math.min(Math.max(+options.deckCount || 4, 3), 6);
    this.jokersPerDeck = Math.min(Math.max(+options.jokersPerDeck || 2, 2), 3);
    this.jokerType = options.jokerType || 'hidden'; // 'hidden' or 'open'

    const activeCandidates = room.players.slice(0, 20);
    const activeCount = activeCandidates.length;

    // Minimum 52 cards remaining in closed draw pile rule
    const cardsNeeded = (activeCount * 13) + 1 + 52;
    const cardsPerDeck = 52 + this.jokersPerDeck;
    while (requestedDecks * cardsPerDeck < cardsNeeded && requestedDecks < 6) {
      requestedDecks++;
    }
    this.deckCount = requestedDecks;

    this.stockPile = createDecks(this.deckCount, this.jokersPerDeck);
    this.discardPile = [];

    // Cut Joker selection
    let cutIdx = this.stockPile.findIndex(c => !c.isPrintedJoker);
    this.cutJoker = cutIdx >= 0 ? this.stockPile.splice(cutIdx, 1)[0] : this.stockPile.pop();

    this.jokerRevealedToAll = (this.jokerType === 'open');
    this.playersWhoSawJoker = new Set();

    this.players = room.players.map((p, idx) => ({
      id: p.id,
      name: p.name,
      hand: [],
      hasPure: false,
      score: 80,
      dropped: false,
      dropScore: null,
      turnsTaken: 0,
      waitlisted: idx >= 20,
      declared: false
    }));

    this.turnIndex = 0;
    this.hasDrawn = false;
    this.phase = 'playing'; // 'playing' | 'declaring' | 'finished'
    this.declaringPlayerId = null;
    this.winner = null;

    this.dealInitialCards();
  }

  dealInitialCards() {
    for (let i = 0; i < 13; i++) {
      for (const p of this.players) {
        if (!p.waitlisted && this.stockPile.length > 0) {
          p.hand.push(this.stockPile.pop());
        }
      }
    }
    if (this.stockPile.length > 0) {
      this.discardPile.push(this.stockPile.pop());
    }
  }

  isWildJoker(card) {
    if (!card) return false;
    if (card.isPrintedJoker) return true;
    return card.rank === this.cutJoker.rank;
  }

  getActivePlayer() {
    return this.players[this.turnIndex];
  }

  nextTurn() {
    this.hasDrawn = false;
    let nextIdx = (this.turnIndex + 1) % this.players.length;
    let count = 0;
    while ((this.players[nextIdx].waitlisted || this.players[nextIdx].dropped) && count < this.players.length) {
      nextIdx = (nextIdx + 1) % this.players.length;
      count++;
    }
    this.turnIndex = nextIdx;
  }

  // Draw Card action
  drawCard(playerId, source = 'stock') {
    if (this.phase !== 'playing') return { ok: false, msg: 'Game not in playing phase.' };
    const p = this.getActivePlayer();
    if (!p || p.id !== playerId) return { ok: false, msg: 'Not your turn.' };
    if (this.hasDrawn) return { ok: false, msg: 'Already drew a card this turn.' };

    let card;
    if (source === 'discard') {
      if (this.discardPile.length === 0) return { ok: false, msg: 'Discard pile is empty.' };
      const topDiscard = this.discardPile[this.discardPile.length - 1];

      // RULE: If Joker is OPEN/revealed, you cannot pick a Joker from the discard pile.
      // BUT if the Joker is HIDDEN, taking it is PERMITTED (as its wild status is hidden).
      if (this.jokerRevealedToAll && this.isWildJoker(topDiscard)) {
        return { ok: false, msg: 'Cannot pick an open Joker from the discard pile!' };
      }
      card = this.discardPile.pop();
    } else {
      if (this.stockPile.length === 0) this.recycleDiscards();
      if (this.stockPile.length === 0) return { ok: false, msg: 'No cards available to draw.' };
      card = this.stockPile.pop();
    }

    p.hand.push(card);
    this.hasDrawn = true;
    p.turnsTaken++;
    return { ok: true, card };
  }

  // Discard Card action
  discardCard(playerId, cardId) {
    if (this.phase === 'declaring' && this.declaringPlayerId === playerId) {
      this.phase = 'playing';
      this.declaringPlayerId = null;
    }

    if (this.phase !== 'playing') return { ok: false, msg: 'Cannot discard right now.' };
    const p = this.getActivePlayer();
    if (!p || p.id !== playerId) return { ok: false, msg: 'Not your turn.' };
    if (!this.hasDrawn) return { ok: false, msg: 'You must draw a card before discarding.' };

    const idx = p.hand.findIndex(c => c.id === cardId);
    if (idx < 0) return { ok: false, msg: 'Card not in hand.' };

    const [discarded] = p.hand.splice(idx, 1);
    this.discardPile.push(discarded);

    this.nextTurn();
    return { ok: true, discarded };
  }

  // Drop Option (First Drop = 20 pts, Middle Drop = 40 pts)
  dropGame(playerId) {
    if (this.phase !== 'playing') return { ok: false, msg: 'Cannot drop right now.' };
    const p = this.getActivePlayer();
    if (!p || p.id !== playerId) return { ok: false, msg: 'You can only drop when it is your turn.' };
    if (this.hasDrawn) return { ok: false, msg: 'Cannot drop after drawing a card. You must discard or declare.' };

    p.dropped = true;
    p.dropScore = p.turnsTaken <= 1 ? 20 : 40;
    p.score = p.dropScore;

    const remaining = this.players.filter(x => !x.waitlisted && !x.dropped);
    if (remaining.length === 1) {
      this.finishGame(remaining[0].id);
    } else {
      this.nextTurn();
    }
    return { ok: true, dropScore: p.dropScore, playerName: p.name };
  }

  // Identical Triplets (Sikkan / Sikkans) or Pure Natural Sequence
  isValidPureGroup(group) {
    if (!group || group.length < 3) return false;

    // A pure sequence / sikkan cannot have wild or printed jokers
    if (group.some(c => this.isWildJoker(c))) return false;

    // Identical Triplets (Sikkan): 3 identical cards (same suit, same rank from separate packs)
    const first = group[0];
    const isSikkan = group.every(c => c.rank === first.rank && c.suit === first.suit);
    if (isSikkan) {
      const distinctPacks = new Set(group.map(c => c.pack));
      if (distinctPacks.size === group.length) return true;
    }

    // Sequence check: all same suit
    const suit = group[0].suit;
    if (!group.every(c => c.suit === suit)) return false;

    // Duplicate cards in suit sequence are forbidden
    const uniqueCards = new Set(group.map(c => `${c.rank}_${c.suit}`));
    if (uniqueCards.size !== group.length) return false;

    // Natural sequence ascending check
    const sorted = [...group].sort((a, b) => a.val - b.val);
    let isRun = true;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i + 1].val !== sorted[i].val + 1) {
        isRun = false;
        break;
      }
    }
    if (isRun) return true;

    // Ace-low check (A-2-3...)
    if (sorted.some(c => c.rank === 'A')) {
      const aceLow = sorted.map(c => c.rank === 'A' ? { ...c, val: 1 } : c).sort((a, b) => a.val - b.val);
      let isAceLowRun = true;
      for (let i = 0; i < aceLow.length - 1; i++) {
        if (aceLow[i + 1].val !== aceLow[i].val + 1) {
          isAceLowRun = false;
          break;
        }
      }
      if (isAceLowRun) return true;
    }

    return false;
  }

  isValidSecondarySequence(group) {
    if (!group || group.length < 3) return false;
    if (this.isValidPureGroup(group)) return true;

    const naturals = group.filter(c => !this.isWildJoker(c));
    const jokerCount = group.length - naturals.length;
    if (naturals.length === 0) return true;

    const suit = naturals[0].suit;
    if (!naturals.every(c => c.suit === suit)) return false;

    const uniqueNaturals = new Set(naturals.map(c => `${c.rank}_${c.suit}`));
    if (uniqueNaturals.size !== naturals.length) return false;

    const sorted = [...naturals].sort((a, b) => a.val - b.val);
    let needed = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      const diff = sorted[i + 1].val - sorted[i].val;
      if (diff <= 0) return false;
      needed += (diff - 1);
    }
    if (needed <= jokerCount) return true;

    if (naturals.some(c => c.rank === 'A')) {
      const aceLow = naturals.map(c => c.rank === 'A' ? { ...c, val: 1 } : c).sort((a, b) => a.val - b.val);
      let aceLowJokers = 0;
      for (let i = 0; i < aceLow.length - 1; i++) {
        const diff = aceLow[i + 1].val - aceLow[i].val;
        if (diff <= 0) return false;
        aceLowJokers += (diff - 1);
      }
      if (aceLowJokers <= jokerCount) return true;
    }

    return false;
  }

  isValidSet(group) {
    if (!group || group.length < 3) return false;
    const naturals = group.filter(c => !this.isWildJoker(c));
    if (naturals.length === 0) return true;
    const rank = naturals[0].rank;
    return naturals.every(c => c.rank === rank);
  }

  isValidGroup(group) {
    return this.isValidPureGroup(group) || this.isValidSecondarySequence(group) || this.isValidSet(group);
  }

  // Present Pure Sequence or Sikkan to unlock Joker
  revealPureSequence(playerId, groupCardIds) {
    const p = this.players.find(x => x.id === playerId);
    if (!p) return { ok: false, msg: 'Player not found.' };

    const activePlayer = this.getActivePlayer();
    if (!this.jokerRevealedToAll && activePlayer.id !== playerId) {
      return { ok: false, msg: 'You must wait for your turn to inspect and unlock the hidden Joker.' };
    }

    const cards = groupCardIds.map(id => p.hand.find(c => c.id === id)).filter(Boolean);
    if (this.isValidPureGroup(cards)) {
      p.hasPure = true;
      this.playersWhoSawJoker.add(playerId);

      const activePlayers = this.players.filter(x => !x.waitlisted);
      if (this.playersWhoSawJoker.size >= activePlayers.length) {
        this.jokerRevealedToAll = true;
      }

      // Broadcast inspection timers:
      // 1. All players get a 5-second broadcast modal with an option to close.
      // 2. The unlocking player gets a 15-second inspection window before resuming play.
      this.io.to(this.room.code).emit('jokerInspectionBroadcast', {
        unlockedBy: p.name,
        cutJoker: this.cutJoker,
        allDuration: 5,
        unlockerId: p.id,
        unlockerDuration: 15,
        jokerRevealedToAll: this.jokerRevealedToAll
      });

      return {
        ok: true,
        cutJoker: this.cutJoker,
        allRevealed: this.jokerRevealedToAll,
        isSikkan: cards.every(c => c.rank === cards[0].rank && c.suit === cards[0].suit)
      };
    }

    return { ok: false, msg: 'Invalid Pure Sequence / Sikkan. Cannot contain Jokers or duplicate cards.' };
  }

  // Declaration
  declareShow(playerId, groups, discardCardId) {
    const p = this.getActivePlayer();
    if (!p || p.id !== playerId) return { ok: false, msg: 'Not your turn to declare.' };
    if (!this.hasDrawn) return { ok: false, msg: 'Draw a card before declaring.' };

    let pureGroup = null;
    let secGroup = null;

    for (const g of groups) {
      const cards = g.map(id => p.hand.find(c => c.id === id)).filter(Boolean);
      if (!pureGroup && this.isValidPureGroup(cards)) {
        pureGroup = cards;
      } else if (!secGroup && this.isValidSecondarySequence(cards)) {
        secGroup = cards;
      } else if (!this.isValidGroup(cards)) {
        this.phase = 'declaring';
        this.declaringPlayerId = playerId;
        return {
          ok: false,
          invalidDeclaration: true,
          msg: 'Invalid declaration! One of your sets/sequences is invalid. Rearrange your cards or discard a card on the discard pile to continue.'
        };
      }
    }

    if (!pureGroup || !secGroup || (pureGroup.length + secGroup.length < 7)) {
      this.phase = 'declaring';
      this.declaringPlayerId = playerId;
      return {
        ok: false,
        invalidDeclaration: true,
        msg: 'Invalid declaration! Must contain at least 1 Pure Sequence/Sikkan and 1 Secondary Sequence totaling 7+ cards. Fix combinations or discard to continue.'
      };
    }

    // Valid declaration
    const dIdx = p.hand.findIndex(c => c.id === discardCardId);
    if (dIdx >= 0) {
      this.discardPile.push(p.hand.splice(dIdx, 1)[0]);
    }

    this.winner = p;
    this.finishGame(p.id);
    return { ok: true, winner: p.name };
  }

  finishGame(winnerId) {
    this.phase = 'finished';
    this.jokerRevealedToAll = true;

    for (const p of this.players) {
      if (p.waitlisted) continue;
      if (p.id === winnerId) {
        p.score = 0;
      } else if (p.dropped) {
        p.score = p.dropScore || 40;
      } else {
        p.score = this.calculateHandScore(p);
      }
    }
  }

  calculateHandScore(player) {
    if (!player.hasPure) return 80;

    let sum = 0;
    for (const c of player.hand) {
      if (this.isWildJoker(c)) continue;
      if (['A', 'K', 'Q', 'J', '10'].includes(c.rank)) {
        sum += 10;
      } else {
        sum += parseInt(c.rank, 10) || 10;
      }
    }
    return Math.min(sum, 80);
  }

  recycleDiscards() {
    if (this.discardPile.length <= 1) return;
    const top = this.discardPile.pop();
    this.stockPile = this.discardPile;
    this.discardPile = [top];
    for (let i = this.stockPile.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.stockPile[i], this.stockPile[j]] = [this.stockPile[j], this.stockPile[i]];
    }
  }

  getStateFor(playerId) {
    const activePlayer = this.getActivePlayer();
    const isMyTurn = activePlayer && activePlayer.id === playerId;
    const me = this.players.find(p => p.id === playerId);

    const canSeeJoker = this.jokerRevealedToAll || (me && me.hasPure && this.playersWhoSawJoker.has(playerId) && isMyTurn);

    return {
      phase: this.phase,
      turn: activePlayer ? activePlayer.id : null,
      hasDrawn: this.hasDrawn,
      stockCount: this.stockPile.length,
      topDiscard: this.discardPile[this.discardPile.length - 1] || null,
      cutJoker: canSeeJoker ? this.cutJoker : null,
      jokerRevealedToAll: this.jokerRevealedToAll,
      jokerType: this.jokerType,
      declaringPlayerId: this.declaringPlayerId,
      winner: this.winner ? this.winner.name : null,
      hand: me ? me.hand : [],
      hasPure: me ? me.hasPure : false,
      dropped: me ? me.dropped : false,
      isWaitlisted: me ? me.waitlisted : false,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length,
        hasPure: p.hasPure,
        dropped: p.dropped,
        score: p.score,
        waitlisted: p.waitlisted
      }))
    };
  }
}

module.exports = RummyGame;
