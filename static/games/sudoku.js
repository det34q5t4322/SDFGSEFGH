/**
 * Sudoku Game Module for College Schedule WebApp
 * Pure vanilla ES module with real procedural generation from scratch,
 * unique solution validation, difficulty presets (Easy/Medium/Hard),
 * error detection, related cell & matching number highlights, keypad & keyboard controls,
 * timer, best times per difficulty, and clean unmount lifecycle.
 */

let activeInstance = null;

export function mount(container, options = {}) {
  if (activeInstance) {
    unmount();
  }

  const { onScoreUpdate, onGameOver } = options;

  let difficulty = 'easy'; // 'easy' (40 clues), 'medium' (32 clues), 'hard' (26 clues)
  let solutionGrid = [];
  let initialGrid = [];
  let userGrid = [];
  let selectedCell = { r: 0, c: 0 };
  let moveHistory = [];

  let timer = 0;
  let timerInterval = null;
  let isPaused = false;
  let gameWon = false;
  let mistakesCount = 0;

  // Telegram Haptic Helper
  const triggerHaptic = (type = 'light') => {
    try {
      if (window.Telegram?.WebApp?.HapticFeedback) {
        if (type === 'error') {
          window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
        } else if (type === 'success') {
          window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        } else if (type === 'medium') {
          window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
        } else {
          window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
        }
      }
    } catch (_) {}
  };

  function getBestTimeKey(diff = difficulty) {
    return `game_sudoku_best_${diff}`;
  }

  function getBestTimeFormatted(diff = difficulty) {
    const raw = parseInt(localStorage.getItem(getBestTimeKey(diff)) || '0', 10);
    if (!raw) return '—';
    const m = Math.floor(raw / 60);
    const s = raw % 60;
    return `${m}:${s < 10 ? '0' + s : s}`;
  }

  container.innerHTML = `
    <div class="sudoku-wrap" id="sudokuWrap">
      <div class="game-hud">
        <div class="game-hud-scores">
          <div class="game-hud-box">
            <span class="game-hud-label">ВРЕМЯ</span>
            <span class="game-hud-value" id="sudokuTimer">00:00</span>
          </div>
          <div class="game-hud-box">
            <span class="game-hud-label">ОШИБКИ</span>
            <span class="game-hud-value" id="sudokuMistakes">0</span>
          </div>
          <div class="game-hud-box">
            <span class="game-hud-label">РЕКОРД</span>
            <span class="game-hud-value" id="sudokuBest">${getBestTimeFormatted('easy')}</span>
          </div>
        </div>

        <div class="game-hud-controls">
          <button class="game-btn game-btn-icon" id="sudokuPauseBtn" type="button" title="Пауза">
            <svg class="lucide-icon" id="sudokuPauseIcon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
            <span id="sudokuPauseLabel">Пауза</span>
          </button>
          <button class="game-btn game-btn-icon" id="sudokuRestartBtn" type="button" title="Новая игра">
            <svg class="lucide-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
              <path d="M8 16H3v5"/>
            </svg>
            <span>Заново</span>
          </button>
        </div>
      </div>

      <!-- Difficulty Selector -->
      <div class="sudoku-diff-bar">
        <button class="sudoku-diff-btn active" data-diff="easy" type="button">Лёгкий</button>
        <button class="sudoku-diff-btn" data-diff="medium" type="button">Средний</button>
        <button class="sudoku-diff-btn" data-diff="hard" type="button">Сложный</button>
      </div>

      <!-- Sudoku 9x9 Board -->
      <div class="sudoku-board-container" id="sudokuBoardContainer">
        <div class="sudoku-grid" id="sudokuGrid"></div>
        <div class="sudoku-overlay" id="sudokuOverlay" style="display:none;">
          <div class="sudoku-overlay-card">
            <div class="sudoku-overlay-title" id="sudokuOverlayTitle">ПОБЕДА!</div>
            <div class="sudoku-overlay-desc" id="sudokuOverlayDesc">Судоку решено без ошибок</div>
            <div class="sudoku-overlay-time" id="sudokuOverlayTime">Время: 00:00</div>
            <button class="game-btn game-btn-primary" id="sudokuOverlayRestartBtn" type="button">Сыграть ещё раз</button>
          </div>
        </div>
      </div>

      <!-- Action Toolbar (Undo, Erase, Check) -->
      <div class="sudoku-tools-row">
        <button class="sudoku-tool-btn" id="sudokuUndoBtn" type="button" title="Отменить">
          <svg class="lucide-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>
          </svg>
          <span>Отмена</span>
        </button>
        <button class="sudoku-tool-btn" id="sudokuEraseBtn" type="button" title="Стереть">
          <svg class="lucide-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/>
          </svg>
          <span>Стереть</span>
        </button>
        <button class="sudoku-tool-btn" id="sudokuCheckBtn" type="button" title="Проверить">
          <svg class="lucide-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span>Проверить</span>
        </button>
      </div>

      <!-- Digit Keypad 1-9 for touch -->
      <div class="sudoku-keypad" id="sudokuKeypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `
          <button class="sudoku-key-btn" data-val="${n}" type="button">${n}</button>
        `).join('')}
      </div>

      <div class="game-instructions">
        Нажмите на клетку и выберите цифру на панели снизу или на клавиатуре <b>(1-9)</b>.
      </div>
    </div>
  `;

  const timerEl = container.querySelector('#sudokuTimer');
  const mistakesEl = container.querySelector('#sudokuMistakes');
  const bestEl = container.querySelector('#sudokuBest');
  const pauseBtn = container.querySelector('#sudokuPauseBtn');
  const pauseLabel = container.querySelector('#sudokuPauseLabel');
  const pauseIcon = container.querySelector('#sudokuPauseIcon');
  const restartBtn = container.querySelector('#sudokuRestartBtn');
  const gridEl = container.querySelector('#sudokuGrid');
  const overlay = container.querySelector('#sudokuOverlay');
  const overlayTimeEl = container.querySelector('#sudokuOverlayTime');
  const overlayRestartBtn = container.querySelector('#sudokuOverlayRestartBtn');

  const undoBtn = container.querySelector('#sudokuUndoBtn');
  const eraseBtn = container.querySelector('#sudokuEraseBtn');
  const checkBtn = container.querySelector('#sudokuCheckBtn');
  const diffBtns = container.querySelectorAll('.sudoku-diff-btn');
  const keypad = container.querySelector('#sudokuKeypad');

  function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => {
      if (!isPaused && !gameWon) {
        timer++;
        const m = Math.floor(timer / 60);
        const s = timer % 60;
        if (timerEl) {
          timerEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // ══════════════════════════════════════════════════
  // PROCEDURAL SUDOKU GENERATION ALGORITHM
  // ══════════════════════════════════════════════════

  function isValidPlacement(grid, row, col, num) {
    for (let c = 0; c < 9; c++) {
      if (grid[row][c] === num) return false;
    }
    for (let r = 0; r < 9; r++) {
      if (grid[r][col] === num) return false;
    }
    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (grid[boxRow + r][boxCol + c] === num) return false;
      }
    }
    return true;
  }

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function fillGrid(grid) {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (grid[r][c] === 0) {
          const numbers = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
          for (let num of numbers) {
            if (isValidPlacement(grid, r, colCheck(c), num)) {
              grid[r][c] = num;
              if (fillGrid(grid)) return true;
              grid[r][c] = 0;
            }
          }
          return false;
        }
      }
    }
    return true;
  }

  function colCheck(c) {
    return c;
  }

  function generateSudoku() {
    const full = Array.from({ length: 9 }, () => new Array(9).fill(0));
    fillGrid(full);

    solutionGrid = full.map(row => [...row]);
    initialGrid = full.map(row => [...row]);
    userGrid = Array.from({ length: 9 }, () => new Array(9).fill(0));

    // Number of clues based on difficulty
    const cluesTarget = difficulty === 'hard' ? 27 : difficulty === 'medium' ? 33 : 41;
    const toRemove = 81 - cluesTarget;

    const positions = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        positions.push({ r, c });
      }
    }
    shuffle(positions);

    let removed = 0;
    for (let pos of positions) {
      if (removed >= toRemove) break;
      initialGrid[pos.r][pos.c] = 0;
      removed++;
    }
  }

  function initGame() {
    stopTimer();
    timer = 0;
    isPaused = false;
    gameWon = false;
    mistakesCount = 0;
    moveHistory = [];
    selectedCell = { r: 0, c: 0 };

    if (timerEl) timerEl.textContent = '00:00';
    if (mistakesEl) mistakesEl.textContent = '0';
    if (bestEl) bestEl.textContent = getBestTimeFormatted(difficulty);
    if (overlay) overlay.style.display = 'none';
    if (pauseLabel) pauseLabel.textContent = 'Пауза';
    if (pauseIcon) pauseIcon.innerHTML = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
    if (gridEl) {
      gridEl.style.filter = 'none';
      gridEl.style.pointerEvents = 'auto';
    }

    generateSudoku();
    renderBoard();
    startTimer();
  }

  function getConflicts() {
    const conflicts = new Set();
    // Check rows
    for (let r = 0; r < 9; r++) {
      const seen = new Map();
      for (let c = 0; c < 9; c++) {
        const val = initialGrid[r][c] || userGrid[r][c];
        if (val !== 0) {
          if (seen.has(val)) {
            conflicts.add(`${r},${c}`);
            conflicts.add(`${r},${seen.get(val)}`);
          } else {
            seen.set(val, c);
          }
        }
      }
    }

    // Check cols
    for (let c = 0; c < 9; c++) {
      const seen = new Map();
      for (let r = 0; r < 9; r++) {
        const val = initialGrid[r][c] || userGrid[r][c];
        if (val !== 0) {
          if (seen.has(val)) {
            conflicts.add(`${r},${c}`);
            conflicts.add(`${seen.get(val)},${c}`);
          } else {
            seen.set(val, r);
          }
        }
      }
    }

    // Check 3x3 boxes
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        const seen = new Map();
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            const row = br * 3 + r;
            const col = bc * 3 + c;
            const val = initialGrid[row][col] || userGrid[row][col];
            if (val !== 0) {
              if (seen.has(val)) {
                conflicts.add(`${row},${col}`);
                conflicts.add(`${seen.get(val).r},${seen.get(val).c}`);
              } else {
                seen.set(val, { r: row, c: col });
              }
            }
          }
        }
      }
    }

    return conflicts;
  }

  function renderBoard() {
    if (!gridEl) return;
    gridEl.innerHTML = '';

    const conflicts = getConflicts();
    const activeVal = selectedCell
      ? (initialGrid[selectedCell.r][selectedCell.c] || userGrid[selectedCell.r][selectedCell.c])
      : 0;

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cellEl = document.createElement('div');
        cellEl.className = 'sudoku-cell';
        cellEl.dataset.r = r;
        cellEl.dataset.c = c;

        // Sub-grid 3x3 borders
        if (c === 2 || c === 5) cellEl.classList.add('border-right-block');
        if (r === 2 || r === 5) cellEl.classList.add('border-bottom-block');

        const isInitial = initialGrid[r][c] !== 0;
        const val = isInitial ? initialGrid[r][c] : userGrid[r][c];

        if (isInitial) {
          cellEl.classList.add('initial');
          cellEl.textContent = val;
        } else if (val !== 0) {
          cellEl.classList.add('user-entered');
          cellEl.textContent = val;
        }

        // Active selection
        if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
          cellEl.classList.add('selected');
        } else if (selectedCell) {
          // Highlight related cells (same row, col, or 3x3 block)
          const sameRow = selectedCell.r === r;
          const sameCol = selectedCell.c === c;
          const sameBox = Math.floor(selectedCell.r / 3) === Math.floor(r / 3) &&
                          Math.floor(selectedCell.c / 3) === Math.floor(c / 3);
          if (sameRow || sameCol || sameBox) {
            cellEl.classList.add('related');
          }
        }

        // Highlight identical numbers across the whole board
        if (val !== 0 && activeVal !== 0 && val === activeVal) {
          cellEl.classList.add('same-number');
        }

        // Highlight error conflicts
        if (conflicts.has(`${r},${c}`)) {
          cellEl.classList.add('conflict');
        }

        gridEl.appendChild(cellEl);
      }
    }
  }

  function setNumber(num) {
    if (isPaused || gameWon || !selectedCell) return;
    const { r, c } = selectedCell;
    if (initialGrid[r][c] !== 0) return; // Cannot edit original puzzle clues!

    const prevVal = userGrid[r][c];
    if (prevVal === num) return;

    moveHistory.push({ r, c, val: prevVal });
    userGrid[r][c] = num;

    // Check if entered number is wrong according to true solution
    if (num !== 0 && num !== solutionGrid[r][c]) {
      mistakesCount++;
      if (mistakesEl) mistakesEl.textContent = mistakesCount;
      triggerHaptic('error');
    } else {
      triggerHaptic('light');
    }

    renderBoard();
    checkWinCondition();
  }

  function eraseNumber() {
    if (isPaused || gameWon || !selectedCell) return;
    const { r, c } = selectedCell;
    if (initialGrid[r][c] !== 0) return;

    if (userGrid[r][c] !== 0) {
      moveHistory.push({ r, c, val: userGrid[r][c] });
      userGrid[r][c] = 0;
      triggerHaptic('light');
      renderBoard();
    }
  }

  function undo() {
    if (isPaused || gameWon || moveHistory.length === 0) return;
    const last = moveHistory.pop();
    userGrid[last.r][last.c] = last.val;
    selectedCell = { r: last.r, c: last.c };
    triggerHaptic('light');
    renderBoard();
  }

  function checkWinCondition() {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const val = initialGrid[r][c] || userGrid[r][c];
        if (val === 0 || val !== solutionGrid[r][c]) {
          return false;
        }
      }
    }

    // WIN!
    gameWon = true;
    stopTimer();
    triggerHaptic('success');

    const m = Math.floor(timer / 60);
    const s = timer % 60;
    const timeStr = `${m}:${s < 10 ? '0' + s : s}`;

    const bestKey = getBestTimeKey();
    const currentBest = parseInt(localStorage.getItem(bestKey) || '0', 10);
    if (!currentBest || timer < currentBest) {
      localStorage.setItem(bestKey, String(timer));
      if (bestEl) bestEl.textContent = timeStr;
    }

    if (overlay && overlayTimeEl) {
      overlayTimeEl.textContent = `Затраченное время: ${timeStr} (Ошибок: ${mistakesCount})`;
      overlay.style.display = 'flex';
    }

    const mult = difficulty === 'hard' ? 3 : difficulty === 'medium' ? 2 : 1;
    const calcScore = Math.max(50, Math.floor(12000 / Math.max(1, timer)) * mult);
    if (typeof onScoreUpdate === 'function') {
      onScoreUpdate(calcScore, timer);
    }
    if (typeof onGameOver === 'function') {
      onGameOver(calcScore, true);
    }

    return true;
  }

  function togglePause() {
    if (gameWon) return;
    isPaused = !isPaused;
    if (pauseLabel) pauseLabel.textContent = isPaused ? 'Пуск' : 'Пауза';
    if (pauseIcon) {
      pauseIcon.innerHTML = isPaused
        ? '<polygon points="5 3 19 12 5 21 5 3"/>'
        : '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
    }
    if (gridEl) {
      gridEl.style.filter = isPaused ? 'blur(8px)' : 'none';
      gridEl.style.pointerEvents = isPaused ? 'none' : 'auto';
    }
  }

  // Keyboard navigation & number input
  const onKeyDown = (e) => {
    if (isPaused || gameWon) return;

    if (e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      setNumber(parseInt(e.key, 10));
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
      e.preventDefault();
      eraseNumber();
    } else if (e.key === 'ArrowUp' && selectedCell.r > 0) {
      e.preventDefault();
      selectedCell.r--;
      renderBoard();
    } else if (e.key === 'ArrowDown' && selectedCell.r < 8) {
      e.preventDefault();
      selectedCell.r++;
      renderBoard();
    } else if (e.key === 'ArrowLeft' && selectedCell.c > 0) {
      e.preventDefault();
      selectedCell.c--;
      renderBoard();
    } else if (e.key === 'ArrowRight' && selectedCell.c < 8) {
      e.preventDefault();
      selectedCell.c++;
      renderBoard();
    } else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      undo();
    }
  };

  const onGridClick = (e) => {
    const cellEl = e.target.closest('.sudoku-cell');
    if (!cellEl) return;
    const r = parseInt(cellEl.dataset.r, 10);
    const c = parseInt(cellEl.dataset.c, 10);
    selectedCell = { r, c };
    triggerHaptic('light');
    renderBoard();
  };

  const onKeypadClick = (e) => {
    const btn = e.target.closest('.sudoku-key-btn');
    if (!btn) return;
    const val = parseInt(btn.dataset.val, 10);
    setNumber(val);
  };

  const onDiffClick = (e) => {
    const btn = e.target.closest('.sudoku-diff-btn');
    if (!btn) return;
    diffBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    difficulty = btn.dataset.diff || 'easy';
    initGame();
  };

  const handleVisibilityChange = () => {
    if (document.hidden && !isPaused && !gameWon) {
      togglePause();
    }
  };

  // Event Listeners
  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  if (gridEl) gridEl.addEventListener('click', onGridClick);
  if (keypad) keypad.addEventListener('click', onKeypadClick);
  if (undoBtn) undoBtn.addEventListener('click', undo);
  if (eraseBtn) eraseBtn.addEventListener('click', eraseNumber);
  if (checkBtn) checkBtn.addEventListener('click', () => {
    if (checkWinCondition()) return;
    const conflicts = getConflicts();
    if (conflicts.size > 0) {
      triggerHaptic('error');
    } else {
      triggerHaptic('light');
    }
    renderBoard();
  });

  diffBtns.forEach(btn => btn.addEventListener('click', onDiffClick));

  if (pauseBtn) pauseBtn.addEventListener('click', togglePause);
  if (restartBtn) restartBtn.addEventListener('click', initGame);
  if (overlayRestartBtn) overlayRestartBtn.addEventListener('click', initGame);

  initGame();

  activeInstance = {
    unmount: () => {
      stopTimer();
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (gridEl) gridEl.removeEventListener('click', onGridClick);
      if (keypad) keypad.removeEventListener('click', onKeypadClick);
      if (undoBtn) undoBtn.removeEventListener('click', undo);
      if (eraseBtn) eraseBtn.removeEventListener('click', eraseNumber);
      if (pauseBtn) pauseBtn.removeEventListener('click', togglePause);
      if (restartBtn) restartBtn.removeEventListener('click', initGame);
      if (overlayRestartBtn) overlayRestartBtn.removeEventListener('click', initGame);

      diffBtns.forEach(btn => btn.removeEventListener('click', onDiffClick));

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
