/**
 * 2048 Game Module for College Schedule WebApp
 * Based on the open-source 2048 by Gabriele Cirulli (MIT License)
 * Adapted to vanilla ES module with Antigravity theme variables and full lifecycle cleanup.
 *
 * MIT License - Copyright (c) 2014 Gabriele Cirulli
 */

let activeInstance = null;

export function mount(container, options = {}) {
  if (activeInstance) {
    unmount();
  }

  const { onScoreUpdate, onGameOver } = options;

  let grid = createEmptyGrid();
  let score = 0;
  let bestScore = parseInt(localStorage.getItem('game_2048_best') || '0', 10);
  let won = false;
  let over = false;
  let keepPlaying = false;
  let isPaused = false;

  // Touch tracking
  let touchStartX = 0;
  let touchStartY = 0;

  // DOM elements
  container.innerHTML = `
    <div class="g2048-wrap" id="g2048Wrap">
      <div class="game-hud">
        <div class="game-hud-scores">
          <div class="game-hud-box">
            <span class="game-hud-label">СЧЁТ</span>
            <span class="game-hud-value" id="g2048Score">0</span>
          </div>
          <div class="game-hud-box">
            <span class="game-hud-label">РЕКОРД</span>
            <span class="game-hud-value" id="g2048Best">${bestScore}</span>
          </div>
        </div>
        <div class="game-hud-controls">
          <button class="game-btn game-btn-icon" id="g2048RestartBtn" type="button" title="Начать заново">
            <svg class="lucide-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
              <path d="M8 16H3v5"/>
            </svg>
            <span>Заново</span>
          </button>
        </div>
      </div>

      <div class="g2048-board-container" id="g2048BoardContainer">
        <div class="g2048-grid" id="g2048Grid"></div>
        <div class="g2048-overlay" id="g2048Overlay" style="display:none;">
          <div class="g2048-message" id="g2048Message"></div>
          <button class="game-btn game-btn-primary" id="g2048OverlayBtn" type="button">Сыграть ещё раз</button>
        </div>
      </div>

      <div class="game-instructions">
        Свайпайте пальцем или используйте клавиши <b>Стрелок / WASD</b> для объединения плиток с одинаковыми числами.
      </div>
    </div>
  `;

  const scoreEl = container.querySelector('#g2048Score');
  const bestEl = container.querySelector('#g2048Best');
  const gridEl = container.querySelector('#g2048Grid');
  const overlayEl = container.querySelector('#g2048Overlay');
  const messageEl = container.querySelector('#g2048Message');
  const overlayBtn = container.querySelector('#g2048OverlayBtn');
  const restartBtn = container.querySelector('#g2048RestartBtn');
  const boardContainer = container.querySelector('#g2048BoardContainer');

  function createEmptyGrid() {
    return [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0]
    ];
  }

  function getAvailableCells() {
    const cells = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (grid[r][c] === 0) cells.push({ r, c });
      }
    }
    return cells;
  }

  function addRandomTile() {
    const available = getAvailableCells();
    if (available.length > 0) {
      const { r, c } = available[Math.floor(Math.random() * available.length)];
      grid[r][c] = Math.random() < 0.9 ? 2 : 4;
    }
  }

  function renderGrid() {
    if (!gridEl) return;
    gridEl.innerHTML = '';
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const val = grid[r][c];
        const cell = document.createElement('div');
        cell.className = 'g2048-cell';
        if (val > 0) {
          const tile = document.createElement('div');
          tile.className = `g2048-tile g2048-tile-${val > 2048 ? 'super' : val}`;
          tile.textContent = val;
          cell.appendChild(tile);
        }
        gridEl.appendChild(cell);
      }
    }

    if (scoreEl) scoreEl.textContent = score;
    if (bestEl) bestEl.textContent = bestScore;
  }

  function slide(row) {
    let arr = row.filter(val => val !== 0);
    let scoreGain = 0;
    for (let i = 0; i < arr.length - 1; i++) {
      if (arr[i] === arr[i + 1]) {
        arr[i] *= 2;
        scoreGain += arr[i];
        if (arr[i] === 2048 && !won && !keepPlaying) {
          won = true;
        }
        arr.splice(i + 1, 1);
      }
    }
    while (arr.length < 4) {
      arr.push(0);
    }
    return { arr, scoreGain };
  }

  function rotateRight(matrix) {
    const result = createEmptyGrid();
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        result[c][3 - r] = matrix[r][c];
      }
    }
    return result;
  }

  function move(direction) {
    if (over || isPaused) return;

    let rotCount = 0;
    if (direction === 'up') rotCount = 3;
    else if (direction === 'right') rotCount = 2;
    else if (direction === 'down') rotCount = 1;

    let current = grid;
    for (let i = 0; i < rotCount; i++) current = rotateRight(current);

    let moved = false;
    let gainedScore = 0;
    const nextGrid = [];

    for (let r = 0; r < 4; r++) {
      const { arr, scoreGain } = slide(current[r]);
      nextGrid.push(arr);
      gainedScore += scoreGain;
      for (let c = 0; c < 4; c++) {
        if (arr[c] !== current[r][c]) moved = true;
      }
    }

    let unrotated = nextGrid;
    for (let i = 0; i < (4 - rotCount) % 4; i++) unrotated = rotateRight(unrotated);

    if (moved) {
      grid = unrotated;
      score += gainedScore;
      if (score > bestScore) {
        bestScore = score;
        localStorage.setItem('game_2048_best', String(bestScore));
      }
      if (typeof onScoreUpdate === 'function') {
        onScoreUpdate(score, bestScore);
      }

      addRandomTile();
      renderGrid();
      checkGameStatus();
    }
  }

  function movesAvailable() {
    if (getAvailableCells().length > 0) return true;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const val = grid[r][c];
        if (c < 3 && val === grid[r][c + 1]) return true;
        if (r < 3 && val === grid[r + 1][c]) return true;
      }
    }
    return false;
  }

  function checkGameStatus() {
    if (won && !keepPlaying) {
      showOverlay('Победа! Вы собрали 2048!', true);
      if (typeof onGameOver === 'function') onGameOver(score, true);
    } else if (!movesAvailable()) {
      over = true;
      showOverlay('Игра окончена!', false);
      if (typeof onGameOver === 'function') onGameOver(score, false);
    }
  }

  function showOverlay(msg, canContinue) {
    if (!overlayEl || !messageEl) return;
    messageEl.textContent = msg;
    if (canContinue) {
      overlayBtn.textContent = 'Продолжить игру';
      overlayBtn.onclick = () => {
        keepPlaying = true;
        overlayEl.style.display = 'none';
      };
    } else {
      overlayBtn.textContent = 'Сыграть заново';
      overlayBtn.onclick = initGame;
    }
    overlayEl.style.display = 'flex';
  }

  function initGame() {
    grid = createEmptyGrid();
    score = 0;
    won = false;
    over = false;
    keepPlaying = false;
    if (overlayEl) overlayEl.style.display = 'none';
    addRandomTile();
    addRandomTile();
    renderGrid();
    if (typeof onScoreUpdate === 'function') {
      onScoreUpdate(score, bestScore);
    }
  }

  // Event Listeners
  const handleKeyDown = (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        move('left');
        break;
      case 'ArrowRight':
      case 'KeyD':
        move('right');
        break;
      case 'ArrowUp':
      case 'KeyW':
        move('up');
        break;
      case 'ArrowDown':
      case 'KeyS':
        move('down');
        break;
    }
  };

  const handleTouchStart = (e) => {
    if (!e.touches || e.touches.length === 0) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  };

  const handleTouchMove = (e) => {
    // Prevent document scrolling when swiping inside the board
    if (e.cancelable) {
      e.preventDefault();
    }
  };

  const handleTouchEnd = (e) => {
    if (!e.changedTouches || e.changedTouches.length === 0) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (Math.max(absDx, absDy) > 25) {
      if (absDx > absDy) {
        move(dx > 0 ? 'right' : 'left');
      } else {
        move(dy > 0 ? 'down' : 'up');
      }
    }
  };

  const handleVisibilityChange = () => {
    isPaused = document.hidden;
  };

  window.addEventListener('keydown', handleKeyDown);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  if (boardContainer) {
    boardContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
    boardContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
    boardContainer.addEventListener('touchend', handleTouchEnd, { passive: true });
  }

  if (restartBtn) {
    restartBtn.addEventListener('click', initGame);
  }

  initGame();

  activeInstance = {
    unmount: () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (boardContainer) {
        boardContainer.removeEventListener('touchstart', handleTouchStart);
        boardContainer.removeEventListener('touchmove', handleTouchMove);
        boardContainer.removeEventListener('touchend', handleTouchEnd);
      }
      if (restartBtn) {
        restartBtn.removeEventListener('click', initGame);
      }
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
