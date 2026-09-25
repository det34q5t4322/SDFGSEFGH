/**
 * Durak (Подкидной дурак, 36 карт) Card Game Module for College Schedule WebApp
 * Full classical Russian Podkidnoy Durak implementation with:
 * - 36-card deck (6..A), Fisher-Yates shuffle
 * - Accurate trump determination and lowest-trump first mover logic
 * - Strict move validation (table ranks matching, defender hand limit, max 6 cards)
 * - Intelligent AI with heuristics and difficulty levels (Лёгкий / Умный)
 * - Interactive targeting & playable card highlighting
 * - Full game state persistence (save/resume unfinished games via localStorage)
 * - 1vs1 online duel synchronization over WebSocket
 * - Smooth CSS transitions and mobile-first responsive viewport fit
 */

let activeInstance = null;

function createPRNG(seed) {
  let s = Math.abs(seed) || 123456789;
  return function() {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function mount(container, options = {}) {
  if (activeInstance) {
    unmount();
  }

  const { onScoreUpdate, onGameOver, isDuel, roundSeed, sendGameAction } = options;

  const SUITS = [
    { id: 'spades', name: 'Пики', symbol: '♠', color: '#0f172a', isRed: false },
    { id: 'clubs', name: 'Трефы', symbol: '♣', color: '#0f172a', isRed: false },
    { id: 'diamonds', name: 'Бубны', symbol: '♦', color: '#dc2626', isRed: true },
    { id: 'hearts', name: 'Червы', symbol: '♥', color: '#dc2626', isRed: true }
  ];

  const RANKS = [
    { id: '6', value: 6, label: '6' },
    { id: '7', value: 7, label: '7' },
    { id: '8', value: 8, label: '8' },
    { id: '9', value: 9, label: '9' },
    { id: '10', value: 10, label: '10' },
    { id: 'J', value: 11, label: 'В' },
    { id: 'Q', value: 12, label: 'Д' },
    { id: 'K', value: 13, label: 'К' },
    { id: 'A', value: 14, label: 'Т' }
  ];

  const random = roundSeed ? createPRNG(roundSeed) : Math.random;

  // Game state
  let deck = [];
  let trumpCard = null;
  let trumpSuit = null;
  let discardPile = [];
  let playerHand = [];
  let opponentHand = [];
  let table = []; // Array of { id, attack: card, defend: card | null }
  let attacker = 'player'; // 'player' | 'opponent'
  let defender = 'opponent'; // 'player' | 'opponent'
  let defenderHandAtRoundStart = 6;
  let isDefenderTaking = false;
  let gameOver = false;
  let selectedTargetPairId = null;
  let aiDifficulty = localStorage.getItem('durak_ai_difficulty') || 'smart'; // 'smart' | 'easy'
  let winsCount = parseInt(localStorage.getItem('game_durak_wins') || '0', 10);
  let statusMessage = 'Игра началась';
  let botThinkingTimer = null;

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

  function getSuitSvg(suitId) {
    if (suitId === 'hearts') {
      return `<svg class="card-suit-svg" viewBox="0 0 24 24" width="14" height="14" fill="#dc2626"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
    }
    if (suitId === 'diamonds') {
      return `<svg class="card-suit-svg" viewBox="0 0 24 24" width="14" height="14" fill="#dc2626"><path d="M12 2 4 12l8 10 8-10z"/></svg>`;
    }
    if (suitId === 'clubs') {
      return `<svg class="card-suit-svg" viewBox="0 0 24 24" width="14" height="14" fill="#0f172a"><circle cx="12" cy="7" r="4"/><circle cx="7" cy="14" r="4"/><circle cx="17" cy="14" r="4"/><path d="M11 14h2l2 8h-6z"/></svg>`;
    }
    return `<svg class="card-suit-svg" viewBox="0 0 24 24" width="14" height="14" fill="#0f172a"><path d="M12 2C9 7 4 10 4 14a6 6 0 0 0 10.5 4L12 22h-1a1 1 0 0 0 0 2h2a1 1 0 0 0 0-2h-1l-2.5-4A6 6 0 0 0 20 14c0-4-5-7-8-12z"/></svg>`;
  }

  function createDeck() {
    const d = [];
    let id = 1;
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        d.push({
          id: id++,
          suit: suit.id,
          suitName: suit.name,
          suitSymbol: suit.symbol,
          color: suit.color,
          isRed: suit.isRed,
          rank: rank.id,
          rankLabel: rank.label,
          value: rank.value
        });
      }
    }
    // Fisher-Yates shuffle
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  function renderCard(card, isFaceDown = false, isTrumpBottom = false) {
    if (!card) return '';
    if (isFaceDown) {
      return `
        <div class="durak-card card-back">
          <div class="card-back-pattern"></div>
        </div>
      `;
    }

    const isTrump = card.suit === trumpSuit;
    return `
      <div class="durak-card ${card.isRed ? 'card-red' : 'card-black'} ${isTrump ? 'is-trump' : ''} ${isTrumpBottom ? 'trump-bottom-card' : ''}" data-id="${card.id}">
        <div class="card-corner corner-top">
          <span class="card-rank" data-rank="${card.rankLabel}">${card.rankLabel}</span>
          ${getSuitSvg(card.suit)}
        </div>
        <div class="card-center">
          ${getSuitSvg(card.suit)}
        </div>
        <div class="card-corner corner-bottom">
          <span class="card-rank" data-rank="${card.rankLabel}">${card.rankLabel}</span>
          ${getSuitSvg(card.suit)}
        </div>
        ${isTrump ? `<span class="trump-badge" title="Козырь">★</span>` : ''}
      </div>
    `;
  }

  container.innerHTML = `
    <div class="durak-wrap ${isDuel ? 'is-duel' : ''}" id="durakWrap">
      ${!isDuel ? `
      <div class="game-hud">
        <div class="game-hud-scores">
          <div class="game-hud-box">
            <span class="game-hud-label">ПОБЕД</span>
            <span class="game-hud-value" id="durakWins">${winsCount}</span>
          </div>
          <div class="game-hud-box">
            <span class="game-hud-label">КОЗЫРЬ</span>
            <span class="game-hud-value" id="durakTrumpSuit">—</span>
          </div>
          <div class="game-hud-box">
            <span class="game-hud-label">КОЛОДА</span>
            <span class="game-hud-value" id="durakDeckRemain">36</span>
          </div>
        </div>

        <div class="game-hud-controls">
          <button class="game-btn game-btn-secondary" id="durakDiffBtn" type="button" title="Сложность бота">
            <span id="durakDiffLabel">${aiDifficulty === 'smart' ? 'Умный ИИ' : 'Лёгкий ИИ'}</span>
          </button>
          <button class="game-btn game-btn-icon" id="durakRestartBtn" type="button" title="Новая игра">
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
      ` : ''}

      <!-- Status banner -->
      <div class="durak-status-bar" id="durakStatusBar">
        <div class="durak-status-dot" id="durakStatusDot"></div>
        <span id="durakStatusText">${statusMessage}</span>
      </div>

      <!-- Card Table Field -->
      <div class="durak-table-field" id="durakTableField">
        <!-- Opponent Hand -->
        <div class="durak-opponent-row" id="durakOpponentRow">
          <div class="durak-player-badge">
            <div class="durak-badge-avatar">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/>
              </svg>
            </div>
            <span id="durakOpponentName">${isDuel ? 'Соперник' : 'Бот'}</span>
            <span class="durak-hand-count" id="durakOpponentCount">6</span>
          </div>
          <div class="durak-hand-cards opponent-hand" id="durakOpponentCards"></div>
        </div>

        <!-- Middle Arena: Deck + Trump Card + Battle Table -->
        <div class="durak-arena">
          <!-- Deck stack & Trump on the side -->
          <div class="durak-deck-area">
            <div class="durak-deck-stack" id="durakDeckStack">
              <div class="durak-trump-slot" id="durakTrumpSlot"></div>
              <div class="durak-deck-pile" id="durakDeckPile">
                <div class="card-back durak-deck-cover"></div>
              </div>
              <span class="durak-deck-badge" id="durakDeckCountBadge" title="Карт в колоде">36</span>
            </div>
            <div class="durak-discard-slot" id="durakDiscardSlot">
              <div class="durak-discard-box">
                <span class="discard-label">Бито</span>
                <span class="discard-count" id="durakDiscardCount">0</span>
              </div>
            </div>
          </div>

          <!-- Combat Table: Up to 6 battle pairs -->
          <div class="durak-combat-table" id="durakCombatTable"></div>
        </div>

        <!-- Action Controls (Бито / Беру) -->
        <div class="durak-actions-bar" id="durakActionsBar">
          <button class="durak-action-btn btn-bito" id="durakBitoBtn" type="button" style="display:none;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>Бито</span>
          </button>
          <button class="durak-action-btn btn-take" id="durakTakeBtn" type="button" style="display:none;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>
            </svg>
            <span>Беру</span>
          </button>
        </div>

        <!-- Player Hand -->
        <div class="durak-player-row" id="durakPlayerRow">
          <div class="durak-hand-cards player-hand" id="durakPlayerCards"></div>
        </div>
      </div>

      <!-- Overlay for win/lose -->
      <div class="durak-overlay" id="durakOverlay" style="display:none;">
        <div class="durak-overlay-card">
          <div class="durak-overlay-title" id="durakOverlayTitle">ПОБЕДА!</div>
          <div class="durak-overlay-desc" id="durakOverlayDesc">Соперник остался в дураках!</div>
          <button class="durak-action-btn btn-bito" id="durakOverlayRestartBtn" type="button" style="margin-top: 10px; width: 100%;">Сыграть снова</button>
        </div>
      </div>
    </div>
  `;

  const statusTextEl = container.querySelector('#durakStatusText');
  const statusDotEl = container.querySelector('#durakStatusDot');
  const winsEl = container.querySelector('#durakWins');
  const trumpSuitEl = container.querySelector('#durakTrumpSuit');
  const deckRemainEl = container.querySelector('#durakDeckRemain');
  const opponentCardsEl = container.querySelector('#durakOpponentCards');
  const opponentCountEl = container.querySelector('#durakOpponentCount');
  const trumpSlotEl = container.querySelector('#durakTrumpSlot');
  const deckPileEl = container.querySelector('#durakDeckPile');
  const deckCountBadge = container.querySelector('#durakDeckCountBadge');
  const discardCountEl = container.querySelector('#durakDiscardCount');
  const combatTableEl = container.querySelector('#durakCombatTable');
  const playerCardsEl = container.querySelector('#durakPlayerCards');
  const bitoBtn = container.querySelector('#durakBitoBtn');
  const takeBtn = container.querySelector('#durakTakeBtn');
  const diffBtn = container.querySelector('#durakDiffBtn');
  const diffLabel = container.querySelector('#durakDiffLabel');
  const overlay = container.querySelector('#durakOverlay');
  const overlayTitle = container.querySelector('#durakOverlayTitle');
  const overlayDesc = container.querySelector('#durakOverlayDesc');
  const overlayRestartBtn = container.querySelector('#durakOverlayRestartBtn');
  const restartBtn = container.querySelector('#durakRestartBtn');

  function setStatus(msg, isAlert = false) {
    statusMessage = msg;
    if (statusTextEl) statusTextEl.textContent = msg;
    if (statusDotEl) {
      statusDotEl.style.background = isAlert ? '#f43f5e' : (attacker === 'player' ? '#10b981' : '#f59e0b');
    }
  }

  function saveGameState() {
    if (isDuel || gameOver) return;
    try {
      const state = {
        deck,
        trumpCard,
        trumpSuit,
        discardPile,
        playerHand,
        opponentHand,
        table,
        attacker,
        defender,
        defenderHandAtRoundStart,
        isDefenderTaking,
        statusMessage,
        aiDifficulty
      };
      localStorage.setItem('college_durak_saved_state', JSON.stringify(state));
    } catch (_) {}
  }

  function clearGameState() {
    if (!isDuel) {
      try {
        localStorage.removeItem('college_durak_saved_state');
      } catch (_) {}
    }
  }

  function loadSavedGameState() {
    if (isDuel) return false;
    try {
      const raw = localStorage.getItem('college_durak_saved_state');
      if (!raw) return false;
      const state = JSON.parse(raw);
      if (!state.playerHand || !state.opponentHand || !state.trumpCard) return false;

      deck = state.deck || [];
      trumpCard = state.trumpCard;
      trumpSuit = state.trumpSuit;
      discardPile = state.discardPile || [];
      playerHand = state.playerHand || [];
      opponentHand = state.opponentHand || [];
      table = state.table || [];
      attacker = state.attacker || 'player';
      defender = state.defender || 'opponent';
      defenderHandAtRoundStart = state.defenderHandAtRoundStart || 6;
      isDefenderTaking = Boolean(state.isDefenderTaking);
      statusMessage = state.statusMessage || 'Партия продолжена';
      aiDifficulty = state.aiDifficulty || 'smart';

      sortHand(playerHand);
      sortHand(opponentHand);
      setStatus(statusMessage);
      render();

      if (attacker === 'opponent' && table.length === 0) {
        scheduleBotAction();
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function initGame(forceFresh = false) {
    if (botThinkingTimer) {
      clearTimeout(botThinkingTimer);
      botThinkingTimer = null;
    }

    if (!forceFresh && !isDuel && loadSavedGameState()) {
      return;
    }

    clearGameState();
    gameOver = false;
    table = [];
    discardPile = [];
    playerHand = [];
    opponentHand = [];
    isDefenderTaking = false;
    selectedTargetPairId = null;
    if (overlay) overlay.style.display = 'none';

    deck = createDeck();

    // Deal 6 cards to each player
    for (let i = 0; i < 6; i++) {
      if (deck.length > 0) playerHand.push(deck.pop());
      if (deck.length > 0) opponentHand.push(deck.pop());
    }

    // Trump card is placed face up at bottom of deck (deck[0])
    trumpCard = deck.length > 0 ? deck[0] : playerHand[0];
    trumpSuit = trumpCard.suit;

    // Determine who starts: player with lowest trump in hand
    let playerMinTrumpCard = null;
    let opponentMinTrumpCard = null;

    playerHand.forEach(c => {
      if (c.suit === trumpSuit) {
        if (!playerMinTrumpCard || c.value < playerMinTrumpCard.value) playerMinTrumpCard = c;
      }
    });
    opponentHand.forEach(c => {
      if (c.suit === trumpSuit) {
        if (!opponentMinTrumpCard || c.value < opponentMinTrumpCard.value) opponentMinTrumpCard = c;
      }
    });

    if (playerMinTrumpCard && opponentMinTrumpCard) {
      if (playerMinTrumpCard.value < opponentMinTrumpCard.value) {
        attacker = 'player';
        defender = 'opponent';
        setStatus(`Ваш младший козырь (${playerMinTrumpCard.rankLabel}${playerMinTrumpCard.suitSymbol})! Ваш ход (Атака)`);
      } else {
        attacker = 'opponent';
        defender = 'player';
        setStatus(`Младший козырь у соперника (${opponentMinTrumpCard.rankLabel}${opponentMinTrumpCard.suitSymbol})! Ход соперника...`);
      }
    } else if (playerMinTrumpCard) {
      attacker = 'player';
      defender = 'opponent';
      setStatus(`Единственный козырь у вас (${playerMinTrumpCard.rankLabel}${playerMinTrumpCard.suitSymbol})! Ваш ход (Атака)`);
    } else if (opponentMinTrumpCard) {
      attacker = 'opponent';
      defender = 'player';
      setStatus(`Козырь только у соперника (${opponentMinTrumpCard.rankLabel}${opponentMinTrumpCard.suitSymbol})! Ход соперника...`);
    } else {
      // Neither has trumps: fair coin toss / random choice with explicit UI notice
      const coin = random() < 0.5;
      attacker = coin ? 'player' : 'opponent';
      defender = coin ? 'opponent' : 'player';
      setStatus(`Козырей на руках нет! Жребий: ${coin ? 'Ваш ход (Атака)' : 'Ход соперника...'}`);
    }

    defenderHandAtRoundStart = defender === 'player' ? playerHand.length : opponentHand.length;

    sortHand(playerHand);
    sortHand(opponentHand);

    render();
    saveGameState();

    if (attacker === 'opponent' && !isDuel) {
      scheduleBotAction();
    }
  }

  function sortHand(hand) {
    hand.sort((a, b) => {
      const aIsTrump = a.suit === trumpSuit;
      const bIsTrump = b.suit === trumpSuit;
      if (aIsTrump && !bIsTrump) return 1;
      if (!aIsTrump && bIsTrump) return -1;
      if (a.suit === b.suit) return a.value - b.value;
      return a.suit.localeCompare(b.suit);
    });
  }

  function canBeat(attackCard, defendCard) {
    if (!attackCard || !defendCard) return false;
    const attackIsTrump = attackCard.suit === trumpSuit;
    const defendIsTrump = defendCard.suit === trumpSuit;

    if (attackIsTrump) {
      return defendIsTrump && defendCard.value > attackCard.value;
    }
    if (defendIsTrump) return true;
    return defendCard.suit === attackCard.suit && defendCard.value > attackCard.value;
  }

  function getTableRanks() {
    const ranks = new Set();
    table.forEach(pair => {
      if (pair.attack) ranks.add(pair.attack.rank);
      if (pair.defend) ranks.add(pair.defend.rank);
    });
    return ranks;
  }

  function getAvailableDefenderSlots() {
    const defenderCount = defender === 'player' ? playerHand.length : opponentHand.length;
    const maxAllowed = Math.min(6, defenderHandAtRoundStart);
    const tableSlotsLeft = maxAllowed - table.length;
    const undefendedCount = table.filter(p => !p.defend).length;
    const handsSlotsLeft = defenderCount - undefendedCount;
    return Math.min(tableSlotsLeft, handsSlotsLeft);
  }

  function canPlayAttackCard(card) {
    if (attacker !== 'player' || gameOver) return false;
    if (getAvailableDefenderSlots() <= 0) return false;

    if (table.length === 0) return true;
    const ranks = getTableRanks();
    return ranks.has(card.rank);
  }

  function canPlayDefendCard(card) {
    if (defender !== 'player' || gameOver || isDefenderTaking) return false;
    if (table.length === 0) return false;

    if (selectedTargetPairId) {
      const targetPair = table.find(p => p.id === selectedTargetPairId);
      if (targetPair && !targetPair.defend) {
        return canBeat(targetPair.attack, card);
      }
    }

    // Any undefended card on table
    return table.some(p => !p.defend && canBeat(p.attack, card));
  }

  function onPlayerCardClick(cardIndex) {
    if (gameOver) return;
    const card = playerHand[cardIndex];
    if (!card) return;

    if (attacker === 'player') {
      if (!canPlayAttackCard(card)) {
        triggerHaptic('error');
        return;
      }

      // Record initial defender cards count if this is the 1st card of this attack round
      if (table.length === 0) {
        defenderHandAtRoundStart = defender === 'player' ? playerHand.length : opponentHand.length;
      }

      // Play attacking card
      playerHand.splice(cardIndex, 1);
      const pairId = Date.now() + Math.random();
      table.push({ id: pairId, attack: card, defend: null });
      triggerHaptic('medium');

      if (isDuel && typeof sendGameAction === 'function') {
        sendGameAction('attack', { card });
      }

      saveGameState();
      render();

      if (!isDuel) {
        scheduleBotAction();
      }
    } else if (defender === 'player') {
      if (!canPlayDefendCard(card)) {
        triggerHaptic('error');
        return;
      }

      let targetPair = null;
      if (selectedTargetPairId) {
        targetPair = table.find(p => p.id === selectedTargetPairId && !p.defend && canBeat(p.attack, card));
      }
      if (!targetPair) {
        targetPair = table.find(p => !p.defend && canBeat(p.attack, card));
      }

      if (targetPair) {
        playerHand.splice(cardIndex, 1);
        targetPair.defend = card;
        selectedTargetPairId = null;
        triggerHaptic('medium');

        if (isDuel && typeof sendGameAction === 'function') {
          sendGameAction('defend', { attackId: targetPair.id, card });
        }

        saveGameState();
        render();

        if (!isDuel) {
          scheduleBotAction();
        }
      }
    }
  }

  function onTablePairClick(pairId) {
    if (defender !== 'player' || isDefenderTaking || gameOver) return;
    const pair = table.find(p => p.id === pairId);
    if (!pair || pair.defend) return;

    if (selectedTargetPairId === pairId) {
      selectedTargetPairId = null;
    } else {
      selectedTargetPairId = pairId;
    }
    render();
  }

  function onBitoClick() {
    if (gameOver) return;
    if (attacker !== 'player' && !isDefenderTaking) return;
    if (table.length === 0) return;

    const undefended = table.find(p => !p.defend);
    if (undefended && !isDefenderTaking) return;

    if (isDefenderTaking) {
      // Attacker is done tossing cards: defender takes everything
      executeDefenderTakesAll('opponent');
      if (isDuel && typeof sendGameAction === 'function') {
        sendGameAction('pass_take', {});
      }
      return;
    }

    executeBito();

    if (isDuel && typeof sendGameAction === 'function') {
      sendGameAction('bito', {});
    }
  }

  function executeBito() {
    table.forEach(p => {
      if (p.attack) discardPile.push(p.attack);
      if (p.defend) discardPile.push(p.defend);
    });
    table = [];
    isDefenderTaking = false;
    selectedTargetPairId = null;

    // Draw cards up to 6: attacker first, then defender
    replenishHands();

    // Swap roles on clean bito
    const prevAttacker = attacker;
    attacker = defender;
    defender = prevAttacker;
    defenderHandAtRoundStart = defender === 'player' ? playerHand.length : opponentHand.length;

    setStatus(attacker === 'player' ? 'Бито! Ваш ход (Атака)' : 'Бито! Ход соперника...');
    triggerHaptic('light');

    if (checkGameOver()) return;
    saveGameState();
    render();

    if (attacker === 'opponent' && !isDuel) {
      scheduleBotAction();
    }
  }

  function onTakeClick() {
    if (gameOver || defender !== 'player') return;
    if (table.length === 0 || isDefenderTaking) return;

    isDefenderTaking = true;
    selectedTargetPairId = null;
    setStatus('Вы берете карты. Соперник может подкинуть...');
    triggerHaptic('medium');

    if (isDuel && typeof sendGameAction === 'function') {
      sendGameAction('take', {});
    }

    saveGameState();
    render();

    if (!isDuel) {
      scheduleBotAction();
    }
  }

  function executeDefenderTakesAll(takingPlayer) {
    table.forEach(p => {
      if (p.attack) {
        if (takingPlayer === 'player') playerHand.push(p.attack);
        else opponentHand.push(p.attack);
      }
      if (p.defend) {
        if (takingPlayer === 'player') playerHand.push(p.defend);
        else opponentHand.push(p.defend);
      }
    });

    table = [];
    isDefenderTaking = false;
    selectedTargetPairId = null;

    // Non-taking player draws up to 6 cards (taking player does NOT draw)
    if (takingPlayer === 'opponent') {
      while (playerHand.length < 6 && deck.length > 0) {
        playerHand.push(deck.pop());
      }
      attacker = 'player';
      defender = 'opponent';
      setStatus('Соперник забрал карты! Ваш ход снова.');
    } else {
      while (opponentHand.length < 6 && deck.length > 0) {
        opponentHand.push(deck.pop());
      }
      attacker = 'opponent';
      defender = 'player';
      setStatus('Вы забрали карты. Ход соперника...');
    }

    defenderHandAtRoundStart = defender === 'player' ? playerHand.length : opponentHand.length;

    sortHand(playerHand);
    sortHand(opponentHand);

    triggerHaptic('light');
    if (checkGameOver()) return;
    saveGameState();
    render();

    if (attacker === 'opponent' && !isDuel) {
      scheduleBotAction();
    }
  }

  function replenishHands() {
    // Order: attacker draws first, defender draws second
    // Bottom card of deck (deck[0]) is the trump card and drawn last
    const firstDraw = attacker === 'player' ? playerHand : opponentHand;
    const secondDraw = attacker === 'player' ? opponentHand : playerHand;

    while (firstDraw.length < 6 && deck.length > 0) {
      firstDraw.push(deck.pop());
    }
    while (secondDraw.length < 6 && deck.length > 0) {
      secondDraw.push(deck.pop());
    }

    sortHand(playerHand);
    sortHand(opponentHand);
  }

  function checkGameOver() {
    if (deck.length > 0) return false;

    const playerEmpty = playerHand.length === 0;
    const opponentEmpty = opponentHand.length === 0;

    if (playerEmpty && opponentEmpty) {
      // Draw!
      gameOver = true;
      clearGameState();
      showOverlay('НИЧЬЯ!', 'Оба игрока избавились от карт одновременно! Никто не остался в дураках.');
      if (typeof onGameOver === 'function') onGameOver(100, true);
      return true;
    }

    if (playerEmpty) {
      // Player won!
      gameOver = true;
      clearGameState();
      winsCount++;
      localStorage.setItem('game_durak_wins', String(winsCount));
      if (winsEl) winsEl.textContent = winsCount;
      showOverlay('ПОБЕДА! 🏆', 'Вы сбросили все карты! Соперник остался в дураках.');
      triggerHaptic('success');
      if (typeof onScoreUpdate === 'function') onScoreUpdate(winsCount, winsCount);
      if (typeof onGameOver === 'function') onGameOver(winsCount * 150, true);
      return true;
    }

    if (opponentEmpty) {
      // Opponent won!
      gameOver = true;
      clearGameState();
      showOverlay('ВЫ В ДУРАКАХ!', 'Соперник вышел из игры первым.');
      triggerHaptic('error');
      if (typeof onGameOver === 'function') onGameOver(0, false);
      return true;
    }

    return false;
  }

  function showOverlay(title, desc) {
    if (overlayTitle) overlayTitle.textContent = title;
    if (overlayDesc) overlayDesc.textContent = desc;
    if (overlay) overlay.style.display = 'flex';
  }

  // ── BOT AI LOGIC (Singleplayer) ───────────────────────────
  function scheduleBotAction() {
    if (gameOver || isDuel) return;
    if (botThinkingTimer) clearTimeout(botThinkingTimer);

    // Human-like response delay: 500-750ms
    const delay = 500 + Math.floor(random() * 250);
    botThinkingTimer = setTimeout(() => {
      executeBotTurn();
    }, delay);
  }

  function executeBotTurn() {
    if (gameOver || isDuel) return;

    if (attacker === 'opponent') {
      // Bot is attacking
      const slotsLeft = getAvailableDefenderSlots();

      if (isDefenderTaking) {
        // Player is taking: bot can toss in matching non-trump cards
        if (slotsLeft > 0) {
          const ranks = getTableRanks();
          const tossable = opponentHand.filter(c => ranks.has(c.rank) && c.suit !== trumpSuit);
          if (tossable.length > 0) {
            // Sort to throw lowest first
            tossable.sort((a, b) => a.value - b.value);
            const card = tossable[0];
            const idx = opponentHand.indexOf(card);
            opponentHand.splice(idx, 1);
            table.push({ id: Date.now() + Math.random(), attack: card, defend: null });
            setStatus(`Бот подкинул ${card.rankLabel}${card.suitSymbol}`);
            saveGameState();
            render();
            scheduleBotAction();
            return;
          }
        }
        // Bot is done tossing cards: finish take
        executeDefenderTakesAll('player');
        return;
      }

      if (table.length === 0) {
        // First attack: lowest non-trump card
        defenderHandAtRoundStart = playerHand.length;
        const nonTrumps = opponentHand.filter(c => c.suit !== trumpSuit);
        nonTrumps.sort((a, b) => a.value - b.value);

        let bestCard = null;
        if (nonTrumps.length > 0) {
          // If smart AI has a pair of lowest rank, prefer that rank
          bestCard = nonTrumps[0];
        } else {
          // Only trumps left
          opponentHand.sort((a, b) => a.value - b.value);
          bestCard = opponentHand[0];
        }

        const idx = opponentHand.indexOf(bestCard);
        opponentHand.splice(idx, 1);
        table.push({ id: Date.now() + Math.random(), attack: bestCard, defend: null });
        setStatus(`Бот ходит: ${bestCard.rankLabel}${bestCard.suitSymbol}`);
        saveGameState();
        render();
        return;
      }

      // Check if all current table cards are defended
      const undefended = table.find(p => !p.defend);
      if (!undefended) {
        // All defended. Can bot toss another card?
        if (slotsLeft > 0) {
          const ranks = getTableRanks();
          // In easy mode, 30% chance bot calls bito early
          if (aiDifficulty === 'easy' && random() < 0.3) {
            executeBito();
            return;
          }

          const tossable = opponentHand.filter(c => ranks.has(c.rank) && c.suit !== trumpSuit);
          tossable.sort((a, b) => a.value - b.value);

          if (tossable.length > 0) {
            const card = tossable[0];
            const idx = opponentHand.indexOf(card);
            opponentHand.splice(idx, 1);
            table.push({ id: Date.now() + Math.random(), attack: card, defend: null });
            setStatus(`Бот подкинул ${card.rankLabel}${card.suitSymbol}`);
            saveGameState();
            render();
            return;
          }
        }
        // No toss: Bot calls Bito!
        executeBito();
        return;
      }
    } else if (defender === 'opponent') {
      // Bot is defending against player attack
      const targetPair = table.find(p => !p.defend);
      if (!targetPair) return;

      // Find valid defending cards in bot's hand
      const valid = opponentHand.filter(c => canBeat(targetPair.attack, c));
      if (valid.length === 0) {
        // Bot cannot beat: takes cards!
        isDefenderTaking = true;
        setStatus('Бот не может отбиться и берет карты!');
        saveGameState();
        render();
        return;
      }

      // Heuristic defense selection:
      // Separate non-trump and trump beaters
      const nonTrumps = valid.filter(c => c.suit !== trumpSuit);
      nonTrumps.sort((a, b) => a.value - b.value);

      const trumps = valid.filter(c => c.suit === trumpSuit);
      trumps.sort((a, b) => a.value - b.value);

      let chosen = null;

      if (nonTrumps.length > 0) {
        // Always prefer the lowest non-trump
        chosen = nonTrumps[0];
      } else {
        // Only trumps can beat
        // In smart mode: evaluate if it's worth burning a trump
        // If attack card is small (<= 9), deck has cards (> 8), and bot has <= 2 trumps, taking may be smarter
        const shouldTakeInstead = aiDifficulty === 'smart' &&
          deck.length > 8 &&
          targetPair.attack.value <= 9 &&
          trumps[0].value >= 11 &&
          table.length >= 2;

        if (shouldTakeInstead) {
          isDefenderTaking = true;
          setStatus('Бот решает взять карты, экономя козыри!');
          saveGameState();
          render();
          return;
        }

        // Use lowest trump
        chosen = trumps[0];
      }

      // Defend!
      const idx = opponentHand.indexOf(chosen);
      opponentHand.splice(idx, 1);
      targetPair.defend = chosen;
      setStatus(`Бот отбился ${chosen.rankLabel}${chosen.suitSymbol}`);
      saveGameState();
      render();
    }
  }

  // ── RENDER FUNCTION ───────────────────────────────────────
  function render() {
    if (trumpSuitEl && trumpCard) {
      trumpSuitEl.innerHTML = `${getSuitSvg(trumpSuit)} ${trumpCard.suitName}`;
    }
    if (deckRemainEl) {
      deckRemainEl.textContent = deck.length;
    }
    if (deckCountBadge) {
      deckCountBadge.textContent = deck.length;
      deckCountBadge.style.display = deck.length > 0 ? 'inline-flex' : 'none';
    }
    if (discardCountEl) {
      discardCountEl.textContent = discardPile.length;
    }
    if (opponentCountEl) {
      opponentCountEl.textContent = opponentHand.length;
    }

    // Render Trump Card Slot (bottom card of deck rotated)
    if (trumpSlotEl) {
      if (deck.length > 0 && trumpCard) {
        trumpSlotEl.innerHTML = renderCard(trumpCard, false, true);
      } else if (trumpCard) {
        // Deck exhausted, show trump suit ghost icon
        trumpSlotEl.innerHTML = `
          <div class="trump-ghost-slot" title="Козырь: ${trumpCard.suitName}">
            ${getSuitSvg(trumpSuit)}
          </div>
        `;
      }
    }

    if (deckPileEl) {
      deckPileEl.style.display = deck.length > 1 ? 'block' : 'none';
    }

    // Opponent cards (face down)
    if (opponentCardsEl) {
      opponentCardsEl.innerHTML = opponentHand.map(() => renderCard(null, true)).join('');
    }

    // Table Combat Pairs
    if (combatTableEl) {
      combatTableEl.innerHTML = table.map(pair => {
        const isSelected = selectedTargetPairId === pair.id;
        return `
          <div class="durak-combat-pair ${isSelected ? 'is-selected' : ''}" data-pair-id="${pair.id}">
            <div class="card-attack-slot">
              ${renderCard(pair.attack)}
            </div>
            <div class="card-defend-slot ${pair.defend ? 'has-card' : 'empty'}">
              ${pair.defend ? renderCard(pair.defend) : '<div class="defend-placeholder"></div>'}
            </div>
          </div>
        `;
      }).join('');

      combatTableEl.querySelectorAll('.durak-combat-pair').forEach(el => {
        el.addEventListener('click', () => {
          const pairId = parseFloat(el.dataset.pairId);
          onTablePairClick(pairId);
        });
      });
    }

    // Player Hand Cards
    if (playerCardsEl) {
      playerCardsEl.innerHTML = playerHand.map((card, idx) => {
        const isPlayable = attacker === 'player' ? canPlayAttackCard(card) : canPlayDefendCard(card);
        return `
          <div class="player-card-wrapper ${isPlayable ? 'is-playable' : 'not-playable'}" data-index="${idx}">
            ${renderCard(card)}
          </div>
        `;
      }).join('');

      // Attach click listeners to player cards
      playerCardsEl.querySelectorAll('.player-card-wrapper').forEach(wrap => {
        wrap.addEventListener('click', () => {
          const idx = parseInt(wrap.dataset.index, 10);
          onPlayerCardClick(idx);
        });
      });
    }

    // Action buttons display
    if (bitoBtn && takeBtn) {
      if (gameOver) {
        bitoBtn.style.display = 'none';
        takeBtn.style.display = 'none';
      } else if (attacker === 'player') {
        takeBtn.style.display = 'none';
        const allDefended = table.length > 0 && table.every(p => Boolean(p.defend));
        bitoBtn.style.display = (allDefended || isDefenderTaking) ? 'inline-flex' : 'none';
        if (isDefenderTaking) {
          bitoBtn.querySelector('span').textContent = 'Отдать карты';
        } else {
          bitoBtn.querySelector('span').textContent = 'Бито';
        }
      } else if (defender === 'player') {
        bitoBtn.style.display = 'none';
        takeBtn.style.display = (!isDefenderTaking && table.length > 0) ? 'inline-flex' : 'none';
      }
    }
  }

  function toggleAiDifficulty() {
    aiDifficulty = aiDifficulty === 'smart' ? 'easy' : 'smart';
    localStorage.setItem('durak_ai_difficulty', aiDifficulty);
    if (diffLabel) {
      diffLabel.textContent = aiDifficulty === 'smart' ? 'Умный ИИ' : 'Лёгкий ИИ';
    }
    triggerHaptic('light');
  }

  if (diffBtn) diffBtn.addEventListener('click', toggleAiDifficulty);
  if (bitoBtn) bitoBtn.addEventListener('click', onBitoClick);
  if (takeBtn) takeBtn.addEventListener('click', onTakeClick);
  if (restartBtn) restartBtn.addEventListener('click', () => initGame(true));
  if (overlayRestartBtn) overlayRestartBtn.addEventListener('click', () => initGame(true));

  initGame(false);

  activeInstance = {
    unmount: () => {
      if (botThinkingTimer) {
        clearTimeout(botThinkingTimer);
        botThinkingTimer = null;
      }
      if (diffBtn) diffBtn.removeEventListener('click', toggleAiDifficulty);
      if (bitoBtn) bitoBtn.removeEventListener('click', onBitoClick);
      if (takeBtn) takeBtn.removeEventListener('click', onTakeClick);
      if (restartBtn) restartBtn.removeEventListener('click', () => initGame(true));
      if (overlayRestartBtn) overlayRestartBtn.removeEventListener('click', () => initGame(true));

      container.innerHTML = '';
      activeInstance = null;
    },
    handleOpponentAction: (action, payload) => {
      if (action === 'attack') {
        const { card } = payload;
        const oppCardIdx = opponentHand.findIndex(c => c.suit === card.suit && c.value === card.value);
        if (oppCardIdx !== -1) opponentHand.splice(oppCardIdx, 1);
        else if (opponentHand.length > 0) opponentHand.pop();

        if (table.length === 0) {
          defenderHandAtRoundStart = playerHand.length;
        }

        table.push({ id: Date.now() + Math.random(), attack: card, defend: null });
        setStatus('Соперник атаковал. Защищайтесь!', true);
        triggerHaptic('medium');
        render();
      } else if (action === 'defend') {
        const { card } = payload;
        const targetPair = table.find(p => !p.defend);
        if (targetPair) {
          const oppCardIdx = opponentHand.findIndex(c => c.suit === card.suit && c.value === card.value);
          if (oppCardIdx !== -1) opponentHand.splice(oppCardIdx, 1);
          else if (opponentHand.length > 0) opponentHand.pop();

          targetPair.defend = card;
          setStatus('Соперник отбился');
          triggerHaptic('medium');
          render();
        }
      } else if (action === 'take') {
        isDefenderTaking = true;
        setStatus('Соперник берет карты! Подкиньте ещё или отдайте.');
        triggerHaptic('light');
        render();
      } else if (action === 'pass_take') {
        executeDefenderTakesAll('player');
      } else if (action === 'bito') {
        executeBito();
      }
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
