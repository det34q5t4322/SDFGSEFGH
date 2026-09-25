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
  'snake': 'Змейка',
  'durak': 'Дурак'
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

function getMyPlayerId() {
  if (_myTelegramId) return String(_myTelegramId);
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (tgUser && tgUser.id) {
    _myTelegramId = tgUser.id;
    return String(tgUser.id);
  }
  const guestId = localStorage.getItem('duel_guest_id');
  if (guestId) {
    _myTelegramId = parseInt(guestId, 10);
    return String(guestId);
  }
  return '';
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

const RANK_SVGS = {
  apprentice: (s = 18, sw = 2) => `<svg class="rank-svg" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/><path d="M6 10h10"/></svg>`,
  adept: (s = 18, sw = 2) => `<svg class="rank-svg" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  specialist: (s = 18, sw = 2) => `<svg class="rank-svg" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 17.5-11.5-11.5v-3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="m14.5 6.5 3.5-3.5h3v3l-3.5 3.5"/><path d="m5 14 4 4"/><path d="m7 17-3 3"/><path d="m3 19 2 2"/></svg>`,
  expert: (s = 18, sw = 2) => `<svg class="rank-svg" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/><circle cx="12" cy="12" r="3"/></svg>`,
  magister: (s = 18, sw = 2) => `<svg class="rank-svg" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 18 3 22 9 12 22 2 9"/><polyline points="11 3 8 9 12 22"/><polyline points="13 3 16 9 12 22"/><line x1="2" y1="9" x2="22" y2="9"/></svg>`,
  grandmaster: (s = 18, sw = 2) => `<svg class="rank-svg" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  archmage: (s = 18, sw = 2) => `<svg class="rank-svg" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>`,
  academician: (s = 18, sw = 2) => `<svg class="rank-svg" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>`
};

function getRankSvg(tierId, size = 18, strokeWidth = 2) {
  const fn = RANK_SVGS[tierId] || RANK_SVGS['specialist'];
  return fn(size, strokeWidth);
}

const GAME_SVGS = {
  tetris: (s = 20) => `<svg class="duel-svg-icon" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="8" x="3" y="3" rx="1.5"/><rect width="8" height="8" x="13" y="3" rx="1.5"/><rect width="8" height="8" x="8" y="13" rx="1.5"/></svg>`,
  '2048': (s = 20) => `<svg class="duel-svg-icon" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="3"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="3" x2="12" y2="21"/></svg>`,
  snake: (s = 20) => `<svg class="duel-svg-icon" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18c2-3 5-3 7 0s5 3 7 0"/><path d="M4 12c2-3 5-3 7 0s5 3 7 0"/><circle cx="18" cy="6" r="2.5"/><path d="M15.5 6H8a4 4 0 0 0-4 4"/></svg>`
};

function getGameSvg(gameId, size = 20) {
  const fn = GAME_SVGS[gameId] || GAME_SVGS['tetris'];
  return fn(size);
}

function getLeaderboardMedalSvg(pos, size = 20) {
  if (pos === 0) {
    return `<span class="duel-medal-badge gold"><svg class="duel-medal-svg gold" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg></span>`;
  } else if (pos === 1) {
    return `<span class="duel-medal-badge silver"><svg class="duel-medal-svg silver" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="#94a3b8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg></span>`;
  } else if (pos === 2) {
    return `<span class="duel-medal-badge bronze"><svg class="duel-medal-svg bronze" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="#d97706" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg></span>`;
  }
  return `<span class="duel-lb-rank-num-plain">${pos + 1}</span>`;
}

function getVictoryTrophySvg(size = 56) {
  return `<svg class="duel-result-big-svg victory" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="#facc15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.45 1-1 1H8c-.55 0-1 .45-1 1v1c0 .55.45 1 1 1h8c.55 0 1-.45 1-1v-1c0-.55-.45-1-1-1h-1c-.55 0-1-.45-1-1v-2.34"/><path d="M6 4h12a2 2 0 0 1 2 2v3a6 6 0 0 1-6 6h0a6 6 0 0 1-6-6V6a2 2 0 0 1 2-2Z"/></svg>`;
}

function getDefeatSvg(size = 56) {
  return `<svg class="duel-result-big-svg defeat" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>`;
}

function getRoundFlameSvg(size = 48) {
  return `<svg class="duel-result-round-svg win" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3.5z"/></svg>`;
}

function getRoundBrokenSvg(size = 48) {
  return `<svg class="duel-result-round-svg loss" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
}

function getAvatarSilhouetteSvg(isWaiting = false) {
  if (isWaiting) {
    return `<svg class="duel-avatar-svg waiting" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  }
  return `<svg class="duel-avatar-svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
}

function renderRoundDotsHtml(winsCount) {
  const dot1 = winsCount >= 1 ? '<span class="duel-round-pip won"></span>' : '<span class="duel-round-pip"></span>';
  const dot2 = winsCount >= 2 ? '<span class="duel-round-pip won"></span>' : '<span class="duel-round-pip"></span>';
  return `${dot1}${dot2}`;
}

function getDuelRank(rating) {
  const TIERS = [
    { id: 'apprentice', name: 'Ученик', color: '#b45309', min: 0, max: 799 },
    { id: 'adept', name: 'Адепт', color: '#94a3b8', min: 800, max: 999 },
    { id: 'specialist', name: 'Специалист', color: '#f59e0b', min: 1000, max: 1199 },
    { id: 'expert', name: 'Эксперт', color: '#10b981', min: 1200, max: 1399 },
    { id: 'magister', name: 'Магистр', color: '#818cf8', min: 1400, max: 1599 },
    { id: 'grandmaster', name: 'Гроссмейстер', color: '#38bdf8', min: 1600, max: 1799 },
    { id: 'archmage', name: 'Архимаг', color: '#c084fc', min: 1800, max: 1999 },
    { id: 'academician', name: 'Академик', color: '#f43f5e', min: 2000, max: 99999 }
  ];

  const r = Math.max(100, Math.round(rating || 1000));
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (r >= t.min) tier = t;
    else break;
  }

  const roman = ['I', 'II', 'III', 'IV', 'V'];
  let starIdx = 1;
  let progress = 0;

  if (tier.id === 'academician') {
    starIdx = Math.min(5, Math.max(1, Math.floor((r - 2000) / 100) + 1));
    progress = (starIdx === 5 && r >= 2400) ? 100 : Math.min(100, Math.max(0, (r - 2000) % 100));
  } else {
    const rangeSize = (tier.max - tier.min + 1) / 5;
    const offset = r - tier.min;
    starIdx = Math.min(5, Math.max(1, Math.floor(offset / rangeSize) + 1));
    const currStarMin = tier.min + (starIdx - 1) * rangeSize;
    progress = Math.min(100, Math.max(0, Math.round(((r - currStarMin) / rangeSize) * 100)));
  }

  const romanStr = roman[starIdx - 1];
  const fullStars = '★'.repeat(starIdx);
  const emptyStars = '☆'.repeat(5 - starIdx);
  const title = `${tier.name} ${romanStr}`;

  return {
    tierId: tier.id,
    tier_id: tier.id,
    name: tier.name,
    icon: tier.id,
    color: tier.color,
    stars: starIdx,
    starsStr: romanStr,
    stars_str: romanStr,
    rankTitle: title,
    rank_title: title,
    progress: progress,
    starsIcons: fullStars + emptyStars
  };
}
const getDotaRank = getDuelRank;

window.switchDuelSubTab = function(tabName) {
  const tabs = ['rooms', 'history', 'leaderboard'];
  tabs.forEach(t => {
    const btn = document.getElementById(`duelSubnav${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const pane = document.getElementById(t === 'rooms' ? 'duelRoomsTabPane' : (t === 'history' ? 'duelHistoryTabPane' : 'duelLeaderboardTabPane'));
    if (btn) btn.classList.toggle('active', t === tabName);
    if (pane) pane.style.display = (t === tabName) ? 'block' : 'none';
  });

  if (tabName === 'history') {
    loadDuelHistory();
  } else if (tabName === 'leaderboard') {
    loadDuelLeaderboard();
  } else if (tabName === 'rooms') {
    refreshDuelRooms();
  }
};

window.loadDuelStats = async function() {
  try {
    const res = await fetchWithTimeout(`${API}/duel/stats`, { headers: getDuelAuthHeaders() }, 4000);

    if (res.ok) {
      const data = await res.json();
      const rating = data.rating || 1000;
      const rank = data.rank || getDotaRank(rating);

      const elo = document.getElementById('duelProfileElo');
      const meta = document.getElementById('duelProfileMeta');
      const name = document.getElementById('duelProfileName');
      const badge = document.getElementById('duelProfileRankBadge');
      const stars = document.getElementById('duelProfileRankStars');
      const fill = document.getElementById('duelProfileRankFill');

      if (elo) elo.textContent = rating;
      if (meta) meta.textContent = `Матчи: ${data.total_matches || 0} • ${data.wins || 0}В / ${data.losses || 0}П • ${data.win_rate || 0}% винрейт`;
      if (name && window.Telegram?.WebApp?.initDataUnsafe?.user?.first_name) {
        name.textContent = window.Telegram.WebApp.initDataUnsafe.user.first_name;
      }

      const tid = rank.tier_id || rank.tierId || 'specialist';
      const rName = rank.name || 'Специалист';
      const rStars = rank.stars_str || rank.starsStr || 'I';
      if (badge) {
        badge.innerHTML = `<span class="duel-rank-svg-wrap">${getRankSvg(tid, 16)}</span> <span>${rName} ${rStars}</span>`;
        badge.style.borderColor = rank.color;
        badge.style.color = rank.color;
        badge.style.background = `${rank.color}18`;
      }
      if (stars) {
        const sCount = rank.stars || 1;
        stars.textContent = '★'.repeat(sCount) + '☆'.repeat(Math.max(0, 5 - sCount));
      }
      if (fill) {
        fill.style.width = `${rank.progress || 0}%`;
        fill.style.background = rank.color;
      }
    }
  } catch (_) {}
};

window.loadDuelHistory = async function() {
  const container = document.getElementById('duelHistoryList');
  if (!container) return;
  container.innerHTML = '<div class="admin-empty-state">Загрузка истории матчей...</div>';

  try {
    const res = await fetchWithTimeout(`${API}/duel/history`, { headers: getDuelAuthHeaders() }, 4000);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const history = data.history || [];

    if (history.length === 0) {
      container.innerHTML = `
        <div class="admin-empty-state" style="padding:24px 10px;">
          У вас пока нет сыгранных дуэлей.<br/>
          Создайте комнату или подключитесь по коду!
        </div>
      `;
      return;
    }

    let html = '';
    history.forEach(m => {
      const isWin = m.is_winner;
      const isDraw = m.is_draw;
      const resClass = isWin ? 'win' : (isDraw ? 'draw' : 'loss');
      const deltaStr = m.delta > 0 ? `+${m.delta}` : (m.delta < 0 ? `${m.delta}` : '0');
      const deltaColor = m.delta > 0 ? '#4ade80' : (m.delta < 0 ? '#f87171' : '#94a3b8');

      const gIcon = getGameSvg(m.game_id, 20);
      const gName = DUEL_GAME_NAMES[m.game_id] || m.game_id;

      const resBadgeHtml = isWin
        ? `<span class="duel-hist-res-badge win"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Победа</span>`
        : (isDraw
          ? `<span class="duel-hist-res-badge draw"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg> Ничья</span>`
          : `<span class="duel-hist-res-badge loss"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Поражение</span>`);

      let dateStr = '';
      try {
        const d = new Date(m.created_at);
        dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      } catch (_) {
        dateStr = m.created_at || '';
      }

      html += `
        <div class="duel-history-card ${resClass}">
          <div class="duel-hist-left">
            <span class="duel-hist-game-icon">${gIcon}</span>
            <div class="duel-hist-info">
              <div class="duel-hist-opp-row">
                ${resBadgeHtml}
                <span class="duel-hist-opp-name">vs ${esc(m.opponent_name)}</span>
              </div>
              <div class="duel-hist-date">${gName} • ${dateStr}</div>
            </div>
          </div>
          <div class="duel-hist-right">
            <div class="duel-hist-score">${m.my_score} : ${m.opp_score}</div>
            <div class="duel-hist-delta" style="color:${deltaColor};">${deltaStr} ELO</div>
          </div>
        </div>
      `;
    });
    container.innerHTML = html;
  } catch (_) {
    container.innerHTML = '<div class="admin-empty-state" style="color:#ef4444;">Не удалось загрузить историю</div>';
  }
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
      const gIcon = getGameSvg(r.game_id, 20);
      const hName = esc(r.host.name || 'Хост');
      const hRating = r.host.rating || 1000;
      const hRank = getDuelRank(hRating);
      html += `
        <div class="duel-room-card">
          <div class="duel-room-card-main">
            <div class="duel-room-card-icon">${gIcon}</div>
            <div class="duel-room-card-text">
              <div class="duel-room-card-title">${gName} • ${r.room_id}</div>
              <div class="duel-room-card-sub">${hName} (<span class="duel-rank-svg-wrap" style="color:${hRank.color};">${getRankSvg(hRank.tier_id, 12)}</span> <span style="color:${hRank.color}; font-weight:600;">${hRank.name} ${hRank.stars_str}</span> • ${hRating} ELO)</div>
            </div>
          </div>
          <button class="duel-room-join-btn" onclick="joinDuelRoom('${r.room_id}')" type="button">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m14.5 17.5-11.5-11.5v-3h3l11.5 11.5"/><path d="m13 19 6-6"/></svg>
            <span>В бой</span>
          </button>
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
      container.innerHTML = '<div class="admin-empty-state">Сыграйте первую дуэль, чтобы возглавить топ!</div>';
      return;
    }

    let html = '';
    leaders.forEach((u, i) => {
      const medal = getLeaderboardMedalSvg(i);
      const rank = u.rank || getDuelRank(u.rating);
      const tid = rank.tier_id || rank.tierId || 'specialist';
      const rName = rank.name || 'Специалист';
      const rStars = rank.stars_str || rank.starsStr || '';
      const rankTitle = `${rName} ${rStars}`.trim();

      html += `
        <div class="duel-lb-row ${i < 3 ? 'top-three' : ''}">
          <div class="duel-lb-left">
            <span class="duel-lb-rank-num">${medal}</span>
            <div class="duel-lb-user-details">
              <span class="duel-lb-user-name">${esc(u.display_name)}</span>
              <span class="duel-lb-dota-badge is-clickable" onclick="openDuelRanksModal()" title="Посмотреть таблицу всех рангов" style="border-color:${rank.color}44; color:${rank.color}; background:${rank.color}15; cursor:pointer;">
                <span class="duel-rank-svg-wrap">${getRankSvg(tid, 14)}</span>
                <span>${rankTitle}</span>
              </span>
            </div>
          </div>
          <div class="duel-lb-right">
            <span class="duel-lb-rating">${u.rating} ELO</span>
            <span class="duel-lb-stats">${u.wins}В / ${u.losses}П (${u.win_rate}%)</span>
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

window.openDuelRanksModal = function() {
  const modal = document.getElementById('duelRanksModal');
  if (!modal) return;

  const eloEl = document.getElementById('duelProfileElo');
  const myRating = eloEl ? (parseInt(eloEl.textContent, 10) || 1000) : 1000;
  const currentRank = getDuelRank(myRating);

  const currBadge = document.getElementById('duelRanksCurrBadge');
  const currMeta = document.getElementById('duelRanksCurrMeta');
  if (currBadge) {
    currBadge.innerHTML = `<span class="duel-rank-svg-wrap" style="color:${currentRank.color};">${getRankSvg(currentRank.tier_id, 20)}</span> <span>${currentRank.name} ${currentRank.stars_str}</span>`;
    currBadge.style.color = currentRank.color;
  }
  if (currMeta) {
    const starsIcons = currentRank.starsIcons || '★☆☆☆☆';
    currMeta.textContent = `${myRating} ELO • ${starsIcons} (${currentRank.progress}% до следующей звезды)`;
  }

  renderDuelRanksList(myRating, currentRank);

  modal.style.display = 'flex';
  setTimeout(() => { modal.classList.add('open'); }, 10);
};

window.closeDuelRanksModal = function() {
  const modal = document.getElementById('duelRanksModal');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(() => { modal.style.display = 'none'; }, 200);
  }
};

function renderDuelRanksList(currentRating, currentRank) {
  const container = document.getElementById('duelRanksListContainer');
  if (!container) return;

  const TIERS_DETAILS = [
    { id: 'apprentice', name: 'Ученик', color: '#b45309', range: '0 — 799 ELO' },
    { id: 'adept', name: 'Адепт', color: '#94a3b8', range: '800 — 999 ELO' },
    { id: 'specialist', name: 'Специалист', color: '#f59e0b', range: '1000 — 1199 ELO' },
    { id: 'expert', name: 'Эксперт', color: '#10b981', range: '1200 — 1399 ELO' },
    { id: 'magister', name: 'Магистр', color: '#818cf8', range: '1400 — 1599 ELO' },
    { id: 'grandmaster', name: 'Гроссмейстер', color: '#38bdf8', range: '1600 — 1799 ELO' },
    { id: 'archmage', name: 'Архимаг', color: '#c084fc', range: '1800 — 1999 ELO' },
    { id: 'academician', name: 'Академик', color: '#f43f5e', range: '2000+ ELO' }
  ];

  let html = '';
  TIERS_DETAILS.forEach((tier) => {
    const isCurrent = (currentRank && currentRank.tier_id === tier.id);

    html += `
      <div class="duel-rank-card-row ${isCurrent ? 'is-current' : ''}" style="border-left-color: ${tier.color};">
        <div class="duel-rank-card-icon" style="background: ${tier.color}1c; border-color: ${tier.color}45; color: ${tier.color};">
          ${getRankSvg(tier.id, 22, 2)}
        </div>
        <div class="duel-rank-card-body">
          <div class="duel-rank-card-header">
            <span class="duel-rank-card-name" style="color: ${tier.color};">${tier.name}</span>
            <span class="duel-rank-card-range">${tier.range}</span>
            ${isCurrent ? '<span class="duel-rank-current-tag">ВЫ ЗДЕСЬ</span>' : ''}
          </div>
          <div class="duel-rank-card-stars-row">Дивизионы со звёздами: <b>I, II, III, IV, V ★★★★★</b></div>
          ${isCurrent ? `
            <div class="duel-rank-card-progress-box">
              <div class="duel-rank-card-progress-txt">Ваш текущий дивизион: <b style="color:${tier.color};">${currentRank.name} ${currentRank.stars_str}</b> (${currentRank.progress}% до след. звезды)</div>
              <div class="duel-rank-progress-wrap">
                <div class="duel-rank-progress-fill" style="width:${currentRank.progress}%; background:${tier.color};"></div>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}



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

  const sheetBody = document.querySelector('.games-sheet-body');
  if (sheetBody) sheetBody.classList.add('is-duel');

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
  const hostRank = document.getElementById('duelHostRank');
  const hostElo = document.getElementById('duelHostElo');
  const hostStatus = document.getElementById('duelHostStatus');

  if (hostName) hostName.textContent = room.host.name;
  const hRating = room.host.rating || 1000;
  const hRank = getDuelRank(hRating);
  if (hostRank) {
    hostRank.innerHTML = `<span class="duel-rank-svg-wrap">${getRankSvg(hRank.tier_id, 14)}</span> <span>${hRank.name} ${hRank.stars_str}</span>`;
    hostRank.style.color = hRank.color;
    hostRank.classList.add('is-clickable');
    hostRank.onclick = openDuelRanksModal;
  }
  if (hostElo) hostElo.textContent = `${hRating} ELO`;
  if (hostStatus) {
    const isReady = room.ready && room.ready[String(room.host.telegram_id)];
    hostStatus.innerHTML = isReady
      ? '<span class="duel-status-ready-tag"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ГОТОВ</span>'
      : '<span class="duel-status-waiting-tag"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 15 15"/></svg> Ожидание</span>';
    hostStatus.className = `duel-player-status ${isReady ? 'ready' : 'waiting'}`;
  }

  const guestName = document.getElementById('duelGuestName');
  const guestRank = document.getElementById('duelGuestRank');
  const guestElo = document.getElementById('duelGuestElo');
  const guestStatus = document.getElementById('duelGuestStatus');
  const guestAvatar = document.getElementById('duelGuestAvatar');
  const readyBtn = document.getElementById('duelReadyBtn');

  if (room.guest) {
    if (guestName) guestName.textContent = room.guest.name;
    const gRating = room.guest.rating || 1000;
    const gRank = getDuelRank(gRating);
    if (guestRank) {
      guestRank.innerHTML = `<span class="duel-rank-svg-wrap">${getRankSvg(gRank.tier_id, 14)}</span> <span>${gRank.name} ${gRank.stars_str}</span>`;
      guestRank.style.color = gRank.color;
      guestRank.style.display = 'inline-flex';
      guestRank.classList.add('is-clickable');
      guestRank.onclick = openDuelRanksModal;
    }
    if (guestElo) guestElo.textContent = `${gRating} ELO`;
    if (guestAvatar) guestAvatar.innerHTML = getAvatarSilhouetteSvg(false);
    if (guestStatus) {
      const isReady = room.ready && room.ready[String(room.guest.telegram_id)];
      guestStatus.innerHTML = isReady
        ? '<span class="duel-status-ready-tag"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ГОТОВ</span>'
        : '<span class="duel-status-waiting-tag"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 15 15"/></svg> Ожидание</span>';
      guestStatus.className = `duel-player-status ${isReady ? 'ready' : 'waiting'}`;
    }
    if (readyBtn) {
      readyBtn.style.display = 'inline-flex';
      const myId = getMyPlayerId();
      const amReady = room.ready && room.ready[myId];
      _isReady = !!amReady;
      readyBtn.innerHTML = _isReady
        ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> <span>Готов! Отменить</span>'
        : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> <span>Я готов к бою!</span>';
      readyBtn.style.background = _isReady ? 'linear-gradient(135deg, #64748b, #475569)' : 'linear-gradient(135deg, #10b981, #059669)';
    }
  } else {
    if (guestName) guestName.textContent = 'Ожидание игрока...';
    if (guestRank) guestRank.style.display = 'none';
    if (guestElo) guestElo.textContent = '—';
    if (guestAvatar) guestAvatar.innerHTML = getAvatarSilhouetteSvg(true);
    if (guestStatus) {
      guestStatus.innerHTML = '<span class="duel-status-waiting-tag"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 15 15"/></svg> Не в сети</span>';
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
      if (data.my_id) {
        _myTelegramId = data.my_id;
      }
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

    case 'game_action':
      if (_activeDuelGame && typeof _activeDuelGame.handleOpponentAction === 'function') {
        _activeDuelGame.handleOpponentAction(data.action, data.payload);
      }
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
    btn.innerHTML = _isReady
      ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> <span>Готов! Отменить</span>'
      : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> <span>Я готов к бою!</span>';
    btn.style.background = _isReady ? 'linear-gradient(135deg, #64748b, #475569)' : 'linear-gradient(135deg, #10b981, #059669)';
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
      module = await import(`/static/games/${gameId}.js?v=20260924_v10`);
    } catch (_) {
      module = await import(`/static/games/${gameId}.js`);
    }

    function sendDuelGameAction(action, payload) {
      if (_duelWs && _duelWs.readyState === WebSocket.OPEN) {
        _duelWs.send(JSON.stringify({ type: 'game_action', action, payload }));
      }
    }

    _activeDuelGame = module.mount(mainField, {
      isDuel: true,
      roundSeed: data.seed,
      sendGameAction: sendDuelGameAction,
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

  const myId = getMyPlayerId();
  const hostId = _currentRoom?.host ? String(_currentRoom.host.telegram_id) : '';
  const guestId = _currentRoom?.guest ? String(_currentRoom.guest.telegram_id) : '';

  const isHost = (myId === hostId);
  const me = isHost ? _currentRoom?.host : _currentRoom?.guest;
  const opp = isHost ? _currentRoom?.guest : _currentRoom?.host;

  const meId = me ? String(me.telegram_id) : myId;
  const oppId = opp ? String(opp.telegram_id) : '';

  const myWins = roundWins ? (roundWins[meId] || 0) : 0;
  const oppWins = roundWins ? (roundWins[oppId] || 0) : 0;

  if (myRoundsEl) myRoundsEl.innerHTML = renderRoundDotsHtml(myWins);
  if (oppRoundsEl) oppRoundsEl.innerHTML = renderRoundDotsHtml(oppWins);

  if (myNameEl) myNameEl.textContent = me ? (me.name || 'Вы') : 'Вы';
  if (oppNameEl) oppNameEl.textContent = opp ? (opp.name || 'Оппонент') : 'Оппонент';

  const pipTitle = document.getElementById('duelPipTitle');
  if (pipTitle && opp) {
    pipTitle.textContent = opp.name || 'Соперник';
  }
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

  const myId = getMyPlayerId();
  const isMe = String(data.winner_id) === myId;
  const overlay = document.getElementById('duelResultOverlay');
  const title = document.getElementById('duelResultTitle');
  const icon = document.getElementById('duelResultIcon');
  const score = document.getElementById('duelResultScore');
  const elo = document.getElementById('duelResultElo');

  if (overlay) overlay.style.display = 'flex';
  if (icon) icon.innerHTML = isMe ? getRoundFlameSvg(48) : getRoundBrokenSvg(48);
  if (title) {
    title.textContent = isMe ? 'Раунд выигран!' : 'Раунд проигран';
    title.style.color = isMe ? '#4ade80' : '#f87171';
  }

  const hostId = _currentRoom?.host ? String(_currentRoom.host.telegram_id) : '';
  const guestId = _currentRoom?.guest ? String(_currentRoom.guest.telegram_id) : '';
  const oppId = (myId === hostId) ? guestId : hostId;

  const myWins = data.round_wins ? (data.round_wins[myId] || 0) : 0;
  const oppWins = data.round_wins ? (data.round_wins[oppId] || 0) : 0;

  if (elo) {
    elo.textContent = `Счёт: Вы ${myWins} — ${oppWins} Соперник`;
    elo.style.color = '#facc15';
  }
  if (score) score.textContent = 'Следующий раунд начнется через секунду...';

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

  const myId = getMyPlayerId();
  const winnerId = String(data.winner_id);
  const isMe = (myId === winnerId);

  const hostId = _currentRoom?.host ? String(_currentRoom.host.telegram_id) : '';
  const guestId = _currentRoom?.guest ? String(_currentRoom.guest.telegram_id) : '';
  const hostName = _currentRoom?.host ? _currentRoom.host.name : 'Игрок 1';
  const guestName = _currentRoom?.guest ? _currentRoom.guest.name : 'Игрок 2';
  const winnerName = (winnerId === hostId) ? hostName : ((winnerId === guestId) ? guestName : 'Победитель');

  const oppId = (myId === hostId) ? guestId : hostId;
  const myWins = data.round_wins ? (data.round_wins[myId] || 0) : 0;
  const oppWins = data.round_wins ? (data.round_wins[oppId] || 0) : 0;

  const overlay = document.getElementById('duelResultOverlay');
  const title = document.getElementById('duelResultTitle');
  const icon = document.getElementById('duelResultIcon');
  const score = document.getElementById('duelResultScore');
  const elo = document.getElementById('duelResultElo');

  if (overlay) overlay.style.display = 'flex';
  if (icon) icon.innerHTML = isMe ? getVictoryTrophySvg(56) : getDefeatSvg(56);
  if (title) {
    title.textContent = isMe ? 'ПОБЕДА В МАТЧЕ!' : 'ПОРАЖЕНИЕ В МАТЧЕ';
    title.style.color = isMe ? '#4ade80' : '#f87171';
  }

  const myDelta = data.elo?.deltas?.[myId] ?? (isMe ? 20 : -20);
  if (elo) {
    if (isMe) {
      elo.textContent = `+${myDelta} ELO (Рейтинг повышен!)`;
      elo.style.color = '#facc15';
    } else {
      elo.textContent = `${myDelta} ELO (Рейтинг понижен)`;
      elo.style.color = '#f87171';
    }
  }

  const resultRank = document.getElementById('duelResultRank');
  const newRating = data.elo?.new_ratings?.[myId];
  if (newRating != null && resultRank) {
    const rInfo = getDuelRank(newRating);
    resultRank.innerHTML = `<span class="duel-rank-svg-wrap" style="color:${rInfo.color};">${getRankSvg(rInfo.tier_id, 18)}</span> <span style="color:${rInfo.color}; font-weight:700;">${rInfo.name} ${rInfo.stars_str}</span> <span style="color:#94a3b8; font-size:13px;">(${newRating} ELO)</span>`;
    resultRank.style.display = 'inline-flex';
    resultRank.classList.add('is-clickable');
    resultRank.onclick = openDuelRanksModal;
  } else if (resultRank) {
    resultRank.style.display = 'none';
  }

  if (score) {
    score.innerHTML = `Победитель: <b>${escapeHtml(winnerName)}</b><br>Итоговый счёт: ${myWins} — ${oppWins}`;
  }

  // Показываем кнопки
  const actions = document.querySelector('.duel-result-actions');
  if (actions) actions.style.display = 'flex';

  // Haptic feedback
  if (window.Telegram?.WebApp?.HapticFeedback) {
    window.Telegram.WebApp.HapticFeedback.notificationOccurred(isMe ? 'success' : 'error');
  }

  // Refresh stats & match history in the background
  try {
    if (typeof loadDuelStats === 'function') setTimeout(loadDuelStats, 400);
    if (typeof loadDuelHistory === 'function') setTimeout(loadDuelHistory, 600);
  } catch (_) {}
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

  const sheetBody = document.querySelector('.games-sheet-body');
  if (sheetBody) sheetBody.classList.remove('is-duel');

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
