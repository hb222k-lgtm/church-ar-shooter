'use strict';

const WEAPONS = {
  pistol:  { name:'권총',    icon:'🔫', damage:25, fireRate:500,  ammo:12, reload:1500, spread:15 },
  shotgun: { name:'샷건',    icon:'💥', damage:65, fireRate:1200, ammo:6,  reload:2500, spread:25 },
  rifle:   { name:'돌격소총', icon:'🎯', damage:30, fireRate:150,  ammo:30, reload:2000, spread:10 },
  sniper:  { name:'저격총',  icon:'🏹', damage:95, fireRate:2000, ammo:5,  reload:3000, spread:5  },
  smg:     { name:'기관단총', icon:'⚡', damage:18, fireRate:80,   ammo:25, reload:1800, spread:20 },
};

const socket   = io();
const charData = JSON.parse(sessionStorage.getItem('char') || '{}');
const myId     = sessionStorage.getItem('myId');
const myTeam   = sessionStorage.getItem('myTeam') || null;
const gameMode = sessionStorage.getItem('gameMode') || 'ffa';

let players      = JSON.parse(sessionStorage.getItem('players') || '{}');
let myHp         = 100;
let compass      = 0;
let isAlive      = true;
let isReloading  = false;
let lastShot     = 0;
let currentAmmo  = 0;
let maxAmmo      = 0;
let aimingAt     = {};
let lastTime     = performance.now();
const particles  = [];
let screenShake  = 0;

let currentWave  = parseInt(sessionStorage.getItem('wave') || '1');
let totalWaves   = parseInt(sessionStorage.getItem('totalWaves') || '5');

const weapon     = charData.weapon || 'pistol';
const weaponInfo = WEAPONS[weapon];

let scene, camera, renderer;
const characterMeshes = {};

/* ══════════════ BOOT ══════════════ */
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
  requestAnimationFrame(loop);
}

/* ══════════════ CAMERA ══════════════ */
async function setupCamera() {
  const video = document.getElementById('camera-feed');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    video.srcObject = stream;
    await video.play();
  } catch (e) { toast('카메라 오류: ' + e.message); }
}

/* ══════════════ THREE.JS ══════════════ */
function setupThreeJS() {
  const canvas = document.getElementById('ar-canvas');
  scene    = new THREE.Scene();
  camera   = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200);
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const ambient = new THREE.AmbientLight(0x8899CC, 0.7);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xFFFFEE, 1.2);
  sun.position.set(3, 6, 4); sun.castShadow = true; scene.add(sun);
  const fill = new THREE.DirectionalLight(0x6688FF, 0.4);
  fill.position.set(-3, 0, -2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xFFAA44, 0.5);
  rim.position.set(0, -2, -5); scene.add(rim);

  camera.position.set(0, 0, 0);
  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

/* ══════════════ CHARACTER BUILDER ══════════════ */
function smat(color, rough = 0.7, metal = 0.1) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: metal });
}

function buildCharacter(c, team) {
  const g = new THREE.Group();
  const skin = smat(c.skinColor || '#FDBCB4', 0.65, 0.05);
  const shirt = smat(c.shirtColor || '#EF4444', 0.75);
  const pants = smat(c.pantsColor || '#1E3A5F', 0.8);
  const hair  = smat(c.hairColor  || '#3D2B1F', 0.85, 0.05);
  const shoe  = smat('#111122', 0.9);

  // Legs
  const legGeo = new THREE.CylinderGeometry(0.12, 0.1, 0.6, 10);
  [-0.15, 0.15].forEach((x, i) => {
    const leg = new THREE.Mesh(legGeo, pants); leg.name = i === 0 ? 'lLeg' : 'rLeg';
    leg.position.set(x, -0.65, 0); g.add(leg);
  });
  // Shoes
  [-0.15, 0.15].forEach(x => {
    const shoe2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.28), shoe);
    shoe2.position.set(x, -1.0, 0.04); g.add(shoe2);
  });

  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.72, 0.3), shirt);
  body.position.set(0, -0.02, 0); g.add(body);

  // Belt
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.06, 0.31),
    smat('#222222', 0.7, 0.4));
  belt.position.set(0, -0.38, 0); g.add(belt);

  // Arms
  const armGeo = new THREE.CylinderGeometry(0.09, 0.08, 0.55, 10);
  const foreGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.45, 10);
  ['l','r'].forEach((side, i) => {
    const aG = new THREE.Group(); aG.name = side + 'Arm';
    const upper = new THREE.Mesh(armGeo, shirt);
    upper.position.y = -0.28; aG.add(upper);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8), skin);
    elbow.position.y = -0.56; aG.add(elbow);
    const fore = new THREE.Mesh(foreGeo, skin);
    fore.position.y = -0.78; aG.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), skin);
    hand.position.y = -1.02; aG.add(hand);
    const x = i === 0 ? -0.4 : 0.4;
    aG.position.set(x, 0.26, 0);
    aG.rotation.z = i === 0 ? 0.15 : -0.15;
    g.add(aG);
    if (side === 'r') addWeapon3D(aG, c.weapon || 'pistol');
  });

  // Neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.16, 10), skin);
  neck.position.set(0, 0.44, 0); g.add(neck);

  // Head
  const headG = new THREE.Group(); headG.name = 'head';
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 20), skin);
  headG.add(headMesh);

  // Eyes
  const eyeW = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const eyeD = new THREE.MeshStandardMaterial({ color: 0x3366ff, roughness: 0.2, metalness: 0.1 });
  const pupilM = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
  [-0.1, 0.1].forEach(x => {
    const w2 = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), eyeW);
    w2.position.set(x, 0.05, 0.24); headG.add(w2);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), eyeD);
    iris.position.set(x, 0.05, 0.27); headG.add(iris);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), pupilM);
    pupil.position.set(x, 0.05, 0.29); headG.add(pupil);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.012, 5, 5),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 }));
    shine.position.set(x + 0.02, 0.075, 0.305); headG.add(shine);
  });

  // Mouth
  const mouthArc = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.012, 6, 12, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x993322, roughness: 0.8 }));
  mouthArc.position.set(0, -0.09, 0.25); mouthArc.rotation.z = Math.PI; headG.add(mouthArc);

  // Nose
  const noseMesh = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), skin);
  noseMesh.position.set(0, 0, 0.28); noseMesh.scale.set(1, 0.7, 0.5); headG.add(noseMesh);

  // Hair
  addHair3D(headG, c.hairStyle || '짧은머리', c.hairColor || '#3D2B1F');
  addAccessory3D(g, headG, c.accessory || '없음', c.accColor || '#FFD700');

  headG.position.set(0, 0.63, 0); g.add(headG);

  // Team indicator ring
  if (team) {
    const ringColor = team === 'red' ? 0xEF4444 : 0x3B82F6;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.03, 8, 24),
      new THREE.MeshStandardMaterial({ color: ringColor, emissive: ringColor, emissiveIntensity: 0.6, roughness: 0.3 })
    );
    ring.position.set(0, -1.06, 0); ring.rotation.x = Math.PI / 2; g.add(ring);
  }

  // Name + HP sprites
  g.add(makeNameSprite(c.name || '?', team));
  const hpBar = makeHPBar();
  hpBar.name = 'hpBar';
  g.add(hpBar);

  g.userData = { animTime: 0, animState: 'idle', hitTimer: 0, shootTimer: 0, baseY: 0 };
  return g;
}

function addHair3D(headG, style, color) {
  const hMat = smat(color, 0.85, 0.05);
  if (style === '대머리') return;
  if (style === '짧은머리') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.285, 16, 16), hMat);
    cap.scale.set(1, 0.5, 1); cap.position.y = 0.12; headG.add(cap);
    [-1,1].forEach(s => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.18), hMat);
      t.position.set(s*0.25, 0, 0); headG.add(t);
    });
  } else if (style === '긴머리') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.285, 16, 16), hMat);
    cap.scale.set(1, 0.5, 1); cap.position.y = 0.12; headG.add(cap);
    const long = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.85, 0.12), hMat);
    long.position.set(0,-0.32,-0.1); headG.add(long);
  } else if (style === '곱슬머리') {
    for (let i = 0; i < 8; i++) {
      const a = (i/8)*Math.PI*2;
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), hMat);
      c.position.set(Math.cos(a)*0.2, 0.04+Math.sin(a)*0.09, Math.sin(a)*0.16); headG.add(c);
    }
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), hMat);
    top.position.y = 0.26; headG.add(top);
  } else if (style === '포니테일') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.285, 16, 16), hMat);
    cap.scale.set(1, 0.5, 1); cap.position.y = 0.12; headG.add(cap);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.038, 0.56, 8), hMat);
    tail.position.set(0,-0.28,-0.25); tail.rotation.x = 0.4; headG.add(tail);
  } else if (style === '모히칸') {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.38, 0.52), hMat);
    strip.position.set(0, 0.3, 0); headG.add(strip);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 6), hMat);
    tip.position.set(0, 0.58, 0); headG.add(tip);
  }
}

function addAccessory3D(g, headG, acc, color) {
  const aMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.3, metalness: 0.5 });
  if (acc === '모자') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 20), aMat);
    brim.position.set(0, 1.02, 0); g.add(brim);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.32, 16), aMat);
    top.position.set(0, 1.2, 0); g.add(top);
  } else if (acc === '안경') {
    const fMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.2, metalness: 0.7 });
    [-0.11, 0.11].forEach(x => {
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 8, 20), fMat);
      frame.position.set(x, 0.68, 0.26); frame.rotation.y = Math.PI/2; g.add(frame);
    });
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.07, 6), fMat);
    br.rotation.z = Math.PI/2; br.position.set(0, 0.68, 0.26); g.add(br);
  } else if (acc === '왕관') {
    const cMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.15, metalness: 0.9,
      emissive: new THREE.Color(color), emissiveIntensity: 0.2 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.33, 0.1, 20, 1, true), cMat);
    base.position.set(0, 1.0, 0); g.add(base);
    for (let i = 0; i < 5; i++) {
      const a = (i/5)*Math.PI*2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.2, 5), cMat);
      spike.position.set(Math.cos(a)*0.28, 1.18, Math.sin(a)*0.28); g.add(spike);
    }
  } else if (acc === '후광') {
    const hMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color),
      emissive: new THREE.Color(color), emissiveIntensity: 1.0, roughness: 0.1, metalness: 0.3 });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.038, 10, 30), hMat);
    halo.name = 'haloMesh'; halo.position.set(0, 1.14, 0); halo.rotation.x = Math.PI/2; g.add(halo);
  } else if (acc === '마스크') {
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.2, 0.1),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.6 }));
    mask.position.set(0, 0.5, 0.25); g.add(mask);
  }
}

function addWeapon3D(armG, weaponType) {
  const wMat = smat('#2a2a3a', 0.35, 0.8);
  const acMat = smat('#FFAA00', 0.3, 0.7);
  const wG = new THREE.Group(); wG.name = 'weapon';
  if (weaponType === 'pistol') {
    wG.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.24), wMat), { position: new THREE.Vector3(0,0,0) }));
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.2,8), wMat);
    b.rotation.x = Math.PI/2; b.position.z = 0.22; wG.add(b);
  } else if (weaponType === 'shotgun') {
    wG.add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.48), wMat));
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.038,0.038,0.45,8), wMat);
    b.rotation.x = Math.PI/2; b.position.z = 0.47; wG.add(b);
  } else if (weaponType === 'rifle') {
    wG.add(new THREE.Mesh(new THREE.BoxGeometry(0.08,0.11,0.58), wMat));
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.32,8), wMat);
    b.rotation.x = Math.PI/2; b.position.z = 0.5; wG.add(b);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055,0.18,0.07), acMat);
    mag.position.set(0,-0.13,0.1); wG.add(mag);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.026,0.026,0.22,8), wMat);
    scope.rotation.x = Math.PI/2; scope.position.set(0,0.1,0.1); wG.add(scope);
  } else if (weaponType === 'sniper') {
    wG.add(new THREE.Mesh(new THREE.BoxGeometry(0.07,0.1,0.78), wMat));
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.018,0.5,8), wMat);
    b.rotation.x = Math.PI/2; b.position.z = 0.74; wG.add(b);
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.032,0.032,0.32,8), wMat);
    sc.rotation.x = Math.PI/2; sc.position.set(0,0.11,0.18); wG.add(sc);
  } else if (weaponType === 'smg') {
    wG.add(new THREE.Mesh(new THREE.BoxGeometry(0.09,0.11,0.34), wMat));
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.18,8), wMat);
    b.rotation.x = Math.PI/2; b.position.z = 0.34; wG.add(b);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055,0.2,0.055), acMat);
    mag.position.set(0,-0.14,0.07); wG.add(mag);
  }
  wG.rotation.set(-0.3, 0, 0);
  wG.position.set(0.06, -0.72, 0.16);
  armG.add(wG);
}

function makeNameSprite(name, team) {
  const cvs = document.createElement('canvas');
  cvs.width = 280; cvs.height = 64;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.75)'; roundRect(ctx, 0,0,280,64,12); ctx.fill();
  const tc = team === 'red' ? '#EF4444' : team === 'blue' ? '#3B82F6' : '#7C3AED';
  ctx.fillStyle = tc; roundRect(ctx, 0,0,7,64,0); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px -apple-system, sans-serif';
  ctx.textAlign = 'center'; ctx.fillText(name, 140, 42);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cvs), depthTest: false }));
  sp.scale.set(1.8, 0.42, 1); sp.position.y = 1.55; sp.name = 'nameSprite';
  return sp;
}

function makeHPBar() {
  const cvs = document.createElement('canvas'); cvs.width = 140; cvs.height = 18;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0,0,140,18);
  ctx.fillStyle = '#10B981'; ctx.fillRect(2,2,136,14);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cvs), depthTest: false }));
  sp.scale.set(1.3, 0.16, 1); sp.position.y = 1.32;
  sp.userData = { canvas: cvs, ctx };
  return sp;
}

function updateHPBarSprite(mesh, hp) {
  const bar = mesh.getObjectByName('hpBar');
  if (!bar) return;
  const { ctx, canvas } = bar.userData;
  ctx.clearRect(0,0,140,18);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0,0,140,18);
  ctx.fillStyle = hp > 60 ? '#10B981' : hp > 30 ? '#F59E0B' : '#EF4444';
  ctx.fillRect(2,2,Math.max(0,(hp/100)*136),14);
  bar.material.map.needsUpdate = true;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r); ctx.closePath();
}

/* ══════════════ PARTICLE SYSTEM ══════════════ */
function spawnHitParticles(pos, color = 0xFFAA00) {
  for (let i = 0; i < 10; i++) {
    const geo = new THREE.SphereGeometry(0.04 + Math.random()*0.04, 4, 4);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8,
      transparent: true, opacity: 1 });
    const p = new THREE.Mesh(geo, mat);
    p.position.copy(pos).add(new THREE.Vector3((Math.random()-.5)*0.4, Math.random()*0.4, (Math.random()-.5)*0.4));
    const speed = 1.5 + Math.random() * 3;
    const dir = new THREE.Vector3(Math.random()-.5, Math.random()*.8+.2, Math.random()-.5).normalize();
    p.userData = { vel: dir.multiplyScalar(speed), life: 0.5 + Math.random()*0.3, maxLife: 0.7, isParticle: true };
    scene.add(p); particles.push(p);
  }
}

function spawnMuzzleFlash() {
  const geo = new THREE.PlaneGeometry(0.8, 0.8);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xFFCC44, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false
  });
  const flash = new THREE.Mesh(geo, mat);
  flash.position.set(0.3, -0.15, -0.7);
  flash.rotation.z = Math.random() * Math.PI;
  flash.userData = { life: 0.08, maxLife: 0.08, isParticle: true, isFlash: true };
  scene.add(flash); particles.push(flash);
}

function spawnStarParticles(pos) {
  for (let i = 0; i < 6; i++) {
    const star = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.06),
      new THREE.MeshStandardMaterial({ color: 0xFFD700, emissive: 0xFFAA00, emissiveIntensity: 1,
        transparent: true, opacity: 1 })
    );
    star.position.copy(pos);
    const dir = new THREE.Vector3(Math.random()-.5, Math.random()+.5, Math.random()-.5).normalize();
    star.userData = { vel: dir.multiplyScalar(2.5), life: 0.6, maxLife: 0.6, isParticle: true };
    scene.add(star); particles.push(star);
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.userData.life -= dt;
    if (p.userData.life <= 0) { scene.remove(p); particles.splice(i,1); continue; }
    const t = p.userData.life / p.userData.maxLife;
    if (!p.userData.isFlash) {
      p.userData.vel.y -= 4 * dt;
      p.position.addScaledVector(p.userData.vel, dt);
      p.rotation.x += dt * 3; p.rotation.z += dt * 2;
    }
    if (p.material.opacity !== undefined) p.material.opacity = t;
    p.scale.setScalar(0.5 + t * 0.5);
  }
}

/* ══════════════ CHARACTER ANIMATION ══════════════ */
function animateCharacter(mesh, dt) {
  const ud = mesh.userData;
  ud.animTime += dt;
  const t = ud.animTime;

  const lArm = mesh.getObjectByName('lArm');
  const rArm = mesh.getObjectByName('rArm');
  const lLeg = mesh.children.find(c => c.name === 'lLeg');
  const rLeg = mesh.children.find(c => c.name === 'rLeg');
  const head = mesh.getObjectByName('head');
  const halo = mesh.getObjectByName('haloMesh');

  if (halo) halo.rotation.z = t * 1.5;

  if (ud.animState === 'idle') {
    const bob = Math.sin(t * 2.0) * 0.05;
    mesh.position.y = ud.baseY + bob;
    if (lArm) lArm.rotation.x =  Math.sin(t * 2.0) * 0.14;
    if (rArm) rArm.rotation.x = -Math.sin(t * 2.0) * 0.14;
    if (lLeg) lLeg.rotation.x = -Math.sin(t * 2.0) * 0.08;
    if (rLeg) rLeg.rotation.x =  Math.sin(t * 2.0) * 0.08;
    if (head) head.rotation.y = Math.sin(t * 0.7) * 0.08;
  }

  if (ud.animState === 'hit') {
    ud.hitTimer -= dt;
    const shake = ud.hitTimer > 0 ? (Math.random()-.5)*0.15 : 0;
    mesh.position.x = ud.baseX + shake;
    mesh.position.y = ud.baseY + shake * 0.5;
    mesh.traverse(child => {
      if (child.isMesh && child.material.emissive) {
        child.material.emissive.setRGB(ud.hitTimer > 0 ? 0.6 : 0, 0, 0);
        child.material.emissiveIntensity = ud.hitTimer > 0 ? 0.8 : 0;
      }
    });
    if (ud.hitTimer <= 0) {
      ud.animState = 'idle';
      mesh.position.x = ud.baseX;
    }
  }

  if (ud.animState === 'shoot') {
    ud.shootTimer -= dt;
    if (rArm) rArm.rotation.x = -0.7;
    if (ud.shootTimer <= 0) { ud.animState = 'idle'; if (rArm) rArm.rotation.x = 0; }
  }

  if (ud.animState === 'dead') {
    mesh.rotation.z = Math.min(mesh.rotation.z + dt * 2.5, Math.PI / 2);
    mesh.position.y = Math.max(ud.baseY - 0.9, mesh.position.y - dt * 0.8);
    mesh.traverse(child => {
      if (child.isMesh && child.material.transparent) child.material.opacity = Math.max(0, child.material.opacity - dt * 0.5);
    });
  }
}

/* ══════════════ SPRITES ══════════════ */
function makeNameSpriteSimple(name, team) { return makeNameSprite(name, team); }

/* ══════════════ ORIENTATION ══════════════ */
async function setupOrientation() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try { await DeviceOrientationEvent.requestPermission(); } catch (e) {}
  }
  let headingOffset = null;
  const handler = e => {
    let heading = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : 360 - (e.alpha||0));
    if (headingOffset === null) headingOffset = heading;
    compass = (heading - headingOffset + 360) % 360;
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    document.getElementById('compass-bar').textContent = dirs[Math.round(heading/45)%8] + ' ' + Math.round(heading) + '°';
    socket.emit('updateHeading', { heading: compass });
  };
  window.addEventListener('deviceorientationabsolute', handler, true);
  window.addEventListener('deviceorientation', handler, true);
}

/* ══════════════ PLAYERS ══════════════ */
function initPlayers() {
  currentAmmo = weaponInfo.ammo; maxAmmo = weaponInfo.ammo;
  Object.values(players).forEach(p => { if (p.id !== myId) spawnCharacter(p); });
  if (gameMode === 'team') { document.getElementById('team-hud').style.display = 'flex'; updateTeamCount(); }
  if (gameMode === 'single') {
    document.getElementById('wave-hud').style.display = 'block';
    updateWaveLabel();
  }
}

function updateWaveLabel() {
  document.getElementById('wave-label').textContent = `⚔️ 웨이브 ${currentWave} / ${totalWaves}`;
}

function showWaveAnnounce(text, sub, duration) {
  const el = document.getElementById('wave-announce');
  document.getElementById('wave-announce-text').textContent = text;
  document.getElementById('wave-announce-sub').textContent = sub || '';
  el.style.display = 'flex';
  setTimeout(() => { el.style.display = 'none'; }, duration || 2800);
}

function spawnCharacter(player) {
  if (characterMeshes[player.id]) scene.remove(characterMeshes[player.id]);
  const mesh = buildCharacter(player.character || {}, player.team);
  mesh.visible = false;
  mesh.userData.baseX = 0; mesh.userData.baseY = 0;
  scene.add(mesh);
  characterMeshes[player.id] = mesh;
}

/* ══════════════ SOCKET ══════════════ */
function setupSocket() {
  socket.on('playerJoined', ({ player }) => {
    players[player.id] = player; spawnCharacter(player); toast(`${player.name} 참가!`);
  });
  socket.on('playerLeft', ({ playerId }) => {
    if (characterMeshes[playerId]) { scene.remove(characterMeshes[playerId]); delete characterMeshes[playerId]; }
    delete players[playerId]; updateTeamCount();
  });
  socket.on('gotHit', ({ damage, hp, shooterId }) => {
    myHp = hp; updateMyHP(); triggerScreenShake(); showHitFlash();
    toast(`💥 ${players[shooterId]?.name || '?'}에게 ${damage} 피해!`);
  });
  socket.on('shotFired', ({ shooterId, targetId, damage }) => {
    const mesh = characterMeshes[targetId];
    if (mesh && targetId !== myId) {
      const pos = mesh.position.clone().add(new THREE.Vector3(0, 0.5, 0));
      spawnHitParticles(pos, 0xFF4444);
      spawnStarParticles(pos);
      mesh.userData.animState = 'hit';
      mesh.userData.hitTimer = 0.25;
      updateHPBarSprite(mesh, players[targetId]?.hp || 100);
      showFloatingDamage(mesh.position, damage);
    }
    if (shooterId === myId) {
      const shooter = characterMeshes[shooterId];
      const sm = characterMeshes[targetId];
      if (sm) { sm.userData.animState = 'hit'; sm.userData.hitTimer = 0.25; }
    }
  });
  socket.on('playerKilled', ({ deadId, killerId, killerName, kills }) => {
    if (players[deadId]) players[deadId].alive = false;
    const mesh = characterMeshes[deadId];
    if (mesh) {
      mesh.userData.animState = 'dead';
      for (let i = 0; i < 3; i++) setTimeout(() => spawnStarParticles(mesh.position.clone().add(new THREE.Vector3((Math.random()-.5)*0.5, Math.random()*0.8, 0))), i*150);
      setTimeout(() => { scene.remove(mesh); delete characterMeshes[deadId]; }, 2500);
    }
    addKillFeed(killerName, players[deadId]?.name || '?');
    updateTeamCount();
    if (deadId === myId) {
      isAlive = false;
      document.getElementById('shoot-btn').classList.add('disabled');
      if (gameMode !== 'single') document.getElementById('game-over-overlay').classList.add('show');
    }
  });
  socket.on('waveCleared', ({ wave, nextWave, total }) => {
    currentWave = nextWave; totalWaves = total; updateWaveLabel();
    showWaveAnnounce(`✅ 웨이브 ${wave} 클리어!`, `다음 웨이브까지 잠시 후...`, 3800);
    toast(`웨이브 ${wave} 격파! 다음: 웨이브 ${nextWave}`);
  });

  socket.on('waveStarted', ({ wave, players: newPlayers }) => {
    currentWave = wave; updateWaveLabel();
    // Remove old bot meshes, spawn new ones
    Object.keys(characterMeshes).forEach(id => {
      if (id !== myId && players[id]?.isBot) { scene.remove(characterMeshes[id]); delete characterMeshes[id]; }
    });
    players = newPlayers;
    Object.values(players).forEach(p => { if (p.id !== myId) spawnCharacter(p); });
    updateTeamCount();
    showWaveAnnounce(`🌊 웨이브 ${wave} 시작!`, `봇 ${Object.values(newPlayers).filter(p=>p.isBot).length}마리 등장!`, 2500);
  });

  socket.on('hpRecovered', ({ hp }) => {
    myHp = hp; updateMyHP();
    const el = document.createElement('div');
    el.textContent = '+회복';
    el.style.cssText = `position:fixed;z-index:12;color:#10B981;font-size:22px;font-weight:900;
      text-shadow:0 2px 8px rgba(0,0,0,0.8);pointer-events:none;left:44%;top:35%;
      animation:floatUp 1s forwards`;
    document.getElementById('game-page').appendChild(el);
    setTimeout(() => el.remove(), 1100);
  });

  socket.on('gameEnded', ({ mode, winnerId, winnerTeam, stats, victory, wave }) =>
    showResult(mode, winnerId, winnerTeam, stats, victory, wave));
}

/* ══════════════ CONTROLS ══════════════ */
function setupControls() {
  const shootBtn = document.getElementById('shoot-btn');
  const reloadBtn = document.getElementById('reload-btn');
  shootBtn.addEventListener('touchstart', e => { e.preventDefault(); shoot(); }, { passive: false });
  shootBtn.addEventListener('mousedown', shoot);
  reloadBtn.addEventListener('click', reload);
  let autoFire = null;
  shootBtn.addEventListener('touchstart', () => {
    if (weapon === 'rifle' || weapon === 'smg') autoFire = setInterval(shoot, weaponInfo.fireRate);
  }, { passive: true });
  ['touchend','touchcancel'].forEach(ev => shootBtn.addEventListener(ev, () => clearInterval(autoFire)));
}

function shoot() {
  if (!isAlive || isReloading) return;
  const now = Date.now();
  if (now - lastShot < weaponInfo.fireRate) return;
  if (currentAmmo <= 0) { reload(); return; }
  lastShot = now; currentAmmo--; updateAmmoHUD();

  let targetId = null, bestAngle = weaponInfo.spread;
  Object.values(players).forEach(p => {
    if (p.id === myId || !p.alive) return;
    if (gameMode === 'team' && p.team === myTeam) return;
    const angle = Math.abs(getScreenAngle(p));
    if (angle < bestAngle) { bestAngle = angle; targetId = p.id; }
  });

  if (targetId) {
    socket.emit('shoot', { targetId, weapon });
    flashCrosshair();
    const tm = characterMeshes[targetId];
    if (tm) { tm.userData.animState = 'shoot'; tm.userData.shootTimer = 0.2; }
  }

  spawnMuzzleFlash();
}

function reload() {
  if (isReloading || currentAmmo === maxAmmo) return;
  isReloading = true;
  const btn = document.getElementById('reload-btn');
  btn.textContent = '재장전 중...'; btn.classList.add('reloading');
  setTimeout(() => {
    currentAmmo = maxAmmo; isReloading = false;
    btn.textContent = '재장전'; btn.classList.remove('reloading');
    updateAmmoHUD(); toast('장전 완료!');
  }, weaponInfo.reload);
}

/* ══════════════ AR POSITIONING ══════════════ */
function getScreenAngle(player) {
  const my = players[myId]; if (!my) return 999;
  let screen = (player.virtualAngle||0) - (my.virtualAngle||0) - compass;
  return ((screen + 180 + 360) % 360) - 180;
}

function updateCharacters(dt) {
  aimingAt = {}; let anyAiming = false;
  Object.values(players).forEach(p => {
    if (p.id === myId) return;
    const mesh = characterMeshes[p.id]; if (!mesh) return;
    if (!p.alive) { mesh.visible = false; return; }
    const screen = getScreenAngle(p);
    const dist = 9, rad = screen * Math.PI / 180;
    const tx = Math.sin(rad)*dist, tz = -Math.cos(rad)*dist;
    mesh.position.x += (tx - mesh.position.x) * 0.12;
    mesh.position.z += (tz - mesh.position.z) * 0.12;
    mesh.visible = Math.abs(screen) < 88;
    mesh.lookAt(0, mesh.position.y, 0);
    aimingAt[p.id] = Math.abs(screen) < weaponInfo.spread;
    if (aimingAt[p.id] && !(gameMode === 'team' && p.team === myTeam)) anyAiming = true;
    animateCharacter(mesh, dt);
  });
  document.getElementById('crosshair').classList.toggle('aim-on', anyAiming);
}

/* ══════════════ HUD ══════════════ */
function initHUD() {
  document.getElementById('ammo-weapon-name').textContent = weaponInfo.name;
  updateAmmoHUD(); updateMyHP();
  const dot = document.createElement('div');
  dot.className = 'radar-dot radar-me';
  document.getElementById('radar').appendChild(dot);
}

function updateMyHP() {
  const pct = myHp / 100;
  const fill = document.getElementById('hp-fill');
  fill.style.width = (pct*100) + '%';
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
  const R = 34;
  alive.forEach(p => {
    if (p.id === myId) return;
    const a = getScreenAngle(p) * Math.PI / 180;
    const dot = document.createElement('div');
    dot.className = 'radar-dot radar-enemy';
    dot.style.background = (gameMode !== 'team' || p.team !== myTeam) ? '#EF4444' : '#3B82F6';
    dot.style.left = (45 + Math.sin(a)*R) + 'px';
    dot.style.top  = (45 - Math.cos(a)*R) + 'px';
    radar.appendChild(dot);
  });
}

/* ══════════════ EFFECTS ══════════════ */
function triggerScreenShake() { screenShake = 0.3; }

function showHitFlash() {
  const el = document.getElementById('hit-flash');
  el.style.opacity = '1'; setTimeout(() => el.style.opacity = '0', 180);
}
function flashCrosshair() {
  const ch = document.getElementById('crosshair');
  ch.classList.add('aim-on'); setTimeout(() => ch.classList.remove('aim-on'), 140);
}
function showFloatingDamage(pos, dmg) {
  const el = document.createElement('div');
  el.textContent = '-' + dmg;
  el.style.cssText = `position:fixed;z-index:12;color:#EF4444;font-size:${20+Math.min(dmg/5,14)}px;
    font-weight:900;text-shadow:0 2px 8px rgba(0,0,0,0.8);pointer-events:none;
    left:${30+Math.random()*40}%;top:${20+Math.random()*30}%;
    animation:floatUp 0.9s forwards`;
  document.getElementById('game-page').appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
function addKillFeed(killer, dead) {
  const feed = document.getElementById('kill-feed');
  const row = document.createElement('div'); row.className = 'kill-row';
  row.innerHTML = `<span style="color:#FCA5A5">${esc(killer)}</span> 💀 ${esc(dead)}`;
  feed.appendChild(row); setTimeout(() => row.remove(), 3200);
}

/* ══════════════ RESULT ══════════════ */
function showResult(mode, winnerId, winnerTeam, stats, victory, wave) {
  const overlay = document.getElementById('game-result-overlay'); overlay.classList.add('show');
  const title = document.getElementById('result-title');
  if (mode === 'single') {
    if (victory) {
      title.innerHTML = `🏆 <span style="color:#F59E0B">완전 클리어!</span><br><small style="font-size:16px;font-weight:400">웨이브 ${wave} 전부 격파!</small>`;
    } else {
      title.innerHTML = `💀 <span style="color:#EF4444">게임 오버</span><br><small style="font-size:16px;font-weight:400">웨이브 ${wave}에서 쓰러짐</small>`;
    }
    document.getElementById('result-table').innerHTML = `
      <tr><th>플레이어</th><th>킬</th><th>도달 웨이브</th></tr>
      ${(stats||[]).map(s => `<tr>
        <td>${esc(s.name)}${s.id===myId?' <small style="color:var(--primary-light)">(나)</small>':''}</td>
        <td>${s.kills}</td><td>${wave}</td></tr>`).join('')}`;
  } else if (mode === 'ffa') {
    const w = stats.find(s => s.id === winnerId);
    title.innerHTML = winnerId === myId ? '🏆 <span style="color:#F59E0B">우승!</span>' : `🏆 ${esc(w?.name||'?')} 우승!`;
    document.getElementById('result-table').innerHTML = `
      <tr><th>플레이어</th><th>킬</th><th>결과</th></tr>
      ${stats.sort((a,b)=>b.kills-a.kills).map(s=>`
      <tr class="${s.id===winnerId?'winner':''}">
        <td>${esc(s.name)}${s.id===myId?' <small style="color:var(--primary-light)">(나)</small>':''}</td>
        <td>${s.kills}</td><td>${s.alive?'✅':'💀'}</td></tr>`).join('')}`;
  } else {
    title.innerHTML = myTeam === winnerTeam ? '🏆 <span style="color:#F59E0B">팀 승리!</span>'
      : `🏆 ${winnerTeam==='red'?'🔴 레드팀':'🔵 블루팀'} 승리!`;
    document.getElementById('result-table').innerHTML = `
      <tr><th>플레이어</th><th>팀</th><th>킬</th><th>결과</th></tr>
      ${stats.sort((a,b)=>b.kills-a.kills).map(s=>`
      <tr class="${s.id===winnerId?'winner':''}">
        <td>${esc(s.name)}${s.id===myId?' <small style="color:var(--primary-light)">(나)</small>':''}</td>
        <td>${s.team==='red'?'🔴':'🔵'}</td>
        <td>${s.kills}</td><td>${s.alive?'✅':'💀'}</td></tr>`).join('')}`;
  }
}

/* ══════════════ MAIN LOOP ══════════════ */
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  updateCharacters(dt);
  updateParticles(dt);
  updateRadar(Object.values(players).filter(p => p.alive));

  // Screen shake
  if (screenShake > 0) {
    camera.position.x = (Math.random()-.5) * screenShake * 0.08;
    camera.position.y = (Math.random()-.5) * screenShake * 0.08;
    screenShake = Math.max(0, screenShake - dt * 3);
    if (screenShake <= 0) camera.position.set(0,0,0);
  }

  renderer.render(scene, camera);
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function toast(msg) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  document.getElementById('toast-container').appendChild(el); setTimeout(() => el.remove(), 3200);
}
