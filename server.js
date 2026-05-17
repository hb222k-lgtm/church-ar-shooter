const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

const WEAPONS = {
  pistol:  { damage: 25, fireRate: 500,  ammo: 12, reloadTime: 1500, spread: 15 },
  shotgun: { damage: 65, fireRate: 1200, ammo: 6,  reloadTime: 2500, spread: 25 },
  rifle:   { damage: 30, fireRate: 150,  ammo: 30, reloadTime: 2000, spread: 10 },
  sniper:  { damage: 95, fireRate: 2000, ammo: 5,  reloadTime: 3000, spread: 5  },
  smg:     { damage: 18, fireRate: 80,   ammo: 25, reloadTime: 1800, spread: 20 },
};

function genCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function getRoomPublic(room) {
  return {
    code: room.code,
    gameMode: room.gameMode,
    status: room.status,
    maxPlayers: room.maxPlayers,
    players: Object.values(room.players).map(p => ({
      id: p.id, name: p.name, character: p.character,
      team: p.team, alive: p.alive, kills: p.kills, hp: p.hp
    })),
  };
}

function assignPositions(room) {
  const players = Object.values(room.players);
  players.forEach((p, i) => {
    p.virtualAngle = (360 / players.length) * i;
    p.hp = 100;
    p.alive = true;
    p.kills = 0;
  });
}

function checkWin(room, roomCode) {
  const alive = Object.values(room.players).filter(p => p.alive);
  if (room.gameMode === 'ffa') {
    if (alive.length <= 1) {
      room.status = 'ended';
      io.to(roomCode).emit('gameEnded', {
        mode: 'ffa',
        winnerId: alive[0]?.id || null,
        stats: Object.values(room.players).map(p => ({
          id: p.id, name: p.name, kills: p.kills, alive: p.alive
        })),
      });
    }
  } else {
    const redAlive = alive.filter(p => p.team === 'red').length;
    const blueAlive = alive.filter(p => p.team === 'blue').length;
    if (redAlive === 0 || blueAlive === 0) {
      room.status = 'ended';
      io.to(roomCode).emit('gameEnded', {
        mode: 'team',
        winnerTeam: redAlive > 0 ? 'red' : 'blue',
        stats: Object.values(room.players).map(p => ({
          id: p.id, name: p.name, team: p.team, kills: p.kills, alive: p.alive
        })),
      });
    }
  }
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ playerData, gameMode, maxPlayers }) => {
    const code = genCode();
    rooms[code] = {
      code, gameMode: gameMode || 'ffa',
      maxPlayers: maxPlayers || 16,
      status: 'waiting',
      host: socket.id,
      players: {},
      teams: { red: [], blue: [] },
    };
    addToRoom(socket, code, playerData);
    socket.emit('roomCreated', { code });
  });

  socket.on('joinRoom', ({ code, playerData }) => {
    const room = rooms[code];
    if (!room) return socket.emit('roomError', '방을 찾을 수 없습니다.');
    if (room.status !== 'waiting') return socket.emit('roomError', '이미 게임이 시작되었습니다.');
    if (Object.keys(room.players).length >= room.maxPlayers)
      return socket.emit('roomError', '방이 가득 찼습니다.');
    addToRoom(socket, code, playerData);
  });

  function addToRoom(socket, code, playerData) {
    const room = rooms[code];
    socket.join(code);
    socket.roomCode = code;

    let team = null;
    if (room.gameMode === 'team') {
      team = room.teams.red.length <= room.teams.blue.length ? 'red' : 'blue';
      room.teams[team].push(socket.id);
    }

    room.players[socket.id] = {
      id: socket.id, ...playerData,
      team, hp: 100, alive: true, kills: 0, virtualAngle: 0,
    };

    socket.emit('joinedRoom', {
      playerId: socket.id,
      room: getRoomPublic(room),
      myTeam: team,
      isHost: room.host === socket.id,
    });

    socket.to(code).emit('playerJoined', { player: room.players[socket.id] });
  }

  socket.on('startGame', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.host !== socket.id) return;
    if (Object.keys(room.players).length < 2)
      return socket.emit('roomError', '최소 2명이 필요합니다.');

    room.status = 'playing';
    assignPositions(room);

    io.to(socket.roomCode).emit('gameStarted', {
      players: room.players,
      gameMode: room.gameMode,
    });
  });

  socket.on('updateHeading', ({ heading }) => {
    const room = rooms[socket.roomCode];
    if (room?.players[socket.id]) {
      room.players[socket.id].heading = heading;
    }
  });

  socket.on('shoot', ({ targetId, weapon }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'playing') return;

    const shooter = room.players[socket.id];
    const target = room.players[targetId];
    if (!shooter?.alive || !target?.alive) return;
    if (room.gameMode === 'team' && shooter.team === target.team) return;

    const w = WEAPONS[weapon] || WEAPONS.pistol;
    const variance = Math.floor(Math.random() * 11) - 5;
    const damage = Math.max(1, w.damage + variance);

    target.hp = Math.max(0, target.hp - damage);

    io.to(targetId).emit('gotHit', { damage, hp: target.hp, shooterId: socket.id });
    io.to(socket.roomCode).emit('shotFired', {
      shooterId: socket.id, targetId, damage, weapon,
    });

    if (target.hp <= 0) {
      target.alive = false;
      shooter.kills++;
      io.to(socket.roomCode).emit('playerKilled', {
        deadId: targetId,
        killerId: socket.id,
        killerName: shooter.name,
        kills: shooter.kills,
      });
      checkWin(room, socket.roomCode);
    }
  });

  socket.on('chatMessage', ({ message }) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    io.to(socket.roomCode).emit('chatMessage', {
      name: player.name, message, team: player.team,
    });
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;

    delete room.players[socket.id];
    ['red', 'blue'].forEach(t => {
      room.teams[t] = room.teams[t].filter(id => id !== socket.id);
    });

    socket.to(socket.roomCode).emit('playerLeft', { playerId: socket.id });

    if (Object.keys(room.players).length === 0) {
      delete rooms[socket.roomCode];
    } else if (room.host === socket.id) {
      room.host = Object.keys(room.players)[0];
      io.to(socket.roomCode).emit('newHost', { hostId: room.host });
    }

    if (room.status === 'playing') checkWin(room, socket.roomCode);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`✅ 서버 실행 중: http://0.0.0.0:${PORT}`));
