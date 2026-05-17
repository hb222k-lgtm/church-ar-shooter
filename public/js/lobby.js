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

socket.on('gameStarted', ({ players, gameMode: mode }) => {
  sessionStorage.setItem('players', JSON.stringify(players));
  sessionStorage.setItem('myId', myId);
  sessionStorage.setItem('myTeam', myTeam || '');
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
  const s = 40 / 160;
  ctx.scale(s, s);
  // draw simplified character
  ctx.fillStyle = c.skinColor || '#FDBCB4';
  ctx.beginPath(); ctx.arc(80, 50, 34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = c.shirtColor || '#EF4444';
  ctx.beginPath(); ctx.roundRect(52, 82, 56, 60, 4); ctx.fill();
  ctx.fillStyle = c.hairColor || '#3D2B1F';
  ctx.beginPath(); ctx.ellipse(80, 20, 34, 20, 0, Math.PI, Math.PI * 2); ctx.fill();
}
