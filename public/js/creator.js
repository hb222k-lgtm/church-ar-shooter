/* =========================================================
   Tank Creator — 2D top-down preview, matches in-game look
   ========================================================= */
'use strict';

const BODY_COLORS = [
  '#4B6B3A', '#6B7F3A', '#374151', '#1F2937', '#7C2D12',
  '#8B2D2D', '#1E3A8A', '#155E75', '#4C1D95', '#9D174D',
  '#92400E', '#365314'
];
const TURRET_COLORS = [
  '#2A3F1F', '#1C1C1C', '#4A2A0E', '#312E81', '#5B21B6',
  '#581C87', '#0F172A', '#7F1D1D', '#064E3B'
];
const TRACK_COLORS = [
  '#1C1C1C', '#0a0a0a', '#3F3F46', '#1F2937', '#451A03'
];
const ACCENT_COLORS = [
  '#FBBF24', '#EF4444', '#10B981', '#3B82F6', '#EC4899',
  '#F97316', '#A78BFA', '#06B6D4', '#FFFFFF'
];

const CHASSIS = [
  { key:'light',  icon:'🏎️', name:'경전차',   desc:'HP 500 · 속도 +30%',
    w:32, h:40, tw:18, th:20, barL:22, barW:3.5 },
  { key:'medium', icon:'🛡️', name:'중형전차', desc:'HP 700 · 균형형 (기본)',
    w:38, h:46, tw:22, th:24, barL:26, barW:4 },
  { key:'heavy',  icon:'🪖', name:'중전차',   desc:'HP 1000 · 속도 -28%',
    w:46, h:54, tw:28, th:30, barL:28, barW:5 },
  { key:'sniper', icon:'🎯', name:'저격전차', desc:'HP 600 · 데미지 +35%',
    w:32, h:44, tw:18, th:20, barL:40, barW:3 },
  { key:'scout',  icon:'📡', name:'정찰전차', desc:'HP 550 · 속도 +25%',
    w:28, h:36, tw:16, th:18, barL:20, barW:3 },
];

const WEAPONS = {
  pistol:  { name:'기관포', icon:'🔫', desc:'균형형, 빠른 연사' },
  shotgun: { name:'산탄포', icon:'💥', desc:'8발 산탄, 근접 강함' },
  rifle:   { name:'속사포', icon:'⚡', desc:'고속 연사' },
  sniper:  { name:'저격포', icon:'🎯', desc:'한 방 강함' },
  smg:     { name:'유탄포', icon:'🔥', desc:'초고속 연사' },
};

const char = {
  name: '',
  chassis: 'medium',
  bodyColor: BODY_COLORS[0],
  turretColor: TURRET_COLORS[0],
  trackColor: TRACK_COLORS[0],
  accentColor: ACCENT_COLORS[0],
  weapon: 'pistol',
  // Legacy fields so lobby's drawMini still works without rewrite
  skinColor: BODY_COLORS[0], hairColor: TURRET_COLORS[0],
  shirtColor: ACCENT_COLORS[0], pantsColor: TRACK_COLORS[0],
  hairStyle: 'medium', accessory: '없음',
};

/* ─── Toast ─── */
function toast(msg) {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

/* ─── Tank preview canvas ─── */
const previewCanvas = document.getElementById('tank-preview');
const pctx = previewCanvas.getContext('2d');

function drawTankPreview() {
  const cw = previewCanvas.width, ch = previewCanvas.height;
  pctx.clearRect(0, 0, cw, ch);

  // Grid backdrop
  pctx.strokeStyle = 'rgba(255,255,255,0.04)';
  pctx.lineWidth = 1;
  for (let x = 0; x <= cw; x += 24) {
    pctx.beginPath(); pctx.moveTo(x, 0); pctx.lineTo(x, ch); pctx.stroke();
  }
  for (let y = 0; y <= ch; y += 24) {
    pctx.beginPath(); pctx.moveTo(0, y); pctx.lineTo(cw, y); pctx.stroke();
  }

  const s = CHASSIS.find(c => c.key === char.chassis) || CHASSIS[1];
  const scale = 2.2;
  const cx = cw/2, cy = ch/2;
  const t = Date.now()/1000;

  pctx.save();
  pctx.translate(cx, cy);
  pctx.rotate(Math.sin(t*0.6)*0.25);  // gentle sway
  pctx.scale(scale, scale);

  // Shadow
  pctx.beginPath();
  pctx.ellipse(0, s.h*0.55, s.w*0.62, 5, 0, 0, Math.PI*2);
  pctx.fillStyle = 'rgba(0,0,0,0.45)'; pctx.fill();

  // Tracks
  pctx.fillStyle = char.trackColor;
  pctx.fillRect(-s.w/2 - 5, -s.h/2, 5, s.h);
  pctx.fillRect( s.w/2,     -s.h/2, 5, s.h);
  pctx.fillStyle = 'rgba(0,0,0,0.55)';
  for (let i = -s.h/2 + 4; i < s.h/2 - 1; i += 5) {
    pctx.fillRect(-s.w/2 - 5, i, 5, 1.5);
    pctx.fillRect( s.w/2,     i, 5, 1.5);
  }
  pctx.fillStyle = '#0a0a0a';
  [-s.h/2+2, s.h/2-4].forEach(yy => {
    pctx.beginPath(); pctx.arc(-s.w/2 - 2.5, yy+1, 3, 0, Math.PI*2); pctx.fill();
    pctx.beginPath(); pctx.arc( s.w/2 + 2.5, yy+1, 3, 0, Math.PI*2); pctx.fill();
  });

  // Body
  pctx.fillStyle = char.bodyColor;
  pctx.fillRect(-s.w/2, -s.h/2, s.w, s.h);
  const bg = pctx.createLinearGradient(0, -s.h/2, 0, s.h/2);
  bg.addColorStop(0, 'rgba(255,255,255,0.22)');
  bg.addColorStop(0.4, 'rgba(255,255,255,0)');
  bg.addColorStop(1, 'rgba(0,0,0,0.25)');
  pctx.fillStyle = bg; pctx.fillRect(-s.w/2, -s.h/2, s.w, s.h);

  // Accent stripe
  pctx.fillStyle = char.accentColor;
  pctx.fillRect(-2, -s.h/2 + 4, 4, s.h - 8);

  pctx.strokeStyle = 'rgba(0,0,0,0.55)';
  pctx.lineWidth = 1.4;
  pctx.strokeRect(-s.w/2, -s.h/2, s.w, s.h);
  pctx.fillStyle = 'rgba(0,0,0,0.18)';
  pctx.fillRect(-s.w/2 + 3, -s.h/2 + 2, s.w - 6, 4);

  // Turret
  pctx.fillStyle = char.turretColor;
  pctx.beginPath(); pctx.arc(0, 0, s.tw/2, 0, Math.PI*2); pctx.fill();
  const tg = pctx.createRadialGradient(-s.tw*0.2, -s.tw*0.2, 1, 0, 0, s.tw/2);
  tg.addColorStop(0, 'rgba(255,255,255,0.25)');
  tg.addColorStop(1, 'rgba(0,0,0,0)');
  pctx.fillStyle = tg; pctx.fill();
  pctx.strokeStyle = 'rgba(0,0,0,0.55)'; pctx.lineWidth = 1.4; pctx.stroke();
  pctx.beginPath(); pctx.arc(0, s.tw*0.15, s.tw*0.13, 0, Math.PI*2);
  pctx.fillStyle = 'rgba(0,0,0,0.5)'; pctx.fill();

  // Barrel
  const bw = s.barW;
  pctx.fillStyle = char.turretColor;
  pctx.fillRect(-bw - 1, -s.tw/2 - 3, bw*2 + 2, 5);
  pctx.fillStyle = '#2a2a2a';
  pctx.fillRect(-bw/2, -s.tw/2 - s.barL, bw, s.barL);
  pctx.strokeStyle = 'rgba(0,0,0,0.55)';
  pctx.lineWidth = 1;
  pctx.strokeRect(-bw/2, -s.tw/2 - s.barL, bw, s.barL);
  pctx.fillStyle = '#444';
  pctx.fillRect(-bw, -s.tw/2 - s.barL - 4, bw*2, 4);

  pctx.restore();
}

function animatePreview() {
  drawTankPreview();
  requestAnimationFrame(animatePreview);
}
animatePreview();

/* ─── Sync legacy color fields whenever main fields change ─── */
function syncLegacy() {
  char.skinColor  = char.bodyColor;
  char.hairColor  = char.turretColor;
  char.pantsColor = char.trackColor;
  char.shirtColor = char.accentColor;
  char.hairStyle  = char.chassis;
}

/* ─── Chassis grid ─── */
const chassisGrid = document.getElementById('chassis-grid');
CHASSIS.forEach(c => {
  const card = document.createElement('div');
  card.className = 'chassis-card' + (char.chassis === c.key ? ' selected' : '');
  card.innerHTML = `
    <div class="chassis-icon">${c.icon}</div>
    <div class="chassis-name">${c.name}</div>
    <div class="chassis-desc">${c.desc}</div>
  `;
  card.addEventListener('click', () => {
    char.chassis = c.key; syncLegacy();
    chassisGrid.querySelectorAll('.chassis-card').forEach(x => x.classList.remove('selected'));
    card.classList.add('selected');
  });
  chassisGrid.appendChild(card);
});

/* ─── Color swatch grids ─── */
function buildSwatchGrid(elId, colors, fieldKey) {
  const wrap = document.getElementById(elId);
  colors.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (char[fieldKey] === c ? ' selected' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => {
      char[fieldKey] = c; syncLegacy();
      wrap.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
      sw.classList.add('selected');
    });
    wrap.appendChild(sw);
  });
}
buildSwatchGrid('body-colors',   BODY_COLORS,   'bodyColor');
buildSwatchGrid('turret-colors', TURRET_COLORS, 'turretColor');
buildSwatchGrid('track-colors',  TRACK_COLORS,  'trackColor');
buildSwatchGrid('accent-colors', ACCENT_COLORS, 'accentColor');

/* ─── Weapon list ─── */
const weaponList = document.getElementById('weapon-list');
Object.entries(WEAPONS).forEach(([key, w]) => {
  const card = document.createElement('div');
  card.className = 'weapon-card' + (char.weapon === key ? ' selected' : '');
  card.innerHTML = `
    <div class="weapon-icon">${w.icon}</div>
    <div class="weapon-info">
      <div class="weapon-name">${w.name}</div>
      <div class="weapon-desc">${w.desc}</div>
    </div>
  `;
  card.addEventListener('click', () => {
    char.weapon = key;
    weaponList.querySelectorAll('.weapon-card').forEach(x => x.classList.remove('selected'));
    card.classList.add('selected');
  });
  weaponList.appendChild(card);
});

/* ─── Tabs ─── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

/* ─── Name input ─── */
document.getElementById('name-input').addEventListener('input', e => {
  char.name = e.target.value.trim();
});

/* ─── Pre-fill from previous session ─── */
const saved = JSON.parse(sessionStorage.getItem('char') || 'null');
if (saved) {
  Object.assign(char, saved);
  document.getElementById('name-input').value = saved.name || '';
  document.querySelectorAll('.chassis-card').forEach((card, i) => {
    card.classList.toggle('selected', CHASSIS[i].key === char.chassis);
  });
  const refresh = (sel, list, field) => {
    document.querySelectorAll(sel).forEach((sw, i) => {
      sw.classList.toggle('selected', list[i] === char[field]);
    });
  };
  refresh('#body-colors .color-swatch',   BODY_COLORS,   'bodyColor');
  refresh('#turret-colors .color-swatch', TURRET_COLORS, 'turretColor');
  refresh('#track-colors .color-swatch',  TRACK_COLORS,  'trackColor');
  refresh('#accent-colors .color-swatch', ACCENT_COLORS, 'accentColor');
  document.querySelectorAll('#weapon-list .weapon-card').forEach((card, i) => {
    card.classList.toggle('selected', Object.keys(WEAPONS)[i] === char.weapon);
  });
}

/* ─── Next button ─── */
document.getElementById('next-btn').addEventListener('click', () => {
  if (!char.name.trim()) { toast('탱크 이름을 입력해주세요!'); return; }
  syncLegacy();
  sessionStorage.setItem('char', JSON.stringify(char));
  // Clear stale room session so a fresh lobby flow starts
  sessionStorage.removeItem('roomCode');
  sessionStorage.removeItem('myId');
  location.href = 'lobby.html';
});
