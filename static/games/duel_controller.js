/**
 * 1vs1 Duel Controller
 * WebSockets, real-time matchmaking, PiP canvas rendering, attacks, disconnect handling
 */

let _duelWs = null;
let _currentRoom = null;
let _myTelegramId = null;
let _isReady = false;
let _activeDuelGame = null;
let _stateBroadcastInterval = null;
let _selectedCreateGame = 'tetris';
let _disconnectInterval = null;
let _disconnectSecondsLeft = 15;

const DUEL_GAME_NAMES = {
  'tetris': 'Тетрис',
  '2048': '2048',
  'snake': 'Змейка'
};

function getDuelAuthHeaders() {
  const headers = typeof getAuthHeaders === 'function' ? getAuthHeaders() : {};
  if (!headers['X-Telegram-Init-Data'] && !headers['X-Telegram-Auth-Token']) {
    let guestId = localStorage.getItem('duel_guest_id');
    if (!guestId) {
      guestId = String(Math.floor(10000000 + Math.random() * 90000000));
      localStorage.setItem('duel_guest_id', guestId);
    }
    let guestName = localStorage.getItem('duel_guest_name') || `Игрок #${parseInt(guestId, 10) % 1000}`;
    headers['X-Guest-ID'] = guestId;
    headers['X-Guest-Name'] = encodeURIComponent(guestName);
  }

  return headers;
}


// ── LOBBY & NAVIGATION ─────────────────────────────────────

window.switchGamesMode = function(mode) {
  const soloBtn = document.getElementById('gamesModeBtnSolo');
  const duelBtn = document.getElementById('gamesModeBtnDuel');
  const catalogView = document.getElementById('gamesCatalogView');
  const duelView = document.getElementById('gamesDuelView');
  const roomView = document.getElementById('gamesDuelRoomView');
  const playView = document.getElementById('gamesPlayView');
  const backBtn = document.getElementById('gamesBackBtn');

  if (mode === 'duel') {
    if (soloBtn) soloBtn.classList.remove('active');
    if (duelBtn) duelBtn.classList.add('active');
    if (catalogView) catalogView.style.display = 'none';
    if (playView) playView.style.display = 'none';
    if (_currentRoom) {
      if (roomView) roomView.style.display = 'block';
      if (duelView) duelView.style.display = 'none';
      if (backBtn) backBtn.style.display = 'inline-flex';
    } else {
      if (roomView) roomView.style.display = 'none';
      if (duelView) duelView.style.display = 'block';
      if (backBtn) backBtn.style.display = 'none';
      loadDuelLobbyData();
    }
  } else {
    if (soloBtn) soloBtn.classList.add('active');
    if (duelBtn) duelBtn.classList.remove('active');
    if (duelView) duelView.style.display = 'none';
    if (roomView) roomView.style.display = 'none';
    if (playView && _activeGameId) {
      playView.style.display = 'block';
      if (backBtn) backBtn.style.display = 'inline-flex';
    } else {
      if (catalogView) catalogView.style.display = 'block';
      if (backBtn) backBtn.style.display = 'none';
    }
  }
};

window.loadDuelLobbyData = async function() {
  refreshDuelRooms();
  loadDuelStats();
  loadDuelLeaderboard();
};

window.loadDuelStats = async function() {
  try {
    const res = await fetchWithTimeout(`${API}/duel/stats`, { headers: getDuelAuthHeaders() }, 4000);

    if (res.ok) {
      const data = await res.json();
      const elo = document.getElementById('duelProfileElo');
      const meta = document.getElementById('duelProfileMeta');
      const name = document.getElementById('duelProfileName');
      if (elo) elo.textContent = data.rating || 1000;
      if (meta) meta.textContent = `Матчи: ${data.total_matches || 0} • ${data.wins || 0}В / ${data.losses || 0}П • ${data.win_rate || 0}% винрейт`;
      if (name && window.Telegram?.WebApp?.initDataUnsafe?.user?.first_name) {
        name.textContent = window.Telegram.WebApp.initDataUnsafe.user.first_name;
      }
    }
  } catch (_) {}
};

window.refreshDuelRooms = async function() {
  const container = document.getElementById('duelRoomsList');
  if (!container) return;
  container.innerHTML = '<div class="admin-empty-state">Поиск открытых лобби...</div>';

  try {
    const res = await fetchWithTimeout(`${API}/duel/rooms`, {}, 4000);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const rooms = data.rooms || [];

    if (rooms.length === 0) {
      container.innerHTML = `
        <div class="admin-empty-state" style="padding:16px 8px;">
          Нет открытых комнат.<br/>Создайте свою и позовите друга!
        </div>
      `;
      return;
    }

    let html = '';
    for (const r of rooms) {
      const gName = DUEL_GAME_NAMES[r.game_id] || r.game_id;
      const gIcon = r.game_id === 'tetris' ? '🧱' : (r.game_id === '2048' ? '2048' : '🐍');
      const hName = esc(r.host.name || 'Хост');
      const hRating = r.host.rating || 1000;
      html += `
        <div class="duel-room-card">
          <div class="duel-room-card-main">
            <div class="duel-room-card-icon">${gIcon}</div>
            <div class="duel-room-card-text">
              <div class="duel-room-card-title">${gName} • ${r.room_id}</div>
              <div class="duel-room-card-sub">${hName} (${hRating} ELO)</div>
            </div>
          </div>
          <button class="duel-room-join-btn" onclick="joinDuelRoom('${r.room_id}')" type="button">В бой ⚔️</button>
        </div>
      `;
    }
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="admin-empty-state" style="color:#ef4444;">Ошибка загрузки комнат</div>';
  }
};

window.loadDuelLeaderboard = async function() {
  const container = document.getElementById('duelLeaderboardList');
  if (!container) return;
  try {
    const res = await fetchWithTimeout(`${API}/duel/leaderboard`, {}, 4000);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const leaders = data.leaderboard || [];

    if (leaders.length === 0) {
      container.innerHTML = '<div class="admin-empty-state">Сыграйте первую дуэль, чтобы попасть в топ!</div>';
      return;
    }

    let html = '';
    leaders.forEach((u, i) => {
      const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : `${i + 1}.`));
      html += `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-bottom:1px solid rgba(255,255,255,0.05); font-size:12px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-weight:700; width:22px;">${medal}</span>
            <span style="font-weight:600; color:#f1f5f9;">${esc(u.display_name)}</span>
          </div>
          <div style="font-family:monospace; font-weight:800; color:#facc15;">
            ${u.rating} ELO <span style="font-weight:400; font-size:11px; color:#94a3b8;">(${u.wins}В/${u.losses}П)</span>
          </div>
        </div>
      `;
    });
    container.innerHTML = html;
  } catch (_) {
    container.innerHTML = '<div class="admin-empty-state">Рейтинг пока формируется</div>';
  }
};

// ── CREATE / JOIN ROOM ─────────────────────────────────────

window.openCreateDuelModal = function() {
  const modal = document.getElementById('createDuelModal');
  if (modal) {
    modal.style.display = 'flex';
    modal.offsetHeight;
    modal.classList.add('open');
  }
};

window.closeCreateDuelModal = function() {
  const modal = document.getElementById('createDuelModal');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(() => { modal.style.display = 'none'; }, 200);
  }
};


window.selectCreateDuelGame = function(gameId, el) {
  _selectedCreateGame = gameId;
  document.querySelectorAll('.create-duel-game-opt').forEach(opt => opt.classList.remove('selected'));
  if (el) el.classList.add('selected');
};

window.submitCreateDuel = async function() {
  const submitBtn = document.getElementById('createDuelSubmitBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Создание комнаты...';
  }

  try {
    const res = await fetchWithTimeout(`${API}/duel/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getDuelAuthHeaders() },
      body: JSON.stringify({ game_id: _selectedCreateGame })
    }, 5000);

    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.detail || 'Не удалось создать комнату');
    }

    closeCreateDuelModal();
    enterDuelRoom(data.room);
  } catch (err) {
    alert(err.message || 'Ошибка создания дуэли');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Создать комнату ⚔️';
    }
  }
};

window.joinDuelByInputCode = function() {
  const input = document.getElementById('duelCodeInput');
  const code = (input ? input.value : '').trim().toUpperCase();
  if (!code || code.length < 4) {
    alert('Введите корректный код комнаты');
    return;
  }
  joinDuelRoom(code);
};

window.joinDuelRoom = async function(roomId) {
  try {
    const res = await fetchWithTimeout(`${API}/duel/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getDuelAuthHeaders() },
      body: JSON.stringify({ room_id: roomId })
    }, 5000);


    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.detail || 'Не удалось войти в комнату');
    }

    enterDuelRoom(data.room);
  } catch (err) {
    alert(err.message || 'Комната недоступна или заполнена');
  }
};

// ── ROOM VIEW & WEBSOCKET ──────────────────────────────────

function enterDuelRoom(room) {
  _currentRoom = room;
  _isReady = false;

  const duelView = document.getElementById('gamesDuelView');
  const roomView = document.getElementById('gamesDuelRoomView');
  const catalogView = document.getElementById('gamesCatalogView');
  const backBtn = document.getElementById('gamesBackBtn');
  const title = document.getElementById('gamesModalTitle');

  if (catalogView) catalogView.style.display = 'none';
  if (duelView) duelView.style.display = 'none';
  if (roomView) roomView.style.display = 'block';
  if (backBtn) backBtn.style.display = 'inline-flex';
  if (title) title.textContent = `Дуэль: ${DUEL_GAME_NAMES[room.game_id] || room.game_id}`;

  renderRoomLobby(room);
  connectDuelWebSocket(room.room_id);
}

function renderRoomLobby(room) {
  const codeDisplay = document.getElementById('duelRoomCodeDisplay');
  if (codeDisplay) codeDisplay.textContent = room.room_id;

  const hostName = document.getElementById('duelHostName');
  const hostElo = document.getElementById('duelHostElo');
  const hostStatus = document.getElementById('duelHostStatus');

  if (hostName) hostName.textContent = room.host.name;
  if (hostElo) hostElo.textContent = `${room.host.rating} ELO`;
  if (hostStatus) {
    const isReady = room.ready && room.ready[String(room.host.telegram_id)];
    hostStatus.textContent = isReady ? 'ГОТОВ ✅' : 'Ожидание...';
    hostStatus.className = `duel-player-status ${isReady ? 'ready' : 'waiting'}`;
  }

  const guestName = document.getElementById('duelGuestName');
  const guestElo = document.getElementById('duelGuestElo');
  const guestStatus = document.getElementById('duelGuestStatus');
  const guestAvatar = document.getElementById('duelGuestAvatar');
  const readyBtn = document.getElementById('duelReadyBtn');

  if (room.guest) {
    if (guestName) guestName.textContent = room.guest.name;
    if (guestElo) guestElo.textContent = `${room.guest.rating} ELO`;
    if (guestAvatar) guestAvatar.textContent = '👤';
    if (guestStatus) {
      const isReady = room.ready && room.ready[String(room.guest.telegram_id)];
      guestStatus.textContent = isReady ? 'ГОТОВ ✅' : 'Ожидание...';
      guestStatus.className = `duel-player-status ${isReady ? 'ready' : 'waiting'}`;
    }
    if (readyBtn) readyBtn.style.display = 'inline-flex';
  } else {
    if (guestName) guestName.textContent = 'Ожидание игрока...';
    if (guestElo) guestElo.textContent = '—';
    if (guestAvatar) guestAvatar.textContent = '⏳';
    if (guestStatus) {
      guestStatus.textContent = 'Не в сети';
      guestStatus.className = 'duel-player-status waiting';
    }
    if (readyBtn) readyBtn.style.display = 'none';
  }
}

function connectDuelWebSocket(roomId) {
  if (_duelWs) {
    try { _duelWs.close(); } catch (_) {}
    _duelWs = null;
  }

  const loc = window.location;
  const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  let authQuery = '';

  const initData = window.Telegram?.WebApp?.initData;
  const authToken = localStorage.getItem('college_tg_auth_token');

  if (initData) {
    authQuery = `&init_data=${encodeURIComponent(initData)}`;
  } else if (authToken) {
    authQuery = `&auth_token=${encodeURIComponent(authToken)}`;
  } else {
    const adminKey = localStorage.getItem('college_admin_key') || 'dadrik_admin_2026';
    authQuery = `&admin_key=${encodeURIComponent(adminKey)}&dev=1`;
  }

  const headers = getDuelAuthHeaders();
  if (headers['X-Guest-ID']) {
    authQuery += `&guest_id=${encodeURIComponent(headers['X-Guest-ID'])}&guest_name=${encodeURIComponent(headers['X-Guest-Name'] || '')}`;
  }

  const wsUrl = `${wsProto}//${loc.host}/ws/duel/${roomId}?v=1${authQuery}`;


  _duelWs = new WebSocket(wsUrl);

  _duelWs.onopen = () => {
    console.log(`[DuelWS] Connected to room ${roomId}`);
    // Start ping heartbeat
    _duelWs._pingTimer = setInterval(() => {
      if (_duelWs && _duelWs.readyState === WebSocket.OPEN) {
        _duelWs.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000);
  };

  _duelWs.onmessage = (event) => {
    try {
      const data = jsonParse(event.data);
      if (!data) return;
      handleDuelWsMessage(data);
    } catch (e) {
      console.error('[DuelWS] Parse error:', e);
    }
  };

  _duelWs.onclose = () => {
    console.log('[DuelWS] Closed');
    if (_duelWs?._pingTimer) clearInterval(_duelWs._pingTimer);
  };

  _duelWs.onerror = (e) => {
    console.error('[DuelWS] Error:', e);
  };
}

function handleDuelWsMessage(data) {
  switch (data.type) {
    case 'room_state':
    case 'player_connected':
      _currentRoom = data.room;
      renderRoomLobby(data.room);
      break;

    case 'ready_update':
      if (_currentRoom) {
        _currentRoom.ready = data.ready;
        renderRoomLobby(_currentRoom);
      }
      break;

    case 'countdown':
      showDuelCountdown(data.seconds);
      break;

    case 'round_start':
      startDuelRound(data);
      break;

    case 'opponent_state':
      renderOpponentPiP(data.grid, data.score);
      break;

    case 'incoming_attack':
      triggerIncomingAttack(data.lines);
      break;

    case 'round_end':
      handleDuelRoundEnd(data);
      break;

    case 'match_over':
      handleDuelMatchOver(data);
      break;

    case 'opponent_disconnected':
      showDuelDisconnectWarning(data.grace_seconds || 15);
      break;

    case 'opponent_reconnected':
      hideDuelDisconnectWarning();
      break;
  }
}

window.toggleDuelReady = function() {
  _isReady = !_isReady;
  const btn = document.getElementById('duelReadyBtn');
  if (btn) {
    btn.textContent = _isReady ? 'Готов! Отменить ✕' : 'Я готов! ⚔️';
    btn.style.background = _isReady ? '#64748b' : 'linear-gradient(135deg, #10b981, #059669)';
  }
  if (_duelWs && _duelWs.readyState === WebSocket.OPEN) {
    _duelWs.send(JSON.stringify({ type: 'ready', ready: _isReady }));
  }
};

window.copyDuelRoomCode = function() {
  if (!_currentRoom) return;
  navigator.clipboard.writeText(_currentRoom.room_id).then(() => {
    const btn = document.getElementById('duelCopyCodeBtn');
    if (btn) btn.innerHTML = '✓';
    setTimeout(() => {
      if (btn) btn.innerHTML = '<svg class="lucide-icon" viewBox="0 0 24 24" width="16" height="16"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
    }, 2000);
  });
};

window.shareDuelInvite = function() {
  if (!_currentRoom) return;
  const code = _currentRoom.room_id;
  const gameName = DUEL_GAME_NAMES[_currentRoom.game_id] || 'игру';
  const url = `https://schedule.dadrik.ru/?duel=${code}`;
  const text = `Сыграем в ${gameName} 1 на 1? Подключайся к комнате: ${code}!`;

  if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
  } else {
    navigator.clipboard.writeText(`${text}\n${url}`).then(() => {
      alert('Ссылка и код скопированы! Отправьте их другу.');
    });
  }
};

// ── ROUND EXECUTION & GAME INTEGRATION ──────────────────────

function showDuelCountdown(seconds) {
  const overlay = document.getElementById('duelCountdownOverlay');
  const num = document.getElementById('duelCountdownNumber');
  if (overlay) overlay.style.display = 'flex';
  if (num) num.textContent = seconds;
}

async function startDuelRound(data) {
  const overlay = document.getElementById('duelCountdownOverlay');
  if (overlay) overlay.style.display = 'none';

  const lobbyCard = document.getElementById('duelLobbyCard');
  const matchHud = document.getElementById('duelMatchHud');
  const playArea = document.getElementById('duelPlayArea');
  const resultOverlay = document.getElementById('duelResultOverlay');

  if (lobbyCard) lobbyCard.style.display = 'none';
  if (resultOverlay) resultOverlay.style.display = 'none';
  if (matchHud) matchHud.style.display = 'flex';
  if (playArea) playArea.style.display = 'flex';

  updateDuelHud(data.round, data.round_wins);

  const mainField = document.getElementById('duelMainField');
  if (mainField) mainField.innerHTML = '';

  const gameId = _currentRoom.game_id;
  try {
    let module;
    try {
      module = await import(`/static/games/${gameId}.js?v=20260924_v9`);
    } catch (_) {
      module = await import(`/static/games/${gameId}.js`);
    }

    _activeDuelGame = module.mount(mainField, {
      isDuel: true,
      roundSeed: data.seed,
      onScoreUpdate: (score, best, gridSnapshot) => {
        sendDuelState(score, gridSnapshot);
        const myScoreEl = document.getElementById('duelHudMyScore');
        if (myScoreEl) myScoreEl.textContent = score;
      },
      onAttack: (lines) => {
        // Тетрис атака
        sendDuelAttack(lines);
      },
      onGameOver: (score) => {
        // Поражение в раунде
        sendDuelRoundLost();
      }
    });

    // Периодическая трансляция состояния поля для PiP (5 раз в сек)
    startDuelStateStream();
  } catch (err) {
    console.error(`Failed to mount duel game ${gameId}:`, err);
  }
}

function updateDuelHud(roundNum, roundWins) {
  const roundTitle = document.getElementById('duelHudRoundTitle');
  if (roundTitle) roundTitle.textContent = `Раунд ${roundNum} (до 2 побед)`;

  const myRoundsEl = document.getElementById('duelHudMyRounds');
  const oppRoundsEl = document.getElementById('duelHudOppRounds');
  const myNameEl = document.getElementById('duelHudMyName');
  const oppNameEl = document.getElementById('duelHudOppName');

  const myId = String(_currentRoom.host.telegram_id);
  const oppId = _currentRoom.guest ? String(_currentRoom.guest.telegram_id) : '';

  const myWins = roundWins ? (roundWins[myId] || 0) : 0;
  const oppWins = roundWins ? (roundWins[oppId] || 0) : 0;

  if (myRoundsEl) myRoundsEl.textContent = `${myWins >= 1 ? '🟢' : '⚪'} ${myWins >= 2 ? '🟢' : '⚪'}`;
  if (oppRoundsEl) oppRoundsEl.textContent = `${oppWins >= 1 ? '🟢' : '⚪'} ${oppWins >= 2 ? '🟢' : '⚪'}`;

  if (myNameEl) myNameEl.textContent = _currentRoom.host.name;
  if (oppNameEl && _currentRoom.guest) oppNameEl.textContent = _currentRoom.guest.name;
}

function sendDuelState(score, grid) {
  if (_duelWs && _duelWs.readyState === WebSocket.OPEN) {
    _duelWs.send(JSON.stringify({
      type: 'state_update',
      score: score || 0,
      grid: grid || null
    }));
  }
}

function sendDuelAttack(lines) {
  if (_duelWs && _duelWs.readyState === WebSocket.OPEN) {
    _duelWs.send(JSON.stringify({
      type: 'attack',
      lines: lines || 1
    }));
  }
}

function sendDuelRoundLost() {
  if (_duelWs && _duelWs.readyState === WebSocket.OPEN) {
    _duelWs.send(JSON.stringify({
      type: 'round_lost'
    }));
  }
}

function startDuelStateStream() {
  stopDuelStateStream();
  _stateBroadcastInterval = setInterval(() => {
    if (_activeDuelGame && typeof _activeDuelGame.getSnapshot === 'function') {
      const snap = _activeDuelGame.getSnapshot();
      if (snap) sendDuelState(snap.score, snap.grid);
    }
  }, 200);
}

function stopDuelStateStream() {
  if (_stateBroadcastInterval) {
    clearInterval(_stateBroadcastInterval);
    _stateBroadcastInterval = null;
  }
}

// ── ATTACK BANNER & INCOMING ATTACKS ───────────────────────

function triggerIncomingAttack(lines) {
  const banner = document.getElementById('duelAttackBanner');
  const count = document.getElementById('duelAttackLinesCount');
  if (banner && count) {
    count.textContent = lines;
    banner.style.display = 'block';
    setTimeout(() => { banner.style.display = 'none'; }, 2200);
  }

  // Передаем штрафные линии в активный тетрис
  if (_activeDuelGame && typeof _activeDuelGame.receiveGarbageLines === 'function') {
    _activeDuelGame.receiveGarbageLines(lines);
  }
}

// ── PICTURE-IN-PICTURE (PIP) RENDERING ─────────────────────

function renderOpponentPiP(grid, score) {
  const oppScoreEl = document.getElementById('duelHudOppScore');
  if (oppScoreEl && score !== undefined) oppScoreEl.textContent = score;

  const canvas = document.getElementById('duelPipCanvas');
  if (!canvas || !grid) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  // Очистка
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);

  // Отрисовка сетки Тетриса (10x20)
  if (Array.isArray(grid) && grid.length === 20) {
    const rows = 20;
    const cols = 10;
    const cellW = w / cols;
    const cellH = h / rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = grid[r][c];
        if (val) {
          ctx.fillStyle = val === 8 ? '#64748b' : '#38bdf8';
          ctx.fillRect(c * cellW + 0.5, r * cellH + 0.5, cellW - 1, cellH - 1);
        }
      }
    }
  } else if (Array.isArray(grid) && grid.length === 4) {
    // 2048 мини-сетка (4x4)
    const cellW = w / 4;
    const cellH = h / 4;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const val = grid[r][c];
        if (val) {
          ctx.fillStyle = val >= 128 ? '#eab308' : '#6366f1';
          ctx.fillRect(c * cellW + 1, r * cellH + 1, cellW - 2, cellH - 2);
        }
      }
    }
  } else if (Array.isArray(grid) && grid.length === 20 && Array.isArray(grid[0]) && grid[0].length === 20) {
    // Змейка мини-сетка (20x20)
    const cellW = w / 20;
    const cellH = h / 20;
    for (let r = 0; r < 20; r++) {
      for (let c = 0; c < 20; c++) {
        const val = grid[r][c];
        if (val === 1) { // змейка
          ctx.fillStyle = '#10b981';
          ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
        } else if (val === 2) { // яблоко
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
        }
      }
    }
  }
}

// ── ROUND / MATCH OVER ─────────────────────────────────────

function handleDuelRoundEnd(data) {
  stopDuelStateStream();
  if (_activeDuelGame && typeof _activeDuelGame.unmount === 'function') {
    _activeDuelGame.unmount();
    _activeDuelGame = null;
  }

  const isMe = String(data.winner_id) === String(_currentRoom.host.telegram_id);
  const overlay = document.getElementById('duelResultOverlay');
  const title = document.getElementById('duelResultTitle');
  const icon = document.getElementById('duelResultIcon');
  const score = document.getElementById('duelResultScore');
  const elo = document.getElementById('duelResultElo');

  if (overlay) overlay.style.display = 'flex';
  if (icon) icon.textContent = isMe ? '🔥' : '💥';
  if (title) title.textContent = isMe ? 'Раунд выигран!' : 'Раунд проигран!';
  if (elo) elo.textContent = `Счёт по раундам: ${data.round_wins[String(_currentRoom.host.telegram_id)] || 0} — ${data.round_wins[_currentRoom.guest ? String(_currentRoom.guest.telegram_id) : ''] || 0}`;
  if (score) score.textContent = 'Следующий раунд начнется через несколько секунд...';

  // Прячем кнопки в оверлее между раундами
  const actions = document.querySelector('.duel-result-actions');
  if (actions) actions.style.display = 'none';

  updateDuelHud(data.round + 1, data.round_wins);
}

function handleDuelMatchOver(data) {
  stopDuelStateStream();
  if (_activeDuelGame && typeof _activeDuelGame.unmount === 'function') {
    _activeDuelGame.unmount();
    _activeDuelGame = null;
  }

  const isMe = String(data.winner_id) === String(_currentRoom.host.telegram_id);
  const overlay = document.getElementById('duelResultOverlay');
  const title = document.getElementById('duelResultTitle');
  const icon = document.getElementById('duelResultIcon');
  const score = document.getElementById('duelResultScore');
  const elo = document.getElementById('duelResultElo');

  if (overlay) overlay.style.display = 'flex';
  if (icon) icon.textContent = isMe ? '🏆' : '💀';
  if (title) title.textContent = isMe ? 'ПОБЕДА В МАТЧЕ!' : 'ПОРАЖЕНИЕ В МАТЧЕ';

  const myDelta = isMe ? (data.elo?.p1_delta || 20) : -(data.elo?.p1_delta || 20);
  if (elo) {
    elo.textContent = myDelta >= 0 ? `+${myDelta} ELO (Рейтинг повышен!)` : `${myDelta} ELO`;
    elo.style.color = myDelta >= 0 ? '#facc15' : '#f87171';
  }

  const myId = String(_currentRoom.host.telegram_id);
  const oppId = _currentRoom.guest ? String(_currentRoom.guest.telegram_id) : '';
  if (score) {
    score.textContent = `Итоговый счёт: ${data.round_wins[myId] || 0} — ${data.round_wins[oppId] || 0}`;
  }

  // Показываем кнопки
  const actions = document.querySelector('.duel-result-actions');
  if (actions) actions.style.display = 'flex';

  // Haptic feedback
  if (window.Telegram?.WebApp?.HapticFeedback) {
    window.Telegram.WebApp.HapticFeedback.notificationOccurred(isMe ? 'success' : 'error');
  }
}

window.requestDuelRematch = function() {
  const overlay = document.getElementById('duelResultOverlay');
  if (overlay) overlay.style.display = 'none';
  const lobbyCard = document.getElementById('duelLobbyCard');
  const matchHud = document.getElementById('duelMatchHud');
  const playArea = document.getElementById('duelPlayArea');

  if (matchHud) matchHud.style.display = 'none';
  if (playArea) playArea.style.display = 'none';
  if (lobbyCard) lobbyCard.style.display = 'block';

  toggleDuelReady();
};

window.exitDuelRoom = function() {
  if (_duelWs) {
    try { _duelWs.close(); } catch (_) {}
    _duelWs = null;
  }
  _currentRoom = null;
  _isReady = false;

  const roomView = document.getElementById('gamesDuelRoomView');
  const overlay = document.getElementById('duelResultOverlay');
  const matchHud = document.getElementById('duelMatchHud');
  const playArea = document.getElementById('duelPlayArea');

  if (roomView) roomView.style.display = 'none';
  if (overlay) overlay.style.display = 'none';
  if (matchHud) matchHud.style.display = 'none';
  if (playArea) playArea.style.display = 'none';

  switchGamesMode('duel');
};

// ── DISCONNECT HANDLING ────────────────────────────────────

function showDuelDisconnectWarning(seconds) {
  _disconnectSecondsLeft = seconds;
  const banner = document.getElementById('duelDisconnectBanner');
  const timer = document.getElementById('duelDisconnectTimer');
  if (banner) banner.style.display = 'block';
  if (timer) timer.textContent = _disconnectSecondsLeft;

  if (_disconnectInterval) clearInterval(_disconnectInterval);
  _disconnectInterval = setInterval(() => {
    _disconnectSecondsLeft--;
    if (timer) timer.textContent = Math.max(0, _disconnectSecondsLeft);
    if (_disconnectSecondsLeft <= 0) {
      clearInterval(_disconnectInterval);
      _disconnectInterval = null;
    }
  }, 1000);
}

function hideDuelDisconnectWarning() {
  if (_disconnectInterval) {
    clearInterval(_disconnectInterval);
    _disconnectInterval = null;
  }
  const banner = document.getElementById('duelDisconnectBanner');
  if (banner) banner.style.display = 'none';
}

function jsonParse(str) {
  try { return JSON.parse(str); } catch (_) { return null; }
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Проверка прямого перехода по ссылке ?duel=ROOMID
document.addEventListener('DOMContentLoaded', () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const duelCode = params.get('duel') || (window.Telegram?.WebApp?.initDataUnsafe?.start_param?.startsWith('duel_') ? window.Telegram.WebApp.initDataUnsafe.start_param.replace('duel_', '') : null);
    if (duelCode) {
      setTimeout(() => {
        if (typeof openGamesModal === 'function') openGamesModal();
        switchGamesMode('duel');
        joinDuelRoom(duelCode);
      }, 500);
    }
  } catch (_) {}
});
