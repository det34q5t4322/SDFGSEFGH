/**
 * 2048 Game Module for College Schedule WebApp
 * Based on the open-source 2048 by Gabriele Cirulli (MIT License)
 * Smooth GPU-accelerated CSS transitions with sliding tiles, pop merges, and 0 flickering.
 *
 * MIT License - Copyright (c) 2014 Gabriele Cirulli
 */

let activeInstance = null;

export function mount(container, options = {}) {
  if (activeInstance) {
    unmount();
  }

  const { onScoreUpdate, onGameOver } = options;

  let board = createEmptyBoard();
  let score = 0;
  let bestScore = parseInt(localStorage.getItem('game_2048_best') || '0', 10);
  let won = false;
  let over = false;
  let keepPlaying = false;
  let isPaused = false;
  let tileIdCounter = 0;
  const tileElements = new Map();

  let pendingAnimationTimer = null;
  let inFlightCleanup = null;

  // Touch tracking
  let touchStartX = 0;
  let touchStartY = 0;

  // DOM layout
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
        <div class="g2048-tile-container" id="g2048TileContainer"></div>
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
  const tileContainerEl = container.querySelector('#g2048TileContainer');
  const overlayEl = container.querySelector('#g2048Overlay');
  const messageEl = container.querySelector('#g2048Message');
  const overlayBtn = container.querySelector('#g2048OverlayBtn');
  const restartBtn = container.querySelector('#g2048RestartBtn');
  const boardContainer = container.querySelector('#g2048BoardContainer');

  // Render static 16 background grid cells once
  if (gridEl) {
    gridEl.innerHTML = '';
    for (let i = 0; i < 16; i++) {
      const cell = document.createElement('div');
      cell.className = 'g2048-cell';
      gridEl.appendChild(cell);
    }
  }

  function createEmptyBoard() {
    return [
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null]
    ];
  }

  function getAvailableCells() {
    const cells = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (board[r][c] === null) cells.push({ r, c });
      }
    }
    return cells;
  }

  function addRandomTile() {
    const available = getAvailableCells();
    if (available.length > 0) {
      const { r, c } = available[Math.floor(Math.random() * available.length)];
      const tile = {
        id: ++tileIdCounter,
        val: Math.random() < 0.9 ? 2 : 4,
        r,
        c,
        isNew: true
      };
      board[r][c] = tile;
      return tile;
    }
    return null;
  }

  function flushInFlight() {
    if (pendingAnimationTimer) {
      clearTimeout(pendingAnimationTimer);
      pendingAnimationTimer = null;
    }
    if (inFlightCleanup) {
      inFlightCleanup();
      inFlightCleanup = null;
    }
  }

  function syncDOMTiles() {
    if (!tileContainerEl) return;

    // Collect all valid IDs currently on board
    const currentIds = new Set();
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const t = board[r][c];
        if (t) currentIds.add(t.id);
      }
    }

    // Remove any elements that are no longer on board
    for (let [id, el] of tileElements.entries()) {
      if (!currentIds.has(id)) {
        el.remove();
        tileElements.delete(id);
      }
    }

    // Render or update active tiles
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const tile = board[r][c];
        if (!tile) continue;

        let el = tileElements.get(tile.id);
        const valClass = tile.val > 2048 ? 'super' : tile.val;

        if (!el) {
          el = document.createElement('div');
          let cls = `g2048-tile g2048-row-${tile.r} g2048-col-${tile.c} g2048-tile-${valClass}`;
          if (tile.isNew) cls += ' g2048-tile-new';
          if (tile.isMerged) cls += ' g2048-tile-merged';
          el.className = cls;

          const inner = document.createElement('div');
          inner.className = `g2048-tile-inner g2048-tile-${valClass}`;
          inner.textContent = tile.val;
          el.appendChild(inner);

          tileContainerEl.appendChild(el);
          tileElements.set(tile.id, el);

          tile.isNew = false;
          tile.isMerged = false;
        } else {
          // Update position and value if changed
          el.className = `g2048-tile g2048-row-${tile.r} g2048-col-${tile.c} g2048-tile-${valClass}`;
          const inner = el.querySelector('.g2048-tile-inner');
          if (inner) {
            inner.className = `g2048-tile-inner g2048-tile-${valClass}`;
            if (inner.textContent !== String(tile.val)) {
              inner.textContent = tile.val;
            }
          }
        }
      }
    }

    if (scoreEl) scoreEl.textContent = score;
    if (bestEl) bestEl.textContent = bestScore;
  }

  function move(direction) {
    if (over || isPaused) return;

    flushInFlight();

    const vectors = {
      up: { r: -1, c: 0 },
      down: { r: 1, c: 0 },
      left: { r: 0, c: -1 },
      right: { r: 0, c: 1 }
    };
    const vector = vectors[direction];
    if (!vector) return;

    const rowIndices = vector.r === 1 ? [3, 2, 1, 0] : [0, 1, 2, 3];
    const colIndices = vector.c === 1 ? [3, 2, 1, 0] : [0, 1, 2, 3];

    let moved = false;
    let gainedScore = 0;
    let hadMerge = false;
    const tilesToRemove = [];
    const mergedTiles = [];

    // Reset merged flags
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (board[r][c]) board[r][c].merged = false;
      }
    }

    for (let r of rowIndices) {
      for (let c of colIndices) {
        const tile = board[r][c];
        if (!tile) continue;

        let currR = r;
        let currC = c;
        let nextR = currR + vector.r;
        let nextC = currC + vector.c;

        while (nextR >= 0 && nextR < 4 && nextC >= 0 && nextC < 4 && board[nextR][nextC] === null) {
          currR = nextR;
          currC = nextC;
          nextR += vector.r;
          nextC += vector.c;
        }

        if (
          nextR >= 0 && nextR < 4 && nextC >= 0 && nextC < 4 &&
          board[nextR][nextC] !== null &&
          board[nextR][nextC].val === tile.val &&
          !board[nextR][nextC].merged
        ) {
          // Merge!
          const targetTile = board[nextR][nextC];
          board[r][c] = null;

          // Slide this tile to target position
          tile.r = nextR;
          tile.c = nextC;
          tilesToRemove.push(tile);
          tilesToRemove.push(targetTile);

          const newVal = tile.val * 2;
          const mergedTile = {
            id: ++tileIdCounter,
            val: newVal,
            r: nextR,
            c: nextC,
            merged: true,
            isMerged: true
          };
          board[nextR][nextC] = mergedTile;
          mergedTiles.push(mergedTile);

          gainedScore += newVal;
          hadMerge = true;
          if (newVal === 2048 && !won && !keepPlaying) {
            won = true;
          }
          moved = true;
        } else if (currR !== r || currC !== c) {
          // Slide to empty spot
          board[r][c] = null;
          tile.r = currR;
          tile.c = currC;
          board[currR][currC] = tile;
          moved = true;
        }
      }
    }

    if (!moved) return;

    // Trigger subtle Telegram haptics if available
    try {
      if (hadMerge) {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('medium');
      } else {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light');
      }
    } catch (_) {}

    score += gainedScore;
    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem('game_2048_best', String(bestScore));
    }
    if (typeof onScoreUpdate === 'function') {
      onScoreUpdate(score, bestScore);
    }
    if (scoreEl) scoreEl.textContent = score;
    if (bestEl) bestEl.textContent = bestScore;

    // Immediately update positions of moving tiles so CSS translation starts smoothly
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const t = board[r][c];
        if (t && tileElements.has(t.id)) {
          const el = tileElements.get(t.id);
          const valClass = t.val > 2048 ? 'super' : t.val;
          el.className = `g2048-tile g2048-row-${t.r} g2048-col-${t.c} g2048-tile-${valClass}`;
        }
      }
    }
    for (let t of tilesToRemove) {
      if (tileElements.has(t.id)) {
        const el = tileElements.get(t.id);
        const valClass = t.val > 2048 ? 'super' : t.val;
        el.className = `g2048-tile g2048-row-${t.r} g2048-col-${t.c} g2048-tile-${valClass}`;
      }
    }

    inFlightCleanup = () => {
      // Remove elements of merged source tiles
      for (let t of tilesToRemove) {
        const el = tileElements.get(t.id);
        if (el) {
          el.remove();
          tileElements.delete(t.id);
        }
      }
      syncDOMTiles();
    };

    pendingAnimationTimer = setTimeout(() => {
      pendingAnimationTimer = null;
      if (inFlightCleanup) {
        inFlightCleanup();
        inFlightCleanup = null;
      }
      addRandomTile();
      syncDOMTiles();
      checkGameStatus();
    }, 105);
  }

  function movesAvailable() {
    if (getAvailableCells().length > 0) return true;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const t = board[r][c];
        if (!t) return true;
        if (c < 3 && board[r][c + 1] && board[r][c + 1].val === t.val) return true;
        if (r < 3 && board[r + 1][c] && board[r + 1][c].val === t.val) return true;
      }
    }
    return false;
  }

  function checkGameStatus() {
    if (won && !keepPlaying) {
      try {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
      } catch (_) {}
      showOverlay('Победа! Вы собрали 2048!', true);
      if (typeof onGameOver === 'function') onGameOver(score, true);
    } else if (!movesAvailable()) {
      try {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('error');
      } catch (_) {}
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
    flushInFlight();
    board = createEmptyBoard();
    if (tileContainerEl) tileContainerEl.innerHTML = '';
    tileElements.clear();
    score = 0;
    won = false;
    over = false;
    keepPlaying = false;
    if (overlayEl) overlayEl.style.display = 'none';

    addRandomTile();
    addRandomTile();
    syncDOMTiles();

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
      flushInFlight();
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
      tileElements.clear();
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
