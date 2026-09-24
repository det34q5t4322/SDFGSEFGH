/**
 * Chrome Dino Runner Game Module for College Schedule WebApp
 * Pure vanilla ES module with Canvas 2D rendering, high-DPI retina scaling,
 * pixel-perfect retro aesthetics, day/night cycles, flying pterodactyls, ducking mechanics,
 * fair forgiving hitboxes, responsive touch controls, and strict unmount lifecycle.
 */

let activeInstance = null;

export function mount(container, options = {}) {
  if (activeInstance) {
    unmount();
  }

  const { onScoreUpdate, onGameOver } = options;

  const V_WIDTH = 600;
  const V_HEIGHT = 220;
  const GROUND_Y = 180;

  let canvas = null;
  let ctx = null;
  let animId = null;

  let score = 0;
  let distance = 0;
  let bestScore = parseInt(localStorage.getItem('game_dino_best') || '0', 10);
  let isPaused = false;
  let gameOver = false;
  let isNight = false;
  let nightAlpha = 0;

  // Dino state
  const dino = {
    x: 45,
    y: GROUND_Y - 32,
    w: 26,
    h: 32,
    vy: 0,
    isJumping: false,
    isDucking: false,
    legFrame: 0,
    legTimer: 0
  };

  const GRAVITY = 0.62;
  const JUMP_POWER = -11.2;
  let currentSpeed = 6.2;
  const MAX_SPEED = 13.5;

  let obstacles = [];
  let nextObstacleDistance = 350;
  let groundOffset = 0;
  let clouds = [];
  let stars = [];

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
    <div class="dino-game-wrap" id="dinoWrap">
      <div class="game-hud">
        <div class="game-hud-scores">
          <div class="game-hud-box">
            <span class="game-hud-label">ДИСТАНЦИЯ</span>
            <span class="game-hud-value" id="dinoScore">00000</span>
          </div>
          <div class="game-hud-box">
            <span class="game-hud-label">СКОРОСТЬ</span>
            <span class="game-hud-value" id="dinoSpeed">1.0x</span>
          </div>
          <div class="game-hud-box">
            <span class="game-hud-label">РЕКОРД</span>
            <span class="game-hud-value" id="dinoBest">${bestScore}</span>
          </div>
        </div>

        <div class="game-hud-controls">
          <button class="game-btn game-btn-icon" id="dinoPauseBtn" type="button" title="Пауза">
            <svg class="lucide-icon" id="dinoPauseIcon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
            <span id="dinoPauseLabel">Пауза</span>
          </button>
          <button class="game-btn game-btn-icon" id="dinoRestartBtn" type="button" title="Заново">
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

      <div class="dino-canvas-container" id="dinoCanvasContainer">
        <canvas id="dinoCanvas" width="600" height="220"></canvas>
        <div class="dino-overlay" id="dinoOverlay" style="display:none;">
          <div class="dino-overlay-card">
            <div class="dino-overlay-title">ВРЕЗАЛСЯ!</div>
            <div class="dino-overlay-score" id="dinoFinalScore">Дистанция: 0</div>
            <button class="game-btn game-btn-primary" id="dinoOverlayRestartBtn" type="button">Бежать снова</button>
          </div>
        </div>
      </div>

      <!-- Mobile Touch Controls for Jumping and Ducking -->
      <div class="dino-mobile-controls">
        <button class="dino-ctrl-btn dino-btn-duck" id="dinoBtnDuck" type="button">
          <svg class="lucide-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          <span>Присесть</span>
        </button>
        <button class="dino-ctrl-btn dino-btn-jump" id="dinoBtnJump" type="button">
          <svg class="lucide-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
          <span>Прыжок</span>
        </button>
      </div>

      <div class="game-instructions">
        Нажимайте <b>Пробел / Стрелку Вверх</b> или тап для прыжка, <b>Стрелку Вниз</b> для приседания под птицами.
      </div>
    </div>
  `;

  canvas = container.querySelector('#dinoCanvas');
  ctx = canvas.getContext('2d');

  const scoreEl = container.querySelector('#dinoScore');
  const speedEl = container.querySelector('#dinoSpeed');
  const bestEl = container.querySelector('#dinoBest');
  const pauseBtn = container.querySelector('#dinoPauseBtn');
  const pauseLabel = container.querySelector('#dinoPauseLabel');
  const pauseIcon = container.querySelector('#dinoPauseIcon');
  const restartBtn = container.querySelector('#dinoRestartBtn');
  const overlay = container.querySelector('#dinoOverlay');
  const finalScoreEl = container.querySelector('#dinoFinalScore');
  const overlayRestartBtn = container.querySelector('#dinoOverlayRestartBtn');

  const btnJump = container.querySelector('#dinoBtnJump');
  const btnDuck = container.querySelector('#dinoBtnDuck');

  function resizeCanvas() {
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(V_WIDTH * dpr);
    canvas.height = Math.floor(V_HEIGHT * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }

  resizeCanvas();

  function initScenery() {
    clouds = [
      { x: 120, y: 35, speed: 0.8 },
      { x: 340, y: 55, speed: 0.6 },
      { x: 520, y: 25, speed: 0.9 }
    ];
    stars = [];
    for (let i = 0; i < 20; i++) {
      stars.push({
        x: Math.random() * V_WIDTH,
        y: Math.random() * 90,
        r: Math.random() * 1.5 + 0.5
      });
    }
  }

  function resetGame() {
    score = 0;
    distance = 0;
    currentSpeed = 6.2;
    gameOver = false;
    isPaused = false;
    isNight = false;
    nightAlpha = 0;

    dino.y = GROUND_Y - 32;
    dino.w = 26;
    dino.h = 32;
    dino.vy = 0;
    dino.isJumping = false;
    dino.isDucking = false;
    dino.legFrame = 0;
    dino.legTimer = 0;

    obstacles = [];
    nextObstacleDistance = 320;
    groundOffset = 0;

    initScenery();

    if (overlay) overlay.style.display = 'none';
    if (pauseLabel) pauseLabel.textContent = 'Пауза';
    if (pauseIcon) pauseIcon.innerHTML = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
    updateHUD();
  }

  function doJump() {
    if (gameOver || isPaused) return;
    if (!dino.isJumping) {
      dino.isJumping = true;
      dino.vy = JUMP_POWER;
      triggerHaptic('light');
    }
  }

  function setDucking(val) {
    if (gameOver || isPaused) return;
    dino.isDucking = val;
    if (val) {
      dino.h = 18;
      dino.w = 34;
      if (!dino.isJumping) {
        dino.y = GROUND_Y - 18;
      } else {
        // Fast drop while in air
        dino.vy += 4.5;
      }
    } else {
      dino.h = 32;
      dino.w = 26;
      if (!dino.isJumping) {
        dino.y = GROUND_Y - 32;
      }
    }
  }

  function spawnObstacle() {
    const allowBirds = score > 250;
    const isBird = allowBirds && Math.random() < 0.35;

    if (isBird) {
      // Birds fly at two heights: low (duck required) or mid-high (jump or run under)
      const isLow = Math.random() < 0.6;
      const birdY = isLow ? GROUND_Y - 24 : GROUND_Y - 48;
      obstacles.push({
        type: 'bird',
        x: V_WIDTH + 20,
        y: birdY,
        w: 32,
        h: 22,
        wingFrame: 0,
        wingTimer: 0
      });
    } else {
      // Cacti variants: small, double, or big
      const variant = Math.floor(Math.random() * 3);
      let w = 15;
      let h = 30;
      if (variant === 1) { // Double cactus
        w = 28; h = 32;
      } else if (variant === 2) { // Tall cactus
        w = 18; h = 38;
      }
      obstacles.push({
        type: 'cactus',
        variant,
        x: V_WIDTH + 20,
        y: GROUND_Y - h,
        w,
        h
      });
    }

    // Dynamic distance to next obstacle ensuring player can always jump/react
    const minGap = 200 + currentSpeed * 14;
    const randGap = Math.random() * 180;
    nextObstacleDistance = minGap + randGap;
  }

  function update() {
    if (isPaused || gameOver) return;

    // Advance distance and score
    distance += currentSpeed * 0.08;
    const newScore = Math.floor(distance);
    if (newScore > score) {
      score = newScore;
      if (score % 100 === 0 && score > 0) {
        triggerHaptic('medium');
      }
      if (score > bestScore) {
        bestScore = score;
        localStorage.setItem('game_dino_best', String(bestScore));
      }
      updateHUD();
      if (typeof onScoreUpdate === 'function') {
        onScoreUpdate(score, bestScore);
      }
    }

    // Progressive speed
    if (currentSpeed < MAX_SPEED) {
      currentSpeed += 0.0012;
    }

    // Day / Night cycle every 500 score
    const cyclePhase = Math.floor(score / 500) % 2;
    isNight = cyclePhase === 1;
    if (isNight && nightAlpha < 1) nightAlpha = Math.min(1, nightAlpha + 0.015);
    if (!isNight && nightAlpha > 0) nightAlpha = Math.max(0, nightAlpha - 0.015);

    // Physics: Jump & Gravity
    if (dino.isJumping) {
      dino.y += dino.vy;
      dino.vy += GRAVITY;

      const targetGroundY = GROUND_Y - dino.h;
      if (dino.y >= targetGroundY) {
        dino.y = targetGroundY;
        dino.vy = 0;
        dino.isJumping = false;
      }
    }

    // Leg animation
    dino.legTimer++;
    if (dino.legTimer > 5) {
      dino.legTimer = 0;
      dino.legFrame = (dino.legFrame + 1) % 2;
    }

    // Scroll ground
    groundOffset = (groundOffset + currentSpeed) % 24;

    // Scroll clouds
    clouds.forEach(c => {
      c.x -= c.speed;
      if (c.x < -60) c.x = V_WIDTH + Math.random() * 80;
    });

    // Move obstacles
    nextObstacleDistance -= currentSpeed;
    if (nextObstacleDistance <= 0) {
      spawnObstacle();
    }

    for (let i = obstacles.length - 1; i >= 0; i--) {
      const obs = obstacles[i];
      obs.x -= currentSpeed;

      if (obs.type === 'bird') {
        obs.wingTimer = (obs.wingTimer || 0) + 1;
        if (obs.wingTimer > 8) {
          obs.wingTimer = 0;
          obs.wingFrame = (obs.wingFrame + 1) % 2;
        }
      }

      // Collision Detection with generous fair hitboxes (inset 4px)
      const dHit = {
        x: dino.x + 4,
        y: dino.y + 3,
        w: dino.w - 7,
        h: dino.h - 5
      };
      const oHit = {
        x: obs.x + 3,
        y: obs.y + 3,
        w: obs.w - 6,
        h: obs.h - 5
      };

      if (
        dHit.x < oHit.x + oHit.w &&
        dHit.x + dHit.w > oHit.x &&
        dHit.y < oHit.y + oHit.h &&
        dHit.y + dHit.h > oHit.y
      ) {
        handleGameOver();
        return;
      }

      // Remove off-screen obstacles
      if (obs.x + obs.w < -30) {
        obstacles.splice(i, 1);
      }
    }
  }

  function handleGameOver() {
    gameOver = true;
    triggerHaptic('error');

    if (overlay && finalScoreEl) {
      finalScoreEl.textContent = `Дистанция: ${score} м (Рекорд: ${bestScore})`;
      overlay.style.display = 'flex';
    }

    if (typeof onGameOver === 'function') {
      onGameOver(score, false);
    }
  }

  function updateHUD() {
    if (scoreEl) scoreEl.textContent = String(score).padStart(5, '0');
    if (speedEl) speedEl.textContent = (currentSpeed / 6.2).toFixed(1) + 'x';
    if (bestEl) bestEl.textContent = String(bestScore);
  }

  function drawDino() {
    ctx.save();
    ctx.fillStyle = isNight ? '#38bdf8' : '#10b981';

    const dx = dino.x;
    const dy = dino.y;

    if (dino.isDucking) {
      // Crouching long dinosaur silhouette
      ctx.fillRect(dx, dy + 6, 28, 12);
      ctx.fillRect(dx + 16, dy + 2, 16, 12); // head lowered
      // Eye
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(dx + 28, dy + 4, 2, 2);
      // Feet
      ctx.fillStyle = isNight ? '#38bdf8' : '#10b981';
      if (dino.legFrame === 0) {
        ctx.fillRect(dx + 4, dy + 16, 4, 3);
      } else {
        ctx.fillRect(dx + 18, dy + 16, 4, 3);
      }
    } else {
      // Classic upright pixel Dino
      // Head & snout
      ctx.fillRect(dx + 12, dy, 14, 12);
      ctx.fillRect(dx + 18, dy + 6, 8, 4);

      // Eye
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(dx + 16, dy + 3, 2, 2);

      // Body & Tail
      ctx.fillStyle = isNight ? '#38bdf8' : '#10b981';
      ctx.fillRect(dx + 6, dy + 10, 14, 14);
      ctx.fillRect(dx, dy + 14, 8, 6);
      ctx.fillRect(dx + 14, dy + 16, 5, 2); // tiny arm

      // Legs
      if (dino.isJumping) {
        ctx.fillRect(dx + 8, dy + 24, 3, 7);
        ctx.fillRect(dx + 15, dy + 24, 3, 5);
      } else if (dino.legFrame === 0) {
        ctx.fillRect(dx + 8, dy + 24, 3, 8);
        ctx.fillRect(dx + 15, dy + 24, 3, 5);
      } else {
        ctx.fillRect(dx + 8, dy + 24, 3, 5);
        ctx.fillRect(dx + 15, dy + 24, 3, 8);
      }
    }
    ctx.restore();
  }

  function drawObstacles() {
    obstacles.forEach(obs => {
      ctx.save();
      if (obs.type === 'cactus') {
        ctx.fillStyle = '#ef4444';
        const ox = obs.x;
        const oy = obs.y;
        const ow = obs.w;
        const oh = obs.h;

        // Main trunk
        ctx.fillRect(ox + ow * 0.35, oy, ow * 0.32, oh);
        // Left arm
        ctx.fillRect(ox, oy + oh * 0.3, ow * 0.35, ow * 0.25);
        ctx.fillRect(ox, oy + oh * 0.15, ow * 0.22, oh * 0.2);
        // Right arm
        ctx.fillRect(ox + ow * 0.65, oy + oh * 0.4, ow * 0.35, ow * 0.25);
        ctx.fillRect(ox + ow * 0.78, oy + oh * 0.25, ow * 0.22, oh * 0.2);
      } else if (obs.type === 'bird') {
        ctx.fillStyle = '#f59e0b';
        const bx = obs.x;
        const by = obs.y;

        // Bird body
        ctx.fillRect(bx + 8, by + 8, 16, 7);
        ctx.fillRect(bx + 20, by + 5, 10, 5); // head
        ctx.fillRect(bx + 26, by + 7, 6, 2);  // beak

        // Wings flapping
        if (obs.wingFrame === 0) {
          // Wings up
          ctx.beginPath();
          ctx.moveTo(bx + 12, by + 8);
          ctx.lineTo(bx + 6, by - 4);
          ctx.lineTo(bx + 18, by + 8);
          ctx.fill();
        } else {
          // Wings down
          ctx.beginPath();
          ctx.moveTo(bx + 12, by + 14);
          ctx.lineTo(bx + 8, by + 22);
          ctx.lineTo(bx + 18, by + 14);
          ctx.fill();
        }
      }
      ctx.restore();
    });
  }

  function draw() {
    if (!ctx || !canvas) return;

    // Background gradient for day/night
    if (nightAlpha > 0) {
      ctx.fillStyle = '#030712';
      ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);
      if (nightAlpha < 1) {
        ctx.save();
        ctx.globalAlpha = 1 - nightAlpha;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);
    }

    // Stars during night
    if (nightAlpha > 0.3) {
      ctx.save();
      ctx.globalAlpha = nightAlpha;
      ctx.fillStyle = '#ffffff';
      stars.forEach(s => {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      });
      // Moon
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(V_WIDTH - 60, 40, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#030712';
      ctx.beginPath();
      ctx.arc(V_WIDTH - 66, 36, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Clouds
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    clouds.forEach(c => {
      ctx.beginPath();
      ctx.roundRect(c.x, c.y, 44, 14, 7);
      ctx.roundRect(c.x + 8, c.y - 7, 24, 14, 7);
      ctx.fill();
    });

    // Ground line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(V_WIDTH, GROUND_Y);
    ctx.stroke();

    // Ground bumps / pebbles
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    for (let x = -groundOffset; x < V_WIDTH; x += 24) {
      if ((x * 7) % 3 === 0) {
        ctx.fillRect(x, GROUND_Y + 4, 3, 2);
      }
      if ((x * 13) % 4 === 0) {
        ctx.fillRect(x + 10, GROUND_Y + 8, 4, 2);
      }
    }

    drawObstacles();
    drawDino();
  }

  function loop() {
    update();
    draw();
    if (activeInstance) {
      animId = requestAnimationFrame(loop);
    }
  }

  function togglePause() {
    if (gameOver) return;
    isPaused = !isPaused;
    if (pauseLabel) pauseLabel.textContent = isPaused ? 'Пуск' : 'Пауза';
    if (pauseIcon) {
      pauseIcon.innerHTML = isPaused
        ? '<polygon points="5 3 19 12 5 21 5 3"/>'
        : '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
    }
  }

  // Keyboard navigation
  const onKeyDown = (e) => {
    if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) {
      e.preventDefault();
      doJump();
    } else if (['ArrowDown', 'KeyS'].includes(e.code)) {
      e.preventDefault();
      setDucking(true);
    } else if (e.code === 'KeyP') {
      e.preventDefault();
      togglePause();
    }
  };

  const onKeyUp = (e) => {
    if (['ArrowDown', 'KeyS'].includes(e.code)) {
      setDucking(false);
    }
    // Short jump release
    if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) {
      if (dino.isJumping && dino.vy < -4) {
        dino.vy = -4;
      }
    }
  };

  const onCanvasPointerDown = (e) => {
    if (gameOver || isPaused) return;
    doJump();
  };

  const handleVisibilityChange = () => {
    if (document.hidden && !isPaused && !gameOver) {
      togglePause();
    }
  };

  // Bind controls
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  if (canvas) canvas.addEventListener('pointerdown', onCanvasPointerDown);
  if (pauseBtn) pauseBtn.addEventListener('click', togglePause);
  if (restartBtn) restartBtn.addEventListener('click', resetGame);
  if (overlayRestartBtn) overlayRestartBtn.addEventListener('click', resetGame);

  const cleanups = [];
  const bindCtrl = (btn, onPress, onRelease) => {
    if (!btn) return;
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onPress();
    };
    const up = (e) => {
      if (onRelease) onRelease();
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    cleanups.push(() => {
      btn.removeEventListener('pointerdown', down);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointercancel', up);
    });
  };

  bindCtrl(btnJump, doJump, () => {
    if (dino.isJumping && dino.vy < -4) dino.vy = -4;
  });
  bindCtrl(btnDuck, () => setDucking(true), () => setDucking(false));

  const onResize = () => resizeCanvas();
  window.addEventListener('resize', onResize);

  resetGame();
  animId = requestAnimationFrame(loop);

  activeInstance = {
    unmount: () => {
      if (animId) cancelAnimationFrame(animId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (canvas) canvas.removeEventListener('pointerdown', onCanvasPointerDown);
      if (pauseBtn) pauseBtn.removeEventListener('click', togglePause);
      if (restartBtn) restartBtn.removeEventListener('click', resetGame);
      if (overlayRestartBtn) overlayRestartBtn.removeEventListener('click', resetGame);

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
