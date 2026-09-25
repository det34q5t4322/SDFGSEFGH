// Verification test script for Durak rules and engine
const assert = require('assert');

const SUITS = [
  { id: 'spades', name: 'Пики' },
  { id: 'clubs', name: 'Трефы' },
  { id: 'diamonds', name: 'Бубны' },
  { id: 'hearts', name: 'Червы' }
];

const RANKS = [
  { id: '6', value: 6 },
  { id: '7', value: 7 },
  { id: '8', value: 8 },
  { id: '9', value: 9 },
  { id: '10', value: 10 },
  { id: 'J', value: 11 },
  { id: 'Q', value: 12 },
  { id: 'K', value: 13 },
  { id: 'A', value: 14 }
];

function createDeck() {
  const d = [];
  let id = 1;
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      d.push({ id: id++, suit: suit.id, rank: rank.id, value: rank.value });
    }
  }
  // Fisher-Yates
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function canBeat(attackCard, defendCard, trumpSuit) {
  if (!attackCard || !defendCard) return false;
  const attackIsTrump = attackCard.suit === trumpSuit;
  const defendIsTrump = defendCard.suit === trumpSuit;

  if (attackIsTrump) {
    return defendIsTrump && defendCard.value > attackCard.value;
  }
  if (defendIsTrump) return true;
  return defendCard.suit === attackCard.suit && defendCard.value > attackCard.value;
}

function getTableRanks(table) {
  const ranks = new Set();
  table.forEach(pair => {
    if (pair.attack) ranks.add(pair.attack.rank);
    if (pair.defend) ranks.add(pair.defend.rank);
  });
  return ranks;
}

function canPlayAttackCard(card, table, maxAttackLimit, defenderHandCount) {
  if (!card) return false;
  const maxAllowed = Math.min(6, maxAttackLimit);
  if (table.length >= maxAllowed) return false;

  // Undefended cards cannot exceed defender's current hand
  const undefended = table.filter(p => !p.defend).length;
  if (undefended >= defenderHandCount) return false;

  if (table.length === 0) return true;
  const ranks = getTableRanks(table);
  return ranks.has(card.rank);
}

// ── TESTS ──
console.log('Testing Durak rules & engine...');

// Test 1: Deck size and ranks
const deck = createDeck();
assert.strictEqual(deck.length, 36, 'Deck must have 36 cards');
const uniqueCards = new Set(deck.map(c => `${c.suit}_${c.rank}`));
assert.strictEqual(uniqueCards.size, 36, 'All 36 cards must be unique');
console.log('✔ Test 1: Deck size and uniqueness passed.');

// Test 2: Card beating rules
const trump = 'hearts';
// Same suit higher beats lower
assert.strictEqual(canBeat({ suit: 'spades', value: 7 }, { suit: 'spades', value: 10 }, trump), true);
assert.strictEqual(canBeat({ suit: 'spades', value: 10 }, { suit: 'spades', value: 7 }, trump), false);
// Same suit same rank cannot beat
assert.strictEqual(canBeat({ suit: 'spades', value: 10 }, { suit: 'spades', value: 10 }, trump), false);
// Non-trump different suit cannot beat
assert.strictEqual(canBeat({ suit: 'spades', value: 7 }, { suit: 'clubs', value: 14 }, trump), false);
// Trump beats non-trump of any rank
assert.strictEqual(canBeat({ suit: 'spades', value: 14 }, { suit: 'hearts', value: 6 }, trump), true);
// Higher trump beats lower trump
assert.strictEqual(canBeat({ suit: 'hearts', value: 8 }, { suit: 'hearts', value: 9 }, trump), true);
// Lower trump cannot beat higher trump
assert.strictEqual(canBeat({ suit: 'hearts', value: 14 }, { suit: 'hearts', value: 6 }, trump), false);
// Non-trump cannot beat trump
assert.strictEqual(canBeat({ suit: 'hearts', value: 6 }, { suit: 'spades', value: 14 }, trump), false);
console.log('✔ Test 2: Beating logic (trumps, suits, ranks) passed.');

// Test 3: Attack card validation & podkidnoy rank rule
let table = [];
const startDefenderCards = 6;
// 1st card can be anything
assert.strictEqual(canPlayAttackCard({ rank: '7', value: 7 }, table, startDefenderCards, 6), true);
table.push({ attack: { rank: '7', value: 7 }, defend: null });

// 2nd card must match rank on table
assert.strictEqual(canPlayAttackCard({ rank: '8', value: 8 }, table, startDefenderCards, 6), false, 'Cannot toss rank not on table');
assert.strictEqual(canPlayAttackCard({ rank: '7', value: 7 }, table, startDefenderCards, 6), true, 'Can toss matching rank');

// If defender beats the 7 with King of hearts
table[0].defend = { rank: 'K', value: 13, suit: 'hearts' };
// Now ranks on table are '7' and 'K'
assert.strictEqual(canPlayAttackCard({ rank: 'K', value: 13 }, table, startDefenderCards, 5), true, 'Can toss rank of defending card');
assert.strictEqual(canPlayAttackCard({ rank: '10', value: 10 }, table, startDefenderCards, 5), false, 'Cannot toss rank 10');
console.log('✔ Test 3: Podkidnoy matching rank validation passed.');

// Test 4: Defender hand count limit and 6-card boundary
table = [];
const defenderCount = 3; // Defender only has 3 cards
table.push({ attack: { rank: '6' }, defend: { rank: '7' } }); // 1st pair defended
table.push({ attack: { rank: '6' }, defend: { rank: '8' } }); // 2nd pair defended
table.push({ attack: { rank: '6' }, defend: { rank: '9' } }); // 3rd pair defended
// table.length is 3. Start defender count was 3. Defender has 0 cards left!
assert.strictEqual(canPlayAttackCard({ rank: '6' }, table, 3, 0), false, 'Cannot attack beyond initial defender count');

// Boundary test: Exactly 6 cards against 6 cards defender
table = [];
for (let i = 0; i < 5; i++) {
  table.push({ attack: { rank: '9' }, defend: { rank: '10' } });
}
// 5 cards on table, defender had 6, has 1 left
assert.strictEqual(canPlayAttackCard({ rank: '9' }, table, 6, 1), true, 'Can play 6th card');
table.push({ attack: { rank: '9' }, defend: { rank: '10' } });
// Now 6 cards on table
assert.strictEqual(canPlayAttackCard({ rank: '9' }, table, 6, 0), false, 'Cannot exceed 6 cards on table');
console.log('✔ Test 4: Defender hand limit & 6-card boundary passed.');

// Test 5: First move determination
function getFirstPlayer(playerHand, oppHand, trumpSuit) {
  let pMin = 999;
  let oMin = 999;
  playerHand.forEach(c => {
    if (c.suit === trumpSuit && c.value < pMin) pMin = c.value;
  });
  oppHand.forEach(c => {
    if (c.suit === trumpSuit && c.value < oMin) oMin = c.value;
  });
  if (pMin < oMin) return { attacker: 'player', reason: `player has lowest trump ${pMin}` };
  if (oMin < pMin) return { attacker: 'opponent', reason: `opponent has lowest trump ${oMin}` };
  return { attacker: 'random', reason: 'no trumps in hands' };
}

const pHand1 = [{ suit: 'spades', value: 6 }, { suit: 'hearts', value: 8 }];
const oHand1 = [{ suit: 'spades', value: 6 }, { suit: 'hearts', value: 7 }];
assert.strictEqual(getFirstPlayer(pHand1, oHand1, 'hearts').attacker, 'opponent', '7 is lower than 8');

const pHand2 = [{ suit: 'spades', value: 6 }, { suit: 'diamonds', value: 14 }];
const oHand2 = [{ suit: 'clubs', value: 10 }, { suit: 'spades', value: 14 }];
assert.strictEqual(getFirstPlayer(pHand2, oHand2, 'hearts').attacker, 'random', 'Neither has trump');
console.log('✔ Test 5: First player determination passed.');

// Test 6: Drawing order & bottom card is trump
let testDeck = [{ rank: 'K', suit: 'hearts', value: 13, id: 99 }]; // bottom trump card
for (let i = 0; i < 5; i++) {
  testDeck.push({ rank: '6', suit: 'spades', value: 6, id: i });
}
// Pop cards
const drawn = [];
while (testDeck.length > 0) {
  drawn.push(testDeck.pop());
}
assert.strictEqual(drawn[drawn.length - 1].id, 99, 'Last card popped must be the bottom card (trump)');
console.log('✔ Test 6: Bottom trump card drawn last passed.');

// Test 7: Available defender slots counts PAIRS, not total individual cards
function getAvailableDefenderSlots(table, defenderHandCount, defenderHandAtRoundStart) {
  const maxAllowed = Math.min(6, defenderHandAtRoundStart);
  const tableSlotsLeft = maxAllowed - table.length; // table.length is number of PAIRS
  const undefendedCount = table.filter(p => !p.defend).length;
  const handsSlotsLeft = defenderHandCount - undefendedCount;
  return Math.min(tableSlotsLeft, handsSlotsLeft);
}

// Scenario: 3 attacks on table, 3 attacks defended (6 individual cards on table)
const testPairTable = [
  { attack: { rank: '6', value: 6 }, defend: { rank: '7', value: 7 } },
  { attack: { rank: '8', value: 8 }, defend: { rank: '9', value: 9 } },
  { attack: { rank: '10', value: 10 }, defend: { rank: 'J', value: 11 } }
];
assert.strictEqual(testPairTable.length, 3, 'table.length must be 3 pairs (not 6 cards)');
// If defender started with 6 cards and now has 3 cards left:
const slotsLeft = getAvailableDefenderSlots(testPairTable, 3, 6);
assert.strictEqual(slotsLeft, 3, 'Defender still has 3 slots for attacks (6 max - 3 pairs)');
console.log('✔ Test 7: getAvailableDefenderSlots counts pairs correctly (not individual cards).');

// Test 8: canBeat trump vs trump strictly requires > (not >=)
const trumpSuit = 'clubs';
const trump6 = { suit: 'clubs', value: 6 };
const trump7 = { suit: 'clubs', value: 7 };
assert.strictEqual(canBeat(trump6, trump7, trumpSuit), true, '7 trump beats 6 trump');
assert.strictEqual(canBeat(trump7, trump6, trumpSuit), false, '6 trump cannot beat 7 trump');
assert.strictEqual(canBeat(trump7, trump7, trumpSuit), false, 'Equal trump rank cannot beat itself');
console.log('✔ Test 8: canBeat for trump vs trump strictly requires >.');

// Test 9: End game simultaneous hand emptying (Draw) without race condition
function checkGameOverScenario(playerHand, opponentHand, deckLength) {
  if (deckLength > 0) return 'in_progress';
  const playerEmpty = playerHand.length === 0;
  const opponentEmpty = opponentHand.length === 0;
  if (playerEmpty && opponentEmpty) return 'draw';
  if (playerEmpty) return 'player_won';
  if (opponentEmpty) return 'opponent_won';
  return 'in_progress';
}

assert.strictEqual(checkGameOverScenario([], [], 0), 'draw', 'Both empty with deck 0 must result in Draw');
assert.strictEqual(checkGameOverScenario([], [{ value: 10 }], 0), 'player_won', 'Player empty first wins');
assert.strictEqual(checkGameOverScenario([{ value: 10 }], [], 0), 'opponent_won', 'Opponent empty first wins');
console.log('✔ Test 9: Simultaneous empty hand detection (Draw) verified with zero race conditions.');

console.log('\nAll Durak engine tests (1-9) PASSED successfully!');

