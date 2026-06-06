/* =========================================================
   Church Shooter – 2D Top-down Client
   ========================================================= */
'use strict';

/* ─── Socket ─── */
const socket = io();

/* ─── Map constants (mirrors server) ─── */
const PLAYER_R = 22;
const BULLET_R = 6;
const PLAYER_MAX_HP = 700;

/* ─── Chassis stats (mirrors server) ─── */
const CHASSIS_STATS = {
  light:   { hp:500,  speedMul:1.30, dmgMul:0.85 },
  medium:  { hp:700,  speedMul:1.00, dmgMul:1.00 },
  heavy:   { hp:1000, speedMul:0.72, dmgMul:1.15 },
  sniper:  { hp:600,  speedMul:0.95, dmgMul:1.35 },
  scout:   { hp:550,  speedMul:1.25, dmgMul:0.90 },
};
function getMyChassis() {
  const char = JSON.parse(sessionStorage.getItem('char')||'{}');
  return CHASSIS_STATS[char.chassis || char.hairStyle || 'medium'] || CHASSIS_STATS.medium;
}

/* ─── Tank chassis catalog ─── */
const TANK_CHASSIS = {
  light:   { w:32, h:40, tw:18, th:20, barL:22, barW:3.5, name:'경전차', desc:'빠르고 가벼움' },
  medium:  { w:38, h:46, tw:22, th:24, barL:26, barW:4,   name:'중형전차', desc:'균형 잡힘' },
  heavy:   { w:46, h:54, tw:28, th:30, barL:28, barW:5,   name:'중전차', desc:'두꺼운 장갑' },
  sniper:  { w:32, h:44, tw:18, th:20, barL:40, barW:3,   name:'저격전차', desc:'긴 포신' },
  scout:   { w:28, h:36, tw:16, th:18, barL:20, barW:3,   name:'정찰전차', desc:'민첩한 정찰' },
};
let   mapW = 1800, mapH = 1200;
let   walls = [];

const MAP_WALLS_FALLBACK = [
  { x:0,y:0,w:1800,h:20 }, { x:0,y:1180,w:1800,h:20 },
  { x:0,y:0,w:20,h:1200 }, { x:1780,y:0,w:20,h:1200 },
];

/* ─── Weapon config ─── */
const WEAPONS_CFG = {
  pistol:  { ammo:15, maxAmmo:15, reloadTime:900,  fireRate:320,  name:'권총',    color:'#FFD700' },
  shotgun: { ammo:8,  maxAmmo:8,  reloadTime:1700, fireRate:900,  name:'샷건',    color:'#FF6B00' },
  rifle:   { ammo:35, maxAmmo:35, reloadTime:1500, fireRate:110,  name:'소총',    color:'#6EE7B7' },
  sniper:  { ammo:6,  maxAmmo:6,  reloadTime:2400, fireRate:1400, name:'저격총',  color:'#60A5FA' },
  smg:     { ammo:32, maxAmmo:32, reloadTime:1300, fireRate:65,   name:'기관단총',color:'#C084FC' },
};

/* ─── State ─── */
let myId        = null;
let myTeam      = null;
let gameMode    = null;
let gameActive  = false;
let isDead      = false;
let myHp        = 100;
let myWeapon    = 'pistol';
let ammo        = 12;
let isReloading = false;
let lastShot    = 0;
let waveNum     = 1;
let totalWaves  = 5;

let gameState   = { players:[], bullets:[] };

/* ─── Canvas ─── */
const canvas  = document.getElementById('game-canvas');
const ctx     = canvas.getContext('2d');
let   camX    = 0, camY = 0;

/* ─── Keyboard ─── */
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyR' && !isReloading) startReload();
  if (e.code === 'KeyC') triggerCheat();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

/* ─── Mouse ─── */
let aimAngle  = 0;
let mouseDown = false;

window.addEventListener('mousemove', e => {
  aimAngle = Math.atan2(e.clientY - canvas.height/2, e.clientX - canvas.width/2);
});
window.addEventListener('mousedown', e => {
  if (e.button === 0) { mouseDown = true; tryShoot(); }
});
window.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });

/* ─── Touch / dual virtual joysticks ─── */
const JOY_R     = 58;   // move stick max radius
const AIM_R     = 48;   // aim stick max radius (smaller = tighter aim feel)
const AIM_DEAD  = 10;   // dead-zone before firing starts
const joy   = { active:false, id:null, bx:0, by:0, cx:0, cy:0, dx:0, dy:0 };
const aim   = { active:false, id:null, bx:0, by:0, cx:0, cy:0, dist:0 };
let   touchFire = false;

canvas.addEventListener('touchstart', onTS, { passive:false });
canvas.addEventListener('touchmove',  onTM, { passive:false });
canvas.addEventListener('touchend',   onTE, { passive:false });
canvas.addEventListener('touchcancel',onTE, { passive:false });

function onTS(e) {
  e.preventDefault();
  const hint = document.getElementById('touch-hint');
  if (hint && hint.style.display !== 'none') hint.style.display = 'none';
  for (const t of e.changedTouches) {
    if (t.clientX < canvas.width/2 && !joy.active) {
      // LEFT side: movement joystick
      joy.active = true; joy.id = t.identifier;
      joy.bx = t.clientX; joy.by = t.clientY;
      joy.cx = t.clientX; joy.cy = t.clientY;
      joy.dx = 0; joy.dy = 0;
    } else if (t.clientX >= canvas.width/2 && !aim.active) {
      // RIGHT side: aim joystick — touch anywhere, drag in direction to fire
      aim.active = true; aim.id = t.identifier;
      aim.bx = t.clientX; aim.by = t.clientY;
      aim.cx = t.clientX; aim.cy = t.clientY;
      aim.dist = 0;
    }
  }
}
function onTM(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) {
      joy.cx = t.clientX; joy.cy = t.clientY;
      const dx = t.clientX - joy.bx, dy = t.clientY - joy.by;
      const d  = Math.hypot(dx, dy);
      joy.dx = d > 0 ? dx/Math.max(d, JOY_R) : 0;
      joy.dy = d > 0 ? dy/Math.max(d, JOY_R) : 0;
    } else if (t.identifier === aim.id) {
      aim.cx = t.clientX; aim.cy = t.clientY;
      const dx = t.clientX - aim.bx, dy = t.clientY - aim.by;
      const d  = Math.hypot(dx, dy);
      aim.dist = d;
      if (d > AIM_DEAD) {
        aimAngle  = Math.atan2(dy, dx);
        touchFire = true;
      } else {
        touchFire = false;
      }
    }
  }
}
function onTE(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) {
      joy.active = false; joy.id = null; joy.dx = 0; joy.dy = 0;
    }
    if (t.identifier === aim.id) {
      aim.active = false; aim.id = null; aim.dist = 0; touchFire = false;
    }
  }
}

/* ─── Shoot ─── */
function tryShoot() {
  if (!gameActive || isDead || isReloading) return;
  const cfg = WEAPONS_CFG[myWeapon];
  if (!cfg) return;
  const now = Date.now();
  if (now - lastShot < cfg.fireRate) return;
  if (ammo <= 0) { startReload(); return; }
  lastShot = now;
  ammo--;
  updateAmmoHUD();
  socket.emit('shoot', { angle: aimAngle, weapon: myWeapon });
  // Local feedback: sound, screen shake, gun recoil
  playShot(myWeapon, 1);
  const shake = ({ pistol:1.4, shotgun:5, rifle:1.2, sniper:6, smg:0.9 })[myWeapon] || 1.5;
  addShake(shake);
  recoilOffset[myId] = { amount: 7, weapon: myWeapon };
  if (ammo <= 0) startReload();
}

function startReload() {
  if (isReloading) return;
  const cfg = WEAPONS_CFG[myWeapon];
  if (!cfg) return;
  isReloading = true;
  const btn = document.getElementById('reload-btn');
  btn.classList.add('reloading');
  btn.textContent = '장전 중...';
  setTimeout(() => {
    ammo = cfg.maxAmmo;
    isReloading = false;
    btn.classList.remove('reloading');
    btn.textContent = '재장전';
    updateAmmoHUD();
  }, cfg.reloadTime);
}

document.getElementById('reload-btn').addEventListener('click', startReload);
document.getElementById('cheat-btn').addEventListener('click', triggerCheat);

/* ─── HUD ─── */
function updateAmmoHUD() {
  const cfg = WEAPONS_CFG[myWeapon];
  document.getElementById('ammo-cur').textContent         = ammo;
  document.getElementById('ammo-max').textContent         = ' / '+(cfg?.maxAmmo||0);
  document.getElementById('ammo-weapon-name').textContent = cfg?.name || myWeapon;
}
function updateHpHUD(hp) {
  myHp = hp;
  const pct = Math.max(0, Math.min(100, (hp/PLAYER_MAX_HP)*100));
  document.getElementById('hp-num').textContent      = hp;
  document.getElementById('hp-fill').style.width     = pct+'%';
  document.getElementById('hp-fill').style.background =
    pct>50?'#10B981' : pct>25?'#F59E0B' : '#EF4444';
}

/* ─── Hit effects ─── */
const hitEffects   = [];
const explosions   = [];   // expanding rings on player death
const recoilOffset = {};   // playerId → {amount, decay}

/* ─── Screen shake ─── */
let shakeAmt = 0;
function addShake(amount) { shakeAmt = Math.min(28, shakeAmt + amount); }

/* ─── WebAudio sound system (procedural — no external assets) ─── */
let audioCtx = null;
let masterGain = null;
let bgmGain = null;
let bgmStarted = false;
let bgmNodes = [];

function ensureAudio() {
  if (audioCtx) return audioCtx;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.45;
    masterGain.connect(audioCtx.destination);
    bgmGain = audioCtx.createGain();
    bgmGain.gain.value = 0.16;
    bgmGain.connect(masterGain);
  } catch (e) { console.warn('No audio', e); }
  return audioCtx;
}

// Initialize audio after first user gesture (browser autoplay policy)
['click','touchstart','keydown'].forEach(ev => {
  window.addEventListener(ev, () => {
    ensureAudio();
    if (audioCtx?.state === 'suspended') audioCtx.resume();
    if (!bgmStarted) { startBGM(); bgmStarted = true; }
  }, { once:true });
});

/* Procedural gun shot — weapon-specific timbres */
function playShot(weapon, distAttenuation=1) {
  if (!audioCtx) return;
  const ctx = audioCtx;
  const now = ctx.currentTime;

  const cfg = {
    pistol:  { freq:380, dur:0.10, q:1.5, type:'square',   vol:0.25 },
    shotgun: { freq:140, dur:0.22, q:0.8, type:'sawtooth', vol:0.40 },
    rifle:   { freq:520, dur:0.07, q:2.0, type:'square',   vol:0.20 },
    sniper:  { freq:220, dur:0.30, q:1.0, type:'sawtooth', vol:0.45 },
    smg:     { freq:620, dur:0.05, q:2.5, type:'square',   vol:0.15 },
  }[weapon] || { freq:380, dur:0.10, q:1.5, type:'square', vol:0.25 };

  // Noise burst (the "bang")
  const bufSize = Math.floor(ctx.sampleRate * cfg.dur);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i=0; i<bufSize; i++) {
    const t = i/bufSize;
    data[i] = (Math.random()*2 - 1) * Math.pow(1-t, 1.8);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = cfg.freq;
  bandpass.Q.value = cfg.q;
  const nGain = ctx.createGain();
  nGain.gain.value = cfg.vol * distAttenuation;
  nGain.gain.exponentialRampToValueAtTime(0.001, now + cfg.dur);
  noise.connect(bandpass).connect(nGain).connect(masterGain);
  noise.start(now);

  // Pitched component (the "boom")
  const osc = ctx.createOscillator();
  osc.type = cfg.type;
  osc.frequency.setValueAtTime(cfg.freq*0.9, now);
  osc.frequency.exponentialRampToValueAtTime(cfg.freq*0.3, now + cfg.dur*0.8);
  const oGain = ctx.createGain();
  oGain.gain.value = cfg.vol * 0.6 * distAttenuation;
  oGain.gain.exponentialRampToValueAtTime(0.001, now + cfg.dur*0.7);
  osc.connect(oGain).connect(masterGain);
  osc.start(now);
  osc.stop(now + cfg.dur);
}

/* Hit sound — short metallic clink */
function playHit(distAttenuation=1) {
  if (!audioCtx) return;
  const ctx = audioCtx;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(1400, now);
  osc.frequency.exponentialRampToValueAtTime(280, now + 0.09);
  const g = ctx.createGain();
  g.gain.value = 0.20 * distAttenuation;
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  osc.connect(g).connect(masterGain);
  osc.start(now); osc.stop(now + 0.13);
}

/* Explosion — kill / death */
function playExplosion(distAttenuation=1) {
  if (!audioCtx) return;
  const ctx = audioCtx;
  const now = ctx.currentTime;

  // Low rumble
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.6);
  const oG = ctx.createGain();
  oG.gain.value = 0.6 * distAttenuation;
  oG.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
  osc.connect(oG).connect(masterGain);
  osc.start(now); osc.stop(now + 0.7);

  // Noise crash
  const bufSize = Math.floor(ctx.sampleRate * 0.5);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i=0; i<bufSize; i++) {
    data[i] = (Math.random()*2 - 1) * Math.pow(1 - i/bufSize, 1.5);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 600;
  const nG = ctx.createGain();
  nG.gain.value = 0.5 * distAttenuation;
  nG.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  noise.connect(lp).connect(nG).connect(masterGain);
  noise.start(now);
}

/* Simple ambient BGM — droning low pads */
function startBGM() {
  if (!audioCtx || !bgmGain) return;
  const ctx = audioCtx;
  // Two slowly detuned saw pads — military-ambient feel
  [55, 73.42, 110].forEach((freq, idx) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380 + idx*60;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.18 - idx*0.04;
    // Slow LFO on filter cutoff
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07 + idx*0.04;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain).connect(f.frequency);
    o.connect(f).connect(g).connect(bgmGain);
    o.start(); lfo.start();
    bgmNodes.push(o, lfo);
  });
}

/* Distance-attenuation for spatial sounds */
function distAtten(x, y) {
  const me = gameState.players.find(p=>p.id===myId);
  if (!me) return 1;
  const d = Math.hypot(x-me.x, y-me.y);
  return Math.max(0.05, 1 - d/900);
}

/* ─── CHEAT MODE: spinning rampage ─── */
const CHEAT_DURATION = 4000;   // 4 seconds of madness
const CHEAT_COOLDOWN = 12000;  // 12 second cooldown
const CHEAT_SPIN_SPEED = 5.2;  // rad/s — slower so bullets cluster tighter
const CHEAT_FIRE_MS = 22;      // shoot every 22ms → ~45 bullets/sec (denser)
let cheatActive  = false;
let cheatEndAt   = 0;
let cheatCDUntil = 0;
let cheatLastShot = 0;
let cheatAngle = 0;

function triggerCheat() {
  if (cheatActive || isDead || !gameActive) return;
  const now = Date.now();
  if (now < cheatCDUntil) {
    toast(`⏱️ 쿨다운 ${Math.ceil((cheatCDUntil-now)/1000)}초`, 1200);
    return;
  }
  cheatActive  = true;
  cheatEndAt   = now + CHEAT_DURATION;
  cheatCDUntil = now + CHEAT_DURATION + CHEAT_COOLDOWN;
  cheatAngle   = aimAngle;
  document.getElementById('cheat-btn').classList.add('active');
  toast('🌀 난사 모드!', 1200);
}

function updateCheatBtn() {
  const btn = document.getElementById('cheat-btn');
  if (!btn) return;
  const now = Date.now();
  if (cheatActive) return; // class already set
  if (now < cheatCDUntil) {
    btn.classList.add('cooldown');
    btn.classList.remove('active');
    const sec = Math.ceil((cheatCDUntil-now)/1000);
    btn.innerHTML = `${sec}s<br><span style="font-size:9px">대기</span>`;
  } else {
    btn.classList.remove('cooldown');
    btn.classList.remove('active');
    btn.innerHTML = `🌀<br><span style="font-size:9px">치트</span>`;
  }
}

function tickCheat(dt) {
  if (!cheatActive) return;
  const now = Date.now();
  if (now >= cheatEndAt) {
    cheatActive = false;
    document.getElementById('cheat-btn').classList.remove('active');
    return;
  }
  // Spin the gun
  cheatAngle += CHEAT_SPIN_SPEED * dt;
  // Force-shoot (bypasses fire-rate / ammo, low-damage)
  if (now - cheatLastShot >= CHEAT_FIRE_MS) {
    cheatLastShot = now;
    // Fire two pellets per tick at small angular offset for a thicker stream
    socket.emit('shoot', { angle: cheatAngle,         weapon: myWeapon, cheat:true });
    socket.emit('shoot', { angle: cheatAngle + 0.06,  weapon: myWeapon, cheat:true });
  }
}

/* ─── Resize ─── */
function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

/* ─── Toast ─── */
function toast(msg, ms=2200) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  c.appendChild(t); setTimeout(() => t.remove(), ms);
}

/* ─── Wave announce ─── */
function showWaveAnnounce(text, sub, duration=2600) {
  const el = document.getElementById('wave-announce');
  document.getElementById('wave-announce-text').textContent = text;
  document.getElementById('wave-announce-sub').textContent  = sub;
  el.style.display = 'flex';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.display = 'none', duration);
}

/* ─── Kill feed ─── */
function addKillFeed(killer, dead) {
  const feed = document.getElementById('kill-feed');
  const item = document.createElement('div');
  item.className = 'kf-item';
  item.textContent = `${killer} 🔫 ${dead}`;
  feed.appendChild(item);
  setTimeout(() => item.remove(), 4000);
}

/* ─── Socket: connection & rejoin ─── */
socket.on('connect', () => {
  myId = socket.id;
  const rc    = sessionStorage.getItem('roomCode');
  const oldId = sessionStorage.getItem('myId');
  const char  = JSON.parse(sessionStorage.getItem('char')||'{}');
  if (rc) {
    socket.emit('rejoinGame', {
      roomCode:   rc,
      oldId:      oldId,
      playerData: { name:char.name||'Player', character:char, weapon:char.weapon||'pistol' },
    });
  } else {
    location.href = 'lobby.html';
  }
});

socket.on('gameRejoined', data => {
  myId       = socket.id;
  myTeam     = data.myTeam || null;
  gameMode   = data.gameMode;
  waveNum    = data.wave      || 1;
  totalWaves = data.totalWaves|| 5;
  if (data.walls) walls = data.walls;
  if (data.mapW)  mapW  = data.mapW;
  if (data.mapH)  mapH  = data.mapH;

  const char = JSON.parse(sessionStorage.getItem('char')||'{}');
  const wpn  = char.weapon || 'pistol';
  if (WEAPONS_CFG[wpn]) {
    myWeapon = wpn; ammo = WEAPONS_CFG[wpn].maxAmmo;
  }
  updateAmmoHUD();

  if (gameMode === 'single') {
    document.getElementById('wave-hud').style.display = 'block';
    document.getElementById('wave-label').textContent = `웨이브 ${waveNum} / ${totalWaves}`;
  } else if (gameMode === 'team') {
    document.getElementById('team-hud').style.display = 'block';
  } else if (gameMode === 'ffa') {
    document.getElementById('ffa-hud').style.display = 'block';
  }

  showWaveAnnounce(
    gameMode==='single' ? `🌊 웨이브 ${waveNum}` : '전투 시작!',
    gameMode==='single' ? `총 ${totalWaves} 웨이브` : '모두 전투 태세!',
  );

  document.getElementById('loading-overlay').style.display = 'none';
  gameActive = true;

  // Show touch hint on mobile
  if ('ontouchstart' in window) {
    const hint = document.getElementById('touch-hint');
    if (hint) {
      hint.style.display = 'flex';
      setTimeout(() => hint.style.display = 'none', 6000);
    }
  }

  requestAnimationFrame(gameLoop);
});

socket.on('rejoinFailed', () => {
  toast('방 연결 실패! 로비로 이동합니다.', 2500);
  setTimeout(() => location.href = 'lobby.html', 2500);
});

const seenBullets = new Set();
socket.on('gameState', state => {
  // Detect new bullets so we can play other players' gun sounds + recoil
  const currentIds = new Set();
  state.bullets.forEach(b => {
    currentIds.add(b.id);
    if (!seenBullets.has(b.id) && b.shooterId !== myId) {
      const shooter = state.players.find(p => p.id === b.shooterId);
      if (shooter) {
        playShot(b.weapon || 'pistol', distAtten(shooter.x, shooter.y));
        recoilOffset[shooter.id] = { amount: 6, weapon: b.weapon };
      }
    }
  });
  seenBullets.clear();
  currentIds.forEach(id => seenBullets.add(id));

  gameState = state;
  const me = state.players.find(p => p.id === myId);
  if (me) {
    updateHpHUD(me.hp);
    if (!me.alive && !isDead) {
      isDead = true;
      // Only show plain game-over overlay if no respawn is coming (single mode)
      if (gameMode === 'single') {
        document.getElementById('game-over-overlay').style.display = 'flex';
      }
    }
  }
  if (gameMode === 'team') {
    document.getElementById('red-count').textContent  =
      state.players.filter(p=>p.team==='red').reduce((s,p)=>s+(p.kills||0),0);
    document.getElementById('blue-count').textContent =
      state.players.filter(p=>p.team==='blue').reduce((s,p)=>s+(p.kills||0),0);
  } else if (gameMode === 'ffa' && me) {
    const el = document.getElementById('my-kills');
    if (el) el.textContent = me.kills || 0;
  }
});

socket.on('bulletHit', ({ x, y, targetId }) => {
  hitEffects.push({ x, y, r:0, life:1 });
  playHit(distAtten(x, y));
  // Trigger recoil on hit target too (kick-back when shot)
  if (targetId && targetId !== myId) {
    recoilOffset[targetId] = { amount: 4, weapon: 'pistol' };
  }
});

socket.on('gotHit', ({ damage, hp }) => {
  updateHpHUD(hp);
  const f = document.getElementById('hit-flash');
  f.style.opacity = '1';
  setTimeout(() => f.style.opacity = '0', 180);
  addShake(3.5);
});

socket.on('playerKilled', ({ deadId, killerName, x, y }) => {
  const dead = gameState.players.find(p=>p.id===deadId);
  addKillFeed(killerName, dead?.name||'???');
  // Explosion: visual ring + sound + shake
  const ex = (x ?? dead?.x ?? 0), ey = (y ?? dead?.y ?? 0);
  explosions.push({ x:ex, y:ey, r:5, life:1.0 });
  playExplosion(distAtten(ex, ey));
  if (deadId === myId) {
    isDead = true;
    addShake(20);
  } else {
    addShake(6 * distAtten(ex, ey));
  }
});

socket.on('respawnPending', ({ delay }) => {
  // Show countdown overlay
  const ov = document.getElementById('game-over-overlay');
  if (!ov) return;
  ov.style.display = 'flex';
  let left = Math.ceil(delay/1000);
  ov.innerHTML = `
    <div style="font-size:54px">💥</div>
    <div style="font-size:24px;font-weight:900;color:#EF4444">파괴됨</div>
    <div style="font-size:16px;color:rgba(255,255,255,0.7)">재출격까지 <span id="resp-cd" style="color:#FBBF24;font-weight:900">${left}</span>초</div>
  `;
  clearInterval(window._respInt);
  window._respInt = setInterval(() => {
    left--;
    const el = document.getElementById('resp-cd');
    if (el) el.textContent = left;
    if (left <= 0) clearInterval(window._respInt);
  }, 1000);
});

socket.on('respawned', ({ hp, x, y }) => {
  isDead = false;
  updateHpHUD(hp);
  document.getElementById('game-over-overlay').style.display = 'none';
  clearInterval(window._respInt);
  ammo = WEAPONS_CFG[myWeapon]?.maxAmmo || 12;
  isReloading = false;
  updateAmmoHUD();
  const btn = document.getElementById('reload-btn');
  btn.classList.remove('reloading'); btn.textContent = '재장전';
  toast('🚀 재출격!', 1500);
  addShake(4);
});

socket.on('waveCleared', ({ wave }) => {
  showWaveAnnounce(`✅ 웨이브 ${wave} 클리어!`, '잠시 후 다음 웨이브…', 4000);
});

socket.on('waveStarted', ({ wave }) => {
  waveNum = wave;
  document.getElementById('wave-label').textContent = `웨이브 ${waveNum} / ${totalWaves}`;
  showWaveAnnounce(`🌊 웨이브 ${wave}`, '전투 개시!');
  ammo = WEAPONS_CFG[myWeapon]?.maxAmmo || 12;
  isReloading = false; isDead = false;
  updateAmmoHUD();
  document.getElementById('game-over-overlay').style.display = 'none';
  const btn = document.getElementById('reload-btn');
  btn.classList.remove('reloading'); btn.textContent = '재장전';
});

socket.on('hpRecovered', ({ hp }) => { updateHpHUD(hp); });

socket.on('gameEnded', data => {
  gameActive = false;
  document.getElementById('game-over-overlay').style.display = 'none';
  const overlay = document.getElementById('game-result-overlay');
  const title   = document.getElementById('result-title');
  const table   = document.getElementById('result-table');
  overlay.style.display = 'flex';

  if (data.mode === 'single') {
    title.textContent = data.victory ? '🏆 승리!' : '💀 게임 오버';
    title.style.color = data.victory ? '#10B981' : '#EF4444';
  } else if (data.mode === 'ffa') {
    const winner = gameState.players.find(p=>p.id===data.winnerId);
    title.textContent = data.winnerId===myId ? '🏆 우승!' : `${winner?.name||'?'} 우승!`;
    title.style.color = data.winnerId===myId ? '#10B981' : '#F59E0B';
  } else {
    title.textContent = `${data.winnerTeam==='red'?'🔴 레드':'🔵 블루'} 팀 승리!`;
    title.style.color = data.winnerTeam===myTeam ? '#10B981' : '#EF4444';
  }

  let html = '<tr><th>이름</th><th>킬</th><th>상태</th></tr>';
  (data.stats||[]).sort((a,b)=>b.kills-a.kills).forEach(p => {
    html += `<tr><td>${escHtml(p.name)}</td><td>${p.kills}</td><td>${p.alive?'✅ 생존':'💀 사망'}</td></tr>`;
  });
  table.innerHTML = html;
});

socket.on('playerLeft', ({ playerId }) => {
  gameState.players = gameState.players.filter(p=>p.id!==playerId);
});

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ─── Input sending (30 Hz) ─── */
let lastInputTime = 0;
function sendInput() {
  const now = Date.now();
  if (now - lastInputTime < 33) return;
  lastInputTime = now;

  let dx=0, dy=0;
  if (keys['KeyW']||keys['ArrowUp'])    dy -= 1;
  if (keys['KeyS']||keys['ArrowDown'])  dy += 1;
  if (keys['KeyA']||keys['ArrowLeft'])  dx -= 1;
  if (keys['KeyD']||keys['ArrowRight']) dx += 1;
  if (joy.active) { dx = joy.dx; dy = joy.dy; }

  const len = Math.hypot(dx,dy);
  if (len > 1) { dx/=len; dy/=len; }

  if (!isDead) socket.emit('moveInput', {
    dx, dy,
    angle: cheatActive ? cheatAngle : aimAngle,
  });
}

/* ─── Main game loop ─── */
let lastFrame = 0;
function gameLoop(now) {
  requestAnimationFrame(gameLoop);
  const dt = Math.min((now - lastFrame)/1000, 0.1);
  lastFrame = now;

  sendInput();
  if (!cheatActive && (mouseDown || touchFire)) tryShoot();
  tickCheat(dt);
  updateCheatBtn();
  updateCamera();
  render(dt);
}

/* ─── Camera ─── */
function updateCamera() {
  const me = gameState.players.find(p=>p.id===myId);
  if (!me) return;
  const targetX = me.x - canvas.width/2;
  const targetY = me.y - canvas.height/2;
  const minX = canvas.width  > mapW ? -(canvas.width-mapW)/2  : 0;
  const maxX = canvas.width  > mapW ? minX                    : mapW - canvas.width;
  const minY = canvas.height > mapH ? -(canvas.height-mapH)/2 : 0;
  const maxY = canvas.height > mapH ? minY                    : mapH - canvas.height;
  camX += (Math.max(minX, Math.min(maxX, targetX)) - camX) * 0.13;
  camY += (Math.max(minY, Math.min(maxY, targetY)) - camY) * 0.13;
}

/* ─── Render ─── */
function render(dt) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Decay screen shake
  shakeAmt = Math.max(0, shakeAmt - dt*60);
  const sx = (Math.random()-0.5) * shakeAmt;
  const sy = (Math.random()-0.5) * shakeAmt;

  // Decay recoil
  for (const id in recoilOffset) {
    recoilOffset[id].amount -= dt*30;
    if (recoilOffset[id].amount <= 0) delete recoilOffset[id];
  }

  ctx.save();
  ctx.translate(-camX + sx, -camY + sy);
    drawMap();
    drawBullets();
    drawPlayers();
    drawHitEffects(dt);
    drawExplosions(dt);
  ctx.restore();

  drawMinimap();
  // Only draw the center crosshair when not using the on-screen aim stick
  if (!isDead && gameActive && !aim.active) drawCrosshair();
  drawJoystick();
  drawAimReticle();
}

/* ─── Draw Map ─── */
function drawMap() {
  const g = ctx.createLinearGradient(0, 0, mapW, mapH);
  g.addColorStop(0, '#0d1117'); g.addColorStop(1, '#161b22');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, mapW, mapH);

  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  for (let x=0; x<=mapW; x+=64) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,mapH); ctx.stroke(); }
  for (let y=0; y<=mapH; y+=64) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(mapW,y); ctx.stroke(); }

  // Floor accent dots
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let x=96; x<mapW; x+=128) {
    for (let y=96; y<mapH; y+=128) {
      ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI*2); ctx.fill();
    }
  }

  const wlist = walls.length ? walls : MAP_WALLS_FALLBACK;
  wlist.forEach(w => {
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(w.x+5, w.y+5, w.w, w.h);
    // Body
    const wg = ctx.createLinearGradient(w.x, w.y, w.x+w.w, w.y+w.h);
    wg.addColorStop(0, '#4B5563'); wg.addColorStop(1, '#374151');
    ctx.fillStyle = wg;
    ctx.fillRect(w.x, w.y, w.w, w.h);
    // Top-left highlight
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.fillRect(w.x, w.y, w.w, Math.min(3, w.h));
    ctx.fillRect(w.x, w.y, Math.min(3, w.w), w.h);
    // Bottom-right shadow
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(w.x+w.w-3, w.y+3, 3, w.h-3);
    ctx.fillRect(w.x+3, w.y+w.h-3, w.w-3, 3);
  });
}

/* ─── Draw Players (as tanks) ─── */
function drawPlayers() {
  const sorted = [...gameState.players].sort((a,b)=>(a.alive?1:0)-(b.alive?1:0));
  sorted.forEach(p => drawTank(p));
}

function getTankColors(p) {
  const char = p.character || {};
  const isMe    = p.id === myId;
  const isAlly  = gameMode==='team' && p.team===myTeam && !isMe;
  const isEnemy = !isMe && !isAlly;

  // Team-mode overrides — body color follows team color so you can tell sides
  let body = char.bodyColor || char.skinColor || '#4B6B3A';
  if (p.team === 'red')  body = char.bodyColor || '#8B2D2D';
  if (p.team === 'blue') body = char.bodyColor || '#1E3A8A';

  return {
    body,
    turret: char.turretColor || char.hairColor  || '#2A3F1F',
    track:  char.trackColor  || char.pantsColor || '#1C1C1C',
    accent: char.accentColor || char.shirtColor || '#FBBF24',
    isMe, isAlly, isEnemy,
  };
}

function drawTank(p) {
  const char     = p.character || {};
  const chassisK = char.chassis || char.hairStyle || 'medium';
  const s        = TANK_CHASSIS[chassisK] || TANK_CHASSIS.medium;
  const cols     = getTankColors(p);
  const useAngle = (cols.isMe && cheatActive) ? cheatAngle : p.angle;

  // Dead tank — show wreck
  if (!p.alive) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle + Math.PI/2);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(-s.w/2-4, -s.h/2, s.w+8, s.h);
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(0, 0, s.tw/2, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    ctx.font = '20px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('💥', p.x, p.y+6);
    return;
  }

  // Ground shadow
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + s.h*0.55, s.w*0.62, 5, 0, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fill();

  // Cheat aura around self
  if (cols.isMe && cheatActive) {
    const t = (Date.now() % 1000) / 1000;
    for (let k=0; k<6; k++) {
      const a = useAngle + k*Math.PI/3 + t*Math.PI*2;
      const rr = s.w*0.7 + 12 + Math.sin(t*Math.PI*2 + k)*3;
      ctx.beginPath();
      ctx.arc(p.x+Math.cos(a)*rr, p.y+Math.sin(a)*rr, 4, 0, Math.PI*2);
      ctx.fillStyle = `hsl(${(k*60 + t*360)%360}, 90%, 60%)`;
      ctx.shadowBlur = 14; ctx.shadowColor = ctx.fillStyle;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  // === Tank body (rotates with aim angle) ===
  ctx.save();
  ctx.translate(p.x, p.y);
  // Tank body is drawn pointing "up" (-Y) before rotation; +PI/2 makes it face aimAngle
  ctx.rotate(useAngle + Math.PI/2);

  // Tracks (left + right of body)
  ctx.fillStyle = cols.track;
  ctx.fillRect(-s.w/2 - 5, -s.h/2, 5, s.h);
  ctx.fillRect( s.w/2,     -s.h/2, 5, s.h);
  // Track tread lines
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  for (let i = -s.h/2 + 4; i < s.h/2 - 1; i += 5) {
    ctx.fillRect(-s.w/2 - 5, i, 5, 1.5);
    ctx.fillRect( s.w/2,     i, 5, 1.5);
  }
  // Drive wheels (front + rear of each track)
  ctx.fillStyle = '#0a0a0a';
  [-s.h/2+2, s.h/2-4].forEach(yy => {
    ctx.beginPath(); ctx.arc(-s.w/2 - 2.5, yy+1, 3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc( s.w/2 + 2.5, yy+1, 3, 0, Math.PI*2); ctx.fill();
  });

  // Body chassis
  ctx.fillStyle = cols.body;
  ctx.fillRect(-s.w/2, -s.h/2, s.w, s.h);

  // Body highlight gradient
  const bg = ctx.createLinearGradient(0, -s.h/2, 0, s.h/2);
  bg.addColorStop(0, 'rgba(255,255,255,0.22)');
  bg.addColorStop(0.4, 'rgba(255,255,255,0)');
  bg.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = bg;
  ctx.fillRect(-s.w/2, -s.h/2, s.w, s.h);

  // Accent stripe down center
  ctx.fillStyle = cols.accent;
  ctx.fillRect(-2, -s.h/2 + 4, 4, s.h - 8);

  // Body outline
  ctx.strokeStyle = cols.isMe ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.5)';
  ctx.lineWidth   = cols.isMe ? 2 : 1.4;
  ctx.strokeRect(-s.w/2, -s.h/2, s.w, s.h);

  // Front armor plate hint (slight darker rectangle at front = -Y)
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(-s.w/2 + 3, -s.h/2 + 2, s.w - 6, 4);

  // === Turret ===
  ctx.fillStyle = cols.turret;
  ctx.beginPath();
  ctx.arc(0, 0, s.tw/2, 0, Math.PI*2);
  ctx.fill();
  // Turret highlight
  const tg = ctx.createRadialGradient(-s.tw*0.2, -s.tw*0.2, 1, 0, 0, s.tw/2);
  tg.addColorStop(0, 'rgba(255,255,255,0.25)');
  tg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = tg; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.4; ctx.stroke();

  // Hatch dot on turret
  ctx.beginPath(); ctx.arc(0, s.tw*0.15, s.tw*0.13, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();

  // === Barrel (forward = -Y direction) ===
  const bw = s.barW;
  const recoil = recoilOffset[p.id]?.amount || 0;  // push barrel BACK (+Y)
  // Barrel mount
  ctx.fillStyle = cols.turret;
  ctx.fillRect(-bw - 1, -s.tw/2 - 3, bw*2 + 2, 5);
  // Barrel
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(-bw/2, -s.tw/2 - s.barL + recoil, bw, s.barL);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-bw/2, -s.tw/2 - s.barL + recoil, bw, s.barL);
  // Muzzle brake
  ctx.fillStyle = '#444';
  ctx.fillRect(-bw, -s.tw/2 - s.barL - 4 + recoil, bw*2, 4);

  // Muzzle flash on recoil
  if (recoil > 2) {
    ctx.beginPath();
    ctx.arc(0, -s.tw/2 - s.barL - 4 + recoil, recoil*0.9, 0, Math.PI*2);
    ctx.fillStyle = `rgba(255,220,120,${recoil/8})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -s.tw/2 - s.barL - 4 + recoil, recoil*0.5, 0, Math.PI*2);
    ctx.fillStyle = `rgba(255,255,200,${recoil/6})`;
    ctx.fill();
  }

  ctx.restore();

  // === Name + HP (screen-aligned) ===
  const nameColor = cols.isMe ? '#6EE7B7' : cols.isEnemy ? '#FCA5A5' : '#93C5FD';
  ctx.fillStyle = nameColor;
  ctx.font = `${cols.isMe?'bold ':''}11px "Courier New",monospace`;
  ctx.textAlign = 'center';
  ctx.fillText((p.name||'?').split(' ').slice(0,2).join(' '), p.x, p.y - s.h/2 - 8);

  // HP bar
  const bw2 = Math.max(44, s.w + 8), bh = 5;
  const bx = p.x - bw2/2, by = p.y + s.h/2 + 8;
  const maxHp = p.maxHp || (p.isBot ? 900 : PLAYER_MAX_HP);
  const hpPct = Math.max(0, Math.min(1, p.hp/maxHp));
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(bx-1, by-1, bw2+2, bh+2);
  ctx.fillStyle = hpPct>0.5?'#10B981' : hpPct>0.25?'#F59E0B' : '#EF4444';
  ctx.fillRect(bx, by, bw2*hpPct, bh);
}

/* ─── Draw Bullets ─── */
function drawBullets() {
  gameState.bullets.forEach(b => {
    const clr = WEAPONS_CFG[b.weapon]?.color || '#FFD700';
    ctx.shadowBlur  = 14; ctx.shadowColor = clr;
    ctx.beginPath(); ctx.arc(b.x, b.y, BULLET_R, 0, Math.PI*2);
    ctx.fillStyle = clr; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(b.x, b.y, BULLET_R*0.45, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fill();
  });
}

/* ─── Explosions ─── */
function drawExplosions(dt) {
  for (let i = explosions.length-1; i >= 0; i--) {
    const e = explosions[i];
    e.r += 220*dt;
    e.life -= dt*1.3;
    if (e.life <= 0) { explosions.splice(i, 1); continue; }

    // Outer shockwave
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, Math.PI*2);
    ctx.strokeStyle = `rgba(255,160,40,${e.life*0.9})`;
    ctx.lineWidth = 4 * e.life;
    ctx.stroke();

    // Inner core
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r*0.45, 0, Math.PI*2);
    ctx.fillStyle = `rgba(255,220,120,${e.life*0.6})`;
    ctx.fill();

    // Sparks
    for (let s=0; s<6; s++) {
      const a  = s/6 * Math.PI*2 + e.life*4;
      const dx = Math.cos(a)*e.r*0.9;
      const dy = Math.sin(a)*e.r*0.9;
      ctx.beginPath();
      ctx.arc(e.x+dx, e.y+dy, 3*e.life, 0, Math.PI*2);
      ctx.fillStyle = `rgba(255,200,80,${e.life})`;
      ctx.fill();
    }
  }
}

/* ─── Hit effects ─── */
function drawHitEffects(dt) {
  for (let i = hitEffects.length-1; i >= 0; i--) {
    const e = hitEffects[i];
    e.r   += 90*dt; e.life -= dt*2.5;
    if (e.life <= 0) { hitEffects.splice(i,1); continue; }
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI*2);
    ctx.strokeStyle = `rgba(255,200,80,${e.life})`;
    ctx.lineWidth   = 2.5*e.life; ctx.stroke();
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r*0.3, 0, Math.PI*2);
    ctx.strokeStyle = `rgba(255,255,180,${e.life*0.45})`;
    ctx.lineWidth   = 1; ctx.stroke();
  }
}

/* ─── Minimap ─── */
function drawMinimap() {
  const SZ=130, PAD=14;
  const mx=PAD, my=canvas.height-SZ-PAD;
  const sx=SZ/mapW, sy=SZ/mapH;

  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  roundRect(ctx, mx, my, SZ, SZ, 7);
  ctx.fill(); ctx.stroke();

  ctx.save();
  roundRect(ctx, mx, my, SZ, SZ, 7);
  ctx.clip();

  ctx.fillStyle = 'rgba(100,120,160,0.5)';
  const wlist = walls.length ? walls : MAP_WALLS_FALLBACK;
  wlist.forEach(w => {
    ctx.fillRect(mx+w.x*sx, my+w.y*sy, Math.max(1,w.w*sx), Math.max(1,w.h*sy));
  });

  gameState.players.forEach(p => {
    if (!p.alive) return;
    const isMe = p.id === myId;
    const px   = mx+p.x*sx, py = my+p.y*sy;
    const col  = isMe?'#10B981' : p.team==='red'?'#EF4444' : p.team==='blue'?'#3B82F6' : '#F59E0B';
    ctx.beginPath(); ctx.arc(px, py, isMe?4.5:2.5, 0, Math.PI*2);
    ctx.fillStyle = col; ctx.shadowBlur=isMe?10:0; ctx.shadowColor=col; ctx.fill();
    ctx.shadowBlur = 0;
    if (isMe) {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px+Math.cos(p.angle)*7, py+Math.sin(p.angle)*7);
      ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();
    }
  });
  ctx.restore();

  ctx.fillStyle='rgba(255,255,255,0.22)'; ctx.font='9px monospace'; ctx.textAlign='left';
  ctx.fillText('MAP', mx+4, my+SZ-4);
}

/* ─── Crosshair ─── */
function drawCrosshair() {
  const cx=canvas.width/2, cy=canvas.height/2;
  const size=14, gap=5;
  ctx.strokeStyle='rgba(255,255,255,0.8)'; ctx.lineWidth=1.5;
  ctx.beginPath();
  ctx.moveTo(cx-size-gap,cy); ctx.lineTo(cx-gap,cy);
  ctx.moveTo(cx+gap,cy);      ctx.lineTo(cx+size+gap,cy);
  ctx.moveTo(cx,cy-size-gap); ctx.lineTo(cx,cy-gap);
  ctx.moveTo(cx,cy+gap);      ctx.lineTo(cx,cy+size+gap);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,2,0,Math.PI*2);
  ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.fill();
}

/* ─── World aim reticle (shows where bullets will go) ─── */
function drawAimReticle() {
  if (isDead || !gameActive) return;
  const me = gameState.players.find(p=>p.id===myId);
  if (!me) return;

  const useAng = cheatActive ? cheatAngle : aimAngle;

  // Short laser line from player → small dot at the end
  const start = PLAYER_R + 18;
  const len   = 110;  // closer = easier to read
  const sx = me.x + Math.cos(useAng)*start - camX;
  const sy = me.y + Math.sin(useAng)*start - camY;
  const tx = me.x + Math.cos(useAng)*(start+len) - camX;
  const ty = me.y + Math.sin(useAng)*(start+len) - camY;

  // Dashed thin guide line
  ctx.save();
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(sx, sy); ctx.lineTo(tx, ty);
  ctx.strokeStyle = touchFire ? 'rgba(252,165,165,0.85)' : 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.setLineDash([]);

  // Small reticle dot at tip
  ctx.beginPath();
  ctx.arc(tx, ty, 5, 0, Math.PI*2);
  ctx.strokeStyle = touchFire ? 'rgba(252,165,165,1)' : 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(tx, ty, 1.5, 0, Math.PI*2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();
}

/* ─── Virtual joysticks (movement + aim) ─── */
function drawJoystick() {
  // Move stick (left)
  if (joy.active) {
    const bx=joy.bx, by=joy.by;
    const dx=joy.cx-bx, dy=joy.cy-by;
    const d=Math.min(Math.hypot(dx,dy),JOY_R);
    const a=Math.atan2(dy,dx);
    const kx=bx+Math.cos(a)*d, ky=by+Math.sin(a)*d;

    ctx.beginPath(); ctx.arc(bx,by,JOY_R,0,Math.PI*2);
    ctx.strokeStyle='rgba(110,231,183,0.4)'; ctx.lineWidth=2.5; ctx.stroke();
    ctx.fillStyle='rgba(16,185,129,0.06)'; ctx.fill();
    ctx.beginPath(); ctx.arc(kx,ky,JOY_R*0.38,0,Math.PI*2);
    ctx.fillStyle='rgba(110,231,183,0.35)'; ctx.fill();
    ctx.strokeStyle='rgba(110,231,183,0.7)'; ctx.lineWidth=1.5; ctx.stroke();
  }

  // Aim stick (right)
  if (aim.active) {
    const bx=aim.bx, by=aim.by;
    const dx=aim.cx-bx, dy=aim.cy-by;
    const d = Math.min(Math.hypot(dx,dy), AIM_R);
    const a = Math.atan2(dy, dx);
    const kx=bx+Math.cos(a)*d, ky=by+Math.sin(a)*d;

    // Outer ring
    ctx.beginPath(); ctx.arc(bx,by,AIM_R,0,Math.PI*2);
    ctx.strokeStyle = touchFire ? 'rgba(252,165,165,0.7)' : 'rgba(252,165,165,0.4)';
    ctx.lineWidth=2.5; ctx.stroke();
    ctx.fillStyle='rgba(239,68,68,0.06)'; ctx.fill();

    // Dead zone
    ctx.beginPath(); ctx.arc(bx,by,AIM_DEAD,0,Math.PI*2);
    ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1; ctx.stroke();

    // Direction line
    if (touchFire) {
      ctx.beginPath();
      ctx.moveTo(bx,by);
      ctx.lineTo(bx+Math.cos(a)*AIM_R, by+Math.sin(a)*AIM_R);
      ctx.strokeStyle='rgba(252,165,165,0.55)';
      ctx.lineWidth=2; ctx.stroke();
    }

    // Knob
    ctx.beginPath(); ctx.arc(kx,ky,AIM_R*0.34,0,Math.PI*2);
    ctx.fillStyle = touchFire ? 'rgba(252,165,165,0.55)' : 'rgba(252,165,165,0.3)';
    ctx.fill();
    ctx.strokeStyle = touchFire ? '#fff' : 'rgba(252,165,165,0.7)';
    ctx.lineWidth=1.8; ctx.stroke();

    // Crosshair icon in knob
    ctx.beginPath();
    ctx.moveTo(kx-6, ky); ctx.lineTo(kx+6, ky);
    ctx.moveTo(kx, ky-6); ctx.lineTo(kx, ky+6);
    ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.lineWidth=1.4; ctx.stroke();
  }
}

/* ─── Utility ─── */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);   ctx.arcTo(x+w, y,   x+w,   y+r,   r);
  ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w, y+h, x+w-r, y+h,   r);
  ctx.lineTo(x+r, y+h);   ctx.arcTo(x,   y+h, x,     y+h-r, r);
  ctx.lineTo(x,   y+r);   ctx.arcTo(x,   y,   x+r,   y,     r);
  ctx.closePath();
}
