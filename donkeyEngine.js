/**
 * Party Blaster - Donkey Card Game Engine
 */

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const MIN_VALUE = { 16: 11, 32: 7, 52: 2, 104: 2 };
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
    this.players = room.players.map(p => ({
      id: p.id,
      name: p.name,
      hand: [],
      rank: 0,
      online: true,
      inactiveRounds: 0
    }));
    this.table = [];
    this.leadSuit = null;
    this.turn = null;
    this.phase = 'playing';
    this.donkey = null;
    this.dealCards();
  }

  dealCards() {
    const cards = createDeck(this.deckSize);
    const n = this.players.length;
    cards.forEach((c, i) => {
      this.players[i % n].hand.push(c);
    });

    const holder = this.players.find(p => p.hand.some(c => c.id === ACE));
    this.turn = holder ? holder.id : this.players[0].id;
  }

  highCard() {
    return this.table.filter(x => x.card.suit === this.leadSuit).sort((a, b) => cmp(b.card, a.card))[0];
  }

  playCard(playerId, cardId, whip = false) {
    if (this.turn !== playerId) return { ok: false, msg: 'Not your turn.' };
    const p = this.players.find(x => x.id === playerId);
    const idx = p.hand.findIndex(c => c.id === cardId);
    if (idx < 0) return { ok: false, msg: 'Card not in hand.' };

    const card = p.hand[idx];
    if (this.table.length && card.suit !== this.leadSuit && p.hand.some(c => c.suit === this.leadSuit)) {
      return { ok: false, msg: 'Must follow lead suit.' };
    }

    p.hand.splice(idx, 1);
    if (!this.table.length) this.leadSuit = card.suit;
    this.table.push({ playerId: p.id, card });

    const hit = card.suit !== this.leadSuit;
    if (hit) {
      const winner = this.players.find(x => x.id === this.highCard().playerId);
      winner.hand.push(...this.table.map(t => t.card));
      this.table = [];
      this.leadSuit = null;
      this.turn = winner.id;
      if (whip) this.io.to(this.room.code).emit('whip');
    } else if (this.table.length >= this.players.filter(x => x.hand.length > 0).length) {
      const winner = this.players.find(x => x.id === this.highCard().playerId);
      this.table = [];
      this.leadSuit = null;
      this.turn = winner.id;
    } else {
      const alive = this.players.filter(x => x.hand.length > 0);
      const currIdx = alive.findIndex(x => x.id === p.id);
      this.turn = alive[(currIdx + 1) % alive.length].id;
    }

    return { ok: true };
  }

  getStateFor(playerId) {
    const me = this.players.find(p => p.id === playerId);
    return {
      phase: this.phase,
      turn: this.turn,
      leadSuit: this.leadSuit,
      table: this.table,
      deckSize: this.deckSize,
      hand: me ? me.hand : [],
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        handCount: p.hand.length,
        rank: p.rank
      }))
    };
  }
}

module.exports = DonkeyGame;
