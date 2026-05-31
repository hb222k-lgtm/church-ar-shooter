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

/* ─── 2D World Constants ─── */
const GAME_W       = 1800;
const GAME_H       = 1200;
const PLAYER_SPEED = 240;   // px/s  (faster movement)
const PLAYER_R     = 18;
const BULLET_SPEED = 720;   // px/s
const BULLET_R     = 6;     // slightly bigger hit-box
const TICK_MS      = 33;    // ~30 Hz
const PLAYER_MAX_HP = 150;  // more survivability

/* ─── Map ─── */
const MAP_WALLS = [
  // Boundary
  { x:0,         y:0,         w:GAME_W, h:20 },
  { x:0,         y:GAME_H-20, w:GAME_W, h:20 },
  { x:0,         y:0,         w:20,     h:GAME_H },
  { x:GAME_W-20, y:0,         w:20,     h:GAME_H },

  // Top-left quadrant
  { x:200,  y:120, w:20,  h:240 },
  { x:380,  y:260, w:240, h:20  },
  { x:520,  y:120, w:20,  h:160 },
  { x:140,  y:480, w:200, h:20  },
  { x:380,  y:440, w:20,  h:200 },

  // Top-right quadrant
  { x:1080, y:120, w:20,  h:280 },
  { x:1240, y:260, w:240, h:20  },
  { x:1400, y:120, w:20,  h:160 },
  { x:1560, y:380, w:200, h:20  },
  { x:1240, y:440, w:20,  h:200 },

  // Center pillars / arena cover
  { x:780,  y:380, w:240, h:20  },
  { x:780,  y:380, w:20,  h:140 },
  { x:1000, y:500, w:20,  h:140 },
  { x:780,  y:620, w:240, h:20  },
  { x:880,  y:480, w:40,  h:40  }, // center pillar

  // Bottom-left quadrant
  { x:200,  y:720, w:20,  h:240 },
  { x:380,  y:840, w:240, h:20  },
  { x:520,  y:880, w:20,  h:160 },
  { x:140,  y:1040,w:200, h:20  },

  // Bottom-right quadrant
  { x:1080, y:780, w:20,  h:280 },
  { x:1240, y:840, w:240, h:20  },
  { x:1400, y:880, w:20,  h:160 },
  { x:1560, y:1040,w:200, h:20  },

  // Diagonal corridor walls
  { x:680,  y:120, w:20,  h:160 },
  { x:1120, y:920, w:20,  h:160 },
];

const SPAWN_POSITIONS = [
  { x:80,         y:80         },
  { x:GAME_W-80,  y:80         },
  { x:80,         y:GAME_H-80  },
  { x:GAME_W-80,  y:GAME_H-80  },
  { x:GAME_W/2,   y:60         },
  { x:60,         y:GAME_H/2   },
  { x:GAME_W-60,  y:GAME_H/2   },
  { x:GAME_W/2,   y:GAME_H-60  },
  { x:300,        y:380        },
  { x:GAME_W-300, y:380        },
  { x:300,        y:GAME_H-380 },
  { x:GAME_W-300, y:GAME_H-380 },
  { x:GAME_W/2,   y:GAME_H/2-120 },
  { x:GAME_W/2,   y:GAME_H/2+120 },
];

/* ─── Weapons ─── */
const WEAPONS = {
  pistol:  { damage:22, fireRate:320,  ammo:15, spread:0.06, pellets:1 },
  shotgun: { damage:12, fireRate:900,  ammo:8,  spread:0.28, pellets:8 },
  rifle:   { damage:24, fireRate:110,  ammo:35, spread:0.04, pellets:1 },
  sniper:  { damage:80, fireRate:1400, ammo:6,  spread:0.01, pellets:1 },
  smg:     { damage:14, fireRate:65,   ammo:32, spread:0.14, pellets:1 },
};

/* ─── Bots ─── */
const BOT_DIFF = {
  easy:   { shootInterval:4500, accuracy:0.25, hp:60,  speed:0.40, dmgMul:0.35, name:'초보봇' },
  normal: { shootInterval:3000, accuracy:0.40, hp:90,  speed:0.55, dmgMul:0.50, name:'일반봇' },
  hard:   { shootInterval:1800, accuracy:0.60, hp:120, speed:0.70, dmgMul:0.70, name:'강력봇' },
};

const BOT_NAMES   = ['철갑','화염','냉기','번개','폭풍','어둠','빛의','강철','독침','용사'];
const BOT_WEAPONS = ['pistol','rifle','shotgun','smg','sniper'];
const BOT_CHARS   = [
  { skinColor:'#F1A283', hairColor:'#1C1C1C', shirtColor:'#374151', pantsColor:'#111827', hairStyle:'짧은머리', accessory:'없음' },
  { skinColor:'#C77A52', hairColor:'#E74C3C', shirtColor:'#7C3AED', pantsColor:'#1E3A5F', hairStyle:'모히칸',   accessory:'없음' },
  { skinColor:'#8D5524', hairColor:'#3D2B1F', shirtColor:'#065F46', pantsColor:'#1C1C1C', hairStyle:'대머리',   accessory:'안경' },
  { skinColor:'#FDBCB4', hairColor:'#8E44AD', shirtColor:'#EF4444', pantsColor:'#374151', hairStyle:'곱슬머리', accessory:'없음' },
  { skinColor:'#4B2E12', hairColor:'#F4D03F', shirtColor:'#1E3A5F', pantsColor:'#111827', hairStyle:'짧은머리', accessory:'모자' },
];

/* ─── Utilities ─── */
function genCode() { return Math.random().toString(36).substr(2,6).toUpperCase(); }

function collidesWithWalls(x, y, r) {
  for (const w of MAP_WALLS) {
    if (x+r > w.x && x-r < w.x+w.w && y+r > w.y && y-r < w.y+w.h) return true;
  }
  return false;
}

function getRoomPublic(room) {
  return {
    code: room.code, gameMode: room.gameMode, status: room.status,
    maxPlayers: room.maxPlayers,
    players: Object.values(room.players).map(p => ({
      id:p.id, name:p.name, character:p.character,
      team:p.team, alive:p.alive, kills:p.kills, hp:p.hp, isBot:p.isBot||false
    })),
  };
}

function assignPositions(room) {
  const all = Object.values(room.players);
  all.forEach((p, i) => {
    const sp = SPAWN_POSITIONS[i % SPAWN_POSITIONS.length];
    p.x     = sp.x + (Math.random()*30 - 15);
    p.y     = sp.y + (Math.random()*30 - 15);
    p.vx    = 0; p.vy = 0; p.angle = 0;
    p.hp    = p.isBot ? (p.maxHp||100) : PLAYER_MAX_HP;
    p.maxHp = p.isBot ? (p.maxHp||100) : PLAYER_MAX_HP;
    p.alive = true;
    if (!p.isBot) p.kills = 0;
  });
}

/* ─── Bot creation ─── */
function createBot(roomCode, difficulty, wave) {
  const room = rooms[roomCode];
  if (!room) return null;
  const diff  = BOT_DIFF[difficulty] || BOT_DIFF.normal;
  const botId = 'bot_' + Math.random().toString(36).substr(2,8);
  const prefix= BOT_NAMES[Math.floor(Math.random()*BOT_NAMES.length)];
  const char  = BOT_CHARS[Math.floor(Math.random()*BOT_CHARS.length)];
  const wpn   = BOT_WEAPONS[Math.floor(Math.random()*BOT_WEAPONS.length)];
  const hp    = Math.round(diff.hp * (1 + (wave-1)*0.1));

  room.players[botId] = {
    id:botId, name:`${prefix} ${diff.name}`, isBot:true,
    character:{ ...char, weapon:wpn, name:prefix },
    team:null, hp, maxHp:hp, alive:true, kills:0,
    x:0, y:0, vx:0, vy:0, angle:0,
    botSpeed:diff.speed, botAccuracy:diff.accuracy,
    botShootInterval:diff.shootInterval, botDmgMul:diff.dmgMul||0.5,
    nextShoot: Date.now() + Math.random()*diff.shootInterval*2,
  };
  return botId;
}

/* ─── Game Loop ─── */
function startGameLoop(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  if (room.gameLoop) clearInterval(room.gameLoop);
  room.bullets = [];
  let lastTick = Date.now();

  room.gameLoop = setInterval(() => {
    if (!rooms[roomCode] || room.status !== 'playing') {
      clearInterval(room.gameLoop); return;
    }
    const now = Date.now();
    const dt  = Math.min((now - lastTick) / 1000, 0.1);
    lastTick  = now;

    const players = Object.values(room.players);
    const humans  = players.filter(p => !p.isBot && p.alive);

    /* ── Human movement ── */
    players.forEach(p => {
      if (p.isBot || !p.alive) return;
      if (p.vx || p.vy) {
        const nx = p.x + p.vx * PLAYER_SPEED * dt;
        const ny = p.y + p.vy * PLAYER_SPEED * dt;
        if (!collidesWithWalls(nx, p.y, PLAYER_R)) p.x = nx;
        if (!collidesWithWalls(p.x, ny, PLAYER_R)) p.y = ny;
        p.x = Math.max(PLAYER_R+22, Math.min(GAME_W-PLAYER_R-22, p.x));
        p.y = Math.max(PLAYER_R+22, Math.min(GAME_H-PLAYER_R-22, p.y));
      }
    });

    /* ── Bot AI ── */
    players.filter(p => p.isBot && p.alive).forEach(bot => {
      if (!humans.length) return;

      // Find nearest human
      let nearest = null, nearDist = Infinity;
      humans.forEach(h => {
        const d = Math.hypot(h.x-bot.x, h.y-bot.y);
        if (d < nearDist) { nearDist=d; nearest=h; }
      });
      if (!nearest) return;

      const dx   = nearest.x - bot.x;
      const dy   = nearest.y - bot.y;
      const dist = Math.hypot(dx, dy);
      bot.angle  = Math.atan2(dy, dx);

      const spd = PLAYER_SPEED * (bot.botSpeed||0.55);
      if (dist > 220) {
        // Advance
        const nx = bot.x + (dx/dist)*spd*dt;
        const ny = bot.y + (dy/dist)*spd*dt;
        if (!collidesWithWalls(nx, bot.y, PLAYER_R)) bot.x = nx;
        if (!collidesWithWalls(bot.x, ny, PLAYER_R)) bot.y = ny;
      } else if (dist < 110) {
        // Retreat
        const nx = bot.x - (dx/dist)*spd*0.5*dt;
        const ny = bot.y - (dy/dist)*spd*0.5*dt;
        if (!collidesWithWalls(nx, bot.y, PLAYER_R)) bot.x = nx;
        if (!collidesWithWalls(bot.x, ny, PLAYER_R)) bot.y = ny;
      }

      // Shoot
      if (now >= bot.nextShoot && dist < 520) {
        bot.nextShoot = now + bot.botShootInterval + Math.random()*800;
        if (Math.random() < (bot.botAccuracy||0.4)) {
          const w   = WEAPONS[bot.character.weapon] || WEAPONS.pistol;
          // Bots have wider spread (less accurate) and reduced damage
          const pa  = bot.angle + (Math.random()-0.5)*Math.max(w.spread, 0.18)*3;
          const dmg = Math.max(1, Math.round((w.damage * (bot.botDmgMul||0.5)) + Math.floor(Math.random()*4)-2));
          room.bullets.push({
            id: 'b_'+Math.random().toString(36).substr(2,6),
            shooterId: bot.id,
            x: bot.x + Math.cos(bot.angle)*(PLAYER_R+6),
            y: bot.y + Math.sin(bot.angle)*(PLAYER_R+6),
            vx: Math.cos(pa)*BULLET_SPEED,
            vy: Math.sin(pa)*BULLET_SPEED,
            damage:dmg, weapon:bot.character.weapon, life:2.0,
          });
        }
      }
    });

    /* ── Bullet physics + collision ── */
    room.bullets = room.bullets.filter(b => {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) return false;
      if (collidesWithWalls(b.x, b.y, BULLET_R)) return false;

      for (const p of players) {
        if (p.id === b.shooterId || !p.alive) continue;
        if (room.gameMode==='team' && room.players[b.shooterId]?.team === p.team && p.team) continue;
        if (Math.hypot(p.x-b.x, p.y-b.y) < PLAYER_R+BULLET_R) {
          p.hp = Math.max(0, p.hp - b.damage);
          if (!p.isBot) io.to(p.id).emit('gotHit', { damage:b.damage, hp:p.hp, shooterId:b.shooterId });
          io.to(roomCode).emit('bulletHit', { bulletId:b.id, targetId:p.id, damage:b.damage, x:b.x, y:b.y });
          if (p.hp <= 0) {
            p.alive = false;
            const shooter = room.players[b.shooterId];
            if (shooter) shooter.kills++;
            io.to(roomCode).emit('playerKilled', {
              deadId:p.id, killerId:b.shooterId,
              killerName:shooter?.name||'?', kills:shooter?.kills||0,
            });
            checkWin(room, roomCode);
          }
          return false;
        }
      }
      return true;
    });

    /* ── Broadcast state ── */
    io.to(roomCode).emit('gameState', {
      players: players.map(p => ({
        id:p.id, x:p.x, y:p.y, angle:p.angle||0,
        hp:p.hp, maxHp:p.maxHp||(p.isBot?100:PLAYER_MAX_HP),
        alive:p.alive, kills:p.kills,
        name:p.name, team:p.team, isBot:p.isBot,
        character:p.character,
      })),
      bullets: room.bullets.map(b => ({
        id:b.id, x:b.x, y:b.y, weapon:b.weapon, shooterId:b.shooterId,
      })),
    });
  }, TICK_MS);
}

/* ─── Win Check ─── */
function checkWin(room, roomCode) {
  if (room.status !== 'playing') return;
  const aliveBots   = Object.values(room.players).filter(p => p.isBot  && p.alive);
  const aliveHumans = Object.values(room.players).filter(p => !p.isBot && p.alive);

  if (room.gameMode === 'single') {
    if (aliveHumans.length === 0) {
      room.status = 'ended';
      if (room.gameLoop) clearInterval(room.gameLoop);
      io.to(roomCode).emit('gameEnded', {
        mode:'single', victory:false, wave:room.wave,
        stats:Object.values(room.players).filter(p=>!p.isBot).map(p=>({id:p.id,name:p.name,kills:p.kills})),
      });
    } else if (aliveBots.length === 0) {
      const total = room.totalWaves||5;
      if (room.wave >= total) {
        room.status = 'ended';
        if (room.gameLoop) clearInterval(room.gameLoop);
        io.to(roomCode).emit('gameEnded', {
          mode:'single', victory:true, wave:room.wave,
          stats:Object.values(room.players).filter(p=>!p.isBot).map(p=>({id:p.id,name:p.name,kills:p.kills})),
        });
      } else {
        room.wave++;
        io.to(roomCode).emit('waveCleared', { wave:room.wave-1, nextWave:room.wave, total });
        setTimeout(() => {
          if (!rooms[roomCode] || room.status !== 'playing') return;
          Object.keys(room.players).forEach(id => { if (room.players[id].isBot) delete room.players[id]; });
          const numBots = Math.min(2+room.wave, 8);
          for (let i=0; i<numBots; i++) createBot(roomCode, room.difficulty, room.wave);
          Object.values(room.players).filter(p=>!p.isBot&&p.alive).forEach(p=>{
            p.hp = Math.min(PLAYER_MAX_HP, p.hp+50);
            io.to(p.id).emit('hpRecovered', { hp:p.hp });
          });
          assignPositions(rooms[roomCode]);
          io.to(roomCode).emit('waveStarted', { wave:room.wave, players:rooms[roomCode].players });
        }, 4500);
      }
    }
  } else if (room.gameMode === 'ffa') {
    const alive = Object.values(room.players).filter(p=>p.alive);
    if (alive.length <= 1) {
      room.status = 'ended';
      if (room.gameLoop) clearInterval(room.gameLoop);
      io.to(roomCode).emit('gameEnded', {
        mode:'ffa', winnerId:alive[0]?.id||null,
        stats:Object.values(room.players).map(p=>({id:p.id,name:p.name,kills:p.kills,alive:p.alive})),
      });
    }
  } else if (room.gameMode === 'team') {
    const alive = Object.values(room.players).filter(p=>p.alive);
    const red   = alive.filter(p=>p.team==='red').length;
    const blue  = alive.filter(p=>p.team==='blue').length;
    if (red===0 || blue===0) {
      room.status = 'ended';
      if (room.gameLoop) clearInterval(room.gameLoop);
      io.to(roomCode).emit('gameEnded', {
        mode:'team', winnerTeam:red>0?'red':'blue',
        stats:Object.values(room.players).map(p=>({id:p.id,name:p.name,team:p.team,kills:p.kills,alive:p.alive})),
      });
    }
  }
}

/* ─── Socket Handlers ─── */
io.on('connection', (socket) => {

  /* ── Single player ── */
  socket.on('startSingle', ({ playerData, difficulty }) => {
    const code = genCode();
    const totalWaves = difficulty==='easy'?5 : difficulty==='normal'?7 : 10;
    rooms[code] = {
      code, gameMode:'single', status:'waiting', maxPlayers:1,
      host:socket.id, players:{}, teams:{red:[],blue:[]},
      difficulty, wave:1, totalWaves, bullets:[], startedAt:0,
    };
    socket.join(code); socket.roomCode = code;
    rooms[code].players[socket.id] = {
      id:socket.id, ...playerData,
      team:null, hp:PLAYER_MAX_HP, alive:true, kills:0, x:0, y:0, vx:0, vy:0, angle:0,
    };
    const numBots = difficulty==='easy'?3 : difficulty==='normal'?4 : 5;
    for (let i=0; i<numBots; i++) createBot(code, difficulty, 1);
    rooms[code].status = 'playing';
    assignPositions(rooms[code]);
    rooms[code].startedAt = Date.now();
    socket.emit('joinedRoom', { playerId:socket.id, room:getRoomPublic(rooms[code]), myTeam:null, isHost:true });
    socket.emit('gameStarted', {
      players:rooms[code].players, gameMode:'single',
      wave:1, totalWaves, difficulty,
      mapW:GAME_W, mapH:GAME_H, walls:MAP_WALLS,
    });
    setTimeout(() => startGameLoop(code), 1200);
  });

  /* ── Create room ── */
  socket.on('createRoom', ({ playerData, gameMode, maxPlayers }) => {
    const code = genCode();
    rooms[code] = {
      code, gameMode:gameMode||'ffa', maxPlayers:maxPlayers||16,
      status:'waiting', host:socket.id, players:{}, teams:{red:[],blue:[]}, bullets:[],
    };
    addToRoom(socket, code, playerData);
    socket.emit('roomCreated', { code });
  });

  /* ── Join room ── */
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
    room.players[socket.id] = {
      id:socket.id, ...playerData, team,
      hp:PLAYER_MAX_HP, alive:true, kills:0, x:0, y:0, vx:0, vy:0, angle:0,
    };
    socket.emit('joinedRoom', {
      playerId:socket.id, room:getRoomPublic(room), myTeam:team, isHost:room.host===socket.id,
    });
    socket.to(code).emit('playerJoined', { player:room.players[socket.id] });
  }

  /* ── Start game (host) ── */
  socket.on('startGame', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.host !== socket.id) return;
    if (Object.keys(room.players).length < 2) return socket.emit('roomError', '최소 2명이 필요합니다.');
    room.status = 'playing';
    room.startedAt = Date.now();
    assignPositions(room);
    io.to(socket.roomCode).emit('gameStarted', {
      players:room.players, gameMode:room.gameMode,
      mapW:GAME_W, mapH:GAME_H, walls:MAP_WALLS,
    });
    setTimeout(() => startGameLoop(socket.roomCode), 1200);
  });

  /* ── Rejoin after page navigation ── */
  socket.on('rejoinGame', ({ roomCode, oldId, playerData }) => {
    const room = rooms[roomCode];
    if (!room || room.status === 'ended') {
      return socket.emit('rejoinFailed', { reason:'room_gone' });
    }
    socket.join(roomCode); socket.roomCode = roomCode;

    const oldPlayer = room.players[oldId];
    if (oldPlayer) {
      // Transfer existing player slot to new socket
      room.players[socket.id] = { ...oldPlayer, id:socket.id };
      delete room.players[oldId];
      ['red','blue'].forEach(t => {
        if (!room.teams[t]) return;
        const i = room.teams[t].indexOf(oldId);
        if (i !== -1) room.teams[t][i] = socket.id;
      });
      if (room.host === oldId) room.host = socket.id;
    } else {
      // Old slot already gone – create fresh entry
      const sp = SPAWN_POSITIONS[Math.floor(Math.random()*SPAWN_POSITIONS.length)];
      let team = null;
      if (room.gameMode === 'team' && playerData) {
        team = room.teams.red.length <= room.teams.blue.length ? 'red' : 'blue';
        room.teams[team].push(socket.id);
      }
      room.players[socket.id] = {
        id:socket.id, ...(playerData||{}), team,
        hp:PLAYER_MAX_HP, maxHp:PLAYER_MAX_HP, alive:true, kills:0,
        x:sp.x, y:sp.y, vx:0, vy:0, angle:0,
      };
    }

    socket.emit('gameRejoined', {
      playerId: socket.id,
      myTeam:   room.players[socket.id].team,
      gameMode: room.gameMode,
      wave:     room.wave||1,
      totalWaves: room.totalWaves||5,
      difficulty: room.difficulty,
      mapW:GAME_W, mapH:GAME_H, walls:MAP_WALLS,
    });
  });

  /* ── Player movement input ── */
  socket.on('moveInput', ({ dx, dy, angle }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'playing') return;
    const player = room.players[socket.id];
    if (!player?.alive) return;
    player.vx = dx||0;
    player.vy = dy||0;
    if (angle !== undefined) player.angle = angle;
  });

  /* ── Shoot ── */
  socket.on('shoot', ({ angle, weapon, cheat }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'playing') return;
    const shooter = room.players[socket.id];
    if (!shooter?.alive) return;

    const w    = WEAPONS[weapon] || WEAPONS.pistol;
    const sa   = angle ?? shooter.angle;
    const ox   = shooter.x + Math.cos(sa)*(PLAYER_R+6);
    const oy   = shooter.y + Math.sin(sa)*(PLAYER_R+6);

    // Cheat shots: only 1 pellet, very low damage, no spread, shorter range
    if (cheat) {
      const dmg = Math.max(1, Math.round(w.damage * 0.12)); // ~12% of base damage
      room.bullets.push({
        id:'b_'+Math.random().toString(36).substr(2,6),
        shooterId:socket.id,
        x:ox, y:oy,
        vx:Math.cos(sa)*BULLET_SPEED*0.95,
        vy:Math.sin(sa)*BULLET_SPEED*0.95,
        damage:dmg, weapon, life:1.0, cheat:true,
      });
      return;
    }

    const pellets = weapon==='shotgun' ? (w.pellets||7) : 1;
    for (let i=0; i<pellets; i++) {
      const pa  = sa + (Math.random()-0.5)*w.spread*(pellets>1?2:1);
      const dmg = pellets>1
        ? Math.max(1, w.damage + Math.floor(Math.random()*4)-2)
        : Math.max(1, w.damage + Math.floor(Math.random()*11)-5);
      room.bullets.push({
        id:'b_'+Math.random().toString(36).substr(2,6),
        shooterId:socket.id,
        x:ox, y:oy,
        vx:Math.cos(pa)*BULLET_SPEED*(pellets>1?0.85:1),
        vy:Math.sin(pa)*BULLET_SPEED*(pellets>1?0.85:1),
        damage:dmg, weapon, life:pellets>1?0.9:2.0,
      });
    }
  });

  /* ── Disconnect ── */
  socket.on('disconnect', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;

    // Stop game loop if no other humans expected
    delete room.players[socket.id];
    ['red','blue'].forEach(t => {
      room.teams[t] = room.teams[t]?.filter(id=>id!==socket.id) || [];
    });
    socket.to(code).emit('playerLeft', { playerId:socket.id });

    const humanCount = Object.values(room.players).filter(p=>!p.isBot).length;
    if (humanCount === 0) {
      // Grace period: allow reconnection for 8s after game starts
      const gracePeriod = room.status==='playing' && room.startedAt && (Date.now()-room.startedAt)<8000;
      if (gracePeriod) {
        setTimeout(() => {
          if (!rooms[code]) return;
          const still = Object.values(rooms[code].players).filter(p=>!p.isBot).length;
          if (still === 0) {
            if (rooms[code].gameLoop) clearInterval(rooms[code].gameLoop);
            delete rooms[code];
          }
        }, 8000);
      } else {
        if (room.gameLoop) clearInterval(room.gameLoop);
        delete rooms[code];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`✅ 서버 실행 중: http://0.0.0.0:${PORT}`));
