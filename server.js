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
const PLAYER_SPEED  = 130;   // base px/s — modified by chassis
const PLAYER_R      = 22;
const BULLET_SPEED  = 760;
const BULLET_R      = 6;
const TICK_MS       = 33;    // ~30 Hz
const PLAYER_MAX_HP = 700;   // base — modified by chassis
const RESPAWN_MS    = 5000;  // respawn delay in FFA / team modes

/* ─── Map themes ─── */
const MAP_THEMES = ['default', 'desert', 'snow', 'urban'];
function pickTheme() { return MAP_THEMES[Math.floor(Math.random()*MAP_THEMES.length)]; }

/* ─── Power-ups ─── */
const POWERUP_TYPES = {
  health:  { icon:'❤️', name:'체력 회복', color:0xef4444, dur:0,    instant:true  },
  shield:  { icon:'🛡️', name:'방어막',    color:0x60a5fa, dur:8000, instant:false },
  speed:   { icon:'⚡', name:'가속',      color:0xfbbf24, dur:8000, instant:false },
  damage:  { icon:'🔥', name:'데미지×2',  color:0xf97316, dur:8000, instant:false },
};
const POWERUP_KEYS = Object.keys(POWERUP_TYPES);
const POWERUP_SPAWN_INTERVAL = 22000; // ms
const POWERUP_MAX = 5;
const POWERUP_RADIUS = 24;

function spawnPowerup(room) {
  // Find a clear spawn spot
  for (let tries=0; tries<20; tries++) {
    const x = 80 + Math.random() * (GAME_W - 160);
    const y = 80 + Math.random() * (GAME_H - 160);
    if (collidesWithWalls(x, y, 30)) continue;
    const type = POWERUP_KEYS[Math.floor(Math.random()*POWERUP_KEYS.length)];
    room.powerups.push({
      id: 'pu_' + Math.random().toString(36).substr(2,7),
      type, x, y, spawnTime: Date.now(),
    });
    return;
  }
}

/* ─── Killstreak rewards ─── */
const KILLSTREAK_REWARDS = {
  3: { name:'자동 회복',    apply: (room, p) => { p.hp = Math.min(p.maxHp, p.hp + 250); } },
  5: { name:'강철 도금',    apply: (room, p) => { p.buffs.shield = Date.now() + 10000; } },
  7: { name:'공중 폭격!',   apply: (room, p) => {
    // Damage all enemies (not teammates)
    Object.values(room.players).forEach(t => {
      if (!t.alive || t.id === p.id) return;
      if (room.gameMode==='team' && t.team === p.team) return;
      t.hp = Math.max(0, t.hp - 350);
      if (!t.isBot) io.to(t.id).emit('gotHit', { damage:350, hp:t.hp, shooterId:p.id });
      io.to(room.code).emit('bulletHit', { bulletId:'airstrike', targetId:t.id, damage:350, x:t.x, y:t.y });
      if (t.hp <= 0) {
        t.alive = false; p.kills++;
        io.to(room.code).emit('playerKilled', {
          deadId:t.id, killerId:p.id, killerName:p.name, kills:p.kills, x:t.x, y:t.y,
        });
        if (room.gameMode === 'ffa' || room.gameMode === 'team') {
          t.respawnAt = Date.now() + RESPAWN_MS;
          if (!t.isBot) io.to(t.id).emit('respawnPending', { delay:RESPAWN_MS });
        }
      }
    });
  } },
};

/* Chassis stat profiles — chosen so each tank has a real role */
const CHASSIS_STATS = {
  light:   { hp:500,  speedMul:1.30, dmgMul:0.85, fireMul:0.85 },
  medium:  { hp:700,  speedMul:1.00, dmgMul:1.00, fireMul:1.00 },
  heavy:   { hp:1000, speedMul:0.72, dmgMul:1.15, fireMul:1.15 },
  sniper:  { hp:600,  speedMul:0.95, dmgMul:1.35, fireMul:1.20 },
  scout:   { hp:550,  speedMul:1.25, dmgMul:0.90, fireMul:0.90 },
};
function getChassisStats(p) {
  const key = p?.character?.chassis || p?.character?.hairStyle || 'medium';
  return CHASSIS_STATS[key] || CHASSIS_STATS.medium;
}

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

// All spawns hand-verified to be clear of walls (player radius = 18)
const SPAWN_POSITIONS = [
  { x:80,    y:80   },  // top-left corner
  { x:1720,  y:80   },  // top-right corner
  { x:80,    y:1120 },  // bottom-left corner
  { x:1720,  y:1120 },  // bottom-right corner
  { x:900,   y:80   },  // top-center
  { x:80,    y:600  },  // mid-left
  { x:1720,  y:600  },  // mid-right
  { x:900,   y:1120 },  // bottom-center
  { x:300,   y:600  },  // left arena
  { x:1500,  y:600  },  // right arena
  { x:680,   y:80   },  // top mid-left
  { x:1120,  y:1120 },  // bottom mid-right
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
  easy:   { shootInterval:4500, accuracy:0.25, hp:600,  speed:0.40, dmgMul:0.35, name:'초보봇' },
  normal: { shootInterval:3000, accuracy:0.40, hp:900,  speed:0.55, dmgMul:0.50, name:'일반봇' },
  hard:   { shootInterval:1800, accuracy:0.60, hp:1200, speed:0.70, dmgMul:0.70, name:'강력봇' },
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
    if (p.isBot) {
      p.hp    = p.maxHp || 100;
    } else {
      const cs = getChassisStats(p);
      p.maxHp = cs.hp;
      p.hp    = cs.hp;
    }
    p.alive = true;
    if (!p.isBot) p.kills = 0;
  });
}

function respawnPlayer(room, p) {
  const cs = getChassisStats(p);
  const sp = SPAWN_POSITIONS[Math.floor(Math.random()*SPAWN_POSITIONS.length)];
  p.x = sp.x + (Math.random()*30 - 15);
  p.y = sp.y + (Math.random()*30 - 15);
  p.vx = 0; p.vy = 0;
  p.maxHp = cs.hp;
  p.hp    = cs.hp;
  p.alive = true;
  p.respawnAt = 0;
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
    wigPhase: Math.random()*6, strafeUntil:0, strafeDir:1,
    buffs:{}, streak:0,
  };
  return botId;
}

/* ─── Game Loop ─── */
function startGameLoop(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  if (room.gameLoop) clearInterval(room.gameLoop);
  room.bullets  = [];
  room.powerups = [];
  room.lastPowerupSpawn = Date.now();
  let lastTick = Date.now();
  // Initial sprinkle of power-ups
  for (let i=0; i<3; i++) spawnPowerup(room);

  room.gameLoop = setInterval(() => {
    if (!rooms[roomCode] || room.status !== 'playing') {
      clearInterval(room.gameLoop); return;
    }
    const now = Date.now();
    const dt  = Math.min((now - lastTick) / 1000, 0.1);
    lastTick  = now;

    const players = Object.values(room.players);
    const humans  = players.filter(p => !p.isBot && p.alive);

    /* ── Respawn pending dead players (FFA/team only) ── */
    if (room.gameMode === 'ffa' || room.gameMode === 'team') {
      players.forEach(p => {
        if (!p.alive && p.respawnAt && now >= p.respawnAt) {
          respawnPlayer(room, p);
          if (!p.isBot) {
            io.to(p.id).emit('respawned', { hp:p.hp, x:p.x, y:p.y });
          }
        }
      });
    }

    /* ── Power-up spawn + pickup ── */
    if (now - room.lastPowerupSpawn > POWERUP_SPAWN_INTERVAL &&
        room.powerups.length < POWERUP_MAX) {
      spawnPowerup(room);
      room.lastPowerupSpawn = now;
    }
    // Pickup detection (only humans pick up — bots get bonus stats already)
    room.powerups = room.powerups.filter(pu => {
      for (const pl of players) {
        if (!pl.alive || pl.isBot) continue;
        if (Math.hypot(pl.x-pu.x, pl.y-pu.y) < PLAYER_R + POWERUP_RADIUS) {
          const def = POWERUP_TYPES[pu.type];
          if (pu.type === 'health') {
            pl.hp = Math.min(pl.maxHp, pl.hp + 300);
          } else {
            pl.buffs[pu.type] = now + def.dur;
          }
          io.to(pl.id).emit('powerupCollected', {
            type:pu.type, dur:def.dur, hp:pl.hp,
          });
          io.to(roomCode).emit('powerupGone', { id:pu.id });
          return false;
        }
      }
      return true;
    });

    /* ── Expire buffs ── */
    players.forEach(p => {
      if (!p.buffs) return;
      for (const k in p.buffs) {
        if (p.buffs[k] && now >= p.buffs[k]) {
          delete p.buffs[k];
          if (!p.isBot) io.to(p.id).emit('powerupExpired', { type:k });
        }
      }
    });

    /* ── Human movement ── */
    players.forEach(p => {
      if (p.isBot || !p.alive) return;
      if (p.vx || p.vy) {
        const speedBuff = (p.buffs && p.buffs.speed) ? 1.6 : 1;
        const spd = PLAYER_SPEED * getChassisStats(p).speedMul * speedBuff;
        const nx = p.x + p.vx * spd * dt;
        const ny = p.y + p.vy * spd * dt;
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

      // Strafe if recently hit (perpendicular to threat direction)
      if (bot.strafeUntil && now < bot.strafeUntil) {
        const pdx = -Math.sin(bot.angle) * bot.strafeDir;
        const pdy =  Math.cos(bot.angle) * bot.strafeDir;
        const nx  = bot.x + pdx*spd*0.9*dt;
        const ny  = bot.y + pdy*spd*0.9*dt;
        if (!collidesWithWalls(nx, bot.y, PLAYER_R)) bot.x = nx;
        if (!collidesWithWalls(bot.x, ny, PLAYER_R)) bot.y = ny;
      } else if (dist > 260) {
        // Advance, with slight perpendicular wiggle to look less robotic
        const wig = Math.sin(now/400 + (bot.wigPhase||0)) * 0.4;
        const fx  = dx/dist + (-Math.sin(bot.angle))*wig;
        const fy  = dy/dist + ( Math.cos(bot.angle))*wig;
        const fl  = Math.hypot(fx, fy);
        const nx  = bot.x + (fx/fl)*spd*dt;
        const ny  = bot.y + (fy/fl)*spd*dt;
        if (!collidesWithWalls(nx, bot.y, PLAYER_R)) bot.x = nx;
        if (!collidesWithWalls(bot.x, ny, PLAYER_R)) bot.y = ny;
      } else if (dist < 130) {
        // Too close — back up
        const nx = bot.x - (dx/dist)*spd*0.6*dt;
        const ny = bot.y - (dy/dist)*spd*0.6*dt;
        if (!collidesWithWalls(nx, bot.y, PLAYER_R)) bot.x = nx;
        if (!collidesWithWalls(bot.x, ny, PLAYER_R)) bot.y = ny;
      } else {
        // Mid-range — strafe sideways while shooting
        const dir = ((bot.wigPhase||0) % 2 < 1) ? 1 : -1;
        const pdx = -Math.sin(bot.angle) * dir;
        const pdy =  Math.cos(bot.angle) * dir;
        const nx  = bot.x + pdx*spd*0.7*dt;
        const ny  = bot.y + pdy*spd*0.7*dt;
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
          // Shield buff reduces damage by 70%
          const shieldOn = p.buffs && p.buffs.shield;
          const finalDmg = shieldOn ? Math.round(b.damage * 0.3) : b.damage;
          p.hp = Math.max(0, p.hp - finalDmg);
          // Track hit for shooter stats
          const shooterRef = room.players[b.shooterId];
          if (shooterRef) {
            shooterRef.shotsHit  = (shooterRef.shotsHit||0) + 1;
            shooterRef.dmgDealt  = (shooterRef.dmgDealt||0) + finalDmg;
          }
          // Bots strafe when hit
          if (p.isBot && p.alive) {
            p.strafeUntil = now + 700 + Math.random()*600;
            p.strafeDir = Math.random()<0.5 ? 1 : -1;
          }
          if (!p.isBot) io.to(p.id).emit('gotHit', { damage:finalDmg, hp:p.hp, shooterId:b.shooterId, shielded:shieldOn });
          io.to(roomCode).emit('bulletHit', { bulletId:b.id, targetId:p.id, damage:finalDmg, x:b.x, y:b.y });
          if (p.hp <= 0) {
            p.alive = false;
            p.deaths = (p.deaths||0) + 1;
            p.streak = 0;          // dying resets killstreak
            if (p.buffs) p.buffs = {};  // wipe buffs on death
            const shooter = room.players[b.shooterId];
            if (shooter) {
              shooter.kills++;
              shooter.streak = (shooter.streak||0) + 1;
              shooter.maxStreak = Math.max(shooter.maxStreak||0, shooter.streak);
              // Killstreak reward?
              const rew = KILLSTREAK_REWARDS[shooter.streak];
              if (rew) {
                rew.apply(room, shooter);
                if (!shooter.isBot) {
                  io.to(shooter.id).emit('killstreak', {
                    streak: shooter.streak, name: rew.name,
                  });
                }
              }
            }
            io.to(roomCode).emit('playerKilled', {
              deadId:p.id, killerId:b.shooterId,
              killerName:shooter?.name||'?', kills:shooter?.kills||0,
              x:p.x, y:p.y,
            });
            if (room.gameMode === 'ffa' || room.gameMode === 'team') {
              p.respawnAt = now + RESPAWN_MS;
              if (!p.isBot) io.to(p.id).emit('respawnPending', { delay:RESPAWN_MS });
            }
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
        alive:p.alive, kills:p.kills, streak:p.streak||0,
        name:p.name, team:p.team, isBot:p.isBot,
        character:p.character,
        buffs: p.buffs ? Object.keys(p.buffs) : [],
      })),
      bullets: room.bullets.map(b => ({
        id:b.id, x:b.x, y:b.y, weapon:b.weapon, shooterId:b.shooterId,
      })),
      powerups: (room.powerups||[]).map(pu => ({
        id:pu.id, type:pu.type, x:pu.x, y:pu.y,
      })),
    });
  }, TICK_MS);
}

/* ─── Win Check ─── */
function buildStats(room) {
  return Object.values(room.players).map(p => ({
    id:p.id, name:p.name, team:p.team, kills:p.kills,
    deaths: p.deaths||0,
    shotsFired: p.shotsFired||0,
    shotsHit: p.shotsHit||0,
    accuracy: p.shotsFired ? Math.round((p.shotsHit||0)/p.shotsFired*100) : 0,
    dmgDealt: p.dmgDealt||0,
    maxStreak: p.maxStreak||0,
    alive: p.alive, isBot: p.isBot||false,
  }));
}
function pickMVP(stats) {
  // Score = kills*100 + dmg/10 + maxStreak*30 + accuracy
  return [...stats].sort((a,b) => {
    const sa = a.kills*100 + a.dmgDealt/10 + a.maxStreak*30 + a.accuracy;
    const sb = b.kills*100 + b.dmgDealt/10 + b.maxStreak*30 + b.accuracy;
    return sb - sa;
  })[0];
}

function checkWin(room, roomCode) {
  if (room.status !== 'playing') return;
  const aliveBots   = Object.values(room.players).filter(p => p.isBot  && p.alive);
  const aliveHumans = Object.values(room.players).filter(p => !p.isBot && p.alive);

  if (room.gameMode === 'single') {
    if (aliveHumans.length === 0) {
      room.status = 'ended';
      if (room.gameLoop) clearInterval(room.gameLoop);
      const stats = buildStats(room);
      io.to(roomCode).emit('gameEnded', {
        mode:'single', victory:false, wave:room.wave,
        stats, mvp: pickMVP(stats),
      });
    } else if (aliveBots.length === 0) {
      const total = room.totalWaves||5;
      if (room.wave >= total) {
        room.status = 'ended';
        if (room.gameLoop) clearInterval(room.gameLoop);
        const stats = buildStats(room);
        io.to(roomCode).emit('gameEnded', {
          mode:'single', victory:true, wave:room.wave,
          stats, mvp: pickMVP(stats),
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
            p.hp = Math.min(PLAYER_MAX_HP, p.hp+500);
            io.to(p.id).emit('hpRecovered', { hp:p.hp });
          });
          assignPositions(rooms[roomCode]);
          io.to(roomCode).emit('waveStarted', { wave:room.wave, players:rooms[roomCode].players });
        }, 4500);
      }
    }
  } else if (room.gameMode === 'ffa') {
    // First to 10 kills wins (or when only one human remains connected)
    const KILL_GOAL = 10;
    const top = Object.values(room.players).sort((a,b)=>b.kills-a.kills)[0];
    const humans = Object.values(room.players).filter(p=>!p.isBot);
    if (top && top.kills >= KILL_GOAL || humans.length === 0) {
      room.status = 'ended';
      if (room.gameLoop) clearInterval(room.gameLoop);
      const stats = buildStats(room);
      io.to(roomCode).emit('gameEnded', {
        mode:'ffa', winnerId:top?.id||null,
        stats, mvp: pickMVP(stats),
      });
    }
  } else if (room.gameMode === 'team') {
    // First team to 20 kills wins
    const TEAM_GOAL = 20;
    const players = Object.values(room.players);
    const redK    = players.filter(p=>p.team==='red').reduce((s,p)=>s+p.kills, 0);
    const blueK   = players.filter(p=>p.team==='blue').reduce((s,p)=>s+p.kills, 0);
    if (redK >= TEAM_GOAL || blueK >= TEAM_GOAL) {
      room.status = 'ended';
      if (room.gameLoop) clearInterval(room.gameLoop);
      const stats = buildStats(room);
      io.to(roomCode).emit('gameEnded', {
        mode:'team', winnerTeam:redK>blueK?'red':'blue',
        stats, mvp: pickMVP(stats),
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
      theme: pickTheme(),
    };
    socket.join(code); socket.roomCode = code;
    rooms[code].players[socket.id] = {
      id:socket.id, ...playerData,
      team:null, hp:PLAYER_MAX_HP, alive:true, kills:0, x:0, y:0, vx:0, vy:0, angle:0, buffs:{}, streak:0,
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
      theme: rooms[code].theme,
    });
    setTimeout(() => startGameLoop(code), 1200);
  });

  /* ── Create room ── */
  socket.on('createRoom', ({ playerData, gameMode, maxPlayers }) => {
    const code = genCode();
    rooms[code] = {
      code, gameMode:gameMode||'ffa', maxPlayers:maxPlayers||16,
      status:'waiting', host:socket.id, players:{}, teams:{red:[],blue:[]}, bullets:[],
      theme: pickTheme(),
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
      hp:PLAYER_MAX_HP, alive:true, kills:0, x:0, y:0, vx:0, vy:0, angle:0, buffs:{}, streak:0,
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
      theme: room.theme,
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
        x:sp.x, y:sp.y, vx:0, vy:0, angle:0, buffs:{}, streak:0,
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
      theme: room.theme || 'default',
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
    const cs   = getChassisStats(shooter);
    const sa   = angle ?? shooter.angle;
    const ox   = shooter.x + Math.cos(sa)*(PLAYER_R+6);
    const oy   = shooter.y + Math.sin(sa)*(PLAYER_R+6);
    const dmgBuff = (shooter.buffs && shooter.buffs.damage) ? 2.0 : 1.0;
    const dmgMul = cs.dmgMul * dmgBuff;
    // Track shots fired (for accuracy stat)
    shooter.shotsFired = (shooter.shotsFired||0) + 1;

    if (cheat) {
      const dmg = Math.max(1, Math.round(w.damage * 0.12 * dmgMul));
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
      const baseDmg = pellets>1
        ? Math.max(1, w.damage + Math.floor(Math.random()*4)-2)
        : Math.max(1, w.damage + Math.floor(Math.random()*11)-5);
      const dmg = Math.max(1, Math.round(baseDmg * dmgMul));
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
