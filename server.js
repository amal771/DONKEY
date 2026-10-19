const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = new Map();
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const PLAYER_COLORS = [
  '#E57373', '#81C784', '#64B5F6', '#FFD54F', '#BA68C8',
  '#4DB6AC', '#FF8A65', '#A1887F', '#90A4AE', '#4DD0E1',
  '#F06292', '#AED581', '#7986CB', '#DCE775', '#9575CD',
  '#4DB6AC', '#FFB74D', '#80CBC4', '#B0BEC5', '#FF80AB'
];

const rid = () => crypto.randomBytes(3).toString('hex').toUpperCase();

function deck(double) {
  let d = [];
  for (let pack = 0; pack < (double ? 2 : 1); pack++) {
    for (const s of SUITS) {
      for (let r = 0; r < RANKS.length; r++) {
        d.push({ suit: s, rank: RANKS[r], value: r + 2, pack });
      }
    }
  }
  return d;
}

function cmp(a, b) {
  return a.value - b.value || b.pack - a.pack; // pack 0 breaks ties[cite: 3, 4]
}

function pub(room, viewer) {
  return {
    code: room.code,
    hostId: room.hostId,
    gameStarterId: room.gameStarterId,
    phase: room.phase,
    paused: room.paused,
    double: room.double,
    players: room.players.map((p, idx) => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      online: p.online,
      inactiveRounds: p.inactiveRounds || 0,
      color: PLAYER_COLORS[idx % PLAYER_COLORS.length]
    })),
    turn: room.turn,
    turnStartedAt: room.turnStartedAt,
    turnDuration: room.turnDuration,
    leader: room.leader,
    leadSuit: room.leadSuit,
    table: room.table.map(x => {
      const pIdx = room.players.findIndex(p => p.id === x.playerId);
      return {
        playerId: x.playerId,
        name: room.players.find(p => p.id === x.playerId)?.name,
        card: x.card,
        color: pIdx >= 0 ? PLAYER_COLORS[pIdx % PLAYER_COLORS.length] : '#ccc'
      };
    }),
    pot: room.pot,
    notice: room.notice,
    hand: room.players.find(p => p.id === viewer)?.hand || [],
    request: room.request ? {
      from: room.request.from,
      to: room.request.to,
      count: room.request.cards.length,
      approved: room.request.approved,
      preview: room.request.preview
    } : null,
    callOffVotes: Array.from(room.callOffVotes || []),
    round: room.round,
    settings: { maxPlayers: 20 }
  };
}

function emit(room) {
  for (const p of room.players) {
    if (p.online) io.to(p.id).emit('state', pub(room, p.id));
  }
}

function note(room, msg) {
  room.notice = msg;
  emit(room);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createRoom(socket, name, double) {
  const code = rid();
  const r = {
    code,
    hostId: socket.id,
    gameStarterId: null,
    players: [{ id: socket.id, name: name.slice(0, 24), hand: [], online: true, inactiveRounds: 0, wasInactiveThisTurn: false }],
    phase: 'lobby',
    paused: false,
    double,
    turn: null,
    turnStartedAt: null,
    turnDuration: 35,
    timer: null,
    lastLeadSuit: null,
    leader: null,
    leadSuit: null,
    table: [],
    pot: [],
    notice: 'Waiting for players to join.',
    request: null,
    callOffVotes: new Set(),
    round: 0
  };
  rooms.set(code, r);
  socket.join(code);
  socket.data.room = code;
  emit(r);
  return code;
}

function roomFor(s) {
  return rooms.get(s.data.room);
}

function nextPlayer(r, id) {
  let i = r.players.findIndex(p => p.id === id);
  for (let n = 1; n <= r.players.length; n++) {
    let p = r.players[(i + n) % r.players.length];
    if (p && p.online && p.hand.length > 0) return p.id;
  }
  return id;
}

function clearRoomTimer(r) {
  if (r.timer) {
    clearInterval(r.timer);
    r.timer = null;
  }
}

function cleanInactiveAndOffline(r) {
  r.players = r.players.filter(p => p.online && (p.inactiveRounds || 0) < 3);
  if (!r.players.some(p => p.id === r.hostId) && r.players.length > 0) {
    r.hostId = r.players[0].id;
  }
}

function start(r) {
  cleanInactiveAndOffline(r);
  if (r.players.length < 2) {
    note(r, 'Need at least 2 active players to start.');
    return;
  }

  clearRoomTimer(r);
  const d = shuffle(deck(r.double));
  r.players.forEach(p => {
    p.hand = [];
    p.inactiveRounds = 0;
    p.wasInactiveThisTurn = false;
  });

  d.forEach((c, i) => r.players[i % r.players.length].hand.push(c));
  r.players.forEach(p => addCardIds(p.hand));

  r.phase = 'playing';
  r.paused = false;
  r.table = [];
  r.pot = [];
  r.request = null;
  r.callOffVotes = new Set();
  r.round = 0;
  r.lastLeadSuit = null;

  // RULE 1: Play is started strictly by the player who holds the Ace of Spades[cite: 3, 4]
  let aceHolder = r.players.find(p => p.hand.some(c => c.suit === '♠' && c.rank === 'A'));
  if (!aceHolder) aceHolder = r.players[0]; // fallback safety

  r.gameStarterId = aceHolder.id;

  if (r.players.length <= 6) {
    // 6 or fewer players: Ace of Spades is automatically played[cite: 3, 4]
    let ace = aceHolder.hand.find(c => c.suit === '♠' && c.rank === 'A');
    if (ace) {
      aceHolder.hand.splice(aceHolder.hand.indexOf(ace), 1);
      r.table = [{ playerId: aceHolder.id, card: ace }];
      r.leadSuit = '♠';
      r.leader = aceHolder.id;
      r.turn = nextPlayer(r, aceHolder.id);
      r.notice = `${aceHolder.name} held the Ace of Spades; it is auto-played to start the match!`;
    }
  } else {
    // More than 6 players: Player with Ace of Spades must choose a card to deal[cite: 3, 4]
    r.turn = aceHolder.id;
    r.leader = aceHolder.id;
    r.leadSuit = null;
    r.notice = `${aceHolder.name} holds the Ace of Spades! Please deal a card to start.`;
    io.to(aceHolder.id).emit('starterAlert');
  }

  setTurnTimer(r);
  emit(r);
}

function autoPlayInactiveCard(r, p) {
  if (!p || p.hand.length === 0) return;
  p.wasInactiveThisTurn = true;
  let cardToPlay = null;

  if (!r.leadSuit || r.table.length === 0) {
    // Inactive player starting a round:
    // If they previously led and folded/hit, alternate suit if possible
    let availableSuits = [...new Set(p.hand.map(c => c.suit))];
    let chosenSuit = availableSuits[0];
    if (r.lastLeadSuit && availableSuits.length > 1) {
      chosenSuit = availableSuits.find(s => s !== r.lastLeadSuit) || chosenSuit;
    }
    const suitCards = p.hand.filter(c => c.suit === chosenSuit).sort((a, b) => a.value - b.value);
    cardToPlay = suitCards[0] || p.hand[0];
  } else {
    // Inactive player following a trick:
    const leadSuitCards = p.hand.filter(c => c.suit === r.leadSuit).sort((a, b) => a.value - b.value);
    if (leadSuitCards.length > 0) {
      // Find current highest lead-suit card on the table
      const currentHigh = r.table
        .filter(x => x.card.suit === r.leadSuit)
        .sort((a, b) => cmp(b.card, a.card))[0];

      // Try playing a card lower than the highest card
      const lowerCards = leadSuitCards.filter(c => currentHigh && c.value < currentHigh.card.value);
      if (lowerCards.length > 0) {
        cardToPlay = lowerCards[lowerCards.length - 1]; // Closest card lower than high card
      } else {
        cardToPlay = leadSuitCards[0]; // Lowest card of the lead suit
      }
    } else {
      // No lead suit: play lowest off-suit card
      cardToPlay = [...p.hand].sort((a, b) => a.value - b.value)[0];
    }
  }

  if (cardToPlay) {
    play(r, p, cardToPlay.id, true);
  }
}

function setTurnTimer(r) {
  clearRoomTimer(r);
  if (r.phase !== 'playing' || r.paused) return;

  const currentTurnPlayer = r.players.find(p => p.id === r.turn);
  const isStartOfTrick = !r.leadSuit || r.table.length === 0;
  const wasPrevInactive = currentTurnPlayer && (currentTurnPlayer.inactiveRounds > 0 || currentTurnPlayer.wasInactiveThisTurn);

  // If it's a new round lead and player was previously inactive, trigger at 7s
  const inactivityThreshold = (isStartOfTrick && wasPrevInactive) ? 7 : 15;

  r.turnDuration = 35;
  r.turnStartedAt = Date.now();
  let elapsed = 0;
  let inactivityHandled = false;
  let beepSent = false;

  r.timer = setInterval(() => {
    if (r.paused) return;
    elapsed++;

    // Inactivity card auto-play
    if (elapsed >= inactivityThreshold && !inactivityHandled) {
      inactivityHandled = true;
      const p = r.players.find(x => x.id === r.turn);
      if (p) autoPlayInactiveCard(r, p);
      return;
    }

    // 25s warning: 3 beeps, vibration, and time request popup to next 3 players + host
    if (elapsed === 25 && !beepSent) {
      beepSent = true;
      if (currentTurnPlayer && currentTurnPlayer.online) {
        io.to(currentTurnPlayer.id).emit('turnWarning');
      }

      // Identify host + next 3 players
      const currIdx = r.players.findIndex(p => p.id === r.turn);
      const eligible = new Set();
      if (r.hostId !== r.turn) eligible.add(r.hostId);
      for (let i = 1; i <= 3; i++) {
        let pNext = r.players[(currIdx + i) % r.players.length];
        if (pNext && pNext.online && pNext.id !== r.turn) eligible.add(pNext.id);
      }

      eligible.forEach(pid => {
        io.to(pid).emit('allowTimePrompt', { forPlayer: currentTurnPlayer?.name });
      });
    }

    // Overall 35s hard timeout
    if (elapsed >= r.turnDuration) {
      const p = r.players.find(x => x.id === r.turn);
      if (p) autoPlayInactiveCard(r, p);
    }
  }, 1000);
}

function play(r, p, cardId, isAutomated = false) {
  if (r.phase !== 'playing' || r.turn !== p.id || r.paused) return false;
  let i = p.hand.findIndex(c => c.id === cardId);
  if (i < 0) return false;
  let card = p.hand[i];

  if (r.leadSuit && r.table.length > 0 && p.hand.some(c => c.suit === r.leadSuit) && card.suit !== r.leadSuit) {
    r.notice = 'You must follow the lead suit when you have one.';
    emit(r);
    return false;
  }

  p.hand.splice(i, 1);
  if (isAutomated) {
    p.wasInactiveThisTurn = true;
  }

  if (!r.leadSuit) {
    r.leadSuit = card.suit;
    r.lastLeadSuit = card.suit;
    r.leader = p.id;
    r.table = [{ playerId: p.id, card }];
    r.turn = nextPlayer(r, p.id);
    r.notice = `${p.name} led ${card.rank}${card.suit}${isAutomated ? ' (auto)' : ''}.`;
    setTurnTimer(r);
    emit(r);
    return true;
  }

  r.table.push({ playerId: p.id, card });

  if (card.suit !== r.leadSuit) {
    // Off-suit HIT![cite: 3, 4]
    r.pot.push(...r.table.map(x => x.card));
    let winner = r.table
      .filter(x => x.card.suit === r.leadSuit)
      .sort((a, b) => cmp(b.card, a.card))[0];
    let wp = r.players.find(x => x.id === winner.playerId);
    wp.hand.push(...r.pot);
    r.notice = `HIT! ${p.name} played ${card.rank}${card.suit} off-suit. ${wp.name} collects the trick.`;
    r.table = [];
    r.pot = [];
    r.leadSuit = null;
    r.leader = wp.id;
    r.turn = wp.id;
    r.round++;
    updateInactiveRounds(r);
  } else if (r.table.length >= r.players.filter(x => x.online && (x.hand.length > 0 || x.id === p.id)).length) {
    // Round won normally[cite: 3, 4]
    let winner = r.table.slice().sort((a, b) => cmp(b.card, a.card))[0];
    r.pot.push(...r.table.map(x => x.card));
    r.notice = `Round won by ${r.players.find(x => x.id === winner.playerId).name}. Cards folded.`;
    r.table = [];
    r.pot = [];
    r.leadSuit = null;
    r.leader = winner.playerId;
    r.turn = winner.playerId;
    r.round++;
    updateInactiveRounds(r);
  } else {
    r.turn = nextPlayer(r, p.id);
  }

  if (r.players.every(x => x.hand.length === 0)) {
    r.phase = 'finished';
    clearRoomTimer(r);
    r.notice += ' Match finished.';
  } else {
    setTurnTimer(r);
  }

  emit(r);
  return true;
}

function updateInactiveRounds(r) {
  r.players.forEach(p => {
    if (p.wasInactiveThisTurn) {
      p.inactiveRounds = (p.inactiveRounds || 0) + 1;
    } else {
      p.inactiveRounds = 0;
    }
    p.wasInactiveThisTurn = false;
  });
}

function addCardIds(hand) {
  hand.forEach(c => {
    if (!c.id) c.id = crypto.randomBytes(5).toString('hex');
  });
}

io.on('connection', s => {
  s.on('create', ({ name, double }) => {
    let code = createRoom(s, (name || 'Player').trim() || 'Player', !!double);
    let r = rooms.get(code);
    r.players.forEach(p => addCardIds(p.hand));
    s.emit('created', { code });
  });

  s.on('join', ({ code, name }) => {
    code = (code || '').trim().toUpperCase();
    let r = rooms.get(code);
    if (!r) return s.emit('errorMsg', 'Room not found. Check the code.');
    if (r.players.length >= 20) return s.emit('errorMsg', 'This table is full (20 players).');
    const newPlayer = {
      id: s.id,
      name: (name || 'Player').trim().slice(0, 24) || 'Player',
      hand: [],
      online: true,
      inactiveRounds: 0,
      wasInactiveThisTurn: false
    };
    if (r.phase === 'playing') {
      r.players.splice(Math.floor(Math.random() * r.players.length), 0, newPlayer);
    } else {
      r.players.push(newPlayer);
    }
    s.join(code);
    s.data.room = code;
    emit(r);
  });

  s.on('kick', ({ playerId }) => {
    let r = roomFor(s);
    if (!r || r.hostId !== s.id || r.phase === 'playing') return;
    if (playerId === r.hostId) return;
    r.players = r.players.filter(p => p.id !== playerId);
    io.to(playerId).emit('errorMsg', 'You have been kicked by the host.');
    emit(r);
  });

  s.on('start', () => {
    let r = roomFor(s);
    if (!r || r.hostId !== s.id) return note(r || {}, 'Only the host can start the game.');
    start(r);
  });

  s.on('play', ({ cardId }) => {
    let r = roomFor(s);
    if (!r) return;
    let p = r.players.find(x => x.id === s.id);
    if (p && play(r, p, cardId, false)) {
      r.players.forEach(pl => addCardIds(pl.hand));
      emit(r);
    }
  });

  s.on('togglePause', () => {
    let r = roomFor(s);
    if (!r || r.hostId !== s.id || r.phase !== 'playing') return;
    r.paused = !r.paused;
    r.notice = r.paused ? 'Game paused by host.' : 'Game resumed.';
    if (!r.paused) setTurnTimer(r);
    emit(r);
  });

  s.on('grantTime', () => {
    let r = roomFor(s);
    if (!r || r.phase !== 'playing') return;
    r.turnDuration += 30;
    r.notice = `Additional 30 seconds granted for current turn!`;
    emit(r);
  });

  s.on('voteCallOff', () => {
    let r = roomFor(s);
    if (!r || r.phase !== 'playing') return;
    if (!r.callOffVotes) r.callOffVotes = new Set();
    r.callOffVotes.add(s.id);

    const hasInactiveOrOffline = r.players.some(p => !p.online || (p.inactiveRounds || 0) >= 2);
    if (!hasInactiveOrOffline) {
      return s.emit('errorMsg', 'Call off is only available after 2 rounds of player inactivity or disconnect.');
    }

    const starter = r.players.find(p => p.id === r.gameStarterId);
    const starterCanCallOff = starter && (!starter.online || (starter.inactiveRounds || 0) >= 3);

    // If game starter clicks call off after 3 inactive rounds:
    if (s.id === r.gameStarterId && r.players.some(p => (p.inactiveRounds || 0) >= 3 || !p.online)) {
      callOffAndReset(r, 'Game called off by starter due to player inactivity.');
      return;
    }

    // Otherwise, 3 votes or majority of active players triggers a call-off
    const activePlayers = r.players.filter(p => p.online && (p.inactiveRounds || 0) < 2);
    const majority = Math.ceil(activePlayers.length / 2);
    if (r.callOffVotes.size >= 3 || r.callOffVotes.size >= majority || starterCanCallOff) {
      callOffAndReset(r, 'Match called off by player vote. Ready for a new game.');
    } else {
      note(r, `Call off vote registered (${r.callOffVotes.size} votes).`);
    }
  });

  s.on('requestCards', ({ count }) => {
    let r = roomFor(s);
    // RULE 3: Request allowed only when player starts the round
    if (!r || r.phase !== 'playing' || r.turn !== s.id || r.table.length > 0 || r.request) return;
    let from = nextPlayer(r, s.id);
    if (from === s.id) return;
    let n = Math.max(1, Math.min(20, Number(count) || 1));
    r.request = { from: s.id, to: from, cards: [], approved: false, preview: [] };
    r.request.count = n;
    r.notice = `${r.players.find(p => p.id === s.id).name} requests ${n} card(s) from next player.`;
    emit(r);
  });

  s.on('respondRequest', ({ approve, cardIds }) => {
    let r = roomFor(s);
    if (!r || !r.request || r.request.to !== s.id) return;
    let q = r.request,
      from = r.players.find(p => p.id === q.from),
      to = r.players.find(p => p.id === q.to);
    if (approve) {
      let ids = (cardIds || []).slice(0, Math.min(q.count, 3));
      if (!ids.length) return s.emit('errorMsg', 'Select at least one card to pass.');
      let selected = ids.map(id => to.hand.find(c => c.id === id)).filter(Boolean);
      if (!selected.length) return;
      selected.forEach(c => to.hand.splice(to.hand.indexOf(c), 1));
      from.hand.push(...selected);
      q.cards = selected;
      q.approved = true;
      q.preview = selected.length <= 3 ? selected : [];
      r.notice = selected.length <= 3
        ? `Cards passed: ${selected.length}. All players can see them.`
        : `${selected.length} cards passed.`;
      r.turn = from.id;
      r.leader = from.id;
      r.request = null;
      addCardIds(from.hand);
      addCardIds(to.hand);
      emit(r);
    } else {
      r.notice = 'Card request declined.';
      r.turn = from.id;
      r.request = null;
      emit(r);
    }
  });

  s.on('reorderHand', ({ cardIds }) => {
    let r = roomFor(s);
    if (!r) return;
    let p = r.players.find(x => x.id === s.id);
    if (!p || !Array.isArray(cardIds)) return;
    const cardMap = new Map(p.hand.map(c => [c.id, c]));
    const newHand = [];
    for (const id of cardIds) {
      if (cardMap.has(id)) {
        newHand.push(cardMap.get(id));
        cardMap.delete(id);
      }
    }
    for (const leftover of cardMap.values()) newHand.push(leftover);
    p.hand = newHand;
    emit(r);
  });

  s.on('disconnect', () => {
    let r = roomFor(s);
    if (!r) return;
    let p = r.players.find(p => p.id === s.id);
    if (p) {
      p.online = false;
      if (r.players.every(x => !x.online)) {
        clearRoomTimer(r);
        rooms.delete(r.code);
      } else {
        emit(r);
      }
    }
  });
});

function callOffAndReset(r, message) {
  clearRoomTimer(r);
  r.phase = 'lobby';
  r.table = [];
  r.pot = [];
  r.request = null;
  r.callOffVotes = new Set();
  cleanInactiveAndOffline(r);
  r.players.forEach(p => (p.hand = []));
  r.notice = message;
  emit(r);
}

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Donkey Online running on ${port}`));
