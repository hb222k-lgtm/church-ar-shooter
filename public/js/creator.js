'use strict';

const SKIN_COLORS  = ['#FDBCB4','#F1A283','#C77A52','#8D5524','#4B2E12'];
const HAIR_COLORS  = ['#F2EBE0','#F4D03F','#A0522D','#3D2B1F','#1C1C1C','#E74C3C','#3498DB','#8E44AD'];
const SHIRT_COLORS = ['#EF4444','#F97316','#EAB308','#22C55E','#3B82F6','#8B5CF6','#EC4899','#FFFFFF','#374151'];
const PANTS_COLORS = ['#1E3A5F','#374151','#1C1C1C','#7C3AED','#065F46','#92400E','#FFFFFF','#4B5563'];
const ACC_COLORS   = ['#FFD700','#FF6B6B','#4ECDC4','#95E1D3','#FF8B94','#A8E6CF','#FFFFFF','#3D5A80'];
const HAIR_STYLES  = ['짧은머리','긴머리','곱슬머리','포니테일','모히칸','대머리'];
const ACCESSORIES  = ['없음','모자','안경','왕관','후광','마스크'];
const WEAPON_DATA  = {
  pistol:  { name:'권총',    icon:'🔫', desc:'균형잡힌 기본 무기',   dmg:25, rate:3, range:3, ammo:12 },
  shotgun: { name:'샷건',    icon:'💥', desc:'근거리 일격필살',       dmg:65, rate:1, range:1, ammo:6  },
  rifle:   { name:'돌격소총', icon:'🎯', desc:'높은 연사력과 정확도', dmg:30, rate:5, range:4, ammo:30 },
  sniper:  { name:'저격총',  icon:'🏹', desc:'원거리 치명타',         dmg:95, rate:1, range:5, ammo:5  },
  smg:     { name:'기관단총', icon:'⚡', desc:'최고속 연사력',         dmg:18, rate:5, range:2, ammo:25 },
};

const char = {
  name:'', skinColor:SKIN_COLORS[0], hairColor:HAIR_COLORS[3],
  hairStyle:'짧은머리', shirtColor:SHIRT_COLORS[0], pantsColor:PANTS_COLORS[0],
  accessory:'없음', accColor:ACC_COLORS[0], weapon:'pistol',
};

/* ── Three.js 3D preview ── */
let pScene, pCamera, pRenderer, pChar, pTime = 0;
let isDragging = false, prevX = 0, rotY = 0;

function hexToThreeColor(hex) {
  return new THREE.Color(hex);
}

function mat(color, roughness = 0.7, metalness = 0.1) {
  return new THREE.MeshStandardMaterial({
    color: hexToThreeColor(color),
    roughness, metalness
  });
}

function buildPreviewChar(c) {
  const g = new THREE.Group();

  // Legs
  const legGeo = new THREE.CylinderGeometry(0.13, 0.11, 0.65, 10);
  const legMat = mat(c.pantsColor, 0.8);
  const lLeg = new THREE.Mesh(legGeo, legMat); lLeg.position.set(-0.16,-0.72,0); g.add(lLeg);
  const rLeg = new THREE.Mesh(legGeo, legMat); rLeg.position.set( 0.16,-0.72,0); g.add(rLeg);

  // Shoes
  const shoeGeo = new THREE.BoxGeometry(0.22, 0.1, 0.3);
  const shoeMat = mat('#111122', 0.9);
  [-0.16, 0.16].forEach(x => {
    const s = new THREE.Mesh(shoeGeo, shoeMat);
    s.position.set(x, -1.08, 0.05); g.add(s);
  });

  // Body
  const bodyGeo = new THREE.BoxGeometry(0.62, 0.75, 0.32);
  bodyGeo.translate(0, 0, 0);
  const body = new THREE.Mesh(bodyGeo, mat(c.shirtColor, 0.75));
  body.position.set(0, -0.02, 0); g.add(body);

  // Collar
  const collarGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.12, 10);
  const collar = new THREE.Mesh(collarGeo, mat(c.shirtColor, 0.75));
  collar.position.set(0, 0.42, 0); g.add(collar);

  // Arms
  const armGeo = new THREE.CylinderGeometry(0.1, 0.09, 0.6, 10);
  const skinMat = mat(c.skinColor, 0.65, 0.05);
  const lArmG = new THREE.Group(); lArmG.name = 'lArm';
  const rArmG = new THREE.Group(); rArmG.name = 'rArm';
  const lArm = new THREE.Mesh(armGeo, mat(c.shirtColor, 0.75));
  const rArm = new THREE.Mesh(armGeo, mat(c.shirtColor, 0.75));
  lArm.position.y = -0.3; rArm.position.y = -0.3;
  lArmG.add(lArm); rArmG.add(rArm);
  // Forearm
  const foreGeo = new THREE.CylinderGeometry(0.09, 0.08, 0.5, 10);
  const lFore = new THREE.Mesh(foreGeo, skinMat); lFore.position.y = -0.55;
  const rFore = new THREE.Mesh(foreGeo, skinMat); rFore.position.y = -0.55;
  lArmG.add(lFore); rArmG.add(rFore);
  lArmG.position.set(-0.42, 0.28, 0); lArmG.rotation.z =  0.12;
  rArmG.position.set( 0.42, 0.28, 0); rArmG.rotation.z = -0.12;
  g.add(lArmG); g.add(rArmG);

  // Neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.18, 10), skinMat);
  neck.position.set(0, 0.47, 0); g.add(neck);

  // Head
  const headG = new THREE.Group(); headG.name = 'head';
  const headGeo = new THREE.SphereGeometry(0.3, 20, 20);
  const head = new THREE.Mesh(headGeo, skinMat);
  headG.add(head);

  // Eyes
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const eyeDark  = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
  const pupilM   = new THREE.MeshStandardMaterial({ color: 0x3366ff, roughness: 0.2, metalness: 0.1 });
  [[-0.11, 1], [0.11, 1]].forEach(([x]) => {
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 12), eyeWhite);
    white.position.set(x, 0.06, 0.25); headG.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 10), pupilM);
    pupil.position.set(x, 0.06, 0.3); headG.add(pupil);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1 }));
    shine.position.set(x + 0.025, 0.09, 0.33); headG.add(shine);
  });

  // Eyebrows
  const browMat = mat(c.hairColor, 0.9);
  [-0.11, 0.11].forEach(x => {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.094, 0.019, 0.026), browMat);
    brow.position.set(x, 0.165, 0.275); brow.rotation.z = x > 0 ? -0.12 : 0.12; headG.add(brow);
  });

  // Mouth (smile)
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 6, 12, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x993322, roughness: 0.8 }));
  mouth.position.set(0, -0.1, 0.27); mouth.rotation.z = Math.PI; headG.add(mouth);

  // Nose
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), skinMat);
  nose.position.set(0, 0, 0.3); nose.scale.set(1, 0.7, 0.5); headG.add(nose);

  // Ears
  [-1, 1].forEach(side => {
    const outer = new THREE.Mesh(new THREE.SphereGeometry(0.068, 10, 8), skinMat);
    outer.scale.set(0.52, 0.74, 0.36); outer.position.set(side * 0.29, 0.02, 0); headG.add(outer);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 6),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(c.skinColor).multiplyScalar(0.85), roughness: 0.8 }));
    inner.scale.set(0.44, 0.60, 0.28); inner.position.set(side * 0.302, 0.02, 0.008); headG.add(inner);
  });

  // Hair
  addHair3D(headG, c.hairStyle, c.hairColor);

  headG.position.set(0, 0.68, 0);
  g.add(headG);

  // Accessory
  addAccessory3D(g, headG, c.accessory, c.accColor);

  // Weapon in right hand
  addWeapon3D(rArmG, c.weapon);

  // Shadow plane
  g.position.y = 0.15;
  return g;
}

function addHair3D(headG, style, color) {
  const hMat = mat(color, 0.85, 0.05);
  if (style === '대머리') {
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.31, 16, 16),
      new THREE.MeshStandardMaterial({ color: hexToThreeColor(color.replace('#', '#')), roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.4 }));
    headG.add(shine); return;
  }
  if (style === '짧은머리') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.305, 16, 16), hMat);
    cap.scale.set(1, 0.55, 1); cap.position.y = 0.14; headG.add(cap);
    // Side tufts
    [-1, 1].forEach(s => {
      const tuft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.2), hMat);
      tuft.position.set(s * 0.28, 0, 0); headG.add(tuft);
    });
  } else if (style === '긴머리') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.305, 16, 16), hMat);
    cap.scale.set(1, 0.55, 1); cap.position.y = 0.14; headG.add(cap);
    const long = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.15), hMat);
    long.position.set(0, -0.35, -0.1); headG.add(long);
  } else if (style === '곱슬머리') {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const curl = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), hMat);
      curl.position.set(Math.cos(a)*0.22, 0.05 + Math.sin(a)*0.1, Math.sin(a)*0.18); headG.add(curl);
    }
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 10), hMat);
    top.position.y = 0.28; headG.add(top);
  } else if (style === '포니테일') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.305, 16, 16), hMat);
    cap.scale.set(1, 0.55, 1); cap.position.y = 0.14; headG.add(cap);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.04, 0.6, 8), hMat);
    tail.position.set(0, -0.3, -0.28); tail.rotation.x = 0.4; headG.add(tail);
  } else if (style === '모히칸') {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.58), hMat);
    strip.position.set(0, 0.32, 0); headG.add(strip);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 6), hMat);
    tip.position.set(0, 0.62, 0); headG.add(tip);
  }
}

function addAccessory3D(g, headG, acc, color) {
  const aMat = new THREE.MeshStandardMaterial({ color: hexToThreeColor(color), roughness: 0.4, metalness: 0.3 });
  if (acc === '모자') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 20), aMat);
    brim.position.set(0, 1.06, 0); g.add(brim);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.35, 16), aMat);
    top.position.set(0, 1.26, 0); g.add(top);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.265, 0.265, 0.06, 16),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }));
    band.position.set(0, 1.09, 0); g.add(band);
  } else if (acc === '안경') {
    const frameMat = new THREE.MeshStandardMaterial({ color: hexToThreeColor(color), roughness: 0.3, metalness: 0.6 });
    [-0.12, 0.12].forEach(x => {
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.015, 8, 20), frameMat);
      frame.position.set(x, 0.74, 0.29); frame.rotation.y = Math.PI / 2; g.add(frame);
    });
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 6), frameMat);
    bridge.rotation.z = Math.PI / 2; bridge.position.set(0, 0.74, 0.29); g.add(bridge);
  } else if (acc === '왕관') {
    const crownMat = new THREE.MeshStandardMaterial({ color: hexToThreeColor(color), roughness: 0.2, metalness: 0.8,
      emissive: hexToThreeColor(color), emissiveIntensity: 0.15 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.35, 0.12, 20, 1, true), crownMat);
    base.position.set(0, 1.04, 0); g.add(base);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 5), crownMat);
      spike.position.set(Math.cos(a)*0.3, 1.22, Math.sin(a)*0.3); g.add(spike);
    }
  } else if (acc === '후광') {
    const haloMat = new THREE.MeshStandardMaterial({
      color: hexToThreeColor(color), roughness: 0.1, metalness: 0.5,
      emissive: hexToThreeColor(color), emissiveIntensity: 0.8
    });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.04, 10, 30), haloMat);
    halo.name = 'halo';
    halo.position.set(0, 1.18, 0); halo.rotation.x = Math.PI / 2; g.add(halo);
  } else if (acc === '마스크') {
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.22, 0.12),
      new THREE.MeshStandardMaterial({ color: hexToThreeColor(color), roughness: 0.6 }));
    mask.position.set(0, 0.54, 0.27); g.add(mask);
    for (let i = 0; i < 3; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.01, 0.01),
        new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.9 }));
      line.position.set(0, 0.56 - i * 0.06, 0.33); g.add(line);
    }
  }
}

function addWeapon3D(armG, weaponType) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x1C1C2E, roughness: 0.28, metalness: 0.88 });
  const poly  = new THREE.MeshStandardMaterial({ color: 0x2D3042, roughness: 0.55, metalness: 0.25 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xB8860B, roughness: 0.22, metalness: 0.92 });
  const wood  = new THREE.MeshStandardMaterial({ color: 0x5C3317, roughness: 0.82, metalness: 0.02 });
  const sc    = new THREE.MeshStandardMaterial({ color: 0x0D1117, roughness: 0.18, metalness: 0.45 });
  const wG = new THREE.Group(); wG.name = 'weapon';
  function mk(geo, m) { return new THREE.Mesh(geo, m); }
  function cyl(rt, rb, h, s) { return new THREE.CylinderGeometry(rt, rb, h, s||8); }
  function box(x, y, z) { return new THREE.BoxGeometry(x, y, z); }

  if (weaponType === 'pistol') {
    const slide = mk(box(0.066, 0.088, 0.21), steel); slide.position.set(0, 0.022, 0.055); wG.add(slide);
    const frame = mk(box(0.06,  0.065, 0.17), poly);  frame.position.set(0, -0.032, 0.04); wG.add(frame);
    const barrel = mk(cyl(0.017, 0.017, 0.22), steel); barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0.022, 0.21); wG.add(barrel);
    const grip = mk(box(0.055, 0.21, 0.09), poly); grip.position.set(0, -0.135, -0.024); grip.rotation.x = 0.18; wG.add(grip);
    const tg = mk(new THREE.TorusGeometry(0.038, 0.009, 6, 10, Math.PI), steel);
    tg.position.set(0, -0.038, 0.025); tg.rotation.z = Math.PI; wG.add(tg);
  } else if (weaponType === 'shotgun') {
    const recv = mk(box(0.1, 0.1, 0.34), steel); recv.position.set(0, 0, 0.04); wG.add(recv);
    [-0.032, 0.032].forEach(x => {
      const b = mk(cyl(0.024, 0.024, 0.56), steel); b.rotation.x = Math.PI/2; b.position.set(x, 0.038, 0.42); wG.add(b);
    });
    const pump = mk(cyl(0.062, 0.058, 0.19, 12), wood); pump.rotation.x = Math.PI/2; pump.position.set(0, 0.038, 0.22); wG.add(pump);
    const stock = mk(box(0.09, 0.1, 0.32), wood); stock.position.set(0, -0.006, -0.28); wG.add(stock);
    const heel  = mk(box(0.09, 0.13, 0.055), poly); heel.position.set(0, -0.006, -0.46); wG.add(heel);
    const rib   = mk(box(0.014, 0.01, 0.5), steel); rib.position.set(0, 0.068, 0.14); wG.add(rib);
  } else if (weaponType === 'rifle') {
    const lower = mk(box(0.068, 0.1, 0.4), poly);  lower.position.set(0, 0, 0.04); wG.add(lower);
    const upper = mk(box(0.062, 0.062, 0.42), steel); upper.position.set(0, 0.083, 0.04); wG.add(upper);
    const barrel = mk(cyl(0.017, 0.017, 0.38), steel); barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0.065, 0.45); wG.add(barrel);
    const fh = mk(cyl(0.028, 0.02, 0.06, 6), steel); fh.rotation.x = Math.PI/2; fh.position.set(0, 0.065, 0.66); wG.add(fh);
    const mag = mk(box(0.048, 0.24, 0.08), brass); mag.position.set(0, -0.175, 0.1); mag.rotation.x = -0.12; wG.add(mag);
    const grip = mk(box(0.058, 0.19, 0.08), poly); grip.position.set(0, -0.115, -0.05); grip.rotation.x = 0.2; wG.add(grip);
    const stock = mk(box(0.062, 0.088, 0.24), poly); stock.position.set(0, 0.012, -0.22); wG.add(stock);
    const carry = mk(box(0.038, 0.055, 0.2), steel); carry.position.set(0, 0.148, -0.01); wG.add(carry);
    const rail  = mk(box(0.022, 0.015, 0.38), steel); rail.position.set(0, 0.117, 0.04); wG.add(rail);
  } else if (weaponType === 'sniper') {
    const body   = mk(box(0.068, 0.11, 0.52), steel); body.position.set(0, 0, 0.06); wG.add(body);
    const barrel = mk(cyl(0.015, 0.017, 0.68), steel); barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0.038, 0.66); wG.add(barrel);
    const mb = mk(box(0.048, 0.044, 0.072), steel); mb.position.set(0, 0.038, 1.03); wG.add(mb);
    const scp = mk(cyl(0.038, 0.038, 0.44, 12), sc); scp.rotation.x = Math.PI/2; scp.position.set(0, 0.132, 0.18); wG.add(scp);
    [-0.23, 0.23].forEach(z => {
      const cap = mk(cyl(0.041, 0.038, 0.04, 12), steel); cap.rotation.x = Math.PI/2; cap.position.set(0, 0.132, 0.18 + z); wG.add(cap);
    });
    const grip  = mk(box(0.058, 0.2, 0.08), poly); grip.position.set(0, -0.12, -0.005); grip.rotation.x = 0.15; wG.add(grip);
    const stock = mk(box(0.068, 0.13, 0.31), poly); stock.position.set(0, -0.008, -0.24); wG.add(stock);
    [-0.058, 0.058].forEach((x, i) => {
      const leg = mk(cyl(0.007, 0.006, 0.24, 6), steel); leg.position.set(x, -0.1, 0.56); leg.rotation.z = i === 0 ? -0.32 : 0.32; wG.add(leg);
    });
  } else if (weaponType === 'smg') {
    const recv  = mk(box(0.08, 0.1, 0.31), steel);  recv.position.set(0, 0, 0.04); wG.add(recv);
    const barrel = mk(cyl(0.019, 0.019, 0.24), steel); barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0.018, 0.32); wG.add(barrel);
    const mc = mk(cyl(0.027, 0.023, 0.052, 8), steel); mc.rotation.x = Math.PI/2; mc.position.set(0, 0.018, 0.46); wG.add(mc);
    const mag  = mk(box(0.048, 0.28, 0.056), brass); mag.position.set(0, -0.19, 0.08); wG.add(mag);
    const grip = mk(box(0.06, 0.18, 0.078), poly); grip.position.set(0, -0.1, -0.065); grip.rotation.x = 0.15; wG.add(grip);
    const stockB = mk(box(0.078, 0.038, 0.22), steel); stockB.position.set(0, 0.058, -0.145); wG.add(stockB);
    const fg   = mk(cyl(0.02, 0.018, 0.12, 8), poly); fg.position.set(0, -0.062, 0.22); wG.add(fg);
  }

  wG.rotation.set(-0.3, 0, 0);
  wG.position.set(0.06, -0.72, 0.15);
  armG.add(wG);
}

function initPreview() {
  const canvas = document.getElementById('char-canvas-3d');
  pScene = new THREE.Scene();
  pCamera = new THREE.PerspectiveCamera(42, canvas.width / canvas.height, 0.1, 100);
  pCamera.position.set(0, 0.3, 3.8);
  pCamera.lookAt(0, 0.2, 0);

  pRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  pRenderer.setSize(canvas.width, canvas.height);
  pRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  pRenderer.shadowMap.enabled = true;
  pRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  pRenderer.setClearColor(0x000000, 0);
  pRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  pRenderer.toneMappingExposure = 1.2;

  // Lighting setup
  const ambient = new THREE.AmbientLight(0x8899CC, 0.6);
  pScene.add(ambient);
  const key = new THREE.DirectionalLight(0xFFFFEE, 1.4);
  key.position.set(2, 4, 3); key.castShadow = true; pScene.add(key);
  const fill = new THREE.DirectionalLight(0x6688FF, 0.5);
  fill.position.set(-2, 1, -1); pScene.add(fill);
  const rim = new THREE.DirectionalLight(0xFFAA44, 0.6);
  rim.position.set(0, -1, -4); pScene.add(rim);

  // Ground shadow disc
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.8, 32),
    new THREE.MeshStandardMaterial({ color: 0x6633CC, roughness: 1, transparent: true, opacity: 0.35 })
  );
  disc.rotation.x = -Math.PI / 2; disc.position.y = -1.1; pScene.add(disc);

  // Drag to rotate
  canvas.addEventListener('touchstart', e => { isDragging = true; prevX = e.touches[0].clientX; });
  canvas.addEventListener('touchmove', e => {
    if (!isDragging) return;
    rotY += (e.touches[0].clientX - prevX) * 0.015;
    prevX = e.touches[0].clientX;
  });
  canvas.addEventListener('touchend', () => isDragging = false);
  canvas.addEventListener('mousedown', e => { isDragging = true; prevX = e.clientX; });
  canvas.addEventListener('mousemove', e => {
    if (!isDragging) return;
    rotY += (e.clientX - prevX) * 0.012;
    prevX = e.clientX;
  });
  canvas.addEventListener('mouseup', () => isDragging = false);

  rebuildChar();
  animatePreview();
}

function rebuildChar() {
  if (pChar) pScene.remove(pChar);
  pChar = buildPreviewChar(char);
  pScene.add(pChar);
}

function animatePreview() {
  requestAnimationFrame(animatePreview);
  pTime += 0.016;
  if (pChar) {
    if (!isDragging) rotY += 0.005;
    pChar.rotation.y = rotY;
    // Breathing
    const breathe = Math.sin(pTime * 1.2 * Math.PI * 2) * 0.015;
    pChar.position.y = breathe;
    // Arm sway from breathing
    const lArm = pChar.getObjectByName('lArm');
    const rArm = pChar.getObjectByName('rArm');
    if (lArm) { lArm.rotation.x = breathe * 1.6 + Math.sin(pTime * 0.8) * 0.04; lArm.rotation.z = 0.12 + Math.sin(pTime * 0.42) * 0.015; }
    if (rArm) { rArm.rotation.x = -breathe * 1.6 - Math.sin(pTime * 0.8) * 0.04; rArm.rotation.z = -0.12 - Math.sin(pTime * 0.42) * 0.015; }
    // Halo spin
    const halo = pChar.getObjectByName('halo');
    if (halo) halo.rotation.z = pTime * 1.4;
  }
  pRenderer.render(pScene, pCamera);
}

/* ── DOM helpers ── */
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function makeSwatches(containerId, colors, key) {
  const wrap = document.getElementById(containerId);
  colors.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (char[key] === c ? ' selected' : '');
    sw.style.background = c;
    if (c === '#FFFFFF') sw.style.border = '3px solid rgba(255,255,255,0.25)';
    sw.addEventListener('click', () => {
      wrap.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      char[key] = c;
      rebuildChar();
    });
    wrap.appendChild(sw);
  });
}

function makeStyleBtns(containerId, items, key) {
  const wrap = document.getElementById(containerId);
  items.forEach(item => {
    const btn = document.createElement('div');
    btn.className = 'style-btn' + (char[key] === item ? ' selected' : '');
    btn.textContent = item;
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.style-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      char[key] = item;
      rebuildChar();
    });
    wrap.appendChild(btn);
  });
}

function makeWeapons() {
  const list = document.getElementById('weapon-list');
  Object.entries(WEAPON_DATA).forEach(([key, w]) => {
    const card = document.createElement('div');
    card.className = 'weapon-card' + (char.weapon === key ? ' selected' : '');
    card.innerHTML = `
      <div class="weapon-icon">${w.icon}</div>
      <div class="weapon-info">
        <div class="weapon-name">${w.name}</div>
        <div class="weapon-desc">${w.desc}</div>
        <div style="margin-top:6px">
          ${bar('데미지',  w.dmg / 20)}
          ${bar('연사',    w.rate / 5)}
          ${bar('사거리',  w.range / 5)}
          ${bar('장탄',    Math.min(w.ammo / 30, 1))}
        </div>
      </div>
      <div style="text-align:right;font-size:11px;color:rgba(255,255,255,0.5)">
        장탄수<br><b style="font-size:20px;color:#fff">${w.ammo}</b>
      </div>`;
    card.addEventListener('click', () => {
      list.querySelectorAll('.weapon-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      char.weapon = key;
      rebuildChar();
    });
    list.appendChild(card);
  });
}

function bar(label, ratio) {
  return `<div class="stat-bar-row">
    <div class="stat-bar-label">${label}</div>
    <div class="stat-bar"><div class="stat-bar-fill" style="width:${Math.round(ratio*100)}%"></div></div>
  </div>`;
}

function init() {
  makeSwatches('skin-colors',  SKIN_COLORS,  'skinColor');
  makeSwatches('hair-colors',  HAIR_COLORS,  'hairColor');
  makeSwatches('shirt-colors', SHIRT_COLORS, 'shirtColor');
  makeSwatches('pants-colors', PANTS_COLORS, 'pantsColor');
  makeSwatches('acc-colors',   ACC_COLORS,   'accColor');
  makeStyleBtns('hair-styles', HAIR_STYLES,  'hairStyle');
  makeStyleBtns('accessories', ACCESSORIES,  'accessory');
  makeWeapons();
  initPreview();

  document.getElementById('name-input').addEventListener('input', e => {
    char.name = e.target.value;
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  document.getElementById('next-btn').addEventListener('click', () => {
    if (!char.name.trim()) { toast('닉네임을 입력해주세요!'); return; }
    sessionStorage.setItem('char', JSON.stringify(char));
    window.location.href = 'lobby.html';
  });
}

window.addEventListener('DOMContentLoaded', init);
