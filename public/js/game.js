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
const radarDots = {};

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

  // Ears
  [-1, 1].forEach(side => {
    const earOuter = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), skin);
    earOuter.scale.set(0.55, 0.75, 0.38);
    earOuter.position.set(side * 0.285, 0.02, 0); headG.add(earOuter);
    const earInner = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6),
      smat('#C8846A', 0.8, 0.02));
    earInner.scale.set(0.45, 0.62, 0.3);
    earInner.position.set(side * 0.298, 0.02, 0.008); headG.add(earInner);
  });

  // Eyebrows
  [-0.1, 0.1].forEach(x => {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.018, 0.025),
      smat(c.hairColor || '#3D2B1F', 0.9));
    brow.position.set(x, 0.155, 0.255); brow.rotation.z = x > 0 ? -0.12 : 0.12; headG.add(brow);
  });

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
  const steel  = smat('#1C1C2E', 0.28, 0.88);
  const poly   = smat('#2D3042', 0.55, 0.25);
  const brass  = smat('#B8860B', 0.22, 0.92);
  const wood   = smat('#5C3317', 0.82, 0.02);
  const scope  = smat('#0D1117', 0.18, 0.45);
  const wG = new THREE.Group(); wG.name = 'weapon';
  function m(geo, mat) { return new THREE.Mesh(geo, mat); }
  function cyl(rt, rb, h, seg) { return new THREE.CylinderGeometry(rt, rb, h, seg||8); }
  function box(x, y, z) { return new THREE.BoxGeometry(x, y, z); }

  if (weaponType === 'pistol') {
    const slide = m(box(0.066, 0.088, 0.21), steel); slide.position.set(0, 0.022, 0.055); wG.add(slide);
    const frame = m(box(0.06,  0.065, 0.17), poly);  frame.position.set(0, -0.032, 0.04); wG.add(frame);
    const barrel = m(cyl(0.017, 0.017, 0.22), steel); barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0.022, 0.21); wG.add(barrel);
    const grip = m(box(0.055, 0.21, 0.09), poly); grip.position.set(0, -0.135, -0.024); grip.rotation.x = 0.18; wG.add(grip);
    const tg = m(new THREE.TorusGeometry(0.038, 0.009, 6, 10, Math.PI), steel);
    tg.position.set(0, -0.038, 0.025); tg.rotation.z = Math.PI; wG.add(tg);
    const frontS = m(box(0.009, 0.022, 0.01), steel); frontS.position.set(0, 0.07, 0.17); wG.add(frontS);
    const backS  = m(box(0.018, 0.022, 0.012), steel); backS.position.set(0, 0.07, -0.05); wG.add(backS);

  } else if (weaponType === 'shotgun') {
    const recv = m(box(0.1, 0.1, 0.34), steel); recv.position.set(0, 0, 0.04); wG.add(recv);
    [-0.032, 0.032].forEach(x => {
      const b = m(cyl(0.024, 0.024, 0.56), steel); b.rotation.x = Math.PI/2; b.position.set(x, 0.038, 0.42); wG.add(b);
    });
    const pump = m(cyl(0.062, 0.058, 0.19, 12), wood); pump.rotation.x = Math.PI/2; pump.position.set(0, 0.038, 0.22); wG.add(pump);
    const stock = m(box(0.09, 0.1, 0.32), wood); stock.position.set(0, -0.006, -0.28); wG.add(stock);
    const heel  = m(box(0.09, 0.13, 0.055), poly); heel.position.set(0, -0.006, -0.46); wG.add(heel);
    const rib   = m(box(0.014, 0.01, 0.5), steel); rib.position.set(0, 0.068, 0.14); wG.add(rib);
    const guard = m(new THREE.TorusGeometry(0.05, 0.01, 6, 10, Math.PI), steel);
    guard.position.set(0, -0.04, 0.02); guard.rotation.z = Math.PI; wG.add(guard);

  } else if (weaponType === 'rifle') {
    const lower = m(box(0.068, 0.1, 0.4), poly);  lower.position.set(0, 0, 0.04); wG.add(lower);
    const upper = m(box(0.062, 0.062, 0.42), steel); upper.position.set(0, 0.083, 0.04); wG.add(upper);
    const barrel = m(cyl(0.017, 0.017, 0.38), steel); barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0.065, 0.45); wG.add(barrel);
    const fh = m(cyl(0.028, 0.02, 0.06, 6), steel); fh.rotation.x = Math.PI/2; fh.position.set(0, 0.065, 0.66); wG.add(fh);
    const mag = m(box(0.048, 0.24, 0.08), brass); mag.position.set(0, -0.175, 0.1); mag.rotation.x = -0.12; wG.add(mag);
    const grip = m(box(0.058, 0.19, 0.08), poly); grip.position.set(0, -0.115, -0.05); grip.rotation.x = 0.2; wG.add(grip);
    const stock = m(box(0.062, 0.088, 0.24), poly); stock.position.set(0, 0.012, -0.22); wG.add(stock);
    const carry = m(box(0.038, 0.055, 0.2), steel); carry.position.set(0, 0.148, -0.01); wG.add(carry);
    const lens  = m(cyl(0.017, 0.017, 0.04, 8), scope); lens.rotation.x = Math.PI/2; lens.position.set(0, 0.148, 0.1); wG.add(lens);
    const rail  = m(box(0.022, 0.015, 0.38), steel); rail.position.set(0, 0.117, 0.04); wG.add(rail);

  } else if (weaponType === 'sniper') {
    const body   = m(box(0.068, 0.11, 0.52), steel); body.position.set(0, 0, 0.06); wG.add(body);
    const barrel = m(cyl(0.015, 0.017, 0.68), steel); barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0.038, 0.66); wG.add(barrel);
    const mb = m(box(0.048, 0.044, 0.072), steel); mb.position.set(0, 0.038, 1.03); wG.add(mb);
    const sc  = m(cyl(0.038, 0.038, 0.44, 12), scope); sc.rotation.x = Math.PI/2; sc.position.set(0, 0.132, 0.18); wG.add(sc);
    [-0.23, 0.23].forEach(z => {
      const cap = m(cyl(0.041, 0.038, 0.04, 12), steel); cap.rotation.x = Math.PI/2; cap.position.set(0, 0.132, 0.18 + z); wG.add(cap);
    });
    [0.042, -0.042].forEach(x => {
      const knob = m(cyl(0.014, 0.014, 0.065, 8), steel); knob.position.set(x, 0.192, 0.18); wG.add(knob);
    });
    const grip  = m(box(0.058, 0.2, 0.08), poly); grip.position.set(0, -0.12, -0.005); grip.rotation.x = 0.15; wG.add(grip);
    const stock = m(box(0.068, 0.13, 0.31), poly); stock.position.set(0, -0.008, -0.24); wG.add(stock);
    [-0.058, 0.058].forEach((x, i) => {
      const leg = m(cyl(0.007, 0.006, 0.24, 6), steel); leg.position.set(x, -0.1, 0.56); leg.rotation.z = i === 0 ? -0.32 : 0.32; wG.add(leg);
    });

  } else if (weaponType === 'smg') {
    const recv  = m(box(0.08, 0.1, 0.31), steel);  recv.position.set(0, 0, 0.04); wG.add(recv);
    const barrel = m(cyl(0.019, 0.019, 0.24), steel); barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0.018, 0.32); wG.add(barrel);
    const mc = m(cyl(0.027, 0.023, 0.052, 8), steel); mc.rotation.x = Math.PI/2; mc.position.set(0, 0.018, 0.46); wG.add(mc);
    const mag  = m(box(0.048, 0.28, 0.056), brass); mag.position.set(0, -0.19, 0.08); wG.add(mag);
    const grip = m(box(0.06, 0.18, 0.078), poly); grip.position.set(0, -0.1, -0.065); grip.rotation.x = 0.15; wG.add(grip);
    const stockB = m(box(0.078, 0.038, 0.22), steel); stockB.position.set(0, 0.058, -0.145); wG.add(stockB);
    const rail = m(box(0.024, 0.016, 0.27), steel); rail.position.set(0, 0.063, 0.04); wG.add(rail);
    const fg   = m(cyl(0.02, 0.018, 0.12, 8), poly); fg.position.set(0, -0.062, 0.22); wG.add(fg);
  }

  wG.rotation.set(-0.3, 0, 0);
  wG.position.set(0.06, -0.72, 0.16);
  armG.add(wG);
}

function makeNameSprite(name, team) {
  const cvs = document.createElement('canvas');
  cvs.width = 320; cvs.height = 72;
  const ctx = cvs.getContext('2d');
  // Glassy dark bg
  const bg = ctx.createLinearGradient(0,0,0,72);
  bg.addColorStop(0, 'rgba(15,15,30,0.88)');
  bg.addColorStop(1, 'rgba(8,8,20,0.92)');
  ctx.fillStyle = bg; roundRect(ctx,0,0,320,72,14); ctx.fill();
  // Accent bar
  const tc = team === 'red' ? '#EF4444' : team === 'blue' ? '#3B82F6' : '#7C3AED';
  const grad = ctx.createLinearGradient(0,0,0,72);
  grad.addColorStop(0, tc); grad.addColorStop(1, tc + '88');
  ctx.fillStyle = grad; roundRect(ctx,0,0,8,72,0); ctx.fill();
  // Subtle highlight top edge
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(14,1); ctx.lineTo(306,1); ctx.stroke();
  // Name text with shadow
  ctx.shadowColor = tc; ctx.shadowBlur = 10;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name.length > 10 ? name.slice(0,10)+'…' : name, 164, 36);
  ctx.shadowBlur = 0;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cvs), depthTest: false, transparent: true }));
  sp.scale.set(2.0, 0.44, 1); sp.position.y = 1.62; sp.name = 'nameSprite';
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
function spawnHitParticles(pos, color = 0xFF3333) {
  for (let i = 0; i < 16; i++) {
    const size = 0.03 + Math.random() * 0.04;
    const geo  = i % 3 === 0 ? new THREE.OctahedronGeometry(size) : new THREE.SphereGeometry(size, 4, 4);
    const mat  = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2,
      transparent: true, opacity: 1 });
    const p = new THREE.Mesh(geo, mat);
    p.position.copy(pos).add(new THREE.Vector3((Math.random()-.5)*0.3, Math.random()*0.3, (Math.random()-.5)*0.3));
    const speed = 2.5 + Math.random() * 4.5;
    const dir   = new THREE.Vector3(Math.random()-.5, Math.random()*.9+.1, Math.random()-.5).normalize();
    p.userData = { vel: dir.multiplyScalar(speed), life: 0.45 + Math.random()*0.3, maxLife: 0.7, isParticle: true };
    scene.add(p); particles.push(p);
  }
}

function spawnBloodSplat(pos) {
  for (let i = 0; i < 8; i++) {
    const geo = new THREE.SphereGeometry(0.022 + Math.random()*0.03, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xAA0000, transparent: true, opacity: 0.85 });
    const p   = new THREE.Mesh(geo, mat);
    p.position.copy(pos);
    const dir = new THREE.Vector3((Math.random()-.5)*2, Math.random()*1.2, (Math.random()-.5)*2).normalize();
    p.userData = { vel: dir.multiplyScalar(1.8 + Math.random()*2), life: 0.7 + Math.random()*0.4,
      maxLife: 1.0, isParticle: true };
    scene.add(p); particles.push(p);
  }
}

function spawnMuzzleFlash() {
  for (let i = 0; i < 3; i++) {
    const size = 0.55 + Math.random() * 0.4;
    const geo  = new THREE.PlaneGeometry(size, size);
    const mat  = new THREE.MeshBasicMaterial({
      color: i === 0 ? 0xFFFFAA : 0xFFAA22,
      transparent: true, opacity: 0.92 - i*0.2,
      side: THREE.DoubleSide, depthTest: false
    });
    const flash = new THREE.Mesh(geo, mat);
    flash.position.set(0.3 + (Math.random()-.5)*0.1, -0.12 + (Math.random()-.5)*0.06, -0.7);
    flash.rotation.z = Math.random() * Math.PI;
    flash.userData = { life: 0.065 - i*0.015, maxLife: 0.07, isParticle: true, isFlash: true };
    scene.add(flash); particles.push(flash);
  }
  // Shell casing
  const casing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.01, 0.035, 6),
    new THREE.MeshStandardMaterial({ color: 0xC89B3C, roughness: 0.3, metalness: 0.9, transparent: true, opacity: 1 })
  );
  casing.position.set(0.18, -0.08, -0.5);
  const dir = new THREE.Vector3(0.8 + Math.random()*0.4, 0.5 + Math.random()*0.5, -Math.random()*0.5).normalize();
  casing.userData = { vel: dir.multiplyScalar(2.5 + Math.random()), life: 1.2, maxLife: 1.2, isParticle: true };
  scene.add(casing); particles.push(casing);
}

function spawnStarParticles(pos) {
  for (let i = 0; i < 10; i++) {
    const star = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.055 + Math.random()*0.04),
      new THREE.MeshStandardMaterial({ color: 0xFFD700, emissive: 0xFFBB00, emissiveIntensity: 1.5,
        transparent: true, opacity: 1 })
    );
    star.position.copy(pos).add(new THREE.Vector3((Math.random()-.5)*0.3, (Math.random()-.5)*0.3, 0));
    const dir = new THREE.Vector3(Math.random()-.5, Math.random()+.6, Math.random()-.5).normalize();
    star.userData = { vel: dir.multiplyScalar(3.0 + Math.random()*1.5), life: 0.7, maxLife: 0.7, isParticle: true };
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

  if (halo) halo.rotation.z = t * 1.8;

  if (ud.animState === 'idle') {
    // Realistic breathing: slow 1.2 Hz cycle
    const breathe = Math.sin(t * 1.2 * Math.PI * 2) * 0.016;
    const sway    = Math.sin(t * 0.55) * 0.012;
    mesh.position.y = ud.baseY + breathe;
    // Arm breathe sway + gentle pendulum
    if (lArm) {
      lArm.rotation.x = breathe * 1.8 + Math.sin(t * 0.85) * 0.05;
      lArm.rotation.z = 0.15 + Math.sin(t * 0.42) * 0.018;
    }
    if (rArm) {
      rArm.rotation.x = -breathe * 1.8 - Math.sin(t * 0.85) * 0.05;
      rArm.rotation.z = -0.15 - Math.sin(t * 0.42) * 0.018;
    }
    // Weight shift
    if (lLeg) lLeg.rotation.x =  Math.sin(t * 0.55) * 0.025;
    if (rLeg) rLeg.rotation.x = -Math.sin(t * 0.55) * 0.025;
    // Head scan - look left/right slowly
    if (head) {
      head.rotation.y = Math.sin(t * 0.48) * 0.14;
      head.rotation.x = Math.sin(t * 0.72) * 0.035 + breathe * 2;
    }
    mesh.rotation.y += Math.sin(t * 0.22) * 0.0008;
  }

  if (ud.animState === 'hit') {
    ud.hitTimer -= dt;
    const pct = Math.max(0, ud.hitTimer / 0.4);
    // Violent shake + backward lean
    mesh.position.x = ud.baseX + (Math.random() - 0.5) * 0.12 * pct;
    mesh.position.y = ud.baseY - pct * 0.14;
    if (head) { head.rotation.x = -pct * 0.55; head.rotation.z = (Math.random()-.5)*0.1*pct; }
    if (lArm) { lArm.rotation.x = -pct * 0.6; }
    if (rArm) { rArm.rotation.x = -pct * 0.6; }
    mesh.traverse(child => {
      if (child.isMesh && child.material.emissive) {
        child.material.emissive.setRGB(pct > 0 ? 0.85 : 0, 0, 0);
        child.material.emissiveIntensity = pct > 0 ? 1.1 : 0;
      }
    });
    if (ud.hitTimer <= 0) {
      ud.animState = 'idle';
      mesh.position.x = ud.baseX;
      mesh.position.y = ud.baseY;
      if (head) { head.rotation.x = 0; head.rotation.z = 0; }
      if (lArm) lArm.rotation.x = 0;
      if (rArm) rArm.rotation.x = 0;
    }
  }

  if (ud.animState === 'shoot') {
    ud.shootTimer -= dt;
    const pct = Math.max(0, ud.shootTimer / 0.28);
    // Extend arm + recoil kick on first half, recover on second
    const recoil = pct > 0.5 ? (1 - pct) * 2 : pct * 2;
    if (rArm) {
      rArm.rotation.x = -0.82 * (1 - pct);
      rArm.rotation.z = -0.15 + recoil * 0.25;
    }
    if (head) head.rotation.x = -recoil * 0.06;
    if (ud.shootTimer <= 0) {
      ud.animState = 'idle';
      if (rArm) { rArm.rotation.x = 0; rArm.rotation.z = -0.15; }
      if (head) head.rotation.x = 0;
    }
  }

  if (ud.animState === 'dead') {
    // One-time: clone all materials to transparent
    if (!ud.deadInitialized) {
      ud.deadInitialized = true;
      mesh.traverse(child => {
        if (child.isMesh) {
          child.material = child.material.clone();
          child.material.transparent = true;
          child.material.opacity = 1;
        }
      });
    }
    mesh.rotation.z  = Math.min(mesh.rotation.z  + dt * 3.8, Math.PI / 2);
    mesh.rotation.x  = Math.min(mesh.rotation.x  + dt * 0.6, 0.35);
    mesh.position.y  = Math.max(ud.baseY - 1.05,  mesh.position.y - dt * 2.0);
    if (lArm) lArm.rotation.x = Math.min(lArm.rotation.x + dt * 2.2, 1.6);
    if (rArm) rArm.rotation.x = Math.min(rArm.rotation.x + dt * 2.8, 2.0);
    mesh.traverse(child => {
      if (child.isMesh && child.material.transparent)
        child.material.opacity = Math.max(0, child.material.opacity - dt * 0.45);
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
    // Track HP client-side for all players (including bots)
    if (players[targetId]) players[targetId].hp = Math.max(0, (players[targetId].hp ?? 100) - damage);

    const mesh = characterMeshes[targetId];
    if (mesh && targetId !== myId) {
      const pos = mesh.position.clone().add(new THREE.Vector3(0, 0.5, 0));
      spawnHitParticles(pos, 0xFF3333);
      spawnBloodSplat(pos);
      mesh.userData.animState = 'hit';
      mesh.userData.hitTimer = 0.4;
      updateHPBarSprite(mesh, players[targetId]?.hp ?? 100);
      showFloatingDamage(mesh.position, damage);
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
    if (!p.alive) { animateCharacter(mesh, dt); return; }

    const screen = getScreenAngle(p);   // -180 … +180  degrees
    const rad    = screen * Math.PI / 180;

    // ── Positioning ──────────────────────────────────────────────────
    // Camera FOV = 70° → half-angle = 35° → at Z=7, frustum half-width ≈ 4.9 units.
    // Old formula: tx=sin*9, tz=-cos*9  → enemies at 90°+ go off-screen / behind camera.
    // New formula: sin maps the full -180…+180 range into ±4.2 (always inside frustum).
    // tz is slightly deeper for side enemies to give a subtle depth cue.
    const tx = Math.sin(rad) * 4.2;
    const tz = -(7.0 - Math.abs(tx) * 0.18);   // 7.0 at center → ~6.2 at full edge

    mesh.position.x += (tx - mesh.position.x) * 0.12;
    mesh.position.z += (tz - mesh.position.z) * 0.12;
    mesh.visible = true;   // always visible when alive

    // Scale: slightly smaller for "behind" enemies as a direction hint
    const behindFactor = Math.max(0.72, (Math.cos(rad) + 2) / 3); // 0.72–1.0
    mesh.scale.setScalar(behindFactor);

    mesh.lookAt(0, mesh.position.y, 0);

    // Dim name/hp sprites when enemy is behind you (|screen|>90°)
    const nameSp = mesh.getObjectByName('nameSprite');
    const hpSp   = mesh.getObjectByName('hpBar');
    const dimmed = Math.abs(screen) > 90;
    if (nameSp?.material) nameSp.material.opacity = dimmed ? 0.45 : 1.0;
    if (hpSp?.material)   hpSp.material.opacity   = dimmed ? 0.35 : 1.0;

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

  const radar = document.getElementById('radar');
  // Sweep wake + line (CSS animated)
  const wake  = document.createElement('div'); wake.id  = 'radar-wake';  radar.appendChild(wake);
  const sweep = document.createElement('div'); sweep.id = 'radar-sweep'; radar.appendChild(sweep);
  // Me dot (always on top)
  const me = document.createElement('div');
  me.className = 'radar-dot radar-me'; me.id = 'radar-me-dot';
  radar.appendChild(me);
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
  const CX = 58, CY = 58, R = 46; // center 58px (half of 116px), dot radius 46px

  const aliveSet = new Set(alive.map(p => p.id));

  // Remove dots for players no longer alive / left game
  Object.keys(radarDots).forEach(id => {
    if (!aliveSet.has(id)) {
      radarDots[id]?.remove();
      delete radarDots[id];
    }
  });

  alive.forEach(p => {
    if (p.id === myId) return;
    const isEnemy = gameMode !== 'team' || p.team !== myTeam;
    const angle   = getScreenAngle(p) * Math.PI / 180;

    // Clamp to edge if angle > 85° (character off screen — show at radar edge)
    const edgeR = R;
    const x = CX + Math.sin(angle) * edgeR;
    const y = CY - Math.cos(angle) * edgeR;

    if (!radarDots[p.id]) {
      // New dot: create persistent element + ping ring
      const dot = document.createElement('div');
      dot.className = `radar-dot ${isEnemy ? 'radar-enemy' : 'radar-ally'}`;
      radar.insertBefore(dot, document.getElementById('radar-me-dot'));
      radarDots[p.id] = dot;

      // Ping ring animation
      const ring = document.createElement('div');
      ring.className = 'radar-ping-ring';
      ring.style.left = x + 'px';
      ring.style.top  = y + 'px';
      ring.style.borderColor = isEnemy ? '#EF4444' : '#60A5FA';
      radar.appendChild(ring);
      setTimeout(() => ring.remove(), 580);
    }

    // Smooth position update (CSS transition handles the animation)
    radarDots[p.id].style.left = x + 'px';
    radarDots[p.id].style.top  = y + 'px';
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
