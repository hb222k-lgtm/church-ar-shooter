'use strict';

const WEAPONS = {
  pistol:  { name:'권총',    icon:'🔫', damage:25, fireRate:500,  ammo:12, reload:1500, spread:15 },
  shotgun: { name:'샷건',    icon:'💥', damage:65, fireRate:1200, ammo:6,  reload:2500, spread:25 },
  rifle:   { name:'돌격소총', icon:'🎯', damage:30, fireRate:150,  ammo:30, reload:2000, spread:10 },
  sniper:  { name:'저격총',  icon:'🏹', damage:95, fireRate:2000, ammo:5,  reload:3000, spread:5  },
  smg:     { name:'기관단총', icon:'⚡', damage:18, fireRate:80,   ammo:25, reload:1800, spread:20 },
};

/* ── State ── */
const socket   = io();
const charData = JSON.parse(sessionStorage.getItem('char') || '{}');
const myId     = sessionStorage.getItem('myId');
const myTeam   = sessionStorage.getItem('myTeam') || null;
const gameMode = sessionStorage.getItem('gameMode') || 'ffa';
const roomCode = sessionStorage.getItem('roomCode');

let players      = JSON.parse(sessionStorage.getItem('players') || '{}');
let myHp         = 100;
let compass      = 0;
let isAlive      = true;
let isReloading  = false;
let lastShot     = 0;
let currentAmmo  = 0;
let maxAmmo      = 0;
let aimingAt     = {};   // { id: boolean }

const weapon     = charData.weapon || 'pistol';
const weaponInfo = WEAPONS[weapon];

/* ── Three.js ── */
let scene, camera, renderer, characterMeshes = {};

/* ── Boot ── */
document.getElementById('start-perm-btn').addEventListener('click', startGame);

async function startGame() {
  document.getElementById('perm-overlay').style.display = 'none';
  await setupCamera();
  setupThreeJS();
  await setupOrientation();
  setupSocket();
  setupControls();
  initHUD();
  initPlayers();
  animate();
}

/* ── Camera ── */
async function setupCamera() {
  const video = document.getElementById('camera-feed');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    toast('카메라를 사용할 수 없습니다: ' + e.message);
  }
}

/* ── Three.js setup ── */
function setupThreeJS() {
  const canvas = document.getElementById('ar-canvas');
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200);
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setClearColor(0x000000, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(2, 5, 3);
  scene.add(sun);

  camera.position.set(0, 0, 0);

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

/* ── Orientation ── */
async function setupOrientation() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') toast('나침반 권한이 없으면 정확도가 낮아집니다.');
    } catch (e) {}
  }

  window.addEventListener('deviceorientationabsolute', handleOrientation, true);
  window.addEventListener('deviceorientation', handleOrientation, true);
}

let headingOffset = null;

function handleOrientation(e) {
  let heading = 0;
  if (e.webkitCompassHeading !== undefined) {
    heading = e.webkitCompassHeading; // iOS
  } else if (e.absolute && e.alpha !== null) {
    heading = 360 - e.alpha;         // Android absolute
  } else if (e.alpha !== null) {
    heading = 360 - e.alpha;
  }

  // Calibrate on first reading so current facing = virtual 0°
  if (headingOffset === null) headingOffset = heading;
  compass = (heading - headingOffset + 360) % 360;
  updateCompassBar(heading);

  socket.emit('updateHeading', { heading: compass });
}

function updateCompassBar(heading) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  const idx  = Math.round(heading / 45) % 8;
  document.getElementById('compass-bar').textContent = dirs[idx] + ' ' + Math.round(heading) + '°';
}

/* ── Build 3-D character ── */
function buildCharacter(c) {
  const g = new THREE.Group();
  const M = THREE.MeshLambertMaterial;

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.75, 0.28),
    new M({ color: c.shirtColor || '#EF4444' })
  );
  body.position.y = 0;
  g.add(body);

  // Head
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 16),
    new M({ color: c.skinColor || '#FDBCB4' })
  );
  head.position.y = 0.62;
  g.add(head);

  // Eyes
  const eyeGeo = new THREE.SphereGeometry(0.055, 8, 8);
  const eyeMat = new M({ color: 0x111111 });
  [-0.11, 0.11].forEach(x => {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(x, 0.67, 0.27);
    g.add(eye);
  });

  // Hair
  const hairMat = new M({ color: c.hairColor || '#3D2B1F' });
  if (c.hairStyle !== '대머리') {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.31, 16, 16), hairMat);
    hair.position.set(0, 0.72, 0);
    hair.scale.set(1, 0.5, 1);
    g.add(hair);
  }
  if (c.hairStyle === '긴머리') {
    const long = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.6, 0.1), hairMat);
    long.position.set(0, 0.42, -0.1);
    g.add(long);
  }
  if (c.hairStyle === '모히칸') {
    const mo = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.45, 6), hairMat);
    mo.position.set(0, 1.08, 0);
    g.add(mo);
  }

  // Arms
  const armGeo = new THREE.BoxGeometry(0.18, 0.55, 0.18);
  const armMat = new M({ color: c.skinColor || '#FDBCB4' });
  [-0.38, 0.38].forEach((x, i) => {
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.position.set(x, -0.05, 0);
    arm.rotation.z = i === 0 ? 0.15 : -0.15;
    g.add(arm);
  });

  // Legs
  const legGeo = new THREE.BoxGeometry(0.22, 0.55, 0.22);
  const legMat = new M({ color: c.pantsColor || '#1E3A5F' });
  [-0.14, 0.14].forEach(x => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, -0.65, 0);
    g.add(leg);
  });

  // Accessory
  const accMat = new M({ color: c.accColor || '#FFD700' });
  if (c.accessory === '모자') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.06, 16), accMat);
    brim.position.set(0, 0.96, 0);
    g.add(brim);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 16), accMat);
    top.position.set(0, 1.14, 0);
    g.add(top);
  } else if (c.accessory === '왕관') {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.3, 5, 1, true), accMat);
    crown.position.set(0, 1.02, 0);
    g.add(crown);
  } else if (c.accessory === '후광') {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.04, 8, 24), accMat);
    halo.position.set(0, 1.12, 0);
    halo.rotation.x = Math.PI / 2;
    g.add(halo);
  }

  // Name sprite
  g.add(makeNameSprite(c.name || '?', c, myTeam));

  // HP bar
  const hpBar = makeHPBar();
  hpBar.name = 'hpBar';
  g.add(hpBar);

  return g;
}

function makeNameSprite(name, c, team) {
  const cvs = document.createElement('canvas');
  cvs.width = 256; cvs.height = 56;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.roundRect(0, 0, 256, 56, 8);
  ctx.fill();
  if (team) {
    ctx.fillStyle = team === 'red' ? '#EF4444' : '#3B82F6';
    ctx.fillRect(0, 0, 6, 56);
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(name, 128, 38);
  const tex = new THREE.CanvasTexture(cvs);
  const sp  = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(1.6, 0.36, 1);
  sp.position.y = 1.42;
  sp.name = 'nameSprite';
  return sp;
}

function makeHPBar() {
  const cvs = document.createElement('canvas');
  cvs.width = 128; cvs.height = 16;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, 128, 16);
  ctx.fillStyle = '#10B981';
  ctx.fillRect(2, 2, 124, 12);
  const tex = new THREE.CanvasTexture(cvs);
  const sp  = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(1.2, 0.14, 1);
  sp.position.y = 1.22;
  sp.name = 'hpBar';
  sp.userData.canvas = cvs;
  sp.userData.ctx = ctx;
  return sp;
}

function updateHPBarSprite(mesh, hp) {
  const bar = mesh.getObjectByName('hpBar');
  if (!bar) return;
  const ctx = bar.userData.ctx;
  const cvs = bar.userData.canvas;
  ctx.clearRect(0, 0, 128, 16);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, 128, 16);
  ctx.fillStyle = hp > 60 ? '#10B981' : hp > 30 ? '#F59E0B' : '#EF4444';
  ctx.fillRect(2, 2, Math.max(0, (hp / 100) * 124), 12);
  bar.material.map.needsUpdate = true;
}

/* ── Init players already in room ── */
function initPlayers() {
  currentAmmo = weaponInfo.ammo;
  maxAmmo     = weaponInfo.ammo;

  Object.values(players).forEach(p => {
    if (p.id === myId) return;
    spawnCharacter(p);
  });

  if (gameMode === 'team') {
    document.getElementById('team-hud').style.display = 'flex';
    updateTeamCount();
  }
}

function spawnCharacter(player) {
  if (characterMeshes[player.id]) scene.remove(characterMeshes[player.id]);
  const mesh = buildCharacter(player.character || {});
  mesh.visible = false;
  scene.add(mesh);
  characterMeshes[player.id] = mesh;
}

/* ── Socket events ── */
function setupSocket() {
  socket.on('playerJoined', ({ player }) => {
    players[player.id] = player;
    spawnCharacter(player);
    toast(`${player.name} 참가!`);
  });

  socket.on('playerLeft', ({ playerId }) => {
    if (characterMeshes[playerId]) {
      scene.remove(characterMeshes[playerId]);
      delete characterMeshes[playerId];
    }
    delete players[playerId];
    updateTeamCount();
  });

  socket.on('gotHit', ({ damage, hp, shooterId }) => {
    myHp = hp;
    updateMyHP();
    showHitFlash();
    const killer = players[shooterId];
    toast(`💥 ${killer?.name || '?'}에게 ${damage} 피해!`);
  });

  socket.on('shotFired', ({ shooterId, targetId, damage, weapon: w }) => {
    if (targetId !== myId && characterMeshes[targetId]) {
      showDamageNumber(characterMeshes[targetId], damage);
    }
  });

  socket.on('playerKilled', ({ deadId, killerId, killerName, kills }) => {
    if (players[deadId]) players[deadId].alive = false;

    if (characterMeshes[deadId]) {
      deathEffect(characterMeshes[deadId]);
      setTimeout(() => {
        if (characterMeshes[deadId]) {
          scene.remove(characterMeshes[deadId]);
          delete characterMeshes[deadId];
        }
      }, 1200);
    }

    addKillFeed(killerName, players[deadId]?.name || '?');
    updateTeamCount();

    if (deadId === myId) {
      isAlive = false;
      document.getElementById('shoot-btn').classList.add('disabled');
      document.getElementById('game-over-overlay').classList.add('show');
    }
  });

  socket.on('gameEnded', ({ mode, winnerId, winnerTeam, stats }) => {
    showResult(mode, winnerId, winnerTeam, stats);
  });
}

/* ── Controls ── */
function setupControls() {
  const shootBtn  = document.getElementById('shoot-btn');
  const reloadBtn = document.getElementById('reload-btn');

  shootBtn.addEventListener('touchstart', e => { e.preventDefault(); shoot(); }, { passive: false });
  shootBtn.addEventListener('mousedown', shoot);
  reloadBtn.addEventListener('click', reload);

  // Auto-fire on long press
  let autoFireInterval = null;
  shootBtn.addEventListener('touchstart', () => {
    if (weapon === 'rifle' || weapon === 'smg') {
      autoFireInterval = setInterval(shoot, weaponInfo.fireRate);
    }
  }, { passive: true });
  ['touchend','touchcancel'].forEach(ev =>
    shootBtn.addEventListener(ev, () => clearInterval(autoFireInterval))
  );
}

function shoot() {
  if (!isAlive || isReloading) return;
  const now = Date.now();
  if (now - lastShot < weaponInfo.fireRate) return;
  if (currentAmmo <= 0) { reload(); return; }

  lastShot = now;
  currentAmmo--;
  updateAmmoHUD();

  // Find target in crosshair
  let targetId = null;
  let bestAngle = weaponInfo.spread;

  Object.values(players).forEach(p => {
    if (p.id === myId || !p.alive) return;
    if (gameMode === 'team' && p.team === myTeam) return;
    const angle = getScreenAngle(p);
    if (Math.abs(angle) < bestAngle) {
      bestAngle = Math.abs(angle);
      targetId = p.id;
    }
  });

  if (targetId) {
    socket.emit('shoot', { targetId, weapon });
    flashCrosshair();
  }

  muzzleFlash();
}

function reload() {
  if (isReloading || currentAmmo === maxAmmo) return;
  isReloading = true;
  const btn = document.getElementById('reload-btn');
  btn.textContent = '재장전 중...';
  btn.classList.add('reloading');
  setTimeout(() => {
    currentAmmo = maxAmmo;
    isReloading = false;
    btn.textContent = '재장전';
    btn.classList.remove('reloading');
    updateAmmoHUD();
    toast('장전 완료!');
  }, weaponInfo.reload);
}

/* ── AR positioning ── */
function getScreenAngle(player) {
  const my = players[myId];
  if (!my) return 999;
  const myAngle  = my.virtualAngle  || 0;
  const enmAngle = player.virtualAngle || 0;
  const relative = (enmAngle - myAngle + 360) % 360;
  let screen = relative - compass;
  screen = ((screen + 180 + 360) % 360) - 180;
  return screen;
}

function updateCharacters() {
  aimingAt = {};
  let anyAiming = false;

  Object.values(players).forEach(p => {
    if (p.id === myId) return;
    const mesh = characterMeshes[p.id];
    if (!mesh) return;

    if (!p.alive) { mesh.visible = false; return; }

    const screen = getScreenAngle(p);
    const dist   = 9;
    const rad    = screen * Math.PI / 180;
    mesh.position.set(Math.sin(rad) * dist, -0.4, -Math.cos(rad) * dist);
    mesh.lookAt(0, -0.4, 0);
    mesh.visible = Math.abs(screen) < 88;

    aimingAt[p.id] = Math.abs(screen) < weaponInfo.spread;
    if (aimingAt[p.id] && p.alive && !(gameMode === 'team' && p.team === myTeam)) {
      anyAiming = true;
    }
  });

  const ch = document.getElementById('crosshair');
  ch.classList.toggle('aim-on', anyAiming);
}

/* ── HUD helpers ── */
function initHUD() {
  document.getElementById('ammo-weapon-name').textContent = weaponInfo.name;
  updateAmmoHUD();
  updateMyHP();

  // Radar center dot
  const dot = document.createElement('div');
  dot.className = 'radar-dot radar-me';
  document.getElementById('radar').appendChild(dot);
}

function updateMyHP() {
  const pct = myHp / 100;
  const fill = document.getElementById('hp-fill');
  fill.style.width = (pct * 100) + '%';
  fill.style.background = pct > 0.6 ? '#10B981' : pct > 0.3 ? '#F59E0B' : '#EF4444';
  document.getElementById('hp-num').textContent = myHp;
}

function updateAmmoHUD() {
  document.getElementById('ammo-cur').textContent = currentAmmo;
  document.getElementById('ammo-max').textContent = ' / ' + maxAmmo;
}

function updateTeamCount() {
  const alive = Object.values(players).filter(p => p.alive);
  document.getElementById('red-count').textContent  = alive.filter(p => p.team === 'red').length;
  document.getElementById('blue-count').textContent = alive.filter(p => p.team === 'blue').length;
  updateRadar(alive);
}

function updateRadar(alive) {
  const radar = document.getElementById('radar');
  radar.querySelectorAll('.radar-enemy').forEach(e => e.remove());
  const my = players[myId];
  if (!my) return;
  const R = 36;
  alive.forEach(p => {
    if (p.id === myId) return;
    const angle = getScreenAngle(p);
    const rad   = angle * Math.PI / 180;
    const dot   = document.createElement('div');
    dot.className = 'radar-dot radar-enemy';
    const isEnemy = gameMode !== 'team' || p.team !== myTeam;
    dot.style.background = isEnemy ? '#EF4444' : '#3B82F6';
    dot.style.left = (45 + Math.sin(rad) * R) + 'px';
    dot.style.top  = (45 - Math.cos(rad) * R) + 'px';
    radar.appendChild(dot);
  });
}

/* ── Visual effects ── */
function showHitFlash() {
  const el = document.getElementById('hit-flash');
  el.style.opacity = '1';
  setTimeout(() => el.style.opacity = '0', 150);
}

function flashCrosshair() {
  const ch = document.getElementById('crosshair');
  ch.classList.add('aim-on');
  setTimeout(() => ch.classList.remove('aim-on'), 120);
}

function muzzleFlash() {
  // Brief white flash at bottom of screen
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:0;left:50%;transform:translateX(-50%);' +
    'width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,rgba(255,200,50,0.6),transparent);' +
    'z-index:15;pointer-events:none;animation:fadeKill 0.2s forwards';
  document.getElementById('game-page').appendChild(el);
  setTimeout(() => el.remove(), 250);
}

function showDamageNumber(mesh, damage) {
  // Overlay 2D number
  const el = document.createElement('div');
  el.textContent = '-' + damage;
  el.style.cssText = 'position:fixed;z-index:12;color:#EF4444;font-size:22px;font-weight:900;' +
    'text-shadow:0 2px 8px rgba(0,0,0,0.8);pointer-events:none;' +
    'left:' + (30 + Math.random() * 40) + '%;top:' + (20 + Math.random() * 30) + '%;' +
    'animation:fadeKill 0.8s forwards;transform:translateY(0)';
  document.getElementById('game-page').appendChild(el);
  setTimeout(() => el.remove(), 900);
}

function deathEffect(mesh) {
  mesh.rotation.x = Math.PI / 2;
}

function addKillFeed(killer, dead) {
  const feed = document.getElementById('kill-feed');
  const row  = document.createElement('div');
  row.className = 'kill-row';
  row.innerHTML = `<span style="color:#FCA5A5">${escHtml(killer)}</span> 💀 ${escHtml(dead)}`;
  feed.appendChild(row);
  setTimeout(() => row.remove(), 3200);
}

/* ── Results ── */
function showResult(mode, winnerId, winnerTeam, stats) {
  const overlay = document.getElementById('game-result-overlay');
  overlay.classList.add('show');

  const title = document.getElementById('result-title');
  if (mode === 'ffa') {
    const w = stats.find(s => s.id === winnerId);
    const isMe = winnerId === myId;
    title.innerHTML = isMe
      ? '🏆 <span style="color:#F59E0B">우승!</span>'
      : `🏆 ${escHtml(w?.name || '?')} 우승!`;
  } else {
    const isWinner = myTeam === winnerTeam;
    title.innerHTML = isWinner
      ? '🏆 <span style="color:#F59E0B">팀 승리!</span>'
      : `🏆 ${winnerTeam === 'red' ? '🔴 레드팀' : '🔵 블루팀'} 승리!`;
  }

  const table = document.getElementById('result-table');
  table.innerHTML = `
    <tr><th>플레이어</th>${mode === 'team' ? '<th>팀</th>' : ''}<th>킬</th><th>상태</th></tr>
    ${stats.sort((a, b) => b.kills - a.kills).map(s => `
      <tr class="${s.id === (winnerId || '') ? 'winner' : ''}">
        <td>${escHtml(s.name)}${s.id === myId ? ' <small>(나)</small>' : ''}</td>
        ${mode === 'team' ? `<td>${s.team === 'red' ? '🔴' : '🔵'}</td>` : ''}
        <td>${s.kills}</td>
        <td>${s.alive ? '✅' : '💀'}</td>
      </tr>`).join('')}
  `;
}

/* ── Render loop ── */
function animate() {
  requestAnimationFrame(animate);
  updateCharacters();
  updateRadar(Object.values(players).filter(p => p.alive));
  renderer.render(scene, camera);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
