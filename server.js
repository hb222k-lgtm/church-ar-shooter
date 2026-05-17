process.on('uncaughtException', (err) => { console.error('UNCAUGHT:', err); process.exit(1); });

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

const WEAPONS = {
  pistol:  { damage:25, fireRate:500,  ammo:12, spread:15 },
  shotgun: { damage:65, fireRate:1200, ammo:6,  spread:25 },
  rifle:   { damage:30, fireRate:150,  ammo:30, spread:10 },
  sniper:  { damage:95, fireRate:2000, ammo:5,  spread:5  },
  smg:     { damage:18, fireRate:80,   ammo:25, spread:20 },
};

const BOT_DIFF = {
  easy:   { shootInterval:3200, accuracy:0.45, hp:70,  damage:12, name:'초보봇' },
  normal: { shootInterval:2000, accuracy:0.65, hp:100, damage:22, name:'일반봇' },
  hard:   { shootInterval:1100, accuracy:0.85, hp:130, damage:35, name:'강력봇' },
};

const BOT_NAMES = ['철갑','화염','냉기','번개','폭풍','어둠','빛의','강철','독침','용사'];
const BOT_WEAPONS = ['pistol','rifle','shotgun','smg','sniper'];
const BOT_CHARS = [
  { skinColor:'#F1A283', hairColor:'#1C1C1C', shirtColor:'#374151', pantsColor:'#111827', hairStyle:'짧은머리', accessory:'없음' },
  { skinColor:'#C77A52', hairColor:'#E74C3C', shirtColor:'#7C3AED', pantsColor:'#1E3A5F', hairStyle:'모히칸',   accessory:'없음' },
  { skinColor:'#8D5524', hairColor:'#3D2B1F', shirtColor:'#065F46', pantsColor:'#1C1C1C', hairStyle:'대머리',   accessory:'안경' },
  { skinColor:'#FDBCB4', hairColor:'#8E44AD', shirtColor:'#EF4444', pantsColor:'#374151', hairStyle:'곱슬머리', accessory:'없음' },
  { skinColor:'#4B2E12', hairColor:'#F4D03F', shirtColor:'#1E3A5F', pantsColor:'#111827', hairStyle:'짧은머리', accessory:'모자' },
];

function genCode() { return Math.random().toString(36).substr(2,6).toUpperCase(); }

function getRoomPublic(room) {
  return {
    code: room.code, gameMode: room.gameMode, status: room.status,
    maxPlayers: room.maxPlayers,
    players: Object.values(room.players).map(p => ({
      id:p.id, name:p.name, character:p.character, team:p.team,
      alive:p.alive, kills:p.kills, hp:p.hp, isBot:p.isBot||false
    })),
  };
}

function assignPositions(room) {
  const all = Object.values(room.players);
  all.forEach((p, i) => {
    p.virtualAngle = (360 / all.length) * i;
    p.hp    = p.isBot ? (p.maxHp || 100) : 100;
    p.alive = true;
    if (!p.isBot) p.kills = 0;
  });
}

/* ── Bot creation ── */
function createBot(roomCode, difficulty, wave) {
  const room = rooms[roomCode];
  if (!room) return null;
  const diff  = BOT_DIFF[difficulty] || BOT_DIFF.normal;
  const botId = 'bot_' + Math.random().toString(36).substr(2,8);
  const prefix = BOT_NAMES[Math.floor(Math.random()*BOT_NAMES.length)];
  const char  = BOT_CHARS[Math.floor(Math.random()*BOT_CHARS.length)];
  const wpn   = BOT_WEAPONS[Math.floor(Math.random()*BOT_WEAPONS.length)];
  const hp    = Math.round(diff.hp * (1 + (wave-1)*0.1));

  room.players[botId] = {
    id: botId, name: prefix + ' ' + diff.name,
    isBot: true, character: { ...char, weapon: wpn, name: prefix },
    team: null, hp, maxHp: hp, alive: true, kills: 0, virtualAngle: 0,
  };
  return botId;
}

function startBotAI(roomCode, difficulty) {
  const room = rooms[roomCode];
  if (!room) return;
  const diff = BOT_DIFF[difficulty] || BOT_DIFF.normal;

  room.botInterval = setInterval(() => {
    if (!rooms[roomCode] || room.status !== 'playing') { clearInterval(room.botInterval); return; }
    const bots    = Object.values(room.players).filter(p => p.isBot  && p.alive);
    const humans  = Object.values(room.players).filter(p => !p.isBot && p.alive);
    if (!bots.length || !humans.length) return;

    bots.forEach(bot => {
      if (Math.random() > diff.accuracy) return;         // miss chance
      const target = humans[Math.floor(Math.random()*humans.length)];
      const dmg    = Math.max(1, diff.damage + Math.floor(Math.random()*8)-4);
      target.hp    = Math.max(0, target.hp - dmg);
      io.to(target.id).emit('gotHit', { damage:dmg, hp:target.hp, shooterId:bot.id });
      io.to(roomCode).emit('shotFired', { shooterId:bot.id, targetId:target.id, damage:dmg, weapon:bot.character.weapon });
      if (target.hp <= 0) {
        target.alive = false; bot.kills++;
        io.to(roomCode).emit('playerKilled', { deadId:target.id, killerId:bot.id, killerName:bot.name, kills:bot.kills });
        checkWin(room, roomCode);
      }
    });
  }, diff.shootInterval);
}

/* ── Win check ── */
function checkWin(room, roomCode) {
  if (room.status !== 'playing') return;
  const aliveBots   = Object.values(room.players).filter(p => p.isBot  && p.alive);
  const aliveHumans = Object.values(room.players).filter(p => !p.isBot && p.alive);

  if (room.gameMode === 'single') {
    if (aliveHumans.length === 0) {
      // 패배
      room.status = 'ended';
      clearInterval(room.botInterval);
      io.to(roomCode).emit('gameEnded', {
        mode:'single', victory:false, wave:room.wave,
        stats: Object.values(room.players).filter(p=>!p.isBot).map(p=>({ id:p.id, name:p.name, kills:p.kills })),
      });
    } else if (aliveBots.length === 0) {
      // 웨이브 클리어!
      const totalWaves = room.totalWaves || 5;
      if (room.wave >= totalWaves) {
        // 최종 승리
        room.status = 'ended';
        clearInterval(room.botInterval);
        io.to(roomCode).emit('gameEnded', {
          mode:'single', victory:true, wave:room.wave,
          stats: Object.values(room.players).filter(p=>!p.isBot).map(p=>({ id:p.id, name:p.name, kills:p.kills })),
        });
      } else {
        room.wave++;
        io.to(roomCode).emit('waveCleared', { wave:room.wave-1, nextWave:room.wave, total:totalWaves });
        // 휴식 후 다음 웨이브 시작
        setTimeout(() => {
          if (!rooms[roomCode] || room.status !== 'playing') return;
          clearInterval(room.botInterval);
          // 죽은 봇 제거, 새 봇 스폰
          Object.keys(room.players).forEach(id => { if (room.players[id].isBot) delete room.players[id]; });
          const numBots = Math.min(2 + room.wave, 8);
          for (let i = 0; i < numBots; i++) createBot(roomCode, room.difficulty, room.wave);
          // 플레이어 HP 부분 회복
          Object.values(room.players).filter(p=>!p.isBot&&p.alive).forEach(p => {
            p.hp = Math.min(100, p.hp + 30);
            io.to(p.id).emit('hpRecovered', { hp:p.hp });
          });
          assignPositions(room);
          io.to(roomCode).emit('waveStarted', { wave:room.wave, players:room.players });
          startBotAI(roomCode, room.difficulty);
        }, 4500);
      }
    }
  } else if (room.gameMode === 'ffa') {
    const alive = Object.values(room.players).filter(p => p.alive);
    if (alive.length <= 1) {
      room.status = 'ended';
      io.to(roomCode).emit('gameEnded', {
        mode:'ffa', winnerId:alive[0]?.id||null,
        stats: Object.values(room.players).map(p=>({ id:p.id, name:p.name, kills:p.kills, alive:p.alive })),
      });
    }
  } else if (room.gameMode === 'team') {
    const alive = Object.values(room.players).filter(p => p.alive);
    const red   = alive.filter(p=>p.team==='red').length;
    const blue  = alive.filter(p=>p.team==='blue').length;
    if (red===0||blue===0) {
      room.status = 'ended';
      io.to(roomCode).emit('gameEnded', {
        mode:'team', winnerTeam:red>0?'red':'blue',
        stats: Object.values(room.players).map(p=>({ id:p.id, name:p.name, team:p.team, kills:p.kills, alive:p.alive })),
      });
    }
  }
}

/* ── Socket handlers ── */
io.on('connection', (socket) => {

  // 싱글플레이 시작
  socket.on('startSingle', ({ playerData, difficulty }) => {
    const code = genCode();
    const totalWaves = difficulty === 'easy' ? 5 : difficulty === 'normal' ? 7 : 10;
    rooms[code] = {
      code, gameMode:'single', status:'waiting',
      maxPlayers:1, host:socket.id,
      players:{}, teams:{red:[],blue:[]},
      difficulty, wave:1, totalWaves,
    };
    socket.join(code); socket.roomCode = code;
    const numBots = difficulty === 'easy' ? 3 : difficulty === 'normal' ? 4 : 5;
    rooms[code].players[socket.id] = {
      id:socket.id, ...playerData,
      team:null, hp:100, alive:true, kills:0, virtualAngle:0,
    };
    for (let i=0; i<numBots; i++) createBot(code, difficulty, 1);
    rooms[code].status = 'playing';
    assignPositions(rooms[code]);
    socket.emit('joinedRoom', { playerId:socket.id, room:getRoomPublic(rooms[code]), myTeam:null, isHost:true });
    socket.emit('gameStarted', { players:rooms[code].players, gameMode:'single',
      wave:1, totalWaves, difficulty });
    setTimeout(() => startBotAI(code, difficulty), 2000);
  });

  // 멀티 방 만들기
  socket.on('createRoom', ({ playerData, gameMode, maxPlayers }) => {
    const code = genCode();
    rooms[code] = { code, gameMode:gameMode||'ffa', maxPlayers:maxPlayers||16,
      status:'waiting', host:socket.id, players:{}, teams:{red:[],blue:[]} };
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
    socket.join(code); socket.roomCode = code;
    let team = null;
    if (room.gameMode === 'team') {
      team = room.teams.red.length <= room.teams.blue.length ? 'red' : 'blue';
      room.teams[team].push(socket.id);
    }
    room.players[socket.id] = { id:socket.id, ...playerData, team, hp:100, alive:true, kills:0, virtualAngle:0 };
    socket.emit('joinedRoom', { playerId:socket.id, room:getRoomPublic(room), myTeam:team, isHost:room.host===socket.id });
    socket.to(code).emit('playerJoined', { player:room.players[socket.id] });
  }

  socket.on('startGame', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.host !== socket.id) return;
    if (Object.keys(room.players).length < 2) return socket.emit('roomError', '최소 2명이 필요합니다.');
    room.status = 'playing';
    assignPositions(room);
    io.to(socket.roomCode).emit('gameStarted', { players:room.players, gameMode:room.gameMode });
  });

  socket.on('updateHeading', ({ heading }) => {
    const room = rooms[socket.roomCode];
    if (room?.players[socket.id]) room.players[socket.id].heading = heading;
  });

  socket.on('shoot', ({ targetId, weapon }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'playing') return;
    const shooter = room.players[socket.id];
    const target  = room.players[targetId];
    if (!shooter?.alive || !target?.alive) return;
    if (room.gameMode === 'team' && shooter.team === target.team) return;

    const w   = WEAPONS[weapon] || WEAPONS.pistol;
    const dmg = Math.max(1, w.damage + Math.floor(Math.random()*11)-5);
    target.hp = Math.max(0, target.hp - dmg);

    if (!target.isBot) io.to(targetId).emit('gotHit', { damage:dmg, hp:target.hp, shooterId:socket.id });
    io.to(socket.roomCode).emit('shotFired', { shooterId:socket.id, targetId, damage:dmg, weapon });

    if (target.hp <= 0) {
      target.alive = false; shooter.kills++;
      io.to(socket.roomCode).emit('playerKilled', {
        deadId:targetId, killerId:socket.id, killerName:shooter.name, kills:shooter.kills
      });
      checkWin(room, socket.roomCode);
    }
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    if (room.botInterval) clearInterval(room.botInterval);
    delete room.players[socket.id];
    ['red','blue'].forEach(t => { room.teams[t] = room.teams[t]?.filter(id=>id!==socket.id)||[]; });
    socket.to(socket.roomCode).emit('playerLeft', { playerId:socket.id });
    if (Object.keys(room.players).filter(id=>!room.players[id]?.isBot).length === 0) {
      delete rooms[socket.roomCode];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`✅ 서버 실행 중: http://0.0.0.0:${PORT}`));
