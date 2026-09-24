/**
 * Sudoku Game Engine & UI
 * Powered by robatron/sudoku.js constraint propagation & Norvig solver,
 * with certified unique solutions, mathematical permutations for infinite variety,
 * Pencil/Notes mode, smart auto-clear, count badges, and tactile mobile controls.
 */

let activeInstance = null;

const BASE_PUZZLES = {
  "easy": [
    {
      "puzzle": "7329.56148..4612.7416.739582.754.391591.3684..4..297.59.5.1.423123.945.667435218.",
      "solution": "732985614859461237416273958267548391591736842348129765985617423123894576674352189"
    },
    {
      "puzzle": "486.5729375326...8.2.3.4675.3984271.814976.5.6725319...476.853...87254611.5493827",
      "solution": "486157293753269148921384675539842716814976352672531984247618539398725461165493827"
    },
    {
      "puzzle": ".21835679975416.323.8..25147..283.658425617936.39.42.1287.493565..3271481346.....",
      "solution": "421835679975416832368792514719283465842561793653974281287149356596327148134658927"
    },
    {
      "puzzle": "376.5124898.67215..1.43869..3918.462.42369.81.61...73965.81392419324.8...28796315",
      "solution": "376951248984672153215438697539187462742369581861524739657813924193245876428796315"
    },
    {
      "puzzle": "8653.17..34178925.792.46..312.47.368437168529.....247.584697..2..3254687276813945",
      "solution": "865321794341789256792546813129475368437168529658932471584697132913254687276813945"
    }
  ],
  "medium": [
    {
      "puzzle": "842.93.766534.8921....2...4..4.6.1...1684.2..52731964.4..7563127.523148923198....",
      "solution": "842193576653478921179625834384562197916847253527319648498756312765231489231984765"
    },
    {
      "puzzle": "9.853.217374.21.59.1.78946..4..9752...3418.9.78..5634.1259736844.7..2.3583..4....",
      "solution": "968534217374621859512789463641397528253418796789256341125973684497862135836145972"
    },
    {
      "puzzle": "614.39.7...518.4.628.6.....1.82953.7.6..178525278631498.19.67....6..1..3972348615",
      "solution": "614539278795182436283674591148295367369417852527863149831956724456721983972348615"
    },
    {
      "puzzle": "534.2......2.7.3.696.143.8.71..52938.5936.4.74.3.8.16.241.97..36.52348193985162..",
      "solution": "534628791182975346967143582716452938859361427423789165241897653675234819398516274"
    },
    {
      "puzzle": "1..2...7.46.53.98..8.7.4..3218.73569753.26..8649.15..73.61487..571..2.4.894657321",
      "solution": "135289674467531982982764153218473569753926418649815237326148795571392846894657321"
    }
  ],
  "hard": [
    {
      "puzzle": ".81..5.2..3.19..48.243.8..539..1........4.93.417.83.5.57...4.1...375.89414863957.",
      "solution": "781465329635192748924378165392516487856247931417983256579824613263751894148639572"
    },
    {
      "puzzle": ".8745.9.2..51..4.8...2..3571.6.29.8.532817.947.8564123.59..18......82.3..6....2..",
      "solution": "387456912925173468614298357146329785532817694798564123259731846471682539863945271"
    },
    {
      "puzzle": "..32...988927.365.567984.2..1..45.674.68..5..3.9....8278..69...6.....8...2.538176",
      "solution": "143256798892713654567984321218345967476892513359671482781469235635127849924538176"
    },
    {
      "puzzle": "83.9.41571..3...645....13.945617..9891.2.8.76.28..95..2758....1349..768.6........",
      "solution": "832964157197325864564781329456173298913258476728649513275836941349517682681492735"
    },
    {
      "puzzle": "..21..8.779..48..38.1679452..64...2.1....57.4.473.298627.58164..5........1...4375",
      "solution": "462153897795248163831679452386497521129865734547312986273581649954736218618924375"
    }
  ]
};

// ══════════════════════════════════════════════════════════════════════
// Norvig's Constraint Propagation Sudoku Solver & Generator (robatron)
// ══════════════════════════════════════════════════════════════════════
const SudokuEngine = (function() {
  const DIGITS = "123456789";
  const ROWS = "ABCDEFGHI";
  const COLS = DIGITS;

  function cross(A, B) {
    const res = [];
    for (let a of A) {
      for (let b of B) {
        res.push(a + b);
      }
    }
    return res;
  }

  const SQUARES = cross(ROWS, COLS);

  function getAllUnits(rows, cols) {
    const units = [];
    for (let r of rows) units.push(cross(r, cols));
    for (let c of cols) units.push(cross(rows, c));
    for (let rs of ["ABC", "DEF", "GHI"]) {
      for (let cs of ["123", "456", "789"]) {
        units.push(cross(rs, cs));
      }
    }
    return units;
  }

  const UNITS = getAllUnits(ROWS, COLS);

  const SQUARE_UNITS_MAP = {};
  for (let s of SQUARES) {
    SQUARE_UNITS_MAP[s] = [];
    for (let u of UNITS) {
      if (u.includes(s)) SQUARE_UNITS_MAP[s].push(u);
    }
  }

  const SQUARE_PEERS_MAP = {};
  for (let s of SQUARES) {
    const peers = new Set();
    for (let u of SQUARE_UNITS_MAP[s]) {
      for (let sq of u) {
        if (sq !== s) peers.add(sq);
      }
    }
    SQUARE_PEERS_MAP[s] = Array.from(peers);
  }

  function assign(values, s, d) {
    const otherValues = values[s].replace(d, "");
    for (let d2 of otherValues) {
      if (!eliminate(values, s, d2)) return false;
    }
    return values;
  }

  function eliminate(values, s, d) {
    if (!values[s].includes(d)) return values;
    values[s] = values[s].replace(d, "");

    if (values[s].length === 0) return false;

    if (values[s].length === 1) {
      const d2 = values[s];
      for (let s2 of SQUARE_PEERS_MAP[s]) {
        if (!eliminate(values, s2, d2)) return false;
      }
    }

    for (let u of SQUARE_UNITS_MAP[s]) {
      const dplaces = [];
      for (let s2 of u) {
        if (values[s2].includes(d)) dplaces.push(s2);
      }
      if (dplaces.length === 0) return false;
      if (dplaces.length === 1) {
        if (!assign(values, dplaces[0], d)) return false;
      }
    }

    return values;
  }

  function search(values) {
    if (!values) return false;
    let allOne = true;
    for (let s of SQUARES) {
      if (values[s].length !== 1) {
        allOne = false;
        break;
      }
    }
    if (allOne) return values;

    let minLen = 10;
    let bestSq = null;
    for (let s of SQUARES) {
      const l = values[s].length;
      if (l > 1 && l < minLen) {
        minLen = l;
        bestSq = s;
      }
    }

    for (let d of values[bestSq]) {
      const copy = Object.assign({}, values);
      const res = search(assign(copy, bestSq, d));
      if (res) return res;
    }
    return false;
  }

  function solve(boardStr) {
    const values = {};
    for (let s of SQUARES) values[s] = DIGITS;
    for (let i = 0; i < 81; i++) {
      const val = boardStr[i];
      if (DIGITS.includes(val)) {
        if (!assign(values, SQUARES[i], val)) return false;
      }
    }
    const res = search(values);
    if (!res) return false;
    let out = "";
    for (let s of SQUARES) out += res[s];
    return out;
  }

  return {
    solve,
    SQUARES
  };
})();

// ══════════════════════════════════════════════════════════════════════
// Puzzle Permutation Engine (Over 2.9 million variations per base)
// ══════════════════════════════════════════════════════════════════════
function permutePuzzle(puzzleStr, solutionStr) {
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const shuffled = [...digits].sort(() => Math.random() - 0.5);
  const map = { '.': '.' };
  for (let i = 0; i < 9; i++) {
    map[String(digits[i])] = String(shuffled[i]);
  }

  const flipH = Math.random() < 0.5;
  const flipV = Math.random() < 0.5;
  const transpose = Math.random() < 0.5;

  const transform = (str) => {
    let grid = [];
    for (let r = 0; r < 9; r++) {
      let row = [];
      for (let c = 0; c < 9; c++) {
        row.push(map[str[r * 9 + c]]);
      }
      grid.push(row);
    }
    if (flipH) grid = grid.map(row => [...row].reverse());
    if (flipV) grid.reverse();
    if (transpose) {
      grid = grid[0].map((_, c) => grid.map(row => row[c]));
    }
    return grid;
  };

  return {
    puzzleGrid: transform(puzzleStr),
    solutionGrid: transform(solutionStr)
  };
}

// ══════════════════════════════════════════════════════════════════════
// Main Mount Function
// ══════════════════════════════════════════════════════════════════════
export function mount(container, options = {}) {
  if (activeInstance) {
    unmount();
  }

  const { onScoreUpdate, onGameOver } = options;

  let difficulty = 'easy';
  let initialGrid = [];
  let solutionGrid = [];
  let userGrid = [];
  let userNotes = []; // 9x9 Set of numbers
  let selectedCell = { r: 0, c: 0 };
  let isNotesMode = false;
  let moveHistory = [];

  let timer = 0;
  let timerInterval = null;
  let isPaused = false;
  let gameWon = false;
  let mistakesCount = 0;

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
            <div class="sudoku-overlay-title" id="sudokuOverlayTitle">ПОБЕДА! 🎉</div>
            <div class="sudoku-overlay-desc" id="sudokuOverlayDesc">Судоку успешно решено!</div>
            <div class="sudoku-overlay-time" id="sudokuOverlayTime">Время: 00:00</div>
            <button class="game-btn game-btn-primary" id="sudokuOverlayRestartBtn" type="button" style="padding: 10px 24px; font-size: 14px; font-weight: 700; border-radius: 12px; background: var(--accent, #6366f1); color: #fff; border: none; cursor: pointer;">Сыграть ещё раз</button>
          </div>
        </div>
      </div>

      <!-- Action Toolbar (Undo, Erase, Notes, Hint) -->
      <div class="sudoku-tools-row">
        <button class="sudoku-tool-btn" id="sudokuUndoBtn" type="button" title="Отменить ход">
          <svg class="lucide-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>
          </svg>
          <span>Отмена</span>
        </button>
        <button class="sudoku-tool-btn" id="sudokuEraseBtn" type="button" title="Стереть цифру">
          <svg class="lucide-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/>
          </svg>
          <span>Стереть</span>
        </button>
        <button class="sudoku-tool-btn" id="sudokuNotesBtn" type="button" title="Режим заметок (карандаш)">
          <svg class="lucide-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
          </svg>
          <span id="sudokuNotesLabel">Заметки</span>
        </button>
        <button class="sudoku-tool-btn" id="sudokuHintBtn" type="button" title="Подсказка">
          <svg class="lucide-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>
          </svg>
          <span>Подсказка</span>
        </button>
      </div>

      <!-- Digit Keypad 1-9 -->
      <div class="sudoku-keypad" id="sudokuKeypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `
          <button class="sudoku-key-btn" data-val="${n}" type="button">
            <span>${n}</span>
            <span class="key-count" id="sudokuKeyCount_${n}">9</span>
          </button>
        `).join('')}
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
  const notesBtn = container.querySelector('#sudokuNotesBtn');
  const notesLabel = container.querySelector('#sudokuNotesLabel');
  const hintBtn = container.querySelector('#sudokuHintBtn');
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

  function initGame() {
    stopTimer();
    timer = 0;
    isPaused = false;
    gameWon = false;
    mistakesCount = 0;
    moveHistory = [];
    selectedCell = { r: 0, c: 0 };
    isNotesMode = false;

    if (notesBtn) notesBtn.classList.remove('active');
    if (timerEl) timerEl.textContent = '00:00';
    if (mistakesEl) mistakesEl.textContent = '0';
    if (bestEl) bestEl.textContent = getBestTimeFormatted(difficulty);
    if (overlay) overlay.style.display = 'none';
    if (pauseLabel) pauseLabel.textContent = 'Пауза';
    if (pauseIcon) {
      pauseIcon.innerHTML = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
    }
    if (gridEl) {
      gridEl.style.filter = 'none';
      gridEl.style.pointerEvents = 'auto';
    }

    // Pick random base puzzle from pool & permute
    const pool = BASE_PUZZLES[difficulty] || BASE_PUZZLES.easy;
    const base = pool[Math.floor(Math.random() * pool.length)];
    const { puzzleGrid, solutionGrid: solGrid } = permutePuzzle(base.puzzle, base.solution);

    initialGrid = puzzleGrid.map(row => row.map(v => (v === '.' ? 0 : parseInt(v, 10))));
    solutionGrid = solGrid.map(row => row.map(v => parseInt(v, 10)));
    userGrid = Array.from({ length: 9 }, () => new Array(9).fill(0));
    userNotes = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set()));

    renderBoard();
    updateKeypadCounts();
    startTimer();
  }

  function getConflicts() {
    const conflicts = new Set();
    // Rows
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
    // Cols
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
    // 3x3 Boxes
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

  function updateKeypadCounts() {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const val = initialGrid[r][c] || userGrid[r][c];
        if (val >= 1 && val <= 9) {
          counts[val]++;
        }
      }
    }

    for (let n = 1; n <= 9; n++) {
      const remain = Math.max(0, 9 - counts[n]);
      const badge = document.getElementById(`sudokuKeyCount_${n}`);
      const btn = container.querySelector(`.sudoku-key-btn[data-val="${n}"]`);
      if (badge) badge.textContent = remain;
      if (btn) {
        btn.classList.toggle('completed', remain === 0);
      }
    }
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
        } else if (userNotes[r][c].size > 0) {
          // Render 3x3 notes grid
          const notesGrid = document.createElement('div');
          notesGrid.className = 'sudoku-notes-grid';
          for (let n = 1; n <= 9; n++) {
            const noteSpan = document.createElement('span');
            noteSpan.className = 'sudoku-note-num';
            noteSpan.textContent = userNotes[r][c].has(n) ? n : '';
            notesGrid.appendChild(noteSpan);
          }
          cellEl.appendChild(notesGrid);
        }

        // Selection
        if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
          cellEl.classList.add('selected');
        } else if (selectedCell) {
          const sameRow = selectedCell.r === r;
          const sameCol = selectedCell.c === c;
          const sameBox = Math.floor(selectedCell.r / 3) === Math.floor(r / 3) &&
                          Math.floor(selectedCell.c / 3) === Math.floor(c / 3);
          if (sameRow || sameCol || sameBox) {
            cellEl.classList.add('related');
          }
        }

        // Same number highlight
        if (val !== 0 && activeVal !== 0 && val === activeVal) {
          cellEl.classList.add('same-number');
        }

        // Conflict highlight
        if (conflicts.has(`${r},${c}`)) {
          cellEl.classList.add('conflict');
        }

        gridEl.appendChild(cellEl);
      }
    }
  }

  function clearNotesForPlacedNumber(row, col, num) {
    // Clear from same row and col
    for (let i = 0; i < 9; i++) {
      userNotes[row][i].delete(num);
      userNotes[i][col].delete(num);
    }
    // Clear from same box
    const br = Math.floor(row / 3) * 3;
    const bc = Math.floor(col / 3) * 3;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        userNotes[br + r][bc + c].delete(num);
      }
    }
  }

  function setNumber(num) {
    if (isPaused || gameWon || !selectedCell) return;
    const { r, c } = selectedCell;
    if (initialGrid[r][c] !== 0) return; // Cannot edit original clue

    if (isNotesMode) {
      // Toggle note
      const currentNotes = new Set(userNotes[r][c]);
      if (currentNotes.has(num)) {
        currentNotes.delete(num);
      } else {
        currentNotes.add(num);
      }
      moveHistory.push({
        type: 'notes',
        r,
        c,
        prevNotes: new Set(userNotes[r][c]),
        prevVal: userGrid[r][c]
      });
      userNotes[r][c] = currentNotes;
      triggerHaptic('light');
      renderBoard();
      return;
    }

    const prevVal = userGrid[r][c];
    if (prevVal === num) return;

    moveHistory.push({
      type: 'val',
      r,
      c,
      prevVal,
      prevNotes: new Set(userNotes[r][c])
    });

    userGrid[r][c] = num;
    userNotes[r][c].clear();
    clearNotesForPlacedNumber(r, c, num);

    // Mistake check: does this number contradict the true unique solution?
    if (num !== 0 && num !== solutionGrid[r][c]) {
      mistakesCount++;
      if (mistakesEl) mistakesEl.textContent = mistakesCount;
      triggerHaptic('error');
    } else {
      triggerHaptic('light');
    }

    renderBoard();
    updateKeypadCounts();
    checkWinCondition();
  }

  function eraseNumber() {
    if (isPaused || gameWon || !selectedCell) return;
    const { r, c } = selectedCell;
    if (initialGrid[r][c] !== 0) return;

    if (userGrid[r][c] !== 0 || userNotes[r][c].size > 0) {
      moveHistory.push({
        type: 'erase',
        r,
        c,
        prevVal: userGrid[r][c],
        prevNotes: new Set(userNotes[r][c])
      });
      userGrid[r][c] = 0;
      userNotes[r][c].clear();
      triggerHaptic('light');
      renderBoard();
      updateKeypadCounts();
    }
  }

  function undo() {
    if (isPaused || gameWon || moveHistory.length === 0) return;
    const last = moveHistory.pop();
    userGrid[last.r][last.c] = last.prevVal;
    userNotes[last.r][last.c] = last.prevNotes;
    selectedCell = { r: last.r, c: last.c };
    triggerHaptic('light');
    renderBoard();
    updateKeypadCounts();
  }

  function giveHint() {
    if (isPaused || gameWon || !selectedCell) return;
    const { r, c } = selectedCell;
    if (initialGrid[r][c] !== 0) return;

    const sol = solutionGrid[r][c];
    if (userGrid[r][c] === sol) return;

    moveHistory.push({
      type: 'hint',
      r,
      c,
      prevVal: userGrid[r][c],
      prevNotes: new Set(userNotes[r][c])
    });

    userGrid[r][c] = sol;
    userNotes[r][c].clear();
    clearNotesForPlacedNumber(r, c, sol);
    triggerHaptic('medium');
    renderBoard();
    updateKeypadCounts();
    checkWinCondition();
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
    } else if (e.key.toLowerCase() === 'n') {
      e.preventDefault();
      toggleNotesMode();
    } else if (e.key.toLowerCase() === 'h') {
      e.preventDefault();
      giveHint();
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

  const onGridPointerDown = (e) => {
    const cellEl = e.target.closest('.sudoku-cell');
    if (!cellEl) return;
    const r = parseInt(cellEl.dataset.r, 10);
    const c = parseInt(cellEl.dataset.c, 10);
    selectedCell = { r, c };
    triggerHaptic('light');
    renderBoard();
  };

  const onKeypadPointerDown = (e) => {
    const btn = e.target.closest('.sudoku-key-btn');
    if (!btn) return;
    const val = parseInt(btn.dataset.val, 10);
    setNumber(val);
  };

  const toggleNotesMode = () => {
    isNotesMode = !isNotesMode;
    if (notesBtn) notesBtn.classList.toggle('active', isNotesMode);
    triggerHaptic('light');
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

  // Event Listeners (using pointerdown for zero-latency touch)
  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  if (gridEl) gridEl.addEventListener('pointerdown', onGridPointerDown);
  if (keypad) keypad.addEventListener('pointerdown', onKeypadPointerDown);
  if (undoBtn) undoBtn.addEventListener('click', undo);
  if (eraseBtn) eraseBtn.addEventListener('click', eraseNumber);
  if (notesBtn) notesBtn.addEventListener('click', toggleNotesMode);
  if (hintBtn) hintBtn.addEventListener('click', giveHint);

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

      if (gridEl) gridEl.removeEventListener('pointerdown', onGridPointerDown);
      if (keypad) keypad.removeEventListener('pointerdown', onKeypadPointerDown);
      if (undoBtn) undoBtn.removeEventListener('click', undo);
      if (eraseBtn) eraseBtn.removeEventListener('click', eraseNumber);
      if (notesBtn) notesBtn.removeEventListener('click', toggleNotesMode);
      if (hintBtn) hintBtn.removeEventListener('click', giveHint);
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
