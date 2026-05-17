'use strict';

const SKIN_COLORS  = ['#FDBCB4','#F1A283','#C77A52','#8D5524','#4B2E12'];
const HAIR_COLORS  = ['#F2EBE0','#F4D03F','#A0522D','#3D2B1F','#1C1C1C','#E74C3C','#3498DB','#8E44AD'];
const SHIRT_COLORS = ['#EF4444','#F97316','#EAB308','#22C55E','#3B82F6','#8B5CF6','#EC4899','#FFFFFF','#374151'];
const PANTS_COLORS = ['#1E3A5F','#374151','#1C1C1C','#7C3AED','#065F46','#92400E','#FFFFFF','#4B5563'];
const ACC_COLORS   = ['#FFD700','#FF6B6B','#4ECDC4','#95E1D3','#FF8B94','#A8E6CF','#FFFFFF','#3D5A80'];
const HAIR_STYLES  = ['짧은머리','긴머리','곱슬머리','포니테일','모히칸','대머리'];
const ACCESSORIES  = ['없음','모자','안경','왕관','후광','마스크'];
const WEAPON_DATA  = {
  pistol:  { name:'권총',  icon:'🔫', desc:'균형잡힌 기본 무기', dmg:25, rate:3, range:3, ammo:12 },
  shotgun: { name:'샷건',  icon:'💥', desc:'근거리 일격필살',    dmg:65, rate:1, range:1, ammo:6  },
  rifle:   { name:'돌격소총', icon:'🎯', desc:'높은 연사력과 정확도', dmg:30, rate:5, range:4, ammo:30 },
  sniper:  { name:'저격총', icon:'🏹', desc:'원거리 치명타',      dmg:95, rate:1, range:5, ammo:5  },
  smg:     { name:'기관단총', icon:'⚡', desc:'최고속 연사력',     dmg:18, rate:5, range:2, ammo:25 },
};

const char = {
  name: '', skinColor: SKIN_COLORS[0], hairColor: HAIR_COLORS[3],
  hairStyle: '짧은머리', shirtColor: SHIRT_COLORS[0], pantsColor: PANTS_COLORS[0],
  accessory: '없음', accColor: ACC_COLORS[0], weapon: 'pistol',
};

/* ── DOM helpers ── */
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function makeSwatches(containerId, colors, key) {
  const wrap = document.getElementById(containerId);
  colors.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (char[key] === c ? ' selected' : '');
    sw.style.background = c;
    if (c === '#FFFFFF') sw.style.border = '3px solid rgba(255,255,255,0.3)';
    sw.addEventListener('click', () => {
      wrap.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      char[key] = c;
      drawCharacter();
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
      drawCharacter();
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
          ${bar('데미지', w.dmg / 20)}
          ${bar('연사', w.rate / 5)}
          ${bar('사거리', w.range / 5)}
          ${bar('장탄', Math.min(w.ammo / 30, 1))}
        </div>
      </div>
      <div style="font-size:11px;color:rgba(255,255,255,0.5)">장탄수<br><b style="font-size:18px;color:#fff">${w.ammo}</b></div>
    `;
    card.addEventListener('click', () => {
      list.querySelectorAll('.weapon-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      char.weapon = key;
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

/* ── Canvas character drawing ── */
function drawCharacter() {
  const canvas = document.getElementById('char-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2;

  // Pants / legs
  ctx.fillStyle = char.pantsColor;
  ctx.beginPath(); ctx.roundRect(cx - 22, 135, 19, 55, 4); ctx.fill();
  ctx.beginPath(); ctx.roundRect(cx + 3,  135, 19, 55, 4); ctx.fill();

  // Shoes
  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath(); ctx.ellipse(cx - 12, 191, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 12, 191, 14, 6, 0, 0, Math.PI * 2); ctx.fill();

  // Body
  ctx.fillStyle = char.shirtColor;
  ctx.beginPath(); ctx.roundRect(cx - 28, 82, 56, 60, 6); ctx.fill();

  // Arms
  ctx.fillStyle = char.skinColor;
  ctx.beginPath(); ctx.roundRect(cx - 44, 84, 17, 48, 5); ctx.fill();
  ctx.beginPath(); ctx.roundRect(cx + 27, 84, 17, 48, 5); ctx.fill();

  // Neck
  ctx.fillStyle = char.skinColor;
  ctx.beginPath(); ctx.roundRect(cx - 9, 70, 18, 18, 4); ctx.fill();

  // Head
  ctx.fillStyle = char.skinColor;
  ctx.beginPath(); ctx.ellipse(cx, 50, 34, 36, 0, 0, Math.PI * 2); ctx.fill();

  // Eyes
  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath(); ctx.ellipse(cx - 12, 46, 5, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 12, 46, 5, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(cx - 10, 44, 2, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 14, 44, 2, 2, 0, 0, Math.PI * 2); ctx.fill();

  // Smile
  ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, 57, 10, 0.1, Math.PI - 0.1); ctx.stroke();

  // Hair
  drawHair(ctx, cx, char.hairStyle, char.hairColor);

  // Accessory
  drawAccessory(ctx, cx, char.accessory, char.accColor);

  // Weapon icon on arm
  const w = WEAPON_DATA[char.weapon];
  ctx.font = '18px serif';
  ctx.fillText(w.icon, cx + 27, 120);

  // Name tag
  if (char.name) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    const tw = ctx.measureText(char.name).width + 12;
    ctx.beginPath(); ctx.roundRect(cx - tw/2, 198, tw, 20, 4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center'; ctx.fillText(char.name, cx, 212); ctx.textAlign = 'left';
  }
}

function drawHair(ctx, cx, style, color) {
  ctx.fillStyle = color;
  if (style === '대머리') {
    ctx.globalAlpha = 0.15;
    ctx.beginPath(); ctx.ellipse(cx, 32, 34, 20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; return;
  }
  if (style === '짧은머리') {
    ctx.beginPath(); ctx.ellipse(cx, 20, 34, 20, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(cx - 34, 14, 10, 24, 3); ctx.fill();
    ctx.beginPath(); ctx.roundRect(cx + 24, 14, 10, 24, 3); ctx.fill();
  } else if (style === '긴머리') {
    ctx.beginPath(); ctx.ellipse(cx, 20, 34, 20, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(cx - 40, 14, 12, 80, 5); ctx.fill();
    ctx.beginPath(); ctx.roundRect(cx + 28, 14, 12, 80, 5); ctx.fill();
  } else if (style === '곱슬머리') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - 0.5;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a)*20, 26 + Math.sin(a)*14, 14, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx, 20, 14, 0, Math.PI * 2); ctx.fill();
  } else if (style === '포니테일') {
    ctx.beginPath(); ctx.ellipse(cx, 20, 34, 20, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(cx - 34, 14, 10, 20, 3); ctx.fill();
    ctx.beginPath(); ctx.roundRect(cx + 24, 14, 10, 20, 3); ctx.fill();
    ctx.beginPath(); ctx.roundRect(cx + 28, 36, 10, 50, 5); ctx.fill();
  } else if (style === '모히칸') {
    ctx.beginPath(); ctx.roundRect(cx - 34, 14, 10, 20, 3); ctx.fill();
    ctx.beginPath(); ctx.roundRect(cx + 24, 14, 10, 20, 3); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 10, 14); ctx.lineTo(cx, -12); ctx.lineTo(cx + 10, 14);
    ctx.fill();
  }
}

function drawAccessory(ctx, cx, acc, color) {
  ctx.fillStyle = color;
  if (acc === '모자') {
    ctx.beginPath(); ctx.ellipse(cx, 14, 38, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(cx - 24, -18, 48, 34, 4); ctx.fill();
  } else if (acc === '안경') {
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(cx - 14, 46, 8, 7, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx + 14, 46, 8, 7, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 6, 46); ctx.lineTo(cx + 6, 46); ctx.stroke();
  } else if (acc === '왕관') {
    ctx.beginPath();
    ctx.moveTo(cx - 28, 12); ctx.lineTo(cx - 28, -4); ctx.lineTo(cx - 14, 4);
    ctx.lineTo(cx, -10); ctx.lineTo(cx + 14, 4); ctx.lineTo(cx + 28, -4);
    ctx.lineTo(cx + 28, 12); ctx.closePath(); ctx.fill();
  } else if (acc === '후광') {
    ctx.strokeStyle = color; ctx.lineWidth = 5;
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.ellipse(cx, -8, 30, 8, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (acc === '마스크') {
    ctx.beginPath(); ctx.roundRect(cx - 20, 55, 40, 22, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(cx - 14, 62 + i * 5); ctx.lineTo(cx + 14, 62 + i * 5); ctx.stroke();
    }
  }
}

/* ── Init ── */
function init() {
  makeSwatches('skin-colors',  SKIN_COLORS,  'skinColor');
  makeSwatches('hair-colors',  HAIR_COLORS,  'hairColor');
  makeSwatches('shirt-colors', SHIRT_COLORS, 'shirtColor');
  makeSwatches('pants-colors', PANTS_COLORS, 'pantsColor');
  makeSwatches('acc-colors',   ACC_COLORS,   'accColor');
  makeStyleBtns('hair-styles', HAIR_STYLES,  'hairStyle');
  makeStyleBtns('accessories', ACCESSORIES,  'accessory');
  makeWeapons();
  drawCharacter();

  document.getElementById('name-input').addEventListener('input', e => {
    char.name = e.target.value;
    drawCharacter();
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
