/**
 * Flappy Student Game Module for College Schedule WebApp
 * Pure vanilla ES module with Canvas 2D physics, tap-to-fly mechanics,
 * high-DPI scaling, Telegram WebApp haptics, and clean unmount lifecycle.
 */

let activeInstance = null;

export function mount(container, options = {}) {
  if (activeInstance) {
    unmount();
  }

  const { onScoreUpdate, onGameOver } = options;

  let canvas = null;
  let ctx = null;
  let animId = null;
  let lastTime = 0;

  let state = 'start'; // 'start', 'playing', 'over'
  let score = 0;
  let bestScore = parseInt(localStorage.getItem('game_flappy_best') || '0', 10);

  // Bird physics
  const bird = {
    x: 60,
    y: 180,
    radius: 14,
    vy: 0,
    gravity: 0.36,
    jump: -6.2,
    angle: 0
  };

  // Pipes
  let pipes = [];
  const PIPE_WIDTH = 52;
  const PIPE_GAP = 104;
  const PIPE_SPEED = 2.2;
  let pipeTimer = 0;

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
    <div class="flappy-game-wrap" id="flappyWrap">
      <div class="game-hud">
        <div class="game-hud-scores">
          <div class="game-hud-box">
            <span class="game-hud-label">СЧЁТ</span>
            <span class="game-hud-value" id="flappyScore">0</span>
          </div>
          <div class="game-hud-box">
            <span class="game-hud-label">РЕКОРД</span>
            <span class="game-hud-value" id="flappyBest">${bestScore}</span>
          </div>
        </div>

        <div class="game-hud-controls">
          <button class="game-ctrl-btn" id="flappyResetBtn" type="button" aria-label="Заново" title="Заново">
            <svg class="lucide-icon" viewBox="0 0 24 24" width="18" height="18"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
          </button>
        </div>
      </div>

      <div class="flappy-canvas-container">
        <canvas id="flappyCanvas"></canvas>
        <div class="flappy-overlay" id="flappyOverlay" style="display:none;">
          <div class="flappy-overlay-card">
            <div class="flappy-overlay-title" id="flappyOverlayTitle">Студент завалил сессию!</div>
            <div class="flappy-overlay-score" id="flappyOverlayScore">Сдано зачётов: 0</div>
            <button class="flappy-overlay-btn" id="flappyOverlayRestartBtn" type="button">Пересдать</button>
          </div>
        </div>
      </div>

      <div class="game-instructions">
        Тапайте по экрану или жмите <b>Пробел</b>, чтобы держать студента в полёте!
      </div>
    </div>
  `;

  canvas = container.querySelector('#flappyCanvas');
  ctx = canvas.getContext('2d');

  const scoreEl = container.querySelector('#flappyScore');
  const bestEl = container.querySelector('#flappyBest');
  const resetBtn = container.querySelector('#flappyResetBtn');
  const overlay = container.querySelector('#flappyOverlay');
  const overlayTitle = container.querySelector('#flappyOverlayTitle');
  const overlayScore = container.querySelector('#flappyOverlayScore');
  const overlayRestartBtn = container.querySelector('#flappyOverlayRestartBtn');

  function resizeCanvas() {
    if (!canvas) return;
    const parentWidth = Math.min(360, container.clientWidth - 20);
    const width = Math.max(280, Math.floor(parentWidth));
    const height = Math.floor(width * 1.25); // 4:5 aspect ratio
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.scale(dpr, dpr);
  }

  resizeCanvas();

  function resetGame() {
    const visualHeight = parseFloat(canvas.style.height) || 350;
    bird.y = visualHeight * 0.45;
    bird.vy = 0;
    bird.angle = 0;
    pipes = [];
    pipeTimer = 0;
    score = 0;
    state = 'start';

    if (scoreEl) scoreEl.textContent = '0';
    if (overlay) overlay.style.display = 'none';
  }

  function flap() {
    if (state === 'start') {
      state = 'playing';
      bird.vy = bird.jump;
      triggerHaptic('light');
    } else if (state === 'playing') {
      bird.vy = bird.jump;
      triggerHaptic('light');
    } else if (state === 'over') {
      resetGame();
    }
  }

  function spawnPipe() {
    const visualWidth = parseFloat(canvas.style.width) || 300;
    const visualHeight = parseFloat(canvas.style.height) || 350;
    const minTop = 45;
    const maxTop = visualHeight - PIPE_GAP - 55;
    const topHeight = Math.floor(minTop + Math.random() * (maxTop - minTop));

    pipes.push({
      x: visualWidth + 10,
      topHeight,
      bottomY: topHeight + PIPE_GAP,
      passed: false
    });
  }

  function update() {
    const visualWidth = parseFloat(canvas.style.width) || 300;
    const visualHeight = parseFloat(canvas.style.height) || 350;

    if (state === 'start') {
      // Gentle bobbing motion
      bird.y = visualHeight * 0.45 + Math.sin(Date.now() / 250) * 6;
      bird.angle = 0;
      return;
    }

    if (state === 'over') return;

    // Apply physics
    bird.vy += bird.gravity;
    bird.y += bird.vy;

    // Bird angle
    bird.angle = Math.min(Math.PI / 4, Math.max(-Math.PI / 5, bird.vy * 0.08));

    // Floor and ceiling collisions
    if (bird.y + bird.radius >= visualHeight - 12) {
      bird.y = visualHeight - 12 - bird.radius;
      handleGameOver();
      return;
    }
    if (bird.y - bird.radius <= 0) {
      bird.y = bird.radius;
      bird.vy = 0;
    }

    // Pipe generation
    pipeTimer++;
    if (pipeTimer >= 90) {
      spawnPipe();
      pipeTimer = 0;
    }

    // Pipe movement and collision
    for (let i = pipes.length - 1; i >= 0; i--) {
      const p = pipes[i];
      p.x -= PIPE_SPEED;

      // Check score
      if (!p.passed && p.x + PIPE_WIDTH < bird.x) {
        p.passed = true;
        score++;
        triggerHaptic('medium');
        if (scoreEl) scoreEl.textContent = score;

        if (score > bestScore) {
          bestScore = score;
          localStorage.setItem('game_flappy_best', String(bestScore));
          if (bestEl) bestEl.textContent = bestScore;
          if (typeof onScoreUpdate === 'function') {
            onScoreUpdate(score, bestScore);
          }
        }
      }

      // Check collision with bird circle vs pipe boxes
      if (
        bird.x + bird.radius > p.x &&
        bird.x - bird.radius < p.x + PIPE_WIDTH
      ) {
        if (bird.y - bird.radius < p.topHeight || bird.y + bird.radius > p.bottomY) {
          handleGameOver();
          return;
        }
      }

      // Remove offscreen
      if (p.x + PIPE_WIDTH < -20) {
        pipes.splice(i, 1);
      }
    }
  }

  function handleGameOver() {
    state = 'over';
    triggerHaptic('error');

    if (overlay) {
      if (overlayTitle) overlayTitle.textContent = 'Сессия завалена!';
      if (overlayScore) overlayScore.textContent = `Сдано зачётов: ${score}`;
      overlay.style.display = 'flex';
    }

    if (typeof onGameOver === 'function') {
      onGameOver(score, false);
    }
  }

  function draw() {
    if (!canvas || !ctx) return;
    const visualWidth = parseFloat(canvas.style.width) || 300;
    const visualHeight = parseFloat(canvas.style.height) || 350;

    // Sky Background gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, visualHeight);
    skyGrad.addColorStop(0, '#0c1022');
    skyGrad.addColorStop(0.7, '#1e1b4b');
    skyGrad.addColorStop(1, '#312e81');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, visualWidth, visualHeight);

    // Stars / College Clouds in background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.arc(visualWidth * 0.2, visualHeight * 0.15, 14, 0, Math.PI * 2);
    ctx.arc(visualWidth * 0.25, visualHeight * 0.13, 18, 0, Math.PI * 2);
    ctx.arc(visualWidth * 0.3, visualHeight * 0.15, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(visualWidth * 0.75, visualHeight * 0.25, 16, 0, Math.PI * 2);
    ctx.arc(visualWidth * 0.82, visualHeight * 0.23, 20, 0, Math.PI * 2);
    ctx.arc(visualWidth * 0.88, visualHeight * 0.25, 14, 0, Math.PI * 2);
    ctx.fill();

    // Draw Pipes (Styled as sleek neon pillars with glowing caps)
    pipes.forEach(p => {
      // Top Pipe
      const topGrad = ctx.createLinearGradient(p.x, 0, p.x + PIPE_WIDTH, 0);
      topGrad.addColorStop(0, '#0284c7');
      topGrad.addColorStop(0.5, '#38bdf8');
      topGrad.addColorStop(1, '#0369a1');
      ctx.fillStyle = topGrad;
      ctx.fillRect(p.x, 0, PIPE_WIDTH, p.topHeight);

      // Top Pipe Cap
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(p.x - 3, p.topHeight - 12, PIPE_WIDTH + 6, 12);
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(p.x - 3, p.topHeight - 12, PIPE_WIDTH + 6, 12);

      // Bottom Pipe
      const btmGrad = ctx.createLinearGradient(p.x, 0, p.x + PIPE_WIDTH, 0);
      btmGrad.addColorStop(0, '#0284c7');
      btmGrad.addColorStop(0.5, '#38bdf8');
      btmGrad.addColorStop(1, '#0369a1');
      ctx.fillStyle = btmGrad;
      ctx.fillRect(p.x, p.bottomY, PIPE_WIDTH, visualHeight - p.bottomY);

      // Bottom Pipe Cap
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(p.x - 3, p.bottomY, PIPE_WIDTH + 6, 12);
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(p.x - 3, p.bottomY, PIPE_WIDTH + 6, 12);
    });

    // Ground Floor
    ctx.fillStyle = '#1e1b4b';
    ctx.fillRect(0, visualHeight - 12, visualWidth, 12);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(0, visualHeight - 12, visualWidth, 2);

    // Draw Flappy Student (Flying character with student cap)
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.angle);

    // Glow
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 10;

    // Body (Blue/Cyan orb)
    const birdGrad = ctx.createRadialGradient(-2, -2, 2, 0, 0, bird.radius);
    birdGrad.addColorStop(0, '#bae6fd');
    birdGrad.addColorStop(0.5, '#38bdf8');
    birdGrad.addColorStop(1, '#0284c7');
    ctx.fillStyle = birdGrad;
    ctx.beginPath();
    ctx.arc(0, 0, bird.radius, 0, Math.PI * 2);
    ctx.fill();

    // Student Cap (Graduation cap on top)
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(0, -bird.radius - 8);
    ctx.lineTo(bird.radius + 6, -bird.radius + 1);
    ctx.lineTo(0, -bird.radius + 6);
    ctx.lineTo(-bird.radius - 6, -bird.radius + 1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Cap Tassel
    ctx.strokeStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(0, -bird.radius + 2);
    ctx.lineTo(-8, -bird.radius + 7);
    ctx.stroke();

    // Eye
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(6, -2, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(7.5, -2, 2, 0, Math.PI * 2);
    ctx.fill();

    // Wing
    ctx.fillStyle = '#0369a1';
    ctx.beginPath();
    ctx.ellipse(-5, 3, 6, 4, bird.angle * -0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Start Screen Guide
    if (state === 'start') {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 6;
      ctx.fillText('Тапните, чтобы взлететь!', visualWidth / 2, visualHeight * 0.65);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.font = '12px sans-serif';
      ctx.fillText('Облетайте препятствия сессии', visualWidth / 2, visualHeight * 0.72);
    }
  }

  function loop(timestamp) {
    update();
    draw();

    if (activeInstance) {
      animId = requestAnimationFrame(loop);
    }
  }

  // Event handlers
  const onCanvasClick = (e) => {
    e.preventDefault();
    flap();
  };

  const onKeyDown = (e) => {
    if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) {
      e.preventDefault();
      flap();
    }
  };

  canvas.addEventListener('pointerdown', onCanvasClick);
  window.addEventListener('keydown', onKeyDown);

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
      if (canvas) {
        canvas.removeEventListener('pointerdown', onCanvasClick);
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
