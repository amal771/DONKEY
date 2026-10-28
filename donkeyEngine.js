/**
 * Party Blaster - Donkey Card Game Engine
 * Preserves all complete original Donkey mechanics:
 * - 16, 32, 52, or 104 card decks
 * - Adaptive turn timers (50s / 15s)
 * - Settle-up timer & Ace of Spades opening
 * - Lead suit following & HIT collection
 * - Whip cracking sound effects
 * - 3-player surrender option
 * - Card request mechanic between players
 * - Seating ring & donkey designation
 */

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const MIN_VALUE = { 16: 11, 32: 7, 52: 2, 104: 2 };
const COLORS = [
  '#E57373', '#81C784', '#64B5F6', '#FFD54F', '#BA68C8', '#4DB6AC',
  '#FF8A65', '#A1887F', '#90A4AE', '#4DD0E1', '#F06292', '#AED581',
  '#7986CB', '#DCE775', '#9575CD', '#26A69A', '#FFB74D', '#80CBC4',
  '#F48FB1', '#CE93D8'
];
const TURN_SECS = 50;
const SETTLE_SECS = 30;
const ACE = '0A♠';

function createDeck(size = 52) {
  const d = [];
  const packs = size === 104 ? 2 : 1;
  for (let pack = 0; pack < packs; pack++) {
    for (const s of SUITS) {
      RANKS.forEach((r, i) => {
        if (i + 2 >= MIN_VALUE[size]) {
          d.push({ id: `${pack}${r}${s}`, suit: s, rank: r, value: i + 2, pack });
        }
      });
    }
  }
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

const cmp = (a, b) => a.value - b.value || b.pack - a.pack;

class DonkeyGame {
  constructor(room, io, options = {}) {
    this.room = room;
    this.io = io;
    this.deckSize = [16, 32, 52, 104].includes(+options.deckSize) ? +options.deckSize : 52;
    this.double = this.deckSize === 104;

    const usedColors = new Set();
    this.players = room.players.map((p, idx) => {
      const color = COLORS[idx % COLORS.length];
      usedColors.add(color);
      return {
        id: p.id,
        name: p.name,
        color: color,
        hand: [],
        online: true,
        inactiveRounds: 0,
        inactNow: false,
        rank: 0,
        wait: false
      };
    });

    this.phase = 'playing';
    this.table = [];
    this.leadSuit = null;
    this.lastLead = null;
    this.turn = null;
    this.limit = TURN_SECS;
    this.elapsed = 0;
    this.opening = false;
    this.settling = false;
    this.reveal = false;
    this.request = null;
    this.surrender = null;
    this.donkey = null;
    this.finished = 0;
    this.round = 0;
    this.deals = 1;
    this.notice = 'Match started!';

    this.dealCards();
    this.startTimers();
  }

  dealCards() {
    const cards = createDeck(this.deckSize);
    const n = this.players.length;
    cards.forEach((c, i) => {
      this.players[i % n].hand.push(c);
    });

    const holder = this.players.find(p => p.hand.some(c => c.id === ACE));
    const starter = holder || this.players[0];
    this.turn = starter.id;

    if (this.players.length <= 6) {
      this.opening = true;
      this.settling = false;
      this.limit = SETTLE_SECS;
      this.notice = `${starter.name} holds the Ace of Spades. Settle up: it plays automatically in 30 seconds.`;
    } else {
      this.opening = false;
      this.settling = true;
      this.limit = SETTLE_SECS;
      this.notice = `${starter.name} holds the Ace of Spades and chooses the opening card. Timer starts after 30 seconds.`;
      this.io.to(starter.id).emit('starterAlert');
    }
  }

  startTimers() {
    clearInterval(this.iv);
    this.iv = setInterval(() => this.tick(), 1000);
  }

  cleanup() {
    clearInterval(this.iv);
  }

  tick() {
    if (this.phase !== 'playing' || !this.turn || this.reveal || this.request) return;
    this.elapsed++;
    const left = Math.max(0, this.limit - this.elapsed);
    this.io.to(this.room.code).emit('tick', { left, limit: this.limit });

    if (this.settling && this.elapsed >= this.limit) {
      this.settling = false;
      this.elapsed = 0;
      this.limit = TURN_SECS;
      const curr = this.players.find(p => p.id === this.turn);
      this.notice = `${curr ? curr.name : 'Player'}'s turn timer has started.`;
      this.broadcastState();
      return;
    }

    if (left <= 0) {
      const curr = this.players.find(p => p.id === this.turn);
      if (curr) this.autoPlay(curr);
    }
  }

  autoPlay(p) {
    if (!p.hand.length) return;
    const sorted = [...p.hand].sort((a, b) => a.value - b.value || b.pack - a.pack);
    let card;
    if (this.opening) {
      card = p.hand.find(x => x.id === ACE);
    } else if (!this.table.length) {
      card = sorted[0];
    } else {
      const match = sorted.filter(c => c.suit === this.leadSuit);
      card = match.length ? match[0] : sorted[0];
    }
    this.playCard(p.id, (card || sorted[0]).id, false, true);
  }

  highCard() {
    return this.table.filter(x => x.card.suit === this.leadSuit).sort((a, b) => cmp(b.card, a.card))[0];
  }

  nextAlive(id) {
    const alive = this.players.filter(p => p.hand.length > 0);
    if (!alive.length) return null;
    const i = alive.findIndex(p => p.id === id);
    return alive[(i + 1) % alive.length];
  }

  playCard(playerId, cardId, whip = false, isAuto = false) {
    if (this.turn !== playerId || this.phase !== 'playing' || this.reveal || this.request) {
      return { ok: false, msg: 'Not your turn.' };
    }

    const p = this.players.find(x => x.id === playerId);
    if (!p) return { ok: false, msg: 'Player not found.' };

    const idx = p.hand.findIndex(c => c.id === cardId);
    if (idx < 0) return { ok: false, msg: 'Card not in hand.' };

    const card = p.hand[idx];
    if (this.opening && card.id !== ACE) {
      return { ok: false, msg: 'The Ace of Spades must open the match.' };
    }

    if (this.table.length && card.suit !== this.leadSuit && p.hand.some(c => c.suit === this.leadSuit)) {
      return { ok: false, msg: 'You must follow the lead suit.' };
    }

    p.hand.splice(idx, 1);
    this.opening = false;
    this.settling = false;
    this.elapsed = 0;
    this.limit = TURN_SECS;

    const tag = isAuto ? ' (auto)' : '';
    if (!this.table.length) {
      this.leadSuit = card.suit;
      this.lastLead = card.suit;
      this.notice = `${p.name} led ${card.rank}${card.suit}${tag}.`;
    } else {
      this.notice = `${p.name} played ${card.rank}${card.suit}${tag}.`;
    }

    this.table.push({ playerId: p.id, card });

    const isHit = card.suit !== this.leadSuit;
    if (isHit && whip) {
      this.io.to(this.room.code).emit('whip');
    }

    const aliveCount = this.players.filter(x => x.hand.length > 0 || x.id === p.id).length;
    if (isHit || this.table.length >= aliveCount) {
      this.endRound(isHit, p, card);
    } else {
      const nxt = this.nextAlive(p.id);
      if (nxt) this.turn = nxt.id;
    }

    this.broadcastState();
    return { ok: true };
  }

  endRound(hit, p, card) {
    const highEntry = this.highCard();
    const winner = this.players.find(x => x.id === (highEntry ? highEntry.playerId : p.id));
    this.reveal = true;
    this.turn = null;

    if (hit) {
      winner.hand.push(...this.table.map(x => x.card));
      this.notice = `HIT! ${p.name} played ${card.rank}${card.suit} off-suit. ${winner.name} collects all cards.`;
      this.io.to(this.room.code).emit('scroll', { secs: 4, text: `${winner.name} got HIT by ${p.name}'s ${card.rank}${card.suit}!` });
    } else {
      this.notice = `Round won by ${winner.name} (${highEntry.card.rank}${this.leadSuit}).`;
      this.io.to(this.room.code).emit('scroll', { secs: 4, text: `${winner.name} won the round with ${highEntry.card.rank}${this.leadSuit}.` });
    }

    setTimeout(() => {
      if (this.phase !== 'playing') return;
      this.table = [];
      this.leadSuit = null;
      this.reveal = false;

      // Assign ranks to players with empty hands
      this.players.forEach(pl => {
        if (!pl.hand.length && !pl.rank) {
          pl.rank = ++this.finished;
          this.io.to(this.room.code).emit('golden', { text: `${pl.name} cleared all cards — #${pl.rank}`, secs: 4 });
        }
      });

      const remaining = this.players.filter(pl => pl.hand.length > 0);
      if (remaining.length <= 1) {
        this.phase = 'finished';
        clearInterval(this.iv);
        const donkeyPlayer = remaining[0] || this.players.sort((a,b) => b.rank - a.rank)[0];
        this.donkey = donkeyPlayer.id;
        this.notice = `${donkeyPlayer.name} is the DONKEY!`;
      } else {
        const leader = winner.hand.length ? winner : this.nextAlive(winner.id);
        this.turn = leader ? leader.id : remaining[0].id;
        this.notice = `${leader ? leader.name : 'Player'} leads next.`;
      }

      this.broadcastState();
    }, hit ? 2500 : 1800);
  }

  requestCards(fromId) {
    if (this.phase !== 'playing' || this.turn !== fromId || this.table.length || this.request) {
      return { ok: false, msg: 'Cannot request cards right now.' };
    }
    const to = this.nextAlive(fromId);
    if (!to || to.id === fromId) return { ok: false, msg: 'No player to request cards from.' };

    this.request = {
      from: fromId,
      to: to.id,
      timer: setTimeout(() => this.resolveRequest(false), 15000)
    };

    const fromP = this.players.find(x => x.id === fromId);
    this.io.to(this.room.code).emit('scroll', { secs: 6, text: `${fromP.name} requests all cards from ${to.name}.` });
    this.notice = `${fromP.name} requested cards from ${to.name} (15s to answer).`;
    this.broadcastState();
    return { ok: true };
  }

  resolveRequest(approve) {
    if (!this.request) return;
    clearTimeout(this.request.timer);
    const q = this.request;
    this.request = null;

    const from = this.players.find(x => x.id === q.from);
    const to = this.players.find(x => x.id === q.to);
    if (!from || !to) return this.broadcastState();

    if (approve) {
      const cards = to.hand.splice(0);
      from.hand.push(...cards);
      this.notice = `${to.name} gave ${cards.length} cards to ${from.name}.`;
      this.io.to(this.room.code).emit('scroll', { secs: 6, text: `${to.name} passed all ${cards.length} cards to ${from.name}!` });
      if (!to.rank) to.rank = ++this.finished;
    } else {
      this.notice = `${to.name} declined the card request.`;
      this.io.to(this.room.code).emit('scroll', { secs: 4, text: this.notice });
    }

    this.turn = from.id;
    this.broadcastState();
  }

  surrender(playerId) {
    const remaining = this.players.filter(p => p.hand.length > 0);
    if (remaining.length !== 3 || !remaining.some(p => p.id === playerId)) {
      return { ok: false, msg: 'Surrender is only allowed when exactly 3 players remain.' };
    }
    this.surrender = { by: playerId, approvals: new Set() };
    const p = this.players.find(x => x.id === playerId);
    this.notice = `${p.name} offered to surrender. One of the other 2 players must approve.`;
    this.broadcastState();
    return { ok: true };
  }

  respondSurrender(playerId, approve) {
    if (!this.surrender || this.surrender.by === playerId) return;
    if (approve) {
      const surrendered = this.players.find(x => x.id === this.surrender.by);
      this.donkey = surrendered.id;
      this.phase = 'finished';
      clearInterval(this.iv);
      this.notice = `${surrendered.name} surrendered and is the DONKEY!`;
    } else {
      this.surrender = null;
      this.notice = 'Surrender declined. Play continues.';
    }
    this.broadcastState();
  }

  broadcastState() {
    for (const p of this.players) {
      this.io.to(p.id).emit('gameState', this.getStateFor(p.id));
    }
  }

  getStateFor(playerId) {
    const me = this.players.find(p => p.id === playerId);
    const high = this.highCard();
    const remaining = this.players.filter(x => x.hand.length > 0);

    return {
      gameType: 'donkey',
      phase: this.phase,
      turn: this.turn,
      turnSecondsLeft: Math.max(0, this.limit - this.elapsed),
      turnDuration: this.limit,
      settling: this.settling,
      opening: this.opening,
      leadSuit: this.leadSuit,
      highId: high ? high.card.id : null,
      table: this.table.map(t => {
        const p = this.players.find(x => x.id === t.playerId);
        return { playerId: t.playerId, name: p ? p.name : 'Player', color: p ? p.color : '#ccc', card: t.card };
      }),
      deckSize: this.deckSize,
      double: this.double,
      notice: this.notice,
      donkey: this.donkey,
      hand: me ? me.hand : [],
      request: this.request ? { from: this.request.from, to: this.request.to } : null,
      surrender: this.surrender ? { by: this.surrender.by } : null,
      canSurrender: this.phase === 'playing' && remaining.length === 3,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        handCount: p.hand.length,
        rank: p.rank
      }))
    };
  }
}

module.exports = DonkeyGame;
