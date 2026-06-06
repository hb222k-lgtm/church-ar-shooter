'use strict';

const socket = io();
const char = JSON.parse(sessionStorage.getItem('char') || '{}');
let myId = null, isHost = false, gameMode = 'ffa', myTeam = null, roomCode = null;

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ── Difficulty selection ── */
let selectedDiff = 'easy';
['easy','normal','hard'].forEach(d => {
  document.getElementById('diff-' + d).addEventListener('click', () => {
    selectedDiff = d;
    ['easy','normal','hard'].forEach(x => document.getElementById('diff-' + x).classList.toggle('selected', x === d));
  });
});

/* ── Solo play ── */
document.getElementById('solo-btn').addEventListener('click', () => {
  if (!char.name) { location.href = 'index.html'; return; }
  sessionStorage.setItem('gameMode', 'single');
  socket.emit('startSingle', {
    playerData: { name: char.name, character: char, weapon: char.weapon },
    difficulty: selectedDiff,
  });
});

/* ── Mode selection ── */
let selectedMode = 'ffa';
document.getElementById('mode-ffa').addEventListener('click', () => selectMode('ffa'));
document.getElementById('mode-team').addEventListener('click', () => selectMode('team'));
function selectMode(m) {
  selectedMode = m;
  document.getElementById('mode-ffa').classList.toggle('selected', m === 'ffa');
  document.getElementById('mode-team').classList.toggle('selected', m === 'team');
}

/* ── Create / Join ── */
document.getElementById('create-btn').addEventListener('click', () => {
  if (!char.name) { location.href = 'index.html'; return; }
  socket.emit('createRoom', {
    playerData: { name: char.name, character: char, weapon: char.weapon },
    gameMode: selectedMode,
    maxPlayers: parseInt(document.getElementById('max-players').value) || 10,
  });
});

document.getElementById('join-btn').addEventListener('click', () => {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (code.length !== 6) { toast('방 코드 6자리를 입력하세요'); return; }
  if (!char.name) { location.href = 'index.html'; return; }
  socket.emit('joinRoom', {
    code,
    playerData: { name: char.name, character: char, weapon: char.weapon },
  });
});

document.getElementById('join-code').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase();
});

/* ── Room code copy ── */
document.getElementById('display-code').addEventListener('click', () => {
  navigator.clipboard?.writeText(roomCode).then(() => toast('코드가 복사되었습니다!'));
});

/* ── Leave / Start ── */
document.getElementById('leave-btn').addEventListener('click', () => location.href = 'index.html');
document.getElementById('start-btn').addEventListener('click', () => {
  socket.emit('startGame');
});

/* ── Socket events ── */
socket.on('roomCreated', ({ code }) => {
  roomCode = code;
});

socket.on('joinedRoom', ({ playerId, room, myTeam: team, isHost: host }) => {
  myId = playerId; isHost = host; myTeam = team; gameMode = room.gameMode;
  sessionStorage.setItem('roomCode', room.code);
  sessionStorage.setItem('gameMode', room.gameMode);

  document.getElementById('screen-home').style.display = 'none';
  document.getElementById('screen-room').style.display = 'block';
  document.getElementById('room-action').style.display = 'block';
  document.getElementById('display-code').textContent = room.code;
  document.getElementById('mode-badge').textContent = room.gameMode === 'ffa' ? '⚔️ 개인전' : '🛡️ 팀전';

  renderPlayers(room.players, room.gameMode);
  updateHostUI(host);
});

socket.on('playerJoined', ({ player }) => {
  addPlayerRow(player, gameMode);
  updateCount();
  toast(`${player.name}님이 입장했습니다!`);
});

socket.on('playerLeft', ({ playerId }) => {
  document.getElementById('pr-' + playerId)?.remove();
  updateCount();
});

socket.on('newHost', ({ hostId }) => {
  if (hostId === myId) { isHost = true; updateHostUI(true); toast('호스트가 되었습니다!'); }
});

socket.on('gameStarted', ({ players, gameMode: mode, wave, totalWaves, difficulty }) => {
  sessionStorage.setItem('players', JSON.stringify(players));
  sessionStorage.setItem('myId', myId);
  sessionStorage.setItem('myTeam', myTeam || '');
  sessionStorage.setItem('gameMode', mode);
  if (mode === 'single') {
    sessionStorage.setItem('wave', wave || 1);
    sessionStorage.setItem('totalWaves', totalWaves || 5);
    sessionStorage.setItem('difficulty', difficulty || 'normal');
  }
  window.location.href = 'game.html';
});

socket.on('roomError', msg => toast('❌ ' + msg));

/* ── Render helpers ── */
function renderPlayers(players, mode) {
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  players.forEach(p => addPlayerRow(p, mode));
  updateCount();
}

function addPlayerRow(player, mode) {
  const list = document.getElementById('player-list');
  if (document.getElementById('pr-' + player.id)) return;

  const row = document.createElement('div');
  row.className = 'player-row';
  row.id = 'pr-' + player.id;

  const miniCanvas = document.createElement('canvas');
  miniCanvas.width = 40; miniCanvas.height = 40;
  drawMini(miniCanvas, player.character);

  const nameWrap = document.createElement('div');
  nameWrap.style.flex = '1';
  nameWrap.innerHTML = `<div class="player-name">${escHtml(player.name)}</div>`;

  const right = document.createElement('div');
  right.style.display = 'flex'; right.style.gap = '6px'; right.style.alignItems = 'center';

  if (mode === 'team' && player.team) {
    const badge = document.createElement('div');
    badge.className = 'team-badge ' + player.team;
    badge.textContent = player.team === 'red' ? '🔴 레드' : '🔵 블루';
    right.appendChild(badge);
  }
  if (player.id === myId || player.name === char.name) {
    const me = document.createElement('div');
    me.className = 'host-badge'; me.textContent = '나';
    right.appendChild(me);
  }

  row.appendChild(miniCanvas);
  row.appendChild(nameWrap);
  row.appendChild(right);
  list.appendChild(row);
}

function updateCount() {
  const n = document.getElementById('player-list').children.length;
  document.getElementById('player-count').textContent = `${n}명`;
}

function updateHostUI(host) {
  document.getElementById('start-btn').style.display = host ? 'block' : 'none';
  document.getElementById('wait-msg').style.display = host ? 'none' : 'block';
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function drawMini(canvas, c) {
  if (!c) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W/2, H/2);

  const body   = c.bodyColor   || c.skinColor  || '#4B6B3A';
  const turret = c.turretColor || c.hairColor  || '#2A3F1F';
  const track  = c.trackColor  || c.pantsColor || '#1C1C1C';
  const accent = c.accentColor || c.shirtColor || '#FBBF24';

  // Scaled-down tank
  const bw = 14, bh = 18;
  // Tracks
  ctx.fillStyle = track;
  ctx.fillRect(-bw/2 - 3, -bh/2, 3, bh);
  ctx.fillRect( bw/2,     -bh/2, 3, bh);
  // Body
  ctx.fillStyle = body;
  ctx.fillRect(-bw/2, -bh/2, bw, bh);
  // Accent stripe
  ctx.fillStyle = accent;
  ctx.fillRect(-1, -bh/2 + 2, 2, bh - 4);
  // Outline
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-bw/2, -bh/2, bw, bh);
  // Turret
  ctx.fillStyle = turret;
  ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
  // Barrel
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(-1, -bh/2 - 7, 2, 8);

  ctx.restore();
}
