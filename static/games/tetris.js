/**
 * Tetris Game Module for College Schedule WebApp
 * Based on open-source javascript-tetris by Jake Gordon (MIT License)
 * Adapted to vanilla ES module with Canvas rendering, Antigravity theme variables,
 * touch D-pad controls, and strict RAF/listener cleanup.
 *
 * MIT License - Copyright (c) 2011 Jake Gordon
 */

let activeInstance = null;

export function mount(container, options = {}) {
  if (activeInstance) {
    unmount();
  }

  const { onScoreUpdate, onGameOver } = options;

  const COLS = 10;
  const ROWS = 20;
  const BLOCK_SIZE = 24;

  let canvas = null;
  let ctx = null;
  let nextCanvas = null;
  let nextCtx = null;
  let rafId = null;
  let lastTime = 0;
  let dropCounter = 0;
  let dropInterval = 1000;
  let isPaused = false;
  let gameOver = false;

  let score = 0;
  let lines = 0;
  let level = 1;
  let bestScore = parseInt(localStorage.getItem('game_tetris_best') || '0', 10);

  let grid = createMatrix(COLS, ROWS);
  let piece = null;
  let nextPiece = null;

  const PIECES = {
    I: [
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 0, 0]
    ],
    J: [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0]
    ],
    L: [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0]
    ],
    O: [
      [1, 1],
      [1, 1]
    ],
    S: [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0]
    ],
    T: [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0]
    ],
    Z: [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0]
    ]
  };

  const COLORS = {
    1: '#06b6d4', // I - Cyan
    2: '#3b82f6', // J - Blue
    3: '#f97316', // L - Orange
    4: '#eab308', // O - Yellow
    5: '#22c55e', // S - Green
    6: '#a855f7', // T - Purple
    7: '#ef4444'  // Z - Red
  };

  container.innerHTML = `
    <div class="tetris-wrap" id="tetrisWrap">
      <div class="game-hud">
        <div class="game-hud-scores">
          <div class="game-hud-box">
            <span class="game-hud-label">СЧЁТ</span>
            <span class="game-hud-value" id="tetrisScore">0</span>
          </div>
          <div class="game-hud-box">
            <span class="game-hud-label">ЛИНИИ</span>
            <span class="game-hud-value" id="tetrisLines">0</span>
          </div>
          <div class="game-hud-box">
            <span class="game-hud-label">РЕКОРД</span>
            <span class="game-hud-value" id="tetrisBest">${bestScore}</span>
          </div>
        </div>
        <div class="game-hud-controls">
          <button class="game-btn game-btn-icon" id="tetrisPauseBtn" type="button" title="Пауза">
            <svg class="lucide-icon" id="tetrisPauseIcon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
            <span id="tetrisPauseLabel">Пауза</span>
          </button>
          <button class="game-btn game-btn-icon" id="tetrisRestartBtn" type="button" title="Заново">
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

      <div class="tetris-main-area">
        <div class="tetris-board-box">
          <canvas id="tetrisCanvas" width="240" height="480"></canvas>
          <div class="tetris-overlay" id="tetrisOverlay" style="display:none;">
            <div class="tetris-message" id="tetrisMessage">ИГРА ОКОНЧЕНА</div>
            <button class="game-btn game-btn-primary" id="tetrisOverlayBtn" type="button">Играть снова</button>
          </div>
        </div>

        <div class="tetris-sidebar">
          <div class="tetris-next-box">
            <div class="tetris-next-label">СЛЕДУЮЩАЯ</div>
            <canvas id="tetrisNextCanvas" width="80" height="80"></canvas>
          </div>
          <div class="tetris-level-box">
            <span class="game-hud-label">УРОВЕНЬ</span>
            <span class="game-hud-value" id="tetrisLevel">1</span>
          </div>
        </div>
      </div>

      <!-- Mobile Touch Controls -->
      <div class="tetris-controls" id="tetrisControls">
        <div class="tetris-controls-row">
          <button class="tetris-pad-btn" id="tBtnLeft" type="button" aria-label="Влево">
            <svg class="lucide-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button class="tetris-pad-btn" id="tBtnRotate" type="button" aria-label="Повернуть">
            <svg class="lucide-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><polyline points="21 3 21 8 16 8"/></svg>
          </button>
          <button class="tetris-pad-btn" id="tBtnRight" type="button" aria-label="Вправо">
            <svg class="lucide-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="tetris-controls-row">
          <button class="tetris-pad-btn tetris-pad-btn-wide" id="tBtnDown" type="button" aria-label="Вниз">
            <svg class="lucide-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            <span>Мягкий сброс</span>
          </button>
          <button class="tetris-pad-btn tetris-pad-btn-action" id="tBtnDrop" type="button" aria-label="Мгновенный сброс">
            <svg class="lucide-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/></svg>
            <span>Дроп</span>
          </button>
        </div>
      </div>
    </div>
  `;

  canvas = container.querySelector('#tetrisCanvas');
  ctx = canvas.getContext('2d');
  nextCanvas = container.querySelector('#tetrisNextCanvas');
  nextCtx = nextCanvas.getContext('2d');

  const scoreEl = container.querySelector('#tetrisScore');
  const linesEl = container.querySelector('#tetrisLines');
  const levelEl = container.querySelector('#tetrisLevel');
  const bestEl = container.querySelector('#tetrisBest');
  const overlayEl = container.querySelector('#tetrisOverlay');
  const messageEl = container.querySelector('#tetrisMessage');
  const overlayBtn = container.querySelector('#tetrisOverlayBtn');
  const pauseBtn = container.querySelector('#tetrisPauseBtn');
  const pauseLabel = container.querySelector('#tetrisPauseLabel');
  const restartBtn = container.querySelector('#tetrisRestartBtn');

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

  function createMatrix(w, h) {
    const m = [];
    while (h--) {
      m.push(new Array(w).fill(0));
    }
    return m;
  }

  // 7-Bag Randomizer (официальный стандарт Тетриса):
  // Детали никогда не повторяются по 3-6 раз подряд!
  let bag = [];

  function refillBag() {
    const pieces = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
    // Fisher-Yates тасование
    for (let i = pieces.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
    }
    bag.push(...pieces);
  }

  function getNextPieceType() {
    if (bag.length <= 3) {
      refillBag();
    }
    return bag.shift();
  }

  function randomPiece() {
    const key = getNextPieceType();
    const shape = PIECES[key];
    const keys = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
    const typeIdx = keys.indexOf(key) + 1;
    return {
      matrix: shape.map(row => row.map(cell => cell ? typeIdx : 0)),
      x: Math.floor(COLS / 2) - Math.ceil(shape[0].length / 2),
      y: 0,
      type: key
    };
  }

  function collide(mat, p) {
    const m = p.matrix;
    const o = { x: p.x, y: p.y };
    for (let y = 0; y < m.length; ++y) {
      for (let x = 0; x < m[y].length; ++x) {
        if (m[y][x] !== 0) {
          if (
            !mat[y + o.y] ||
            mat[y + o.y][x + o.x] === undefined ||
            mat[y + o.y][x + o.x] !== 0
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function merge(mat, p) {
    p.matrix.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value !== 0) {
          mat[y + p.y][x + p.x] = value;
        }
      });
    });
  }

  function rotate(matrix, dir = 1) {
    for (let y = 0; y < matrix.length; ++y) {
      for (let x = 0; x < y; ++x) {
        [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
      }
    }
    if (dir > 0) {
      matrix.forEach(row => row.reverse());
    } else {
      matrix.reverse();
    }
  }

  function playerRotate() {
    if (!piece || gameOver || isPaused) return;
    const originalX = piece.x;
    const originalY = piece.y;
    rotate(piece.matrix, 1);

    // Super Rotation System (SRS) kicks: try in-place, horizontal shifts, and vertical kicks up
    const kicks = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [2, 0],
      [-2, 0],
      [0, -1],
      [1, -1],
      [-1, -1],
      [0, -2]
    ];

    let kicked = false;
    for (const [kx, ky] of kicks) {
      piece.x = originalX + kx;
      piece.y = originalY + ky;
      if (!collide(grid, piece)) {
        kicked = true;
        break;
      }
    }

    if (!kicked) {
      rotate(piece.matrix, -1);
      piece.x = originalX;
      piece.y = originalY;
      return;
    }

    triggerHaptic('light');
  }

  function playerMove(dir) {
    if (!piece || gameOver || isPaused) return;
    piece.x += dir;
    if (collide(grid, piece)) {
      piece.x -= dir;
    }
  }

  function playerDrop() {
    if (!piece || gameOver || isPaused) return;
    piece.y++;
    if (collide(grid, piece)) {
      piece.y--;
      merge(grid, piece);
      arenaSweep();
      playerReset();
    }
    dropCounter = 0;
  }

  function playerHardDrop() {
    if (!piece || gameOver || isPaused) return;
    triggerHaptic('medium');
    while (!collide(grid, piece)) {
      piece.y++;
      score += 2;
    }
    piece.y--;
    merge(grid, piece);
    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem('game_tetris_best', String(bestScore));
    }
    updateUI();
    if (typeof onScoreUpdate === 'function') {
      onScoreUpdate(score, bestScore);
    }
    arenaSweep();
    playerReset();
    dropCounter = 0;
  }

  function arenaSweep() {
    let rowCount = 0;
    outer: for (let y = grid.length - 1; y >= 0; --y) {
      for (let x = 0; x < grid[y].length; ++x) {
        if (grid[y][x] === 0) {
          continue outer;
        }
      }
      const row = grid.splice(y, 1)[0].fill(0);
      grid.unshift(row);
      ++y;
      rowCount++;
    }

    if (rowCount > 0) {
      triggerHaptic(rowCount >= 4 ? 'medium' : 'light');
      const lineScores = [0, 100, 300, 500, 800];
      score += (lineScores[rowCount] || 1000) * level;
      lines += rowCount;
      level = Math.floor(lines / 10) + 1;
      dropInterval = Math.max(120, 1000 - (level - 1) * 90);

      if (score > bestScore) {
        bestScore = score;
        localStorage.setItem('game_tetris_best', String(bestScore));
      }

      updateUI();
      if (typeof onScoreUpdate === 'function') {
        onScoreUpdate(score, bestScore);
      }
    }
  }

  function playerReset() {
    piece = nextPiece || randomPiece();
    nextPiece = randomPiece();
    piece.x = Math.floor(COLS / 2) - Math.ceil(piece.matrix[0].length / 2);
    piece.y = 0;

    drawNext();

    if (collide(grid, piece)) {
      gameOver = true;
      triggerHaptic('error');
      if (overlayEl && messageEl) {
        messageEl.textContent = 'ИГРА ОКОНЧЕНА';
        overlayEl.style.display = 'flex';
      }
      if (typeof onGameOver === 'function') {
        onGameOver(score, false);
      }
    }
  }

  function drawBlock(targetCtx, x, y, color) {
    const px = x * BLOCK_SIZE;
    const py = y * BLOCK_SIZE;

    targetCtx.fillStyle = color;
    targetCtx.fillRect(px, py, BLOCK_SIZE, BLOCK_SIZE);

    // Bevel highlights for retro glass aesthetic
    targetCtx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    targetCtx.fillRect(px, py, BLOCK_SIZE, 2);
    targetCtx.fillRect(px, py, 2, BLOCK_SIZE);

    targetCtx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    targetCtx.fillRect(px, py + BLOCK_SIZE - 2, BLOCK_SIZE, 2);
    targetCtx.fillRect(px + BLOCK_SIZE - 2, py, 2, BLOCK_SIZE);
  }

  function drawGhostBlock(targetCtx, x, y, color) {
    const px = x * BLOCK_SIZE;
    const py = y * BLOCK_SIZE;
    targetCtx.strokeStyle = color;
    targetCtx.lineWidth = 1.5;
    targetCtx.strokeRect(px + 1.5, py + 1.5, BLOCK_SIZE - 3, BLOCK_SIZE - 3);
    targetCtx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    targetCtx.fillRect(px + 2, py + 2, BLOCK_SIZE - 4, BLOCK_SIZE - 4);
  }

  function draw() {
    if (!ctx || !canvas) return;

    // Clear board background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw subtle grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * BLOCK_SIZE, 0);
      ctx.lineTo(x * BLOCK_SIZE, ROWS * BLOCK_SIZE);
      ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * BLOCK_SIZE);
      ctx.lineTo(COLS * BLOCK_SIZE, y * BLOCK_SIZE);
      ctx.stroke();
    }

    // Draw merged matrix
    grid.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value !== 0) {
          drawBlock(ctx, x, y, COLORS[value] || '#818cf8');
        }
      });
    });

    // Draw Ghost Piece projection
    if (piece) {
      const ghost = {
        matrix: piece.matrix,
        x: piece.x,
        y: piece.y
      };
      while (!collide(grid, ghost)) {
        ghost.y++;
      }
      ghost.y--;

      if (ghost.y > piece.y) {
        ghost.matrix.forEach((row, y) => {
          row.forEach((value, x) => {
            if (value !== 0) {
              drawGhostBlock(ctx, ghost.x + x, ghost.y + y, COLORS[value] || '#818cf8');
            }
          });
        });
      }
    }

    // Draw active piece
    if (piece) {
      piece.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
          if (value !== 0) {
            drawBlock(ctx, piece.x + x, piece.y + y, COLORS[value] || '#818cf8');
          }
        });
      });
    }
  }

  function drawNext() {
    if (!nextCtx || !nextCanvas || !nextPiece) return;
    nextCtx.fillStyle = '#1e293b';
    nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);

    const m = nextPiece.matrix;
    const w = m[0].length;
    const h = m.length;
    const offX = Math.floor((nextCanvas.width - w * 18) / 2);
    const offY = Math.floor((nextCanvas.height - h * 18) / 2);

    m.forEach((row, y) => {
      row.forEach((val, x) => {
        if (val !== 0) {
          nextCtx.fillStyle = COLORS[val] || '#818cf8';
          nextCtx.fillRect(offX + x * 18, offY + y * 18, 17, 17);
        }
      });
    });
  }

  function updateUI() {
    if (scoreEl) scoreEl.textContent = score;
    if (linesEl) linesEl.textContent = lines;
    if (levelEl) levelEl.textContent = level;
    if (bestEl) bestEl.textContent = bestScore;
  }

  function update(time = 0) {
    if (!activeInstance) return;

    if (!lastTime) lastTime = time;
    const deltaTime = Math.min(time - lastTime, 100);
    lastTime = time;

    if (!isPaused && !gameOver) {
      dropCounter += deltaTime;
      if (dropCounter > dropInterval) {
        playerDrop();
      }
    }

    draw();
    rafId = requestAnimationFrame(update);
  }

  function togglePause() {
    if (gameOver) return;
    isPaused = !isPaused;
    if (!isPaused) {
      lastTime = performance.now();
      dropCounter = 0;
    }
    if (pauseLabel) {
      pauseLabel.textContent = isPaused ? 'Пуск' : 'Пауза';
    }
  }

  function initGame() {
    bag = [];
    refillBag();
    grid = createMatrix(COLS, ROWS);
    score = 0;
    lines = 0;
    level = 1;
    dropInterval = 1000;
    dropCounter = 0;
    gameOver = false;
    isPaused = false;
    lastTime = performance.now();
    if (overlayEl) overlayEl.style.display = 'none';
    if (pauseLabel) pauseLabel.textContent = 'Пауза';

    nextPiece = randomPiece();
    playerReset();
    updateUI();
  }

  // Keyboard controls
  const handleKeyDown = (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        playerMove(-1);
        break;
      case 'ArrowRight':
      case 'KeyD':
        playerMove(1);
        break;
      case 'ArrowUp':
      case 'KeyW':
        playerRotate();
        break;
      case 'ArrowDown':
      case 'KeyS':
        playerDrop();
        break;
      case 'Space':
        playerHardDrop();
        break;
      case 'KeyP':
        togglePause();
        break;
    }
  };

  const handleVisibilityChange = () => {
    if (document.hidden) {
      isPaused = true;
      if (pauseLabel) pauseLabel.textContent = 'Пуск';
    } else if (!gameOver) {
      lastTime = performance.now();
      dropCounter = 0;
    }
  };

  // Bind controls
  window.addEventListener('keydown', handleKeyDown);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  if (pauseBtn) pauseBtn.addEventListener('click', togglePause);
  if (restartBtn) restartBtn.addEventListener('click', initGame);
  if (overlayBtn) overlayBtn.addEventListener('click', initGame);

  const btnLeft = container.querySelector('#tBtnLeft');
  const btnRight = container.querySelector('#tBtnRight');
  const btnRotate = container.querySelector('#tBtnRotate');
  const btnDown = container.querySelector('#tBtnDown');
  const btnDrop = container.querySelector('#tBtnDrop');

  const cleanups = [];
  const bindTouch = (btn, action) => {
    if (!btn) return;
    let lastFire = 0;
    const handler = (e) => {
      const now = performance.now();
      if (now - lastFire < 50) return;
      lastFire = now;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      action();
    };
    btn.addEventListener('pointerdown', handler);
    cleanups.push(() => btn.removeEventListener('pointerdown', handler));
  };

  bindTouch(btnLeft, () => playerMove(-1));
  bindTouch(btnRight, () => playerMove(1));
  bindTouch(btnRotate, () => playerRotate());
  bindTouch(btnDown, () => playerDrop());
  bindTouch(btnDrop, () => playerHardDrop());

  initGame();
  lastTime = performance.now();
  rafId = requestAnimationFrame(update);

  activeInstance = {
    unmount: () => {
      // 1. Explicitly cancel requestAnimationFrame
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      // 2. Remove all global and DOM event listeners
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (pauseBtn) pauseBtn.removeEventListener('click', togglePause);
      if (restartBtn) restartBtn.removeEventListener('click', initGame);
      if (overlayBtn) overlayBtn.removeEventListener('click', initGame);

      cleanups.forEach(fn => { try { fn(); } catch (_) {} });

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
