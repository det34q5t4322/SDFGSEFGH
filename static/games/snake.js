/**
 * Snake Classic Game Module for College Schedule WebApp
 * Pure vanilla ES module with Canvas 2D rendering, swipe & D-pad controls,
 * responsive scaling, high-DPI support, and clean unmount lifecycle.
 */

let activeInstance = null;

export function mount(container, options = {}) {
  if (activeInstance) {
    unmount();
  }

  const { onScoreUpdate, onGameOver } = options;

  const GRID_SIZE = 16;
  const INTERNAL_SIZE = 320;
  let canvas = null;
  let ctx = null;
  let animId = null;
  let lastTick = 0;
  let tickInterval = 185; // ms per step (комфортная, плавная классическая скорость)

  let snake = [];
  let dir = { x: 1, y: 0 };
  let inputQueue = [];
  let food = null;
  let bonusFood = null;
  let bonusTimer = 0;
  let applesEaten = 0;

  let score = 0;
  let bestScore = parseInt(localStorage.getItem('game_snake_best') || '0', 10);
  let isPaused = false;
  let gameOver = false;
  let isStarted = false;

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

  container.innerHTML = `
    <div class="snake-game-wrap" id="snakeWrap">
      <div class="game-hud">
        <div class="game-hud-scores">
          <div class="game-hud-box">
            <span class="game-hud-label">СЧЁТ</span>
            <span class="game-hud-value" id="snakeScore">0</span>
          </div>
          <div class="game-hud-box">
            <span class="game-hud-label">ДЛИНА</span>
            <span class="game-hud-value" id="snakeLength">3</span>
          </div>
          <div class="game-hud-box">
            <span class="game-hud-label">РЕКОРД</span>
            <span class="game-hud-value" id="snakeBest">${bestScore}</span>
          </div>
        </div>

        <div class="game-hud-controls">
          <button class="game-ctrl-btn" id="snakePauseBtn" type="button" aria-label="Пауза" title="Пауза">
            <svg class="lucide-icon" viewBox="0 0 24 24" width="18" height="18"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          </button>
          <button class="game-ctrl-btn" id="snakeResetBtn" type="button" aria-label="Заново" title="Заново">
            <svg class="lucide-icon" viewBox="0 0 24 24" width="18" height="18"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
          </button>
        </div>
      </div>

      <div class="snake-canvas-container">
        <canvas id="snakeCanvas"></canvas>
        <div class="snake-overlay" id="snakeOverlay" style="display:none;">
          <div class="snake-overlay-card">
            <div class="snake-overlay-title" id="snakeOverlayTitle">Игра окончена</div>
            <div class="snake-overlay-score" id="snakeOverlayScore">Счёт: 0</div>
            <button class="snake-overlay-btn" id="snakeOverlayRestartBtn" type="button">Играть снова</button>
          </div>
        </div>
      </div>

      <!-- Touch D-Pad: удобный большой эргономичный джойстик -->
      <div class="snake-dpad">
        <div class="snake-dpad-row">
          <button class="snake-dpad-btn" id="sBtnUp" type="button" aria-label="Вверх">
            <svg class="lucide-icon" viewBox="0 0 24 24"><polygon points="12 4 4 17 20 17 12 4"/></svg>
          </button>
        </div>
        <div class="snake-dpad-row">
          <button class="snake-dpad-btn" id="sBtnLeft" type="button" aria-label="Влево">
            <svg class="lucide-icon" viewBox="0 0 24 24"><polygon points="4 12 17 20 17 4 4 12"/></svg>
          </button>
          <button class="snake-dpad-center" id="sBtnCenter" type="button" aria-label="Пауза / Старт" title="Пауза / Старт">
            <div class="snake-dpad-dot"></div>
          </button>
          <button class="snake-dpad-btn" id="sBtnRight" type="button" aria-label="Вправо">
            <svg class="lucide-icon" viewBox="0 0 24 24"><polygon points="20 12 7 4 7 20 20 12"/></svg>
          </button>
        </div>
        <div class="snake-dpad-row">
          <button class="snake-dpad-btn" id="sBtnDown" type="button" aria-label="Вниз">
            <svg class="lucide-icon" viewBox="0 0 24 24"><polygon points="12 20 20 7 4 7 12 20"/></svg>
          </button>
        </div>
      </div>

      <div class="game-instructions">
        Управляйте большим джойстиком, свайпами по полю или <b>WASD / Стрелками</b>.
      </div>
    </div>
  `;

  canvas = container.querySelector('#snakeCanvas');
  ctx = canvas.getContext('2d');

  const scoreEl = container.querySelector('#snakeScore');
  const lengthEl = container.querySelector('#snakeLength');
  const bestEl = container.querySelector('#snakeBest');
  const pauseBtn = container.querySelector('#snakePauseBtn');
  const resetBtn = container.querySelector('#snakeResetBtn');
  const overlay = container.querySelector('#snakeOverlay');
  const overlayTitle = container.querySelector('#snakeOverlayTitle');
  const overlayScore = container.querySelector('#snakeOverlayScore');
  const overlayRestartBtn = container.querySelector('#snakeOverlayRestartBtn');

  const btnUp = container.querySelector('#sBtnUp');
  const btnDown = container.querySelector('#sBtnDown');
  const btnLeft = container.querySelector('#sBtnLeft');
  const btnRight = container.querySelector('#sBtnRight');
  const btnCenter = container.querySelector('#sBtnCenter');

  // Фиксированная эталонная система координат: поле всегда одинаковое на всех экранах!
  function resizeCanvas() {
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(INTERNAL_SIZE * dpr);
    canvas.height = Math.floor(INTERNAL_SIZE * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }

  resizeCanvas();

  function resetGame() {
    const mid = Math.floor(GRID_SIZE / 2);
    snake = [
      { x: mid, y: mid },
      { x: mid - 1, y: mid },
      { x: mid - 2, y: mid }
    ];
    dir = { x: 1, y: 0 };
    inputQueue = [];
    score = 0;
    applesEaten = 0;
    bonusFood = null;
    bonusTimer = 0;
    tickInterval = 185;
    gameOver = false;
    isPaused = false;
    isStarted = false;
    lastTick = 0;

    if (scoreEl) scoreEl.textContent = '0';
    if (lengthEl) lengthEl.textContent = '3';
    if (overlay) overlay.style.display = 'none';

    spawnFood();
  }

  function spawnFood() {
    const freeCells = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let y = 0; y < GRID_SIZE; y++) {
        if (!snake.some(seg => seg.x === x && seg.y === y)) {
          freeCells.push({ x, y });
        }
      }
    }
    if (freeCells.length > 0) {
      food = freeCells[Math.floor(Math.random() * freeCells.length)];
    } else {
      food = { x: 0, y: 0 };
    }

    // Каждые 5 яблок появляется золотое бонусное яблоко с таймером
    if (applesEaten > 0 && applesEaten % 5 === 0 && !bonusFood) {
      const bonusCandidates = freeCells.filter(c => !food || c.x !== food.x || c.y !== food.y);
      if (bonusCandidates.length > 0) {
        bonusFood = bonusCandidates[Math.floor(Math.random() * bonusCandidates.length)];
        bonusTimer = 45; // 45 тиков жизни
      }
    }
  }

  function changeDirection(dx, dy) {
    if (gameOver || isPaused) return;

    if (!isStarted) {
      isStarted = true;
      dir = { x: dx, y: dy };
      inputQueue = [];
      lastTick = performance.now();
      tick();
      draw();
      return;
    }

    // Буфер из максимум 2 быстрых поворотов (для идеальных заворотов за угол)
    if (inputQueue.length >= 2) return;

    const ref = inputQueue.length > 0 ? inputQueue[inputQueue.length - 1] : dir;

    // Нельзя развернуться на 180 градусов назад
    if (dx === -ref.x && dy === -ref.y) return;

    // Игнорируем повторное нажатие того же направления
    if (dx === ref.x && dy === ref.y) return;

    inputQueue.push({ x: dx, y: dy });
  }

  function tick() {
    if (gameOver || isPaused || !isStarted) return;

    if (inputQueue.length > 0) {
      dir = inputQueue.shift();
    }

    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // Wall collision
    if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE) {
      handleGameOver();
      return;
    }

    // Self collision: tail segment is excluded if not eating, because tail moves away on this tick
    const willEat = (food && head.x === food.x && head.y === food.y) ||
                    (bonusFood && head.x === bonusFood.x && head.y === bonusFood.y);
    const segmentsToCheck = willEat ? snake : snake.slice(0, snake.length - 1);
    if (segmentsToCheck.some(seg => seg.x === head.x && seg.y === head.y)) {
      handleGameOver();
      return;
    }

    snake.unshift(head);

    let ate = false;

    // Check normal food
    if (food && head.x === food.x && head.y === food.y) {
      score += 10;
      applesEaten++;
      ate = true;
      triggerHaptic('light');
      // Плавное умеренное ускорение (не слишком быстрое)
      tickInterval = Math.max(130, 185 - Math.floor(score / 60) * 3);
      spawnFood();
    }

    // Check bonus food
    if (bonusFood && head.x === bonusFood.x && head.y === bonusFood.y) {
      score += 50;
      bonusFood = null;
      bonusTimer = 0;
      ate = true;
      triggerHaptic('medium');
    }

    if (!ate) {
      snake.pop();
    }

    if (bonusFood) {
      bonusTimer--;
      if (bonusTimer <= 0) bonusFood = null;
    }

    if (scoreEl) scoreEl.textContent = score;
    if (lengthEl) lengthEl.textContent = snake.length;

    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem('game_snake_best', String(bestScore));
      if (bestEl) bestEl.textContent = bestScore;
      if (typeof onScoreUpdate === 'function') {
        onScoreUpdate(score, bestScore);
      }
    }
  }

  function handleGameOver() {
    gameOver = true;
    triggerHaptic('error');

    if (overlay) {
      if (overlayTitle) overlayTitle.textContent = 'Столкновение!';
      if (overlayScore) overlayScore.textContent = `Ваш счёт: ${score}`;
      overlay.style.display = 'flex';
    }

    if (typeof onGameOver === 'function') {
      onGameOver(score, false);
    }
  }

  function draw() {
    if (!canvas || !ctx) return;
    const visualSize = INTERNAL_SIZE;
    const cellSize = visualSize / GRID_SIZE;

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, visualSize, visualSize);

    // Subtle grid dots/lines
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let y = 0; y < GRID_SIZE; y++) {
        if ((x + y) % 2 === 0) {
          ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
      }
    }

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, visualSize - 1, visualSize - 1);

    // Гарантируем, что яблоко всегда существует
    if (!food) spawnFood();

    // Bonus food (Golden pulse with star)
    if (bonusFood) {
      const bx = bonusFood.x * cellSize + cellSize / 2;
      const by = bonusFood.y * cellSize + cellSize / 2;
      const r = cellSize * 0.42;

      ctx.save();
      ctx.shadowColor = '#eab308';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();

      // Star sparkle
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.floor(cellSize * 0.55)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', bx, by + 1);
      ctx.restore();
    }

    // Normal food (Сочное яркое неоновое яблоко с 3D-бликом и листочком)
    if (food) {
      const fx = food.x * cellSize + cellSize / 2;
      const fy = food.y * cellSize + cellSize / 2;
      const r = cellSize * 0.38;

      ctx.save();
      // Glow
      ctx.shadowColor = 'rgba(239, 68, 68, 0.8)';
      ctx.shadowBlur = 10;

      // Apple Body
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(fx, fy, r, 0, Math.PI * 2);
      ctx.fill();

      // Specular 3D Highlight
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.beginPath();
      ctx.arc(fx - r * 0.32, fy - r * 0.32, r * 0.28, 0, Math.PI * 2);
      ctx.fill();

      // Emerald Leaf
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(fx + r * 0.4, fy - r * 0.55, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Snake Body
    for (let i = snake.length - 1; i >= 0; i--) {
      const seg = snake[i];
      const sx = seg.x * cellSize;
      const sy = seg.y * cellSize;
      const pad = 1.5;

      ctx.save();
      if (i === 0) {
        // Head
        ctx.fillStyle = '#10b981';
        ctx.shadowColor = 'rgba(16, 185, 129, 0.5)';
        ctx.shadowBlur = 6;
        drawRoundedRect(ctx, sx + pad, sy + pad, cellSize - pad * 2, cellSize - pad * 2, 5);
        ctx.fill();

        // Eyes
        ctx.fillStyle = '#ffffff';
        let eye1X, eye1Y, eye2X, eye2Y;
        const eyeSize = cellSize * 0.16;
        if (dir.x === 1) { // Right
          eye1X = sx + cellSize * 0.7; eye1Y = sy + cellSize * 0.28;
          eye2X = sx + cellSize * 0.7; eye2Y = sy + cellSize * 0.72;
        } else if (dir.x === -1) { // Left
          eye1X = sx + cellSize * 0.3; eye1Y = sy + cellSize * 0.28;
          eye2X = sx + cellSize * 0.3; eye2Y = sy + cellSize * 0.72;
        } else if (dir.y === -1) { // Up
          eye1X = sx + cellSize * 0.28; eye1Y = sy + cellSize * 0.3;
          eye2X = sx + cellSize * 0.72; eye2Y = sy + cellSize * 0.3;
        } else { // Down
          eye1X = sx + cellSize * 0.28; eye1Y = sy + cellSize * 0.7;
          eye2X = sx + cellSize * 0.72; eye2Y = sy + cellSize * 0.7;
        }
        ctx.beginPath(); ctx.arc(eye1X, eye1Y, eyeSize, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(eye2X, eye2Y, eyeSize, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = '#0f172a';
        ctx.beginPath(); ctx.arc(eye1X, eye1Y, eyeSize * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(eye2X, eye2Y, eyeSize * 0.5, 0, Math.PI * 2); ctx.fill();
      } else {
        // Body gradient from green to teal
        const ratio = i / snake.length;
        ctx.fillStyle = ratio > 0.5 ? '#059669' : '#34d399';
        drawRoundedRect(ctx, sx + pad, sy + pad, cellSize - pad * 2, cellSize - pad * 2, 4);
        ctx.fill();
      }
      ctx.restore();
    }

    // Start prompt banner
    if (!isStarted) {
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.76)';
      ctx.fillRect(0, visualSize / 2 - 30, visualSize, 60);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Нажмите кнопку или свайпните', visualSize / 2, visualSize / 2 - 8);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px system-ui, -apple-system, sans-serif';
      ctx.fillText('для старта игры', visualSize / 2, visualSize / 2 + 12);
      ctx.restore();
    }
  }

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function loop(timestamp) {
    if (!lastTick) lastTick = timestamp;
    const elapsed = Math.min(timestamp - lastTick, 300);

    if (elapsed > tickInterval) {
      tick();
      lastTick = timestamp;
    }

    draw();

    if (activeInstance) {
      animId = requestAnimationFrame(loop);
    }
  }

  // Swipe detection on Canvas
  let touchStartX = 0;
  let touchStartY = 0;

  const onTouchStart = (e) => {
    if (e.touches && e.touches[0]) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  };

  const onTouchEnd = (e) => {
    if (e.changedTouches && e.changedTouches[0]) {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (Math.max(absDx, absDy) > 22) {
        if (absDx > absDy) {
          changeDirection(dx > 0 ? 1 : -1, 0);
        } else {
          changeDirection(0, dy > 0 ? 1 : -1);
        }
      }
    }
  };

  // Keyboard navigation
  const onKeyDown = (e) => {
    if (['ArrowUp', 'KeyW'].includes(e.code)) {
      e.preventDefault();
      changeDirection(0, -1);
    } else if (['ArrowDown', 'KeyS'].includes(e.code)) {
      e.preventDefault();
      changeDirection(0, 1);
    } else if (['ArrowLeft', 'KeyA'].includes(e.code)) {
      e.preventDefault();
      changeDirection(-1, 0);
    } else if (['ArrowRight', 'KeyD'].includes(e.code)) {
      e.preventDefault();
      changeDirection(1, 0);
    } else if (e.code === 'Space') {
      e.preventDefault();
      togglePause();
    }
  };

  function togglePause() {
    isPaused = !isPaused;
    if (!isPaused) {
      lastTick = performance.now();
    }
    if (pauseBtn) {
      pauseBtn.innerHTML = isPaused
        ? `<svg class="lucide-icon" viewBox="0 0 24 24" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg>`
        : `<svg class="lucide-icon" viewBox="0 0 24 24" width="18" height="18"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    }
  }

  const handleVisibilityChange = () => {
    if (document.hidden) {
      if (!isPaused && isStarted && !gameOver) {
        togglePause();
      }
    } else {
      lastTick = performance.now();
    }
  };

  // Attach D-pad listeners: прямой перехват touchstart с нулевой задержкой
  const dpadCleanups = [];

  const bindDpad = (btn, dx, dy) => {
    if (!btn) return;
    let lastTap = 0;
    const handler = (e) => {
      const now = performance.now();
      if (now - lastTap < 40) return;
      lastTap = now;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      changeDirection(dx, dy);
      triggerHaptic('light');
    };
    btn.addEventListener('touchstart', handler, { passive: false });
    btn.addEventListener('mousedown', handler);
    dpadCleanups.push(() => {
      btn.removeEventListener('touchstart', handler);
      btn.removeEventListener('mousedown', handler);
    });
  };

  bindDpad(btnUp, 0, -1);
  bindDpad(btnDown, 0, 1);
  bindDpad(btnLeft, -1, 0);
  bindDpad(btnRight, 1, 0);

  if (btnCenter) {
    let lastCenterTap = 0;
    const centerHandler = (e) => {
      const now = performance.now();
      if (now - lastCenterTap < 40) return;
      lastCenterTap = now;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      if (!isStarted) {
        isStarted = true;
        lastTick = performance.now();
        tick();
        draw();
      } else {
        togglePause();
      }
      triggerHaptic('medium');
    };
    btnCenter.addEventListener('touchstart', centerHandler, { passive: false });
    btnCenter.addEventListener('mousedown', centerHandler);
    dpadCleanups.push(() => {
      btnCenter.removeEventListener('touchstart', centerHandler);
      btnCenter.removeEventListener('mousedown', centerHandler);
    });
  }

  const onCanvasClick = () => {
    if (!isStarted && !gameOver) {
      isStarted = true;
    }
  };

  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchend', onTouchEnd, { passive: true });
  canvas.addEventListener('click', onCanvasClick);
  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  pauseBtn.addEventListener('click', togglePause);
  resetBtn.addEventListener('click', resetGame);
  overlayRestartBtn.addEventListener('click', resetGame);

  const onWindowResize = () => resizeCanvas();
  window.addEventListener('resize', onWindowResize);

  resetGame();
  animId = requestAnimationFrame(loop);

  activeInstance = {
    unmount: () => {
      if (animId) cancelAnimationFrame(animId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onWindowResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (canvas) {
        canvas.removeEventListener('touchstart', onTouchStart);
        canvas.removeEventListener('touchend', onTouchEnd);
        canvas.removeEventListener('click', onCanvasClick);
      }
      dpadCleanups.forEach(fn => { try { fn(); } catch (_) {} });
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
