const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
app.use(express.static('public'));

// Scannable join QR: opens the site with ?room=CODE
app.get('/qr/:code', async (req, res) => {
  try {
    const url = `${req.protocol}://${req.get('host')}/?room=${encodeURIComponent(req.params.code.slice(0, 8))}`;
    res.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', margin: 1 }));
  } catch (e) { res.sendStatus(500); }
});

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const COLORS = ['#E57373', '#81C784', '#64B5F6', '#FFD54F', '#BA68C8', '#4DB6AC', '#FF8A65', '#A1887F', '#90A4AE', '#4DD0E1',
  '#F06292', '#AED581', '#7986CB', '#DCE775', '#9575CD', '#26A69A', '#FFB74D', '#80CBC4', '#F48FB1', '#CE93D8'];
const TURN_SECS = 50; // normal turn length (15s if inactive in previous round)
const ACE = '0A♠'; // Ace of Spades from the first pack opens the match
const rooms = new Map();

const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function newCode() { // 3 letters while fewer than 100 rooms are active, else 4
  const n = rooms.size < 100 ? 3 : 4;
  let c;
  do { c = Array.from({ length: n }, () => L[Math.floor(Math.random() * 26)]).join(''); } while (rooms.has(c));
  return c;
}
const deck = double => {
  const d = [];
  for (let pack = 0; pack < (double ? 2 : 1); pack++)
    for (const s of SUITS) RANKS.forEach((r, i) => d.push({ id: `${pack}${r}${s}`, suit: s, rank: r, value: i + 2, pack }));
  return d;
};
const cmp = (a, b) => a.value - b.value || b.pack - a.pack; // equal rank: first pack is higher
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const seated = r => r.players.filter(p => !p.wait);
const alive = r => seated(r).filter(p => p.hand.length > 0);
const P = (r, id) => r.players.find(p => p.id === id);
const roomOf = s => rooms.get(s.data.room);
const high = r => r.table.filter(x => x.card.suit === r.leadSuit).sort((a, b) => cmp(b.card, a.card))[0];
const needVotes = r => Math.min(3, Math.floor(seated(r).filter(p => p.online).length / 2) + 1); // "2 more players or majority, whichever is lower"
const unhealthy = r => seated(r).some(p => !p.online || p.inactiveRounds >= 2);

function nextAlive(r, id) {
  const s = seated(r), i = s.findIndex(p => p.id === id);
  for (let n = 1; n <= s.length; n++) { const p = s[(i + n) % s.length]; if (p.hand.length) return p; }
  return null;
}

function pub(r, viewer) {
  const me = P(r, viewer), h = r.table.length ? high(r) : null;
  return {
    code: r.code, hostId: r.hostId, starterId: r.starterId, gameStarterId: r.starterId, phase: r.phase, paused: r.paused, double: r.double,
    players: r.players.map(p => ({ id: p.id, name: p.name, color: p.color, handCount: p.hand.length, online: p.online,
      inactiveRounds: p.inactiveRounds, wait: p.wait, rank: p.rank })),
    turn: r.turn, turnSecondsLeft: Math.max(0, r.limit - r.elapsed), turnDuration: r.limit, opening: r.opening,
    leadSuit: r.leadSuit, highId: h ? h.card.id : null, highPlayerId: h ? h.playerId : null, reveal: r.reveal,
    table: r.table.map(x => { const p = P(r, x.playerId); return { playerId: x.playerId, name: p?.name, color: p?.color || '#ccc', card: x.card }; }),
    notice: r.notice, hand: me ? me.hand : [],
    request: r.request ? { from: r.request.from, to: r.request.to, count: P(r, r.request.to)?.hand.length } : null,
    callOffVotes: [...r.votes], voteNeed: needVotes(r), canVote: r.phase === 'playing' && unhealthy(r),
    surrender: r.surrender ? { by: r.surrender.by } : null, canSurrender: r.phase === 'playing' && alive(r).length === 3,
    donkey: r.donkey, round: r.round
  };
}
function emit(r) { for (const p of r.players) if (p.online) io.to(p.id).emit('state', pub(r, p.id)); }
function note(r, m) { r.notice = m; emit(r); }

function newPlayer(r, id, name) {
  const used = new Set(r.players.map(p => p.color));
  return { id, name: (String(name || 'Player').trim().slice(0, 24)) || 'Player', hand: [], online: true, inactiveRounds: 0, inactNow: false,
    rank: 0, wait: false, color: COLORS.find(c => !used.has(c)) || COLORS[0] };
}

function setTurn(r, id) {
  const p = P(r, id);
  r.turn = id; r.elapsed = 0; r.granted = false; r.eligible = null;
  r.limit = r.opening ? 15 : (p && p.inactiveRounds >= 1 ? 15 : TURN_SECS); // 15s if inactive in previous round
}

function tick(r) {
  if (r.phase !== 'playing' || r.paused || r.request || r.reveal || !r.turn) return;
  const p = P(r, r.turn); if (!p) return;
  r.elapsed++;
  io.to(r.code).emit('tick', { left: Math.max(0, r.limit - r.elapsed), limit: r.limit });
  const ls = r.leadSuit && r.table.length ? p.hand.filter(c => c.suit === r.leadSuit) : [];
  if (p.online && ls.length === 1 && r.elapsed === 10) return auto(r, p, true); // single legal card: auto-dealt, not inactive
  if (p.online && !r.opening && r.limit >= TURN_SECS && r.limit - r.elapsed === 10) {
    io.to(p.id).emit('turnWarning');
    const s = seated(r), i = s.findIndex(x => x.id === p.id), el = new Set();
    if (r.hostId !== p.id) el.add(r.hostId);
    for (let k = 1; k <= 3; k++) { const q = s[(i + k) % s.length]; if (q && q.id !== p.id && q.online) el.add(q.id); }
    r.eligible = el;
    el.forEach(id => io.to(id).emit('allowTimePrompt', { forPlayer: p.name }));
  }
  if (r.elapsed >= (p.online ? r.limit : Math.min(r.limit, 5))) auto(r, p, r.opening);
}

function auto(r, p, free) {
  if (!p.hand.length) return;
  const hs = [...p.hand].sort((a, b) => a.value - b.value || b.pack - a.pack);
  let c;
  if (r.opening) c = p.hand.find(x => x.id === ACE);
  else if (!r.table.length) {
    const ss = [...new Set(hs.map(x => x.suit))];
    const s = ss.find(x => x !== r.lastLead) || ss[0];
    c = hs.find(x => x.suit === s);
  } else {
    const ls = hs.filter(x => x.suit === r.leadSuit);
    if (ls.length) { const hv = high(r).card, lower = ls.filter(x => cmp(x, hv) < 0); c = lower.length ? lower[lower.length - 1] : ls[0]; }
    else c = hs[0];
  }
  play(r, p, (c || hs[0]).id, free ? 'free' : 'auto');
}

function play(r, p, cardId, mode) {
  if (r.phase !== 'playing' || r.turn !== p.id || r.paused || r.request || r.reveal) return false;
  const i = p.hand.findIndex(c => c.id === cardId);
  if (i < 0) return false;
  const card = p.hand[i], err = m => { io.to(p.id).emit('errorMsg', m); return false; };
  if (r.opening && card.id !== ACE) return err('The Ace of Spades must open the match.');
  if (r.table.length && card.suit !== r.leadSuit && p.hand.some(c => c.suit === r.leadSuit)) return err('You must follow the lead suit.');
  p.hand.splice(i, 1);
  if (mode === 'manual') { p.inactiveRounds = 0; p.inactNow = false; } else if (mode === 'auto') p.inactNow = true;
  r.opening = false;
  const tag = mode === 'auto' ? ' (auto)' : '';
  if (!r.table.length) {
    r.leadSuit = card.suit; r.lastLead = card.suit;
    const s = seated(r), k = s.findIndex(x => x.id === p.id);
    r.order = [...s.slice(k), ...s.slice(0, k)].filter(x => x.id === p.id || x.hand.length).map(x => x.id);
    r.notice = `${p.name} led ${card.rank}${card.suit}${tag}.`;
  } else r.notice = `${p.name} played ${card.rank}${card.suit}${tag}.`;
  r.table.push({ playerId: p.id, card });
  const hit = card.suit !== r.leadSuit;
  if (hit || r.table.length >= r.order.length) endRound(r, hit, p, card);
  else setTurn(r, r.order[r.table.length]);
  emit(r);
  return true;
}

function endRound(r, hit, p, card) {
  const w = P(r, high(r).playerId);
  if (hit) {
    w.hand.push(...r.table.map(x => x.card)); // winner takes everything, incl. the off-suit HIT card
    r.notice = `HIT! ${p.name} played ${card.rank}${card.suit} off-suit. ${w.name} collects all ${r.table.length} cards.`;
  } else r.notice = `Round won by ${w.name} (${high(r).card.rank}${r.leadSuit}). Cards folded.`;
  r.reveal = true; r.turn = null;
  const rid = ++r.round;
  setTimeout(() => { if (r.phase === 'playing' && r.round === rid) finishRound(r, w); }, process.env.FAST ? 1 : hit ? 3000 : 2000);
}

// Assign finishing ranks to anyone who emptied their hand; end the game when one player remains.
function checkEnd(r, ids) {
  for (const id of ids) { const p = P(r, id); if (p && !p.wait && !p.hand.length && !p.rank) p.rank = ++r.finished; }
  const a = alive(r);
  if (a.length > 1) return false;
  let d = a[0];
  if (!d) { d = seated(r).sort((x, y) => y.rank - x.rank)[0]; r.finished--; }
  d.rank = 0;
  endGame(r, d, `${d.name} is the DONKEY! Winner: ${seated(r).find(p => p.rank === 1)?.name}.`);
  return true;
}
function endGame(r, d, msg) {
  clearInterval(r.iv); r.phase = 'finished'; r.donkey = d.id; r.turn = null; r.request = null; r.surrender = null; r.reveal = false;
  r.notice = msg;
}

function finishRound(r, w) {
  const ids = r.order.slice();
  r.order.forEach(id => { const p = P(r, id); if (!p) return; if (p.inactNow) p.inactiveRounds++; p.inactNow = false; });
  r.table = []; r.leadSuit = null; r.reveal = false;
  if (!checkEnd(r, ids)) {
    if (alive(r).length !== 3) r.surrender = null;
    const lead = w.hand.length ? w : nextAlive(r, w.id);
    setTurn(r, lead.id);
    r.notice += ` ${lead.name} leads.`;
  }
  emit(r);
}

function prune(r) {
  const gone = r.players.filter(p => !p.online || p.inactiveRounds >= 2);
  gone.forEach(p => { if (p.online) { io.to(p.id).emit('kicked', 'Removed from the table for inactivity.'); io.sockets.sockets.get(p.id)?.leave(r.code); } });
  r.players = r.players.filter(p => !gone.includes(p));
  if (!P(r, r.hostId) && r.players.length) r.hostId = r.players[0].id;
}

function start(r) {
  prune(r);
  r.players.forEach(p => p.wait = false); // waiting joiners are seated now
  const s = r.players;
  if (s.length < 2) return note(r, 'Need at least 2 active players to start.');
  clearInterval(r.iv);
  s.forEach(p => { p.hand = []; p.inactiveRounds = 0; p.inactNow = false; p.rank = 0; });
  shuffle(deck(r.double)).forEach((c, i) => s[i % s.length].hand.push(c));
  Object.assign(r, { phase: 'playing', paused: false, table: [], order: [], request: null, votes: new Set(), surrender: null, donkey: null,
    round: 0, finished: 0, leadSuit: null, lastLead: null, reveal: false });
  const holder = s.find(p => p.hand.some(c => c.id === ACE));
  r.starterId = holder.id;
  if (s.length <= 6) {
    r.opening = true; setTurn(r, holder.id);
    r.notice = `${holder.name} holds the Ace of Spades. It will be played automatically in 15 seconds.`;
  } else {
    r.opening = false; setTurn(r, holder.id);
    r.notice = `${holder.name} holds the Ace of Spades and chooses the opening card.`;
    io.to(holder.id).emit('starterAlert');
  }
  r.iv = setInterval(() => tick(r), 1000);
  emit(r);
}

function callOff(r, msg) {
  clearInterval(r.iv); r.phase = 'lobby'; r.table = []; r.request = null; r.surrender = null; r.turn = null; r.reveal = false; r.opening = false;
  r.votes = new Set();
  prune(r);
  r.players.forEach(p => { p.hand = []; p.wait = false; p.rank = 0; });
  note(r, msg);
}

function resolveRequest(r, approve) {
  const q = r.request; if (!q) return;
  clearTimeout(q.t); r.request = null;
  const from = P(r, q.from), to = P(r, q.to);
  if (!from || !to) return emit(r);
  if (approve) {
    const cards = to.hand.splice(0); from.hand.push(...cards);
    io.to(r.code).emit('passed', { from: to.name, to: from.name, count: cards.length, cards: cards.length <= 3 ? cards : null, secs: 8 });
    r.notice = `${to.name} passed ${cards.length} card(s) to ${from.name}.`;
    if (checkEnd(r, [to.id])) return emit(r);
  } else r.notice = `${to.name} declined the card request.`;
  setTurn(r, from.id);
  emit(r);
}

io.on('connection', s => {
  const join = (r, name) => { const p = newPlayer(r, s.id, name); p.wait = r.phase === 'playing'; r.players.push(p); s.join(r.code); s.data.room = r.code; return p; };

  s.on('create', ({ name, double }) => {
    const code = newCode();
    const r = { code, hostId: s.id, starterId: null, players: [], phase: 'lobby', paused: false, double: !!double, turn: null, limit: TURN_SECS, elapsed: 0,
      table: [], order: [], request: null, votes: new Set(), surrender: null, donkey: null, notice: 'Waiting for players to join.', round: 0, finished: 0 };
    rooms.set(code, r); join(r, name);
    s.emit('created', { code }); emit(r);
  });

  s.on('join', ({ code, name }) => {
    const r = rooms.get(String(code || '').trim().toUpperCase());
    if (!r) return s.emit('errorMsg', 'Room not found. Check the code.');
    if (r.players.length >= 20) return s.emit('errorMsg', 'This table is full (20 players).');
    const p = join(r, name);
    if (p.wait) s.emit('errorMsg', 'A match is in progress. You are seated when the next match begins.');
    emit(r);
  });

  s.on('kick', ({ playerId }) => {
    const r = roomOf(s);
    if (!r || r.hostId !== s.id || r.phase === 'playing' || playerId === s.id) return;
    r.players = r.players.filter(p => p.id !== playerId);
    io.to(playerId).emit('kicked', 'You were kicked by the host.');
    io.sockets.sockets.get(playerId)?.leave(r.code);
    emit(r);
  });

  s.on('start', () => { const r = roomOf(s); if (r && r.hostId === s.id && r.phase !== 'playing') start(r); });

  s.on('play', ({ cardId }) => { const r = roomOf(s), p = r && P(r, s.id); if (p) play(r, p, cardId, 'manual'); });

  s.on('togglePause', () => {
    const r = roomOf(s);
    if (!r || r.hostId !== s.id || r.phase !== 'playing') return;
    r.paused = !r.paused; note(r, r.paused ? 'Game paused by host.' : 'Game resumed.');
  });

  s.on('grantTime', () => {
    const r = roomOf(s);
    if (!r || r.phase !== 'playing' || r.granted || !r.eligible || !r.eligible.has(s.id)) return;
    r.granted = true; r.limit += 30; note(r, `${P(r, s.id).name} granted +30 seconds.`);
  });

  s.on('requestCards', () => {
    const r = roomOf(s);
    if (!r || r.phase !== 'playing' || r.turn !== s.id || r.table.length || r.request || r.paused || r.opening) return;
    const to = nextAlive(r, s.id); if (!to || to.id === s.id) return;
    r.request = { from: s.id, to: to.id, t: setTimeout(() => resolveRequest(r, false), 15000) };
    note(r, `${P(r, s.id).name} asks ${to.name} for all their cards (15s to answer).`);
  });

  s.on('respondRequest', ({ approve }) => { const r = roomOf(s); if (r && r.request && r.request.to === s.id) resolveRequest(r, !!approve); });

  s.on('surrender', () => {
    const r = roomOf(s);
    if (!r || r.phase !== 'playing' || r.surrender || alive(r).length !== 3 || !alive(r).some(p => p.id === s.id)) return;
    r.surrender = { by: s.id, no: new Set() };
    note(r, `${P(r, s.id).name} raises the white flag. One of the other two must approve.`);
  });

  s.on('respondSurrender', ({ approve }) => {
    const r = roomOf(s), q = r && r.surrender;
    if (!q || q.by === s.id || !alive(r).some(p => p.id === s.id)) return;
    if (approve) {
      const d = P(r, q.by);
      alive(r).filter(p => p.id !== d.id).sort((a, b) => a.hand.length - b.hand.length).forEach(p => p.rank = ++r.finished);
      d.rank = 0;
      endGame(r, d, `${d.name} surrendered and is the DONKEY!`);
      emit(r);
    } else { q.no.add(s.id); if (q.no.size >= 2) { r.surrender = null; note(r, 'Surrender declined. Play on.'); } }
  });

  // "Call off / new game": available when someone is offline or inactive for 2 rounds
  s.on('voteCallOff', () => {
    const r = roomOf(s);
    if (!r || r.phase !== 'playing' || P(r, s.id)?.wait) return;
    if (!unhealthy(r)) return s.emit('errorMsg', 'Only available when a player is offline or inactive for 2 rounds.');
    r.votes.add(s.id);
    if (r.votes.size >= needVotes(r)) callOff(r, 'Match called off by vote. Host can deal a new game.');
    else note(r, `New-game vote: ${r.votes.size}/${needVotes(r)}.`);
  });

  s.on('reorderHand', ({ cardIds }) => {
    const r = roomOf(s), p = r && P(r, s.id);
    if (!p || !Array.isArray(cardIds)) return;
    const m = new Map(p.hand.map(c => [c.id, c])), out = [];
    for (const id of cardIds) if (m.has(id)) { out.push(m.get(id)); m.delete(id); }
    p.hand = [...out, ...m.values()];
  });

  s.on('disconnect', () => {
    const r = roomOf(s), p = r && P(r, s.id);
    if (!p) return;
    p.online = false;
    if (r.phase !== 'playing') r.players = r.players.filter(x => x !== p);
    else if (r.request && (r.request.from === p.id || r.request.to === p.id)) resolveRequest(r, false);
    if (!P(r, r.hostId)?.online) { const h = r.players.find(x => x.online); if (h) r.hostId = h.id; }
    if (!r.players.some(x => x.online)) { clearInterval(r.iv); clearTimeout(r.request?.t); rooms.delete(r.code); } else emit(r);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Donkey Online running on ${port}`));
