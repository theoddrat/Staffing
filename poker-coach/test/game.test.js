import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hand, positionsFor } from '../src/engine/game.js';
import { Tournament } from '../src/engine/tournament.js';
import { parseCards } from '../src/engine/cards.js';
import { makeRng } from '../src/engine/rng.js';
import { icmEquity } from '../src/engine/icm.js';

/** Deck that deals hole cards (in dealing order) then the board with burns. */
function riggedDeck(holeBySeat, button, board) {
  const n = holeBySeat.length;
  const order = [];
  for (let round = 0; round < 2; round++) {
    for (let k = 1; k <= n; k++) order.push(holeBySeat[(button + k) % n][round]);
  }
  const b = parseCards(board);
  const burn = [];
  const used = new Set([...order, ...b]);
  for (let c = 0; c < 52 && burn.length < 3; c++) if (!used.has(c)) burn.push(c);
  order.push(burn[0], b[0], b[1], b[2], burn[1], b[3], burn[2], b[4]);
  let pos = 0;
  return { deal: (k) => order.slice(pos, (pos += k)) };
}

const players = (...stacks) => stacks.map((s, i) => ({ id: `p${i}`, name: `P${i}`, stack: s }));
const total = (h) => h.players.reduce((t, p) => t + p.stack, 0);

test('positions', () => {
  assert.deepEqual(positionsFor(9, 0).map((p) => p.canonical), ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO']);
  assert.deepEqual(positionsFor(6, 2).map((p) => p.display), ['HJ', 'CO', 'BTN', 'SB', 'BB', 'UTG']);
  assert.deepEqual(positionsFor(2, 1).map((p) => p.canonical), ['BB', 'SB']);
});

test('blinds, BB ante and preflop action order', () => {
  const h = new Hand({ players: players(1000, 1000, 1000, 1000), button: 0, sb: 50, bb: 100, ante: 100, rng: makeRng(1) }).start();
  assert.equal(h.players[1].stack, 950);
  assert.equal(h.players[2].stack, 800);
  assert.equal(h.pot, 250);
  assert.equal(h.toAct, 3, 'UTG acts first');
  h.act({ type: 'fold' });
  h.act({ type: 'fold' });
  h.act({ type: 'fold' });
  assert.ok(h.complete);
  assert.equal(h.players[2].stack, 1050, 'BB wins SB + gets blind and ante back');
  assert.equal(total(h), 4000);
});

test('heads-up: button posts SB and acts first preflop, last postflop', () => {
  const h = new Hand({ players: players(1000, 1000), button: 1, sb: 50, bb: 100, rng: makeRng(2) }).start();
  assert.equal(h.players[1].bet, 50);
  assert.equal(h.toAct, 1);
  h.act({ type: 'call' });
  assert.equal(h.toAct, 0, 'BB has the option');
  h.act({ type: 'check' });
  assert.equal(h.street, 'flop');
  assert.equal(h.toAct, 0, 'BB acts first postflop');
});

test('min-raise rules and short all-in does not reopen betting', () => {
  const h = new Hand({ players: players(10000, 10000, 10000, 550), button: 0, sb: 50, bb: 100, rng: makeRng(3) }).start();
  // UTG (3) is the short stack. Make P3 act after a raise: UTG folds? Use order: 3 -> 0 -> 1 -> 2
  h.act({ type: 'call' }); // P3 limps 100
  h.act({ type: 'raise', to: 400 }); // P0 raises to 400 (increment 300)
  let la = h.legalActions();
  assert.equal(la.minTo, 700, 'min re-raise is previous increment');
  h.act({ type: 'fold' }); // SB
  h.act({ type: 'fold' }); // BB
  // P3 shoves 550 total: increment 150 < 300 → not a full raise
  h.act({ type: 'allin' });
  la = h.legalActions();
  assert.equal(h.toAct, 0);
  assert.equal(la.canRaise, false, 'short all-in does not reopen');
  assert.equal(la.toCall, 150);
  h.act({ type: 'call' });
  assert.ok(h.complete, 'runs out the board');
  assert.equal(total(h), 30550);
});

test('side pots with three all-ins pay correctly', () => {
  const hole = [parseCards('AsAd'), parseCards('KsKd'), parseCards('QsQd')];
  // P0 BTN (AA, 300), P1 SB (KK, 600), P2 BB (QQ, 1000)
  const deck = riggedDeck(hole, 0, '2c7h9dJcTh');
  const h = new Hand({ players: players(300, 600, 1000), button: 0, sb: 10, bb: 20, deck }).start();
  h.act({ type: 'allin' }); // P0 300
  h.act({ type: 'allin' }); // P1 600
  h.act({ type: 'call' }); // P2 calls 600
  assert.ok(h.complete);
  assert.equal(h.players[0].stack, 900, 'AA wins main pot 3x300');
  assert.equal(h.players[1].stack, 600, 'KK wins side pot 2x300');
  assert.equal(h.players[2].stack, 400, 'QQ keeps uncalled 400');
  assert.equal(total(h), 1900);
});

test('split pot divides chips including odd chip', () => {
  const hole = [parseCards('Ah2c'), parseCards('Ad3c'), parseCards('7s8s')];
  const deck = riggedDeck(hole, 0, 'KsKdQcQhJs');
  const h = new Hand({ players: players(1000, 1000, 1000), button: 0, sb: 5, bb: 10, ante: 5, deck }).start();
  h.act({ type: 'call' }); // BTN
  h.act({ type: 'call' }); // SB
  h.act({ type: 'check' }); // BB
  // P2 (BB) holds 7s8s: plays board K K Q Q J -> also A kickers win for P0/P1
  for (let s = 0; s < 3; s++) { h.act({ type: 'check' }); h.act({ type: 'check' }); h.act({ type: 'check' }); }
  assert.ok(h.complete);
  // pot = 30 + 5 ante = 35, split between P0 and P1 (aces) → 18/17 with odd chip left of button
  assert.equal(h.players[1].stack + h.players[0].stack, 2000 - 20 + 35);
  assert.equal(h.players[1].stack, 1008, 'odd chip goes to first seat left of the button');
  assert.equal(total(h), 3000);
});

test('random tournaments conserve chips and finish with unique places', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const rng = makeRng(seed * 77);
    const t = new Tournament({ players: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })), scenario: 'turbo', seed });
    let guard = 0;
    while (!t.isOver() && guard++ < 3000) {
      const h = t.nextHand();
      while (!h.complete) {
        const la = h.legalActions();
        const r = rng();
        if (r < 0.15 && la.canRaise) h.act({ type: 'raise', to: la.minTo + Math.floor(rng() * (la.maxTo - la.minTo + 1)) });
        else if (r < 0.25) h.act({ type: 'fold' });
        else if (la.canCheck) h.act({ type: 'check' });
        else h.act({ type: 'call' });
      }
      t.completeHand(h);
      const chips = t.seats.reduce((s, x) => s + x.stack, 0);
      assert.equal(chips, t.totalChips, `chips conserved (seed ${seed}, hand ${h.id})`);
    }
    assert.ok(t.isOver(), 'tournament finished');
    const places = t.seats.map((s) => s.finish).sort((a, b) => a - b);
    assert.deepEqual(places, [1, 2, 3, 4, 5, 6]);
  }
});

test('ICM equity', () => {
  const eq = icmEquity([5000, 5000], [70, 30]);
  assert.ok(Math.abs(eq[0] - 50) < 1e-9);
  const eq3 = icmEquity([5000, 3000, 2000], [50, 30, 20]);
  assert.ok(Math.abs(eq3.reduce((a, b) => a + b, 0) - 100) < 1e-9);
  assert.ok(eq3[0] < 50 * 1.0 && eq3[0] > 38, 'chip leader equity compressed');
  assert.deepEqual(icmEquity([0, 100], [60, 40]), [0, 60]);
});
