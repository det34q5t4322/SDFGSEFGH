/**
 * Minesweeper Game Module for College Schedule WebApp
 * Based on classic open-source minesweeper algorithms (MIT License)
 * Adapted to vanilla ES module with Antigravity theme variables,
 * safe first click, mobile dig/flag toggle, SVG vectors (zero emojis), and strict cleanup.
 *
 * MIT License
 */

let activeInstance = null;

export function mount(container, options = {}) {
  if (activeInstance) {
    unmount();
  }

  const { onScoreUpdate, onGameOver } = options;

  let width = 9;
  let height = 9;
  let totalMines = 10;
  let grid = [];
  let flags = 0;
  let revealedCount = 0;
  let isFirstClick = true;
  let gameOver = false;
  let gameWon = false;
  let isPaused = false;

  let timer = 0;
  let timerInterval = null;
  let mode = 'dig'; // 'dig' or 'flag'

  let bestTime = parseInt(localStorage.getItem('game_minesweeper_best') || '0', 10);

  // SVG Icons
  const ICONS = {
    mine: `<svg class="ms-icon-mine" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="7" fill="currentColor"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="3" y1="13" x2="5" y2="13"/><line x1="19" y1="13" x2="21" y2="13"/><line x1="5.6" y1="6.6" x2="7" y2="8"/><line x1="17" y1="18" x2="18.4" y2="19.4"/><line x1="5.6" y1="19.4" x2="7" y2="18"/><line x1="17" y1="8" x2="18.4" y2="6.6"/></svg>`,
    flag: `<svg class="ms-icon-flag" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#ef4444" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" fill="#ef4444"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
    shovel: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 22v-5l5-5 5 5-5 5z"/><path d="m9 15 8-8"/><circle cx="19" cy="5" r="2"/></svg>`,
    smile: `<svg class="ms-icon-face" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
    dead: `<svg class="ms-icon-face ms-face-dead" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5-1.5 4-1.5 4 1.5 4 1.5"/><line x1="8" y1="8" x2="10" y2="10"/><line x1="10" y1="8" x2="8" y2="10"/><line x1="14" y1="8" x2="16" y2="10"/><line x1="16" y1="8" x2="14" y2="10"/></svg>`,
    cool: `<svg class="ms-icon-face ms-face-cool" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#eab308" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5 2 4 2 4-2 4-2"/><path d="M4 10h16"/><path d="M6 10a2 2 0 0 0 4 0"/><path d="M14 10a2 2 0 0 0 4 0"/></svg>`
  };

  container.innerHTML = `
    <div class="minesweeper-wrap" id="msWrap">
      <div class="game-hud">
        <div class="game-hud-scores">
          <div class="game-hud-box">
            <span class="game-hud-label">МИНЫ</span>
            <span class="game-hud-value" id="msMineCount">${totalMines}</span>
          </div>
          <div class="game-hud-box">
            <span class="game-hud-label">ВРЕМЯ</span>
            <span class="game-hud-value" id="msTimer">0</span>
          </div>
          <div class="game-hud-box">
            <span class="game-hud-label">РЕКОРД</span>
            <span class="game-hud-value" id="msBest">${bestTime ? bestTime + 'с' : '—'}</span>
          </div>
        </div>

        <div class="game-hud-controls">
          <button class="ms-face-btn" id="msFaceBtn" type="button" aria-label="Сброс">${ICONS.smile}</button>
          <div class="ms-difficulty-selector">
            <button class="ms-diff-btn active" id="diff9" data-size="9" data-mines="10" type="button">9x9</button>
            <button class="ms-diff-btn" id="diff12" data-size="12" data-mines="20" type="button">12x12</button>
          </div>
        </div>
      </div>

      <!-- Mobile Mode Switcher (Dig vs Flag) -->
      <div class="ms-mode-bar">
        <button class="ms-mode-btn active" id="msModeDig" type="button">
          ${ICONS.shovel}
          <span>Копать</span>
        </button>
        <button class="ms-mode-btn" id="msModeFlag" type="button">
          ${ICONS.flag}
          <span>Флаг</span>
        </button>
      </div>

      <div class="ms-board-outer">
        <div class="ms-grid" id="msGrid"></div>
      </div>

      <div class="game-instructions">
        На мобильном переключайте <b>Копать / Флаг</b> или удерживайте ячейку. На ПК — левый клик (открыть) и правый клик (флаг).
      </div>
    </div>
  `;

  const gridEl = container.querySelector('#msGrid');
  const mineCountEl = container.querySelector('#msMineCount');
  const timerEl = container.querySelector('#msTimer');
  const bestEl = container.querySelector('#msBest');
  const faceBtn = container.querySelector('#msFaceBtn');
  const modeDigBtn = container.querySelector('#msModeDig');
  const modeFlagBtn = container.querySelector('#msModeFlag');
  const diff9Btn = container.querySelector('#diff9');
  const diff12Btn = container.querySelector('#diff12');

  function startTimer() {
    if (timerInterval) return;
    timerInterval = setInterval(() => {
      if (!isPaused && !gameOver && !gameWon) {
        timer++;
        if (timerEl) timerEl.textContent = timer;
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function initBoard() {
    stopTimer();
    timer = 0;
    flags = 0;
    revealedCount = 0;
    isFirstClick = true;
    gameOver = false;
    gameWon = false;

    if (timerEl) timerEl.textContent = '0';
    if (mineCountEl) mineCountEl.textContent = totalMines;
    if (faceBtn) faceBtn.innerHTML = ICONS.smile;

    grid = [];
    for (let r = 0; r < height; r++) {
      grid[r] = [];
      for (let c = 0; c < width; c++) {
        grid[r][c] = {
          r,
          c,
          isMine: false,
          revealed: false,
          flagged: false,
          neighborMines: 0
        };
      }
    }

    renderBoard();
  }

  function generateMines(firstR, firstC) {
    let planted = 0;
    while (planted < totalMines) {
      const r = Math.floor(Math.random() * height);
      const c = Math.floor(Math.random() * width);
      // Ensure first clicked cell and its 8 immediate neighbors are safe
      const isNeighborOrSelf = Math.abs(r - firstR) <= 1 && Math.abs(c - firstC) <= 1;
      if (!grid[r][c].isMine && !isNeighborOrSelf) {
        grid[r][c].isMine = true;
        planted++;
      }
    }

    // Calculate neighbor mine numbers
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        if (!grid[r][c].isMine) {
          let count = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const nr = r + dr;
              const nc = c + dc;
              if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
                if (grid[nr][nc].isMine) count++;
              }
            }
          }
          grid[r][c].neighborMines = count;
        }
      }
    }
  }

  function renderBoard() {
    if (!gridEl) return;
    gridEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = `repeat(${width}, minmax(0, 1fr))`;
    gridEl.style.gridTemplateRows = `repeat(${height}, minmax(0, 1fr))`;

    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const cell = grid[r][c];
        const cellEl = document.createElement('div');
        cellEl.className = 'ms-cell';
        cellEl.dataset.r = r;
        cellEl.dataset.c = c;

        if (cell.revealed) {
          cellEl.classList.add('revealed');
          if (cell.isMine) {
            cellEl.classList.add('mine');
            cellEl.innerHTML = ICONS.mine;
          } else if (cell.neighborMines > 0) {
            cellEl.classList.add(`num-${cell.neighborMines}`);
            cellEl.textContent = cell.neighborMines;
          }
        } else if (cell.flagged) {
          cellEl.classList.add('flagged');
          cellEl.innerHTML = ICONS.flag;
        }

        gridEl.appendChild(cellEl);
      }
    }
  }

  function updateCellEl(r, c) {
    if (!gridEl) return;
    const cell = grid[r]?.[c];
    if (!cell) return;
    const cellEl = gridEl.querySelector(`.ms-cell[data-r="${r}"][data-c="${c}"]`);
    if (!cellEl) return;

    if (cell.revealed) {
      cellEl.className = 'ms-cell revealed';
      if (cell.isMine) {
        cellEl.classList.add('mine');
        cellEl.innerHTML = ICONS.mine;
      } else if (cell.neighborMines > 0) {
        cellEl.classList.add(`num-${cell.neighborMines}`);
        cellEl.textContent = cell.neighborMines;
      } else {
        cellEl.innerHTML = '';
      }
    } else if (cell.flagged) {
      cellEl.className = 'ms-cell flagged';
      cellEl.innerHTML = ICONS.flag;
    } else {
      cellEl.className = 'ms-cell';
      cellEl.innerHTML = '';
    }
  }

  let isBulkRevealing = false;

  function revealCell(r, c) {
    if (gameOver || gameWon || isPaused) return;
    const cell = grid[r]?.[c];
    if (!cell || cell.revealed || cell.flagged) return;

    const wasBulk = isBulkRevealing;
    if (!wasBulk) isBulkRevealing = true;

    if (isFirstClick) {
      isFirstClick = false;
      generateMines(r, c);
      startTimer();
    }

    cell.revealed = true;
    revealedCount++;

    if (cell.isMine) {
      isBulkRevealing = false;
      gameOver = true;
      stopTimer();
      if (faceBtn) faceBtn.innerHTML = ICONS.dead;
      revealAllMines();
      if (typeof onGameOver === 'function') onGameOver(0, false);
      return;
    }

    // If zero neighbor mines, flood fill
    if (cell.neighborMines === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
            if (!grid[nr][nc].revealed && !grid[nr][nc].flagged) {
              revealCell(nr, nc);
            }
          }
        }
      }
    }

    if (!wasBulk) {
      isBulkRevealing = false;
      renderBoard();
      checkWin();
    }
  }

  function chordCell(r, c) {
    const cell = grid[r]?.[c];
    if (!cell || !cell.revealed || cell.neighborMines === 0) return;

    let flagCount = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
          if (grid[nr][nc].flagged) flagCount++;
        }
      }
    }

    if (flagCount === cell.neighborMines) {
      isBulkRevealing = true;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
            if (!grid[nr][nc].revealed && !grid[nr][nc].flagged) {
              revealCell(nr, nc);
            }
          }
        }
      }
      isBulkRevealing = false;
      renderBoard();
      checkWin();
    }
  }

  function toggleFlag(r, c) {
    if (gameOver || gameWon || isPaused) return;
    const cell = grid[r]?.[c];
    if (!cell || cell.revealed) return;

    cell.flagged = !cell.flagged;
    flags += cell.flagged ? 1 : -1;

    if (mineCountEl) {
      mineCountEl.textContent = totalMines - flags;
    }

    updateCellEl(r, c);
  }

  function revealAllMines() {
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        if (grid[r][c].isMine) {
          grid[r][c].revealed = true;
        }
      }
    }
    renderBoard();
  }

  function checkWin() {
    const safeCells = width * height - totalMines;
    if (revealedCount === safeCells) {
      gameWon = true;
      stopTimer();
      if (faceBtn) faceBtn.innerHTML = ICONS.cool;

      // Auto flag remaining mines
      for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
          if (grid[r][c].isMine) grid[r][c].flagged = true;
        }
      }
      flags = totalMines;
      if (mineCountEl) mineCountEl.textContent = '0';
      renderBoard();

      // Score in minesweeper: higher is better or faster time
      const score = Math.max(10, Math.floor(10000 / Math.max(1, timer)));
      if (!bestTime || timer < bestTime) {
        bestTime = timer;
        localStorage.setItem('game_minesweeper_best', String(bestTime));
        if (bestEl) bestEl.textContent = bestTime + 'с';
      }

      if (typeof onScoreUpdate === 'function') {
        onScoreUpdate(score, bestTime);
      }
      if (typeof onGameOver === 'function') {
        onGameOver(score, true);
      }
    }
  }

  // Telegram Haptic Helper
  const triggerHaptic = (type = 'light') => {
    try {
      if (window.Telegram?.WebApp?.HapticFeedback) {
        if (type === 'error') {
          window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
        } else if (type === 'medium') {
          window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
        } else {
          window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
        }
      }
    } catch (_) {}
  };

  // Event Listeners on Grid: сверхнадёжное удержание для флага (появление -> фиксация -> снятие вторым удержанием)
  let longPressTimer = null;
  let longPressTriggered = false;
  let suppressClickUntil = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let activeR = -1;
  let activeC = -1;

  const onPointerDown = (e) => {
    // Если правый клик мыши — обрабатывает contextmenu
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const cellEl = e.target.closest('.ms-cell');
    if (!cellEl) return;
    const r = parseInt(cellEl.dataset.r, 10);
    const c = parseInt(cellEl.dataset.c, 10);
    const cell = grid[r]?.[c];
    if (!cell || cell.revealed || gameOver || gameWon || isPaused) return;

    touchStartX = e.clientX;
    touchStartY = e.clientY;
    activeR = r;
    activeC = c;
    longPressTriggered = false;

    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    // Долгое нажатие для установки или снятия флага (260ms)
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      longPressTriggered = true;
      suppressClickUntil = Date.now() + 650;

      // При зажатии флажок появляется/исчезает и фиксируется до следующего удержания
      toggleFlag(activeR, activeC);
      triggerHaptic('medium');
    }, 260);
  };

  const onPointerMove = (e) => {
    if (!longPressTimer) return;
    const dist = Math.hypot(e.clientX - touchStartX, e.clientY - touchStartY);
    // Допускаем естественное микро-смещение пальца (18px)
    if (dist > 18) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  const onPointerUp = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  const onPointerCancel = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  const onGridClick = (e) => {
    // Если жест был долгим зажатием, отменяем клик чтобы не открыть ячейку и не сбросить флаг
    if (longPressTriggered || Date.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      longPressTriggered = false;
      return;
    }

    const cellEl = e.target.closest('.ms-cell');
    if (!cellEl) return;
    const r = parseInt(cellEl.dataset.r, 10);
    const c = parseInt(cellEl.dataset.c, 10);
    const cell = grid[r]?.[c];
    if (!cell || gameOver || gameWon || isPaused) return;

    if (cell.revealed) {
      chordCell(r, c);
      triggerHaptic('light');
    } else if (cell.flagged) {
      // Ячейка с флагом:
      if (mode === 'flag') {
        toggleFlag(r, c);
        triggerHaptic('light');
      }
      // В режиме 'dig' обычный клик по флагу защищён и ничего не делает
    } else {
      // Закрытая ячейка без флага:
      if (mode === 'flag') {
        toggleFlag(r, c);
        triggerHaptic('light');
      } else {
        revealCell(r, c);
        triggerHaptic('light');
      }
    }
  };

  const onGridContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Блокируем нативный вызов контекстного меню мобильного браузера, чтобы флаг не мигал
    if (longPressTriggered || Date.now() < suppressClickUntil || e.pointerType === 'touch') {
      return;
    }

    const cellEl = e.target.closest('.ms-cell');
    if (!cellEl) return;
    const r = parseInt(cellEl.dataset.r, 10);
    const c = parseInt(cellEl.dataset.c, 10);
    toggleFlag(r, c);
    triggerHaptic('medium');
  };

  const handleVisibilityChange = () => {
    isPaused = document.hidden;
  };

  // Difficulty switchers
  const setDifficulty = (size, mines, activeBtn, otherBtn) => {
    width = size;
    height = size;
    totalMines = mines;
    activeBtn.classList.add('active');
    otherBtn.classList.remove('active');
    initBoard();
  };

  const onDiff9Click = () => setDifficulty(9, 10, diff9Btn, diff12Btn);
  const onDiff12Click = () => setDifficulty(12, 20, diff12Btn, diff9Btn);

  // Mode switcher (Dig / Flag)
  const onModeDigClick = () => {
    mode = 'dig';
    modeDigBtn.classList.add('active');
    modeFlagBtn.classList.remove('active');
  };

  const onModeFlagClick = () => {
    mode = 'flag';
    modeFlagBtn.classList.add('active');
    modeDigBtn.classList.remove('active');
  };

  // Bind all listeners
  if (gridEl) {
    gridEl.addEventListener('click', onGridClick);
    gridEl.addEventListener('contextmenu', onGridContextMenu);
    gridEl.addEventListener('pointerdown', onPointerDown);
    gridEl.addEventListener('pointermove', onPointerMove);
    gridEl.addEventListener('pointerup', onPointerUp);
    gridEl.addEventListener('pointercancel', onPointerCancel);
  }

  if (faceBtn) faceBtn.addEventListener('click', initBoard);
  if (modeDigBtn) modeDigBtn.addEventListener('click', onModeDigClick);
  if (modeFlagBtn) modeFlagBtn.addEventListener('click', onModeFlagClick);
  if (diff9Btn) diff9Btn.addEventListener('click', onDiff9Click);
  if (diff12Btn) diff12Btn.addEventListener('click', onDiff12Click);

  document.addEventListener('visibilitychange', handleVisibilityChange);

  initBoard();

  activeInstance = {
    unmount: () => {
      stopTimer();
      if (longPressTimer) clearTimeout(longPressTimer);

      if (gridEl) {
        gridEl.removeEventListener('click', onGridClick);
        gridEl.removeEventListener('contextmenu', onGridContextMenu);
        gridEl.removeEventListener('pointerdown', onPointerDown);
        gridEl.removeEventListener('pointermove', onPointerMove);
        gridEl.removeEventListener('pointerup', onPointerUp);
        gridEl.removeEventListener('pointercancel', onPointerCancel);
      }

      if (faceBtn) faceBtn.removeEventListener('click', initBoard);
      if (modeDigBtn) modeDigBtn.removeEventListener('click', onModeDigClick);
      if (modeFlagBtn) modeFlagBtn.removeEventListener('click', onModeFlagClick);
      if (diff9Btn) diff9Btn.removeEventListener('click', onDiff9Click);
      if (diff12Btn) diff12Btn.removeEventListener('click', onDiff12Click);

      document.removeEventListener('visibilitychange', handleVisibilityChange);

      container.innerHTML = '';
      activeInstance = null;
    }
  };

  return activeInstance;
}

export function unmount() {
  if (activeInstance) {
    activeInstance.unmount();
    activeInstance = null;
  }
}
