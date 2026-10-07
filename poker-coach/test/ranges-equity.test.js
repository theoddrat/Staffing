import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRange, rangePercent, LABEL_TO_CLASS, classOfCards, CLASSES } from '../src/engine/ranges.js';
import { comboRangeFromClasses, fullComboRange, comboIndex, NUM_COMBOS } from '../src/engine/combos.js';
import { equityVsRanges, equityVsHands } from '../src/engine/equity.js';
import { parseCards } from '../src/engine/cards.js';

const labels = (w) => CLASSES.filter((c) => w[c.idx] > 0).map((c) => c.label).sort();

test('range parsing', () => {
  assert.deepEqual(labels(parseRange('QQ+')), ['AA', 'KK', 'QQ']);
  assert.deepEqual(labels(parseRange('KTs+')), ['KJs', 'KQs', 'KTs']);
  assert.deepEqual(labels(parseRange('A5s-A2s')), ['A2s', 'A3s', 'A4s', 'A5s']);
  assert.deepEqual(labels(parseRange('76s-54s')), ['54s', '65s', '76s']);
  assert.deepEqual(labels(parseRange('88-66')), ['66', '77', '88']);
  assert.deepEqual(labels(parseRange('AK')), ['AKo', 'AKs']);
  assert.equal(parseRange('AKo:0.5')[LABEL_TO_CLASS.get('AKo')], 0.5);
  assert.ok(Math.abs(rangePercent(parseRange('22+, A2s+, K2s+, Q2s+, J2s+, T2s+, 92s+, 82s+, 72s+, 62s+, 52s+, 42s+, 32s, A2o+, K2o+, Q2o+, J2o+, T2o+, 92o+, 82o+, 72o+, 62o+, 52o+, 42o+, 32o')) - 1) < 1e-9);
});

test('class lookup from cards', () => {
  assert.equal(CLASSES[classOfCards(...parseCards('AsKs'))].label, 'AKs');
  assert.equal(CLASSES[classOfCards(...parseCards('Kd As'))].label, 'AKo');
  assert.equal(CLASSES[classOfCards(...parseCards('7c7d'))].label, '77');
  assert.equal(CLASSES[classOfCards(...parseCards('2c3d'))].label, '32o');
});

test('combo ranges', () => {
  const r = comboRangeFromClasses(parseRange('AA'), parseCards('As'));
  let n = 0;
  for (let k = 0; k < NUM_COMBOS; k++) n += r[k];
  assert.equal(n, 3, 'AA with As dead leaves 3 combos');
  assert.equal(comboIndex(0, 1), comboIndex(1, 0));
});

test('equity sanity checks', () => {
  const aa = parseCards('AsAh');
  const kk = comboRangeFromClasses(parseRange('KK'), aa);
  const res = equityVsRanges(aa, [], [kk], { iterations: 20000, seed: 1 });
  assert.ok(Math.abs(res.equity - 0.82) < 0.015, `AA vs KK ≈ 82% (got ${res.equity})`);

  const ak = parseCards('AsKs');
  const qq = equityVsHands([ak, parseCards('QdQc')], [], { iterations: 20000, seed: 2 });
  assert.ok(Math.abs(qq[0] - 0.46) < 0.02, `AKs vs QQ ≈ 46% (got ${qq[0]})`);

  // river exact: nut flush vs anything
  const board = parseCards('2h7h9hJc3d');
  const nut = parseCards('AhKh');
  const exact = equityVsRanges(nut, board, [fullComboRange([...nut, ...board])]);
  assert.ok(exact.equity > 0.99);

  // turn exact enumeration path
  const turn = parseCards('2h7h9hJc');
  const fd = equityVsRanges(parseCards('AhKd'), turn, [comboRangeFromClasses(parseRange('JJ'), [...parseCards('AhKd'), ...turn])]);
  // 9 hearts + 2 aces + 2 kings? no — vs set of jacks only flush outs (8 non-board hearts minus Ah) count
  assert.ok(fd.equity > 0.12 && fd.equity < 0.25, `flush draw vs set on turn (got ${fd.equity})`);
});
