/**
 * Party Blaster - Rummy Game Engine
 * 20-Player Custom Indian/Marriage Rummy Variant
 *
 * Rules & Inactivity Timers Implemented:
 * 1. Default Inactivity Timer: 20 seconds.
 * 2. Active Interaction Extension: If user touches/moves/interacts, timer extends to 45 seconds.
 * 3. Offline Player Timer: When a player is offline/disconnected, turn auto-plays in 8 seconds.
 * 4. Auto-Play on Inactivity / Timeout:
 *    - Automatically draws 1 card from the closed stock pile.
 *    - Automatically discards 1 non-joker card onto the open discard pile.
 * 5. Hidden vs Open Joker discard taking rules:
 *    - If joker is hidden, taking from discard is allowed.
 *    - If joker is open, picking an open joker from discard is blocked.
 * 6. Drops: First Drop = 20 pts, Middle Drop = 40 pts.
 * 7. Sikkan (identical triplets) recognized as pure sequence.
 * 8. Pure sequence reveal inspections (5s table popup, 15s unlocker inspection).
 * 9. Soft invalid declaration popup.
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
    this.jokerType = options.jokerType || 'hidden';

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
      declared: false,
      online: true,
      hasInteracted: false
    }));

    this.turnIndex = 0;
    this.hasDrawn = false;
    this.phase = 'playing';
    this.declaringPlayerId = null;
    this.winner = null;

    // Timer configs
    this.timerLimit = 20; // default 20s if inactive
    this.timerElapsed = 0;

    this.dealInitialCards();
    this.initTurnTimer();
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

  initTurnTimer() {
    const p = this.getActivePlayer();
    if (!p) return;

    this.timerElapsed = 0;
    p.hasInteracted = false;

    if (!p.online) {
      this.timerLimit = 8; // Offline players get 8 seconds
    } else {
      this.timerLimit = 20; // Inactive default 20 seconds
    }

    clearInterval(this.turnInterval);
    this.turnInterval = setInterval(() => this.tick(), 1000);
  }

  // Player moved card, dragged, or touched UI
  registerInteraction(playerId) {
    const p = this.getActivePlayer();
    if (p && p.id === playerId && !p.hasInteracted) {
      p.hasInteracted = true;
      this.timerLimit = 45; // Extend timer to 45 seconds on activity
      this.emitTimerTick();
    }
  }

  tick() {
    if (this.phase !== 'playing') return;
    const p = this.getActivePlayer();
    if (!p) return;

    this.timerElapsed++;
    this.emitTimerTick();

    if (this.timerElapsed >= this.timerLimit) {
      this.autoPlayTurn(p);
    }
  }

  emitTimerTick() {
    const p = this.getActivePlayer();
    const left = Math.max(0, this.timerLimit - this.timerElapsed);
    this.io.to(this.room.code).emit('rummyTick', {
      playerId: p ? p.id : null,
      left,
      limit: this.timerLimit
    });
  }

  // Auto-play when 20s (inactive), 45s (active), or 8s (offline) expires
  autoPlayTurn(p) {
    if (this.phase !== 'playing') return;

    // Step 1: Draw from stock pile if not already drawn
    if (!this.hasDrawn) {
      if (this.stockPile.length === 0) this.recycleDiscards();
      if (this.stockPile.length > 0) {
        const drawn = this.stockPile.pop();
        p.hand.push(drawn);
        this.hasDrawn = true;
        p.turnsTaken++;
      }
    }

    // Step 2: Auto-discard a non-joker card onto the open discard pile
    let discardIdx = p.hand.findIndex(c => !this.isWildJoker(c));
    if (discardIdx < 0) discardIdx = 0;

    if (p.hand.length > 0) {
      const [discarded] = p.hand.splice(discardIdx, 1);
      this.discardPile.push(discarded);
      this.io.to(this.room.code).emit('scroll', {
        secs: 4,
        text: `⏳ Time out! ${p.name} auto-drew from pile and discarded ${discarded.rank}${discarded.suit}.`
      });
    }

    this.nextTurn();
    this.broadcastState();
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
    this.initTurnTimer();
  }

  cleanup() {
    clearInterval(this.turnInterval);
  }

  drawCard(playerId, source = 'stock') {
    if (this.phase !== 'playing') return { ok: false, msg: 'Game not in playing phase.' };
    const p = this.getActivePlayer();
    if (!p || p.id !== playerId) return { ok: false, msg: 'Not your turn.' };
    if (this.hasDrawn) return { ok: false, msg: 'Already drew a card this turn.' };

    this.registerInteraction(playerId);

    let card;
    if (source === 'discard') {
      if (this.discardPile.length === 0) return { ok: false, msg: 'Discard pile is empty.' };
      const topDiscard = this.discardPile[this.discardPile.length - 1];

      // If Joker is OPEN/revealed, you cannot pick an open Joker from the discard pile.
      // If the Joker is HIDDEN, taking it is PERMITTED.
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

  isValidPureGroup(group) {
    if (!group || group.length < 3) return false;
    if (group.some(c => this.isWildJoker(c))) return false;

    // Identical Triplets (Sikkan): 3 identical cards from separate packs
    const first = group[0];
    const isSikkan = group.every(c => c.rank === first.rank && c.suit === first.suit);
    if (isSikkan) {
      const distinctPacks = new Set(group.map(c => c.pack));
      if (distinctPacks.size === group.length) return true;
    }

    const suit = group[0].suit;
    if (!group.every(c => c.suit === suit)) return false;

    const uniqueCards = new Set(group.map(c => `${c.rank}_${c.suit}`));
    if (uniqueCards.size !== group.length) return false;

    const sorted = [...group].sort((a, b) => a.val - b.val);
    let isRun = true;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i + 1].val !== sorted[i].val + 1) {
        isRun = false;
        break;
      }
    }
    if (isRun) return true;

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
    clearInterval(this.turnInterval);

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

  setPlayerOnline(playerId, isOnline) {
    const p = this.players.find(x => x.id === playerId);
    if (p) {
      p.online = isOnline;
      if (!isOnline && this.getActivePlayer()?.id === playerId) {
        // Drop limit to 8 seconds if current player disconnected
        this.timerLimit = 8;
        this.emitTimerTick();
      }
    }
  }

  broadcastState() {
    for (const p of this.players) {
      this.io.to(p.id).emit('gameState', this.getStateFor(p.id));
    }
  }

  getStateFor(playerId) {
    const activePlayer = this.getActivePlayer();
    const isMyTurn = activePlayer && activePlayer.id === playerId;
    const me = this.players.find(p => p.id === playerId);

    const canSeeJoker = this.jokerRevealedToAll || (me && me.hasPure && this.playersWhoSawJoker.has(playerId) && isMyTurn);

    return {
      gameType: 'rummy',
      phase: this.phase,
      turn: activePlayer ? activePlayer.id : null,
      turnSecondsLeft: Math.max(0, this.timerLimit - this.timerElapsed),
      turnDuration: this.timerLimit,
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
        online: p.online,
        score: p.score,
        waitlisted: p.waitlisted
      }))
    };
  }
}

module.exports = RummyGame;
