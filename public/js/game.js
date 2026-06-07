/* =========================================================
   Church Tank Battle — 3D Client (Three.js)
   ========================================================= */
'use strict';

const socket = io();

/* ─── World constants ─── */
const PLAYER_R = 22;
const BULLET_R = 6;
const PLAYER_MAX_HP = 700;
let   mapW = 1800, mapH = 1200;
let   walls = [];
const MAP_WALLS_FALLBACK = [
  { x:0,y:0,w:1800,h:20 }, { x:0,y:1180,w:1800,h:20 },
  { x:0,y:0,w:20,h:1200 }, { x:1780,y:0,w:20,h:1200 },
];

/* ─── Chassis ─── */
const TANK_CHASSIS = {
  light:   { w:32, h:40, tw:18, th:20, barL:22, barW:3.5 },
  medium:  { w:38, h:46, tw:22, th:24, barL:26, barW:4 },
  heavy:   { w:46, h:54, tw:28, th:30, barL:28, barW:5 },
  sniper:  { w:32, h:44, tw:18, th:20, barL:40, barW:3 },
  scout:   { w:28, h:36, tw:16, th:18, barL:20, barW:3 },
};
const CHASSIS_STATS = {
  light:   { hp:500,  speedMul:1.30, dmgMul:0.85 },
  medium:  { hp:700,  speedMul:1.00, dmgMul:1.00 },
  heavy:   { hp:1000, speedMul:0.72, dmgMul:1.15 },
  sniper:  { hp:600,  speedMul:0.95, dmgMul:1.35 },
  scout:   { hp:550,  speedMul:1.25, dmgMul:0.90 },
};

/* ─── Weapon config (client) ─── */
const WEAPONS_CFG = {
  pistol:  { ammo:15, maxAmmo:15, reloadTime:900,  fireRate:320,  name:'기관포',   color:0xFFD700 },
  shotgun: { ammo:8,  maxAmmo:8,  reloadTime:1700, fireRate:900,  name:'산탄포',   color:0xFF6B00 },
  rifle:   { ammo:35, maxAmmo:35, reloadTime:1500, fireRate:110,  name:'속사포',   color:0x6EE7B7 },
  sniper:  { ammo:6,  maxAmmo:6,  reloadTime:2400, fireRate:1400, name:'저격포',   color:0x60A5FA },
  smg:     { ammo:32, maxAmmo:32, reloadTime:1300, fireRate:65,   name:'유탄포',   color:0xC084FC },
};

/* ─── Powerup definitions ─── */
const POWERUP_DEFS = {
  health: { icon:'❤️', color:0xef4444, name:'체력 회복' },
  shield: { icon:'🛡️', color:0x60a5fa, name:'방어막' },
  speed:  { icon:'⚡', color:0xfbbf24, name:'가속' },
  damage: { icon:'🔥', color:0xf97316, name:'데미지×2' },
};

/* ─── State ─── */
let myId = null, myTeam = null, gameMode = null;
let gameActive = false, isDead = false;
let myHp = 100, myWeapon = 'pistol', ammo = 12;
let isReloading = false, lastShot = 0;
let waveNum = 1, totalWaves = 5;
let gameState = { players:[], bullets:[], powerups:[] };

/* ─── Three.js scene ─── */
const T = {
  renderer: null, scene: null, camera: null,
  ground: null, gridHelper: null, ambient: null, sun: null,
  wallGroup: null,
  tanks: new Map(),         // playerId → tank entry
  bullets: new Map(),       // bulletId → mesh
  powerups: new Map(),      // powerupId → mesh
  treads: [],               // pool of fading tread mark planes
  treadIdx: 0,
  dustParticles: [],
  bulletTrails: new Map(),  // bulletId → trail points
  lastTreadDrop: {},        // playerId → timestamp
  initialized: false,
};

/* ─── 2D overlay canvas (HUD: minimap, joystick, crosshair, kill markers) ─── */
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

/* ─── Input ─── */
const keys = {};
let aimAngle = 0;
let mouseDown = false;

window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyR' && !isReloading) startReload();
  if (e.code === 'KeyC') triggerCheat();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

window.addEventListener('mousemove', e => {
  aimAngle = Math.atan2(e.clientY - canvas.height/2, e.clientX - canvas.width/2);
});
window.addEventListener('mousedown', e => {
  if (e.button === 0) { mouseDown = true; tryShoot(); }
});
window.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });

/* ─── Touch (dual joystick) ─── */
const JOY_R = 58, AIM_R = 48, AIM_DEAD = 10;
const joy = { active:false, id:null, bx:0, by:0, cx:0, cy:0, dx:0, dy:0 };
const aim = { active:false, id:null, bx:0, by:0, cx:0, cy:0, dist:0 };
let touchFire = false;

const touchCatcher = document.getElementById('touch-catcher');
touchCatcher.addEventListener('touchstart', onTS, { passive:false });
touchCatcher.addEventListener('touchmove',  onTM, { passive:false });
touchCatcher.addEventListener('touchend',   onTE, { passive:false });
touchCatcher.addEventListener('touchcancel',onTE, { passive:false });

function onTS(e) {
  e.preventDefault();
  const hint = document.getElementById('touch-hint');
  if (hint && hint.style.display !== 'none') hint.style.display = 'none';
  for (const t of e.changedTouches) {
    if (t.clientX < canvas.width/2 && !joy.active) {
      joy.active = true; joy.id = t.identifier;
      joy.bx = t.clientX; joy.by = t.clientY;
      joy.cx = t.clientX; joy.cy = t.clientY;
      joy.dx = 0; joy.dy = 0;
    } else if (t.clientX >= canvas.width/2 && !aim.active) {
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
      const d = Math.hypot(dx, dy);
      joy.dx = d > 0 ? dx/Math.max(d, JOY_R) : 0;
      joy.dy = d > 0 ? dy/Math.max(d, JOY_R) : 0;
    } else if (t.identifier === aim.id) {
      aim.cx = t.clientX; aim.cy = t.clientY;
      const dx = t.clientX - aim.bx, dy = t.clientY - aim.by;
      const d = Math.hypot(dx, dy);
      aim.dist = d;
      if (d > AIM_DEAD) {
        aimAngle = Math.atan2(dy, dx);
        touchFire = true;
      } else { touchFire = false; }
    }
  }
}
function onTE(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) { joy.active=false; joy.id=null; joy.dx=0; joy.dy=0; }
    if (t.identifier === aim.id) { aim.active=false; aim.id=null; aim.dist=0; touchFire=false; }
  }
}

/* ─── Shoot ─── */
function tryShoot() {
  if (!gameActive || isDead || isReloading) return;
  const cfg = WEAPONS_CFG[myWeapon]; if (!cfg) return;
  const now = Date.now();
  if (now - lastShot < cfg.fireRate) return;
  if (ammo <= 0) { startReload(); return; }
  lastShot = now;
  ammo--;
  updateAmmoHUD();
  socket.emit('shoot', { angle: aimAngle, weapon: myWeapon });
  playShot(myWeapon, 1);
  const shake = ({ pistol:1.4, shotgun:5, rifle:1.2, sniper:6, smg:0.9 })[myWeapon] || 1.5;
  addShake(shake);
  recoilOffset[myId] = { amount: 7 };
  if (ammo <= 0) startReload();
}

function startReload() {
  if (isReloading) return;
  const cfg = WEAPONS_CFG[myWeapon]; if (!cfg) return;
  isReloading = true;
  const btn = document.getElementById('reload-btn');
  btn.classList.add('reloading'); btn.textContent = '장전 중...';
  setTimeout(() => {
    ammo = cfg.maxAmmo;
    isReloading = false;
    btn.classList.remove('reloading'); btn.textContent = '재장전';
    updateAmmoHUD();
  }, cfg.reloadTime);
}

document.getElementById('reload-btn').addEventListener('click', startReload);
document.getElementById('cheat-btn').addEventListener('click', triggerCheat);

/* ─── HUD ─── */
function updateAmmoHUD() {
  const cfg = WEAPONS_CFG[myWeapon];
  document.getElementById('ammo-cur').textContent = ammo;
  document.getElementById('ammo-max').textContent = ' / '+(cfg?.maxAmmo||0);
  document.getElementById('ammo-weapon-name').textContent = cfg?.name || myWeapon;
}
function updateHpHUD(hp) {
  myHp = hp;
  const pct = Math.max(0, Math.min(100, (hp/PLAYER_MAX_HP)*100));
  document.getElementById('hp-num').textContent = hp;
  document.getElementById('hp-fill').style.width = pct+'%';
  document.getElementById('hp-fill').style.background =
    pct>50?'#10B981' : pct>25?'#F59E0B' : '#EF4444';
}

/* ─── Effects state ─── */
const hitEffects   = [];
const explosions   = [];
const recoilOffset = {};
const hitFlashUntil = {};  // playerId → timestamp; show red tint until then
let shakeAmt = 0;
function addShake(amount) { shakeAmt = Math.min(28, shakeAmt + amount); }

/* ─── Cheat mode ─── */
const CHEAT_DURATION = 4000;
const CHEAT_COOLDOWN = 12000;
const CHEAT_SPIN_SPEED = 5.2;
const CHEAT_FIRE_MS = 22;
let cheatActive = false, cheatEndAt = 0, cheatCDUntil = 0;
let cheatLastShot = 0, cheatAngle = 0;
function triggerCheat() {
  if (cheatActive || isDead || !gameActive) return;
  const now = Date.now();
  if (now < cheatCDUntil) {
    toast(`⏱️ 쿨다운 ${Math.ceil((cheatCDUntil-now)/1000)}초`, 1200);
    return;
  }
  cheatActive = true;
  cheatEndAt = now + CHEAT_DURATION;
  cheatCDUntil = now + CHEAT_DURATION + CHEAT_COOLDOWN;
  cheatAngle = aimAngle;
  document.getElementById('cheat-btn').classList.add('active');
  toast('🌀 난사 모드!', 1200);
}
function updateCheatBtn() {
  const btn = document.getElementById('cheat-btn'); if (!btn) return;
  const now = Date.now();
  if (cheatActive) return;
  if (now < cheatCDUntil) {
    btn.classList.add('cooldown'); btn.classList.remove('active');
    const sec = Math.ceil((cheatCDUntil-now)/1000);
    btn.innerHTML = `${sec}s<br><span style="font-size:9px">대기</span>`;
  } else {
    btn.classList.remove('cooldown'); btn.classList.remove('active');
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
  cheatAngle += CHEAT_SPIN_SPEED * dt;
  if (now - cheatLastShot >= CHEAT_FIRE_MS) {
    cheatLastShot = now;
    socket.emit('shoot', { angle: cheatAngle, weapon: myWeapon, cheat:true });
    socket.emit('shoot', { angle: cheatAngle + 0.06, weapon: myWeapon, cheat:true });
  }
}

/* ─── WebAudio sound system ─── */
let audioCtx = null, masterGain = null, bgmGain = null, bgmStarted = false, bgmNodes = [];
let engineOsc = null, engineGain = null;
function ensureAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain(); masterGain.gain.value = 0.45;
    masterGain.connect(audioCtx.destination);
    bgmGain = audioCtx.createGain(); bgmGain.gain.value = 0.14;
    bgmGain.connect(masterGain);
    // Engine drone — persistent low oscillator with gain that ramps with movement
    engineOsc = audioCtx.createOscillator();
    engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 60;
    const eFilt = audioCtx.createBiquadFilter();
    eFilt.type = 'lowpass'; eFilt.frequency.value = 200;
    engineGain = audioCtx.createGain(); engineGain.gain.value = 0;
    engineOsc.connect(eFilt).connect(engineGain).connect(masterGain);
    engineOsc.start();
  } catch (e) { console.warn(e); }
}
['click','touchstart','keydown'].forEach(ev => {
  window.addEventListener(ev, () => {
    ensureAudio();
    if (audioCtx?.state === 'suspended') audioCtx.resume();
    if (!bgmStarted) { startBGM(); bgmStarted = true; }
  }, { once:true });
});
function playShot(weapon, distAtt=1) {
  if (!audioCtx) return;
  const ctx2 = audioCtx, now = ctx2.currentTime;
  const cfg = {
    pistol:  { freq:380, dur:0.10, q:1.5, type:'square',   vol:0.25 },
    shotgun: { freq:140, dur:0.22, q:0.8, type:'sawtooth', vol:0.40 },
    rifle:   { freq:520, dur:0.07, q:2.0, type:'square',   vol:0.20 },
    sniper:  { freq:220, dur:0.30, q:1.0, type:'sawtooth', vol:0.45 },
    smg:     { freq:620, dur:0.05, q:2.5, type:'square',   vol:0.15 },
  }[weapon] || { freq:380, dur:0.10, q:1.5, type:'square', vol:0.25 };
  const bufSize = Math.floor(ctx2.sampleRate * cfg.dur);
  const buf = ctx2.createBuffer(1, bufSize, ctx2.sampleRate);
  const data = buf.getChannelData(0);
  for (let i=0; i<bufSize; i++) data[i] = (Math.random()*2-1) * Math.pow(1-i/bufSize, 1.8);
  const noise = ctx2.createBufferSource(); noise.buffer = buf;
  const bp = ctx2.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value = cfg.freq; bp.Q.value = cfg.q;
  const nG = ctx2.createGain(); nG.gain.value = cfg.vol * distAtt;
  nG.gain.exponentialRampToValueAtTime(0.001, now + cfg.dur);
  noise.connect(bp).connect(nG).connect(masterGain);
  noise.start(now);
  const osc = ctx2.createOscillator(); osc.type = cfg.type;
  osc.frequency.setValueAtTime(cfg.freq*0.9, now);
  osc.frequency.exponentialRampToValueAtTime(cfg.freq*0.3, now + cfg.dur*0.8);
  const oG = ctx2.createGain(); oG.gain.value = cfg.vol*0.6 * distAtt;
  oG.gain.exponentialRampToValueAtTime(0.001, now + cfg.dur*0.7);
  osc.connect(oG).connect(masterGain);
  osc.start(now); osc.stop(now + cfg.dur);
}
function playHit(distAtt=1) {
  if (!audioCtx) return;
  const ctx2 = audioCtx, now = ctx2.currentTime;
  const osc = ctx2.createOscillator(); osc.type = 'triangle';
  osc.frequency.setValueAtTime(1400, now);
  osc.frequency.exponentialRampToValueAtTime(280, now + 0.09);
  const g = ctx2.createGain(); g.gain.value = 0.20 * distAtt;
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  osc.connect(g).connect(masterGain);
  osc.start(now); osc.stop(now + 0.13);
}
function playExplosion(distAtt=1) {
  if (!audioCtx) return;
  const ctx2 = audioCtx, now = ctx2.currentTime;
  const osc = ctx2.createOscillator(); osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.6);
  const oG = ctx2.createGain(); oG.gain.value = 0.6 * distAtt;
  oG.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
  osc.connect(oG).connect(masterGain);
  osc.start(now); osc.stop(now + 0.7);
  const bufSize = Math.floor(ctx2.sampleRate * 0.5);
  const buf = ctx2.createBuffer(1, bufSize, ctx2.sampleRate);
  const data = buf.getChannelData(0);
  for (let i=0; i<bufSize; i++) data[i] = (Math.random()*2-1) * Math.pow(1-i/bufSize, 1.5);
  const noise = ctx2.createBufferSource(); noise.buffer = buf;
  const lp = ctx2.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value = 600;
  const nG = ctx2.createGain(); nG.gain.value = 0.5 * distAtt;
  nG.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  noise.connect(lp).connect(nG).connect(masterGain);
  noise.start(now);
}
function playPickup() {
  if (!audioCtx) return;
  const ctx2 = audioCtx, now = ctx2.currentTime;
  const o1 = ctx2.createOscillator(); o1.type = 'sine'; o1.frequency.setValueAtTime(800, now);
  o1.frequency.exponentialRampToValueAtTime(1600, now + 0.15);
  const g = ctx2.createGain(); g.gain.value = 0.25;
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  o1.connect(g).connect(masterGain);
  o1.start(now); o1.stop(now + 0.2);
}
function startBGM() {
  if (!audioCtx || !bgmGain) return;
  [55, 73.42, 110].forEach((freq, idx) => {
    const o = audioCtx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const f = audioCtx.createBiquadFilter(); f.type='lowpass'; f.frequency.value = 380+idx*60; f.Q.value = 0.7;
    const g = audioCtx.createGain(); g.gain.value = 0.18 - idx*0.04;
    const lfo = audioCtx.createOscillator(); lfo.frequency.value = 0.07 + idx*0.04;
    const lfoG = audioCtx.createGain(); lfoG.gain.value = 60;
    lfo.connect(lfoG).connect(f.frequency);
    o.connect(f).connect(g).connect(bgmGain);
    o.start(); lfo.start();
    bgmNodes.push(o, lfo);
  });
}
function distAtten(x, y) {
  const me = gameState.players.find(p => p.id===myId);
  if (!me) return 1;
  return Math.max(0.05, 1 - Math.hypot(x-me.x, y-me.y)/900);
}

/* ─── 3D scene initialization ─── */
function init3D() {
  if (T.initialized) return;
  T.initialized = true;
  const cv = document.getElementById('three-canvas');
  T.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: false });
  T.renderer.setSize(window.innerWidth, window.innerHeight);
  T.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  T.scene = new THREE.Scene();
  T.scene.background = new THREE.Color(0x0a0e1a);
  T.scene.fog = new THREE.Fog(0x0a0e1a, 380, 1800);

  T.camera = new THREE.PerspectiveCamera(55, window.innerWidth/window.innerHeight, 1, 3500);

  // Lights
  T.ambient = new THREE.AmbientLight(0xc8d8ff, 0.6);
  T.scene.add(T.ambient);
  T.sun = new THREE.DirectionalLight(0xfff2d0, 0.85);
  T.sun.position.set(400, 600, 200);
  T.scene.add(T.sun);
  T.scene.add(new THREE.HemisphereLight(0x6b88c8, 0x2a3548, 0.35));

  // Ground
  const groundGeo = new THREE.PlaneGeometry(mapW, mapH);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x232f48 });
  T.ground = new THREE.Mesh(groundGeo, groundMat);
  T.ground.rotation.x = -Math.PI/2;
  T.ground.position.set(mapW/2, 0, mapH/2);
  T.scene.add(T.ground);

  // Grid lines on the floor
  T.gridHelper = new THREE.GridHelper(Math.max(mapW, mapH)*1.2, 50, 0x3a4870, 0x1f2a40);
  T.gridHelper.position.set(mapW/2, 0.4, mapH/2);
  T.scene.add(T.gridHelper);

  // Walls
  T.wallGroup = new THREE.Group();
  T.scene.add(T.wallGroup);
  buildWalls();
}

function buildWalls() {
  if (!T.wallGroup) return;
  while (T.wallGroup.children.length) T.wallGroup.remove(T.wallGroup.children[0]);
  const wlist = walls.length ? walls : MAP_WALLS_FALLBACK;
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x4a5470 });
  const topMat  = new THREE.MeshLambertMaterial({ color: 0x6c7896 });
  wlist.forEach(w => {
    const g = new THREE.BoxGeometry(w.w, 36, w.h);
    const m = new THREE.Mesh(g, wallMat);
    m.position.set(w.x + w.w/2, 18, w.y + w.h/2);
    T.wallGroup.add(m);
    // Top cap
    const tg = new THREE.BoxGeometry(w.w + 2, 2, w.h + 2);
    const tm = new THREE.Mesh(tg, topMat);
    tm.position.set(w.x + w.w/2, 37, w.y + w.h/2);
    T.wallGroup.add(tm);
  });
}

/* ─── Tank mesh factory ─── */
function createTankEntry(player) {
  const chassisK = player.character?.chassis || player.character?.hairStyle || 'medium';
  const s = TANK_CHASSIS[chassisK] || TANK_CHASSIS.medium;
  const c = player.character || {};
  const teamCol = player.team === 'red'  ? '#8B2D2D'
                : player.team === 'blue' ? '#1E3A8A' : null;
  const bodyColor   = teamCol || c.bodyColor   || c.skinColor  || '#4B6B3A';
  const turretColor = c.turretColor || c.hairColor  || '#2A3F1F';
  const trackColor  = c.trackColor  || c.pantsColor || '#1C1C1C';
  const accentColor = c.accentColor || c.shirtColor || '#FBBF24';

  const group = new THREE.Group();

  // Tracks
  const trackGeo = new THREE.BoxGeometry(5, 7, s.h);
  const trackMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(trackColor) });
  const trackL = new THREE.Mesh(trackGeo, trackMat);
  trackL.position.set(-s.w/2 - 2.5, 3.5, 0);
  const trackR = new THREE.Mesh(trackGeo, trackMat);
  trackR.position.set( s.w/2 + 2.5, 3.5, 0);
  group.add(trackL, trackR);

  // Body
  const bodyGeo = new THREE.BoxGeometry(s.w, 9, s.h);
  const bodyMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(bodyColor) });
  const hull = new THREE.Mesh(bodyGeo, bodyMat);
  hull.position.y = 7;
  group.add(hull);

  // Accent stripe down the hull top
  const stripeGeo = new THREE.BoxGeometry(2, 0.3, s.h - 6);
  const stripeMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(accentColor) });
  const stripe = new THREE.Mesh(stripeGeo, stripeMat);
  stripe.position.set(0, 11.6, 0);
  group.add(stripe);

  // Turret
  const turretGeo = new THREE.CylinderGeometry(s.tw/2, s.tw/2*1.05, 7, 18);
  const turretMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(turretColor) });
  const turret = new THREE.Mesh(turretGeo, turretMat);
  turret.position.y = 15;
  group.add(turret);

  // Barrel — child of turret group
  const barrelGroup = new THREE.Group();
  const barrelGeo = new THREE.CylinderGeometry(s.barW*0.55, s.barW*0.55, s.barL, 10);
  const barrel = new THREE.Mesh(barrelGeo, new THREE.MeshLambertMaterial({ color: 0x2a2a2a }));
  // Cylinder default = along Y. Rotate so it lies along Z, then push out so end sits in front of turret.
  barrel.rotation.x = Math.PI/2;
  barrel.position.set(0, 0, -s.tw/2 - s.barL/2);
  barrelGroup.add(barrel);
  // Muzzle brake
  const muzzleGeo = new THREE.BoxGeometry(s.barW*1.8, s.barW*1.8, 3);
  const muzzle = new THREE.Mesh(muzzleGeo, new THREE.MeshLambertMaterial({ color: 0x444444 }));
  muzzle.position.set(0, 0, -s.tw/2 - s.barL - 1.5);
  barrelGroup.add(muzzle);
  turret.add(barrelGroup);

  // Smoke particle (damaged) — sprite-like, hidden by default
  const smokeMat = new THREE.MeshBasicMaterial({
    color: 0x222222, transparent: true, opacity: 0, depthWrite:false,
  });
  const smoke = new THREE.Mesh(new THREE.SphereGeometry(6, 8, 8), smokeMat);
  smoke.position.set(0, 18, 0);
  smoke.visible = false;
  group.add(smoke);

  // Fire particle (critical) — emissive-like
  const fireMat = new THREE.MeshBasicMaterial({
    color: 0xff8800, transparent: true, opacity: 0, depthWrite:false,
  });
  const fire = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 8), fireMat);
  fire.position.set(0, 16, 0);
  fire.visible = false;
  group.add(fire);

  // Shield aura (when shield buff active) — translucent dome
  const shieldMat = new THREE.MeshBasicMaterial({
    color: 0x60a5fa, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite:false,
  });
  const shield = new THREE.Mesh(new THREE.SphereGeometry(s.w*0.7, 14, 10), shieldMat);
  shield.position.y = 12;
  shield.visible = false;
  group.add(shield);

  // Name label sprite
  const label = createTextSprite(player.name || '?', player.id === myId);
  label.position.set(0, 30, 0);
  group.add(label);

  T.scene.add(group);

  return {
    group, hull, turret, barrel: barrelGroup, trackL, trackR,
    bodyMat, hullColor: new THREE.Color(bodyColor), smoke, fire, shield,
    label, s, chassisK,
    lastPos: new THREE.Vector3(),
  };
}

/* ─── Text sprite (name labels above tanks) ─── */
function createTextSprite(text, highlight) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const cx = cv.getContext('2d');
  cx.font = 'bold 32px "Courier New",monospace';
  cx.fillStyle = highlight ? '#6EE7B7' : '#FCA5A5';
  cx.strokeStyle = 'rgba(0,0,0,0.85)';
  cx.lineWidth = 5;
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.strokeText(text, 128, 32);
  cx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(40, 10, 1);
  return sprite;
}

/* ─── Bullet meshes ─── */
function createBulletMesh(b) {
  const col = WEAPONS_CFG[b.weapon]?.color || 0xFFD700;
  const g = new THREE.SphereGeometry(BULLET_R, 10, 10);
  const m = new THREE.MeshBasicMaterial({ color: col });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(b.x, 14, b.y);
  // Glow shell
  const glowG = new THREE.SphereGeometry(BULLET_R*2, 10, 10);
  const glowM = new THREE.MeshBasicMaterial({ color: col, transparent:true, opacity:0.35, depthWrite:false });
  const glow = new THREE.Mesh(glowG, glowM);
  mesh.add(glow);
  T.scene.add(mesh);
  return mesh;
}

/* ─── Powerup meshes ─── */
function createPowerupMesh(pu) {
  const def = POWERUP_DEFS[pu.type] || POWERUP_DEFS.health;
  const group = new THREE.Group();
  // Box body
  const boxG = new THREE.BoxGeometry(18, 18, 18);
  const boxM = new THREE.MeshLambertMaterial({ color: def.color });
  const box = new THREE.Mesh(boxG, boxM);
  box.position.y = 14;
  group.add(box);
  // Glow shell
  const glowG = new THREE.BoxGeometry(26, 26, 26);
  const glowM = new THREE.MeshBasicMaterial({ color: def.color, transparent:true, opacity:0.25, depthWrite:false });
  const glow = new THREE.Mesh(glowG, glowM);
  glow.position.y = 14;
  group.add(glow);
  // Icon as sprite above the box
  const iconCv = document.createElement('canvas');
  iconCv.width = 64; iconCv.height = 64;
  const ix = iconCv.getContext('2d');
  ix.font = '52px sans-serif'; ix.textAlign='center'; ix.textBaseline='middle';
  ix.fillText(def.icon, 32, 36);
  const iconTex = new THREE.CanvasTexture(iconCv);
  const iconSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTex, depthTest:false }));
  iconSpr.scale.set(16, 16, 1);
  iconSpr.position.y = 14;
  group.add(iconSpr);
  group.position.set(pu.x, 0, pu.y);
  T.scene.add(group);
  return group;
}

/* ─── Tread mark pool ─── */
const TREAD_POOL_SIZE = 60;
function ensureTreadPool() {
  if (T.treads.length) return;
  const treadGeo = new THREE.PlaneGeometry(8, 12);
  for (let i=0; i<TREAD_POOL_SIZE; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent:true, opacity:0, depthWrite:false });
    const m = new THREE.Mesh(treadGeo, mat);
    m.rotation.x = -Math.PI/2;
    m.position.y = 0.5;
    T.scene.add(m);
    T.treads.push({ mesh:m, life:0 });
  }
}
function dropTreadMarks(tank, x, z, angle) {
  ensureTreadPool();
  // Drop two parallel treads at the back-of-tank position
  const half = tank.s.w/2 + 3;
  const dirX = Math.cos(angle), dirZ = Math.sin(angle);
  const perpX = -dirZ, perpZ = dirX;
  for (let side = -1; side <= 1; side += 2) {
    const slot = T.treads[T.treadIdx];
    T.treadIdx = (T.treadIdx + 1) % T.treads.length;
    slot.mesh.position.set(x + perpX*half*side, 0.5, z + perpZ*half*side);
    slot.mesh.rotation.x = -Math.PI/2;
    slot.mesh.rotation.z = -angle;
    slot.mesh.material.opacity = 0.35;
    slot.life = 1.0;
  }
}

/* ─── Dust trail ─── */
function spawnDust(x, z) {
  if (T.dustParticles.length > 80) return; // cap
  const g = new THREE.SphereGeometry(4, 6, 6);
  const m = new THREE.MeshBasicMaterial({ color: 0xa89878, transparent:true, opacity:0.6, depthWrite:false });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x + (Math.random()-0.5)*8, 3, z + (Math.random()-0.5)*8);
  T.scene.add(mesh);
  T.dustParticles.push({
    mesh, life:1.0,
    vx:(Math.random()-0.5)*20, vy:30+Math.random()*20, vz:(Math.random()-0.5)*20,
  });
}

/* ─── Mesh sync from gameState ─── */
function syncMeshes() {
  // Players
  const seenP = new Set();
  gameState.players.forEach(p => {
    seenP.add(p.id);
    let entry = T.tanks.get(p.id);
    if (!entry) {
      entry = createTankEntry(p);
      T.tanks.set(p.id, entry);
    }
    // Position & rotation (server angle: 0 = +X. Three.js: rotate around Y; +X faces -Z by default after rotY=π/2... we want barrel along world-direction (cos a, 0, sin a))
    // Tank model's "front" is the -Z direction (where barrel extends). We want -Z to align with (cos a, sin a) in XZ.
    // Rotation around Y by -a + π/2... let's just use: rotY = -angle - π/2. Then forward = rotate (-Z) by rotY:
    //   forward = (sin(rotY), 0, -cos(rotY)) = (-sin(angle+π/2), 0, cos(angle+π/2)) = (-cos a, 0, -sin a)
    // That's the OPPOSITE of (cos a, sin a). So rotY = π/2 - angle. Verify:
    //   forward = (sin(π/2-a), 0, -cos(π/2-a)) = (cos a, 0, -sin a)
    // Game wants barrel to point at (cos a, sin a) in XZ. With server y → world Z (z = world Z), we want forward.z = +sin a. But we got -sin a.
    // Try rotY = -π/2 + angle... forward = (sin(angle-π/2), 0, -cos(angle-π/2)) = (-cos a, 0, -sin a). Still wrong sign.
    // The renderer maps server (x,y) → world (x, 0, y), so a 2D angle 'a' meaning direction (cos a, sin a) in 2D corresponds to world direction (cos a, 0, sin a).
    // We want the tank's local -Z to become this. Default -Z is (0,0,-1). Rotate by Y by θ: new = (-sin θ, 0, -cos θ).
    // Need: -sin θ = cos a → sin θ = -cos a;  -cos θ = sin a → cos θ = -sin a.
    // tan θ = sin θ/cos θ = (-cos a)/(-sin a) = cos a/sin a = cot a → θ = π/2 - a... or θ = -π/2 - a depending on signs.
    // Test a=0: need sin θ = -1, cos θ = 0 → θ = -π/2. So θ = -π/2 when a=0. With θ = -a - π/2 we get -π/2 ✓.
    // Test a=π/2: need sin θ = 0, cos θ = -1 → θ = π. Formula -π/2-π/2 = -π. Same direction (mod 2π) ✓.
    entry.group.position.set(p.x, 0, p.y);
    entry.group.rotation.y = -p.angle - Math.PI/2;

    // Damage states
    const maxHp = p.maxHp || PLAYER_MAX_HP;
    const hpPct = p.alive ? p.hp/maxHp : 0;
    entry.smoke.visible = p.alive && hpPct < 0.5;
    entry.smoke.material.opacity = entry.smoke.visible ? (0.4 + 0.4*Math.sin(Date.now()/120)) * (1 - hpPct/0.5) : 0;
    entry.smoke.position.y = 16 + Math.sin(Date.now()/300)*2;
    entry.fire.visible = p.alive && hpPct < 0.2;
    entry.fire.material.opacity = entry.fire.visible ? (0.5 + 0.5*Math.sin(Date.now()/80)) : 0;

    // Shield aura (if buffs include shield)
    const hasShield = (p.buffs||[]).includes('shield');
    entry.shield.visible = hasShield && p.alive;
    if (hasShield) entry.shield.material.opacity = 0.18 + 0.12*Math.sin(Date.now()/250);

    // Hit flash — tint hull red until timestamp
    const flash = hitFlashUntil[p.id];
    if (flash && Date.now() < flash) {
      entry.hull.material.color.setHex(0xff5050);
    } else {
      entry.hull.material.color.copy(entry.hullColor);
      if (flash) delete hitFlashUntil[p.id];
    }

    // Death — hide tank, show wreck instead
    if (!p.alive) {
      entry.group.scale.set(1,0.3,1);  // squashed
      entry.group.position.y = 0;
      entry.smoke.visible = true;
      entry.smoke.material.opacity = 0.7;
    } else {
      entry.group.scale.set(1,1,1);
    }

    // Recoil — push barrel along its local +Z (back)
    const recoil = recoilOffset[p.id]?.amount || 0;
    entry.barrel.position.z = recoil * 0.35;
    if (recoil > 2 && p.alive) {
      // Quick muzzle flash by spawning a brief dust at barrel tip
      const barrelTipDistance = entry.s.tw/2 + entry.s.barL;
      const tipX = p.x + Math.cos(p.angle) * barrelTipDistance;
      const tipZ = p.y + Math.sin(p.angle) * barrelTipDistance;
      if (Math.random() < 0.5) spawnDust(tipX, tipZ);
    }

    // Tread marks + dust trail when moving
    if (p.alive) {
      const distMoved = entry.lastPos.distanceTo(new THREE.Vector3(p.x, 0, p.y));
      if (distMoved > 0.5) {
        const now = Date.now();
        const last = T.lastTreadDrop[p.id] || 0;
        if (now - last > 130) {
          dropTreadMarks(entry, p.x, p.y, p.angle);
          if (distMoved > 1.5) spawnDust(p.x - Math.cos(p.angle)*entry.s.h*0.5,
                                        p.y - Math.sin(p.angle)*entry.s.h*0.5);
          T.lastTreadDrop[p.id] = now;
        }
        entry.lastPos.set(p.x, 0, p.y);
      }
    }
  });
  // Remove stale tanks
  T.tanks.forEach((entry, id) => {
    if (!seenP.has(id)) {
      T.scene.remove(entry.group);
      T.tanks.delete(id);
    }
  });

  // Bullets
  const seenB = new Set();
  gameState.bullets.forEach(b => {
    seenB.add(b.id);
    let mesh = T.bullets.get(b.id);
    if (!mesh) {
      mesh = createBulletMesh(b);
      T.bullets.set(b.id, mesh);
    }
    mesh.position.set(b.x, 14, b.y);
  });
  T.bullets.forEach((mesh, id) => {
    if (!seenB.has(id)) {
      T.scene.remove(mesh);
      T.bullets.delete(id);
    }
  });

  // Powerups
  const seenPU = new Set();
  (gameState.powerups||[]).forEach(pu => {
    seenPU.add(pu.id);
    let m = T.powerups.get(pu.id);
    if (!m) {
      m = createPowerupMesh(pu);
      T.powerups.set(pu.id, m);
    }
    // Float + spin
    m.rotation.y += 0.03;
    m.position.y = Math.sin(Date.now()/300 + (pu.x+pu.y)/200) * 3;
  });
  T.powerups.forEach((m, id) => {
    if (!seenPU.has(id)) {
      T.scene.remove(m);
      T.powerups.delete(id);
    }
  });
}

/* ─── Update tread/dust effects ─── */
function tickEffects(dt) {
  // Tread fade
  T.treads.forEach(t => {
    if (t.life > 0) {
      t.life -= dt * 0.3;
      t.mesh.material.opacity = Math.max(0, t.life * 0.35);
    }
  });
  // Dust simulate
  for (let i = T.dustParticles.length-1; i >= 0; i--) {
    const p = T.dustParticles[i];
    p.mesh.position.x += p.vx*dt;
    p.mesh.position.y += p.vy*dt;
    p.mesh.position.z += p.vz*dt;
    p.vy -= 40*dt;  // gravity
    p.life -= dt*1.6;
    p.mesh.material.opacity = p.life * 0.6;
    p.mesh.scale.multiplyScalar(1 + dt*0.3);
    if (p.life <= 0) {
      T.scene.remove(p.mesh);
      T.dustParticles.splice(i, 1);
    }
  }
  // Recoil decay (existing)
  for (const id in recoilOffset) {
    recoilOffset[id].amount -= dt*30;
    if (recoilOffset[id].amount <= 0) delete recoilOffset[id];
  }
  // Engine sound varies with my movement
  if (engineGain) {
    const me = gameState.players.find(p => p.id===myId);
    const moving = me && me.alive && (joy.active || keys['KeyW']||keys['KeyA']||keys['KeyS']||keys['KeyD']||keys['ArrowUp']||keys['ArrowDown']||keys['ArrowLeft']||keys['ArrowRight']);
    const targetGain = moving ? 0.12 : 0.04;
    const targetFreq = moving ? 95 : 55;
    engineGain.gain.value += (targetGain - engineGain.gain.value) * 0.1;
    engineOsc.frequency.value += (targetFreq - engineOsc.frequency.value) * 0.05;
  }
}

/* ─── Camera follow ─── */
function updateCamera() {
  const me = gameState.players.find(p => p.id===myId);
  if (!me) return;
  // Angled top-down: high above, slightly behind in +Z (south)
  const targetX = me.x;
  const targetZ = me.y;
  const camY = 250;
  const camOffsetZ = 140;
  // Apply screen shake
  const sx = (Math.random()-0.5) * shakeAmt;
  const sy = (Math.random()-0.5) * shakeAmt;
  T.camera.position.lerp(new THREE.Vector3(targetX + sx, camY, targetZ + camOffsetZ + sy), 0.13);
  T.camera.lookAt(new THREE.Vector3(targetX, 6, targetZ));
}

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
  document.getElementById('wave-announce-sub').textContent = sub;
  el.style.display = 'flex';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.display='none', duration);
}

function addKillFeed(killer, dead) {
  const feed = document.getElementById('kill-feed');
  const item = document.createElement('div');
  item.className = 'kf-item';
  item.textContent = `${killer} 🔫 ${dead}`;
  feed.appendChild(item);
  setTimeout(() => item.remove(), 4000);
}

/* ─── Socket events ─── */
socket.on('connect', () => {
  myId = socket.id;
  const rc = sessionStorage.getItem('roomCode');
  const oldId = sessionStorage.getItem('myId');
  const char = JSON.parse(sessionStorage.getItem('char')||'{}');
  if (rc) {
    socket.emit('rejoinGame', {
      roomCode: rc, oldId,
      playerData: { name:char.name||'Player', character:char, weapon:char.weapon||'pistol' },
    });
  } else {
    location.href = 'lobby.html';
  }
});

socket.on('gameRejoined', data => {
  myId = socket.id;
  myTeam = data.myTeam || null;
  gameMode = data.gameMode;
  waveNum = data.wave || 1;
  totalWaves = data.totalWaves || 5;
  if (data.walls) walls = data.walls;
  if (data.mapW)  mapW = data.mapW;
  if (data.mapH)  mapH = data.mapH;

  const char = JSON.parse(sessionStorage.getItem('char')||'{}');
  const wpn = char.weapon || 'pistol';
  if (WEAPONS_CFG[wpn]) { myWeapon = wpn; ammo = WEAPONS_CFG[wpn].maxAmmo; }
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
  // Build 3D scene now that we know the map size
  init3D();
  buildWalls();
  gameActive = true;
  if ('ontouchstart' in window) {
    const hint = document.getElementById('touch-hint');
    if (hint) { hint.style.display='flex'; setTimeout(()=>hint.style.display='none', 6000); }
  }
  requestAnimationFrame(gameLoop);
});

socket.on('rejoinFailed', () => {
  toast('방 연결 실패! 로비로 이동합니다.', 2500);
  setTimeout(() => location.href = 'lobby.html', 2500);
});

const seenBullets = new Set();
socket.on('gameState', state => {
  const curIds = new Set();
  state.bullets.forEach(b => {
    curIds.add(b.id);
    if (!seenBullets.has(b.id) && b.shooterId !== myId) {
      const shooter = state.players.find(p => p.id === b.shooterId);
      if (shooter) {
        playShot(b.weapon || 'pistol', distAtten(shooter.x, shooter.y));
        recoilOffset[shooter.id] = { amount: 6 };
      }
    }
  });
  seenBullets.clear();
  curIds.forEach(id => seenBullets.add(id));

  gameState = state;
  const me = state.players.find(p => p.id===myId);
  if (me) {
    updateHpHUD(me.hp);
    if (!me.alive && !isDead) {
      isDead = true;
      if (gameMode === 'single') document.getElementById('game-over-overlay').style.display = 'flex';
    }
  }
  if (gameMode === 'team') {
    document.getElementById('red-count').textContent =
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
  if (targetId) {
    recoilOffset[targetId] = { amount: 4 };
    hitFlashUntil[targetId] = Date.now() + 130;
  }
});

socket.on('gotHit', ({ damage, hp, shielded }) => {
  updateHpHUD(hp);
  const f = document.getElementById('hit-flash');
  f.style.opacity = '1';
  setTimeout(() => f.style.opacity = '0', 180);
  addShake(shielded ? 1.5 : 3.5);
  if (shielded) toast('🛡️ 방어!', 600);
});

socket.on('playerKilled', ({ deadId, killerName, x, y }) => {
  const dead = gameState.players.find(p=>p.id===deadId);
  addKillFeed(killerName, dead?.name||'???');
  const ex = (x ?? dead?.x ?? 0), ey = (y ?? dead?.y ?? 0);
  explosions.push({ x:ex, y:ey, r:5, life:1.0 });
  playExplosion(distAtten(ex, ey));
  if (deadId === myId) { isDead = true; addShake(20); }
  else addShake(6 * distAtten(ex, ey));
});

socket.on('killstreak', ({ streak, name }) => {
  const el = document.getElementById('killstreak-banner');
  document.getElementById('ks-streak').textContent = `${streak} KILLS`;
  document.getElementById('ks-reward').textContent = name + '!';
  el.style.display = 'block';
  // Re-trigger animation
  el.style.animation = 'none'; void el.offsetWidth;
  el.style.animation = 'streakPop 0.6s ease';
  setTimeout(() => el.style.display = 'none', 2400);
  // Triumph sound
  if (audioCtx) {
    const ctx2 = audioCtx, now = ctx2.currentTime;
    [440, 554, 659].forEach((f, i) => {
      const o = ctx2.createOscillator(); o.type='triangle'; o.frequency.value = f;
      const g = ctx2.createGain(); g.gain.value = 0.18;
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.3 + i*0.1);
      o.connect(g).connect(masterGain);
      o.start(now + i*0.08); o.stop(now + 0.5 + i*0.1);
    });
  }
});

socket.on('powerupCollected', ({ type, dur, hp }) => {
  const def = POWERUP_DEFS[type];
  playPickup();
  if (hp !== undefined) updateHpHUD(hp);
  if (dur > 0) {
    showActivePowerup(type, dur);
  } else {
    toast(`${def.icon} ${def.name}!`, 1500);
  }
});

let powerupTimerId = null;
function showActivePowerup(type, dur) {
  const def = POWERUP_DEFS[type];
  const el = document.getElementById('powerup-active');
  document.getElementById('pw-icon').textContent = def.icon;
  document.getElementById('pw-name').textContent = def.name;
  el.style.display = 'block';
  let left = Math.ceil(dur/1000);
  document.getElementById('pw-timer').textContent = left + 's';
  clearInterval(powerupTimerId);
  powerupTimerId = setInterval(() => {
    left--;
    document.getElementById('pw-timer').textContent = left + 's';
    if (left <= 0) {
      clearInterval(powerupTimerId);
      el.style.display = 'none';
    }
  }, 1000);
}

socket.on('powerupExpired', ({ type }) => {
  const el = document.getElementById('powerup-active');
  if (el) el.style.display = 'none';
  clearInterval(powerupTimerId);
});

socket.on('powerupGone', () => { /* removed by gameState sync naturally */ });

socket.on('respawnPending', ({ delay }) => {
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
    const e = document.getElementById('resp-cd'); if (e) e.textContent = left;
    if (left <= 0) clearInterval(window._respInt);
  }, 1000);
});

socket.on('respawned', ({ hp }) => {
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

socket.on('hpRecovered', ({ hp }) => updateHpHUD(hp));

socket.on('gameEnded', data => {
  gameActive = false;
  document.getElementById('game-over-overlay').style.display = 'none';
  const overlay = document.getElementById('game-result-overlay');
  const title = document.getElementById('result-title');
  const table = document.getElementById('result-table');
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

/* ─── Input send ─── */
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
    dx, dy, angle: cheatActive ? cheatAngle : aimAngle,
  });
}

/* ─── Resize ─── */
function resize() {
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  if (T.renderer) {
    T.renderer.setSize(window.innerWidth, window.innerHeight);
    T.camera.aspect = window.innerWidth / window.innerHeight;
    T.camera.updateProjectionMatrix();
  }
}
window.addEventListener('resize', resize);
resize();

/* ─── Main loop ─── */
let lastFrame = 0;
function gameLoop(now) {
  requestAnimationFrame(gameLoop);
  const dt = Math.min((now - lastFrame)/1000, 0.1);
  lastFrame = now;
  sendInput();
  if (!cheatActive && (mouseDown || touchFire)) tryShoot();
  tickCheat(dt);
  updateCheatBtn();
  shakeAmt = Math.max(0, shakeAmt - dt*60);
  tickEffects(dt);
  updateCamera();
  syncMeshes();
  // 3D render
  if (T.renderer) T.renderer.render(T.scene, T.camera);
  // 2D overlay (minimap, joystick, crosshair)
  drawOverlay(dt);
}

/* ─── 2D overlay drawing ─── */
function drawOverlay(dt) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawMinimap();
  if (!isDead && gameActive && !aim.active) drawCrosshair();
  drawJoystick();
}

function drawMinimap() {
  const SZ=130, PAD=14;
  const mx=PAD, my=canvas.height-SZ-PAD;
  const sx=SZ/mapW, sy=SZ/mapH;
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
  roundRect(ctx, mx, my, SZ, SZ, 7);
  ctx.fill(); ctx.stroke();
  ctx.save();
  roundRect(ctx, mx, my, SZ, SZ, 7);
  ctx.clip();
  ctx.fillStyle = 'rgba(120,140,180,0.55)';
  const wlist = walls.length ? walls : MAP_WALLS_FALLBACK;
  wlist.forEach(w => {
    ctx.fillRect(mx+w.x*sx, my+w.y*sy, Math.max(1,w.w*sx), Math.max(1,w.h*sy));
  });
  // Powerup dots
  (gameState.powerups||[]).forEach(pu => {
    const def = POWERUP_DEFS[pu.type];
    if (!def) return;
    ctx.beginPath();
    ctx.arc(mx + pu.x*sx, my + pu.y*sy, 2.5, 0, Math.PI*2);
    ctx.fillStyle = '#' + def.color.toString(16).padStart(6,'0');
    ctx.fill();
  });
  gameState.players.forEach(p => {
    if (!p.alive) return;
    const isMe = p.id === myId;
    const px = mx + p.x*sx, py = my + p.y*sy;
    const col = isMe ? '#10B981'
      : p.team==='red' ? '#EF4444'
      : p.team==='blue' ? '#3B82F6' : '#F59E0B';
    ctx.beginPath();
    ctx.arc(px, py, isMe?4.5:2.5, 0, Math.PI*2);
    ctx.fillStyle = col; ctx.shadowBlur = isMe?10:0; ctx.shadowColor = col; ctx.fill();
    ctx.shadowBlur = 0;
    if (isMe) {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px+Math.cos(p.angle)*7, py+Math.sin(p.angle)*7);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  });
  ctx.restore();
  ctx.fillStyle='rgba(255,255,255,0.22)'; ctx.font='9px monospace'; ctx.textAlign='left';
  ctx.fillText('MAP', mx+4, my+SZ-4);
}

function drawCrosshair() {
  const cx = canvas.width/2, cy = canvas.height/2;
  const size = 14, gap = 5;
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx-size-gap,cy); ctx.lineTo(cx-gap,cy);
  ctx.moveTo(cx+gap,cy);      ctx.lineTo(cx+size+gap,cy);
  ctx.moveTo(cx,cy-size-gap); ctx.lineTo(cx,cy-gap);
  ctx.moveTo(cx,cy+gap);      ctx.lineTo(cx,cy+size+gap);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,2,0,Math.PI*2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
}

function drawJoystick() {
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
  if (aim.active) {
    const bx=aim.bx, by=aim.by;
    const dx=aim.cx-bx, dy=aim.cy-by;
    const d = Math.min(Math.hypot(dx,dy), AIM_R);
    const a = Math.atan2(dy, dx);
    const kx=bx+Math.cos(a)*d, ky=by+Math.sin(a)*d;
    ctx.beginPath(); ctx.arc(bx,by,AIM_R,0,Math.PI*2);
    ctx.strokeStyle = touchFire ? 'rgba(252,165,165,0.7)' : 'rgba(252,165,165,0.4)';
    ctx.lineWidth=2.5; ctx.stroke();
    ctx.fillStyle='rgba(239,68,68,0.06)'; ctx.fill();
    ctx.beginPath(); ctx.arc(bx,by,AIM_DEAD,0,Math.PI*2);
    ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1; ctx.stroke();
    if (touchFire) {
      ctx.beginPath();
      ctx.moveTo(bx,by); ctx.lineTo(bx+Math.cos(a)*AIM_R, by+Math.sin(a)*AIM_R);
      ctx.strokeStyle='rgba(252,165,165,0.55)'; ctx.lineWidth=2; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(kx,ky,AIM_R*0.34,0,Math.PI*2);
    ctx.fillStyle = touchFire ? 'rgba(252,165,165,0.55)' : 'rgba(252,165,165,0.3)';
    ctx.fill();
    ctx.strokeStyle = touchFire ? '#fff' : 'rgba(252,165,165,0.7)';
    ctx.lineWidth=1.8; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(kx-6, ky); ctx.lineTo(kx+6, ky);
    ctx.moveTo(kx, ky-6); ctx.lineTo(kx, ky+6);
    ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.lineWidth=1.4; ctx.stroke();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);   ctx.arcTo(x+w, y,   x+w,   y+r,   r);
  ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w, y+h, x+w-r, y+h,   r);
  ctx.lineTo(x+r, y+h);   ctx.arcTo(x,   y+h, x,     y+h-r, r);
  ctx.lineTo(x,   y+r);   ctx.arcTo(x,   y,   x+r,   y,     r);
  ctx.closePath();
}
