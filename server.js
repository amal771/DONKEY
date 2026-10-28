/**
 * Party Blaster - Multi-Game Server
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');

const RummyGame = require('./rummyEngine');
const DonkeyGame = require('./donkeyEngine');

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/qr/:code', async (req, res) => {
  try {
    const url = `${req.protocol}://${req.get('host')}/?room=${encodeURIComponent(req.params.code.slice(0, 8))}`;
    res.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', margin: 1 }));
  } catch (e) {
    res.sendStatus(500);
  }
});

const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function broadcastRoomState(room) {
  if (!room.instance) {
    io.to(room.code).emit('lobbyUpdate', {
      code: room.code,
      hostId: room.hostId,
      gameType: room.gameType,
      options: room.options,
      players: room.players
    });
    return;
  }

  for (const p of room.players) {
    io.to(p.id).emit('gameState', room.instance.getStateFor(p.id));
  }
}

io.on('connection', socket => {
  socket.on('createRoom', ({ name, gameType, options }) => {
    const trimmed = String(name || '').trim().slice(0, 24);
    if (!trimmed) return socket.emit('errorMsg', 'Please enter your name.');

    const code = generateCode();
    const gType = (gameType === 'donkey' || gameType === 'rummy') ? gameType : 'rummy';

    const room = {
      code,
      hostId: socket.id,
      gameType: gType,
      options: options || {},
      players: [{ id: socket.id, name: trimmed }],
      instance: null
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.room = code;

    socket.emit('roomCreated', { code, gameType: room.gameType, options: room.options });
    broadcastRoomState(room);
  });

  socket.on('joinRoom', ({ name, code }) => {
    const trimmedName = String(name || '').trim().slice(0, 24);
    const trimmedCode = String(code || '').trim().toUpperCase();

    if (!trimmedName) return socket.emit('errorMsg', 'Please enter your name.');
    const room = rooms.get(trimmedCode);
    if (!room) return socket.emit('errorMsg', 'Room not found. Check code.');

    room.players.push({ id: socket.id, name: trimmedName });
    socket.join(room.code);
    socket.data.room = room.code;

    socket.emit('joinedRoom', { code: room.code, gameType: room.gameType, options: room.options });
    broadcastRoomState(room);
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.hostId !== socket.id) return;

    if (room.gameType === 'rummy') {
      room.instance = new RummyGame(room, io, room.options);
    } else if (room.gameType === 'donkey') {
      room.instance = new DonkeyGame(room, io, room.options);
    }

    broadcastRoomState(room);
  });

  // Rummy Socket Events
  socket.on('rummyDraw', ({ source }) => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.instance || room.gameType !== 'rummy') return;
    const res = room.instance.drawCard(socket.id, source);
    if (!res.ok) socket.emit('errorMsg', res.msg);
    broadcastRoomState(room);
  });

  socket.on('rummyDiscard', ({ cardId }) => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.instance || room.gameType !== 'rummy') return;
    const res = room.instance.discardCard(socket.id, cardId);
    if (!res.ok) socket.emit('errorMsg', res.msg);
    broadcastRoomState(room);
  });

  socket.on('rummyDrop', () => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.instance || room.gameType !== 'rummy') return;
    const res = room.instance.dropGame(socket.id);
    if (!res.ok) {
      socket.emit('errorMsg', res.msg);
    } else {
      io.to(room.code).emit('dropNotice', { name: res.playerName, score: res.dropScore });
    }
    broadcastRoomState(room);
  });

  socket.on('rummyRevealPure', ({ groupCardIds }) => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.instance || room.gameType !== 'rummy') return;
    const res = room.instance.revealPureSequence(socket.id, groupCardIds);
    if (!res.ok) socket.emit('errorMsg', res.msg);
    broadcastRoomState(room);
  });

  socket.on('rummyDeclare', ({ groups, discardCardId }) => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.instance || room.gameType !== 'rummy') return;
    const res = room.instance.declareShow(socket.id, groups, discardCardId);
    if (!res.ok) {
      if (res.invalidDeclaration) {
        socket.emit('invalidDeclarationPrompt', { message: res.msg });
      } else {
        socket.emit('errorMsg', res.msg);
      }
    }
    broadcastRoomState(room);
  });

  // Donkey Socket Events
  socket.on('donkeyPlay', ({ cardId, whip }) => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.instance || room.gameType !== 'donkey') return;
    const res = room.instance.playCard(socket.id, cardId, whip);
    if (!res.ok) socket.emit('errorMsg', res.msg);
    broadcastRoomState(room);
  });

  socket.on('donkeyRequestCards', () => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.instance || room.gameType !== 'donkey') return;
    const res = room.instance.requestCards(socket.id);
    if (!res.ok) socket.emit('errorMsg', res.msg);
  });

  socket.on('donkeyRespondRequest', ({ approve }) => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.instance || room.gameType !== 'donkey') return;
    room.instance.resolveRequest(approve);
  });

  socket.on('donkeySurrender', () => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.instance || room.gameType !== 'donkey') return;
    const res = room.instance.surrender(socket.id);
    if (!res.ok) socket.emit('errorMsg', res.msg);
  });

  socket.on('donkeyRespondSurrender', ({ approve }) => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.instance || room.gameType !== 'donkey') return;
    room.instance.respondSurrender(socket.id, approve);
  });

  const handleDisconnect = () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;

    if (room.instance && typeof room.instance.cleanup === 'function') {
      // If room empties cleanup timers
    }

    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) {
      if (room.instance && typeof room.instance.cleanup === 'function') {
        room.instance.cleanup();
      }
      rooms.delete(room.code);
    } else {
      if (room.hostId === socket.id) {
        room.hostId = room.players[0].id;
      }
      broadcastRoomState(room);
    }
  };

  socket.on('disconnect', handleDisconnect);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Party Blaster server online on port ${PORT}`);
});
