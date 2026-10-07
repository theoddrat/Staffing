import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headsUpPushFold, rangeFraction } from '../src/gto/pushfold.js';
import { LABEL_TO_CLASS, rangePercent } from '../src/engine/ranges.js';
import { RFI, VS_OPEN, scaleRange } from '../src/gto/charts.js';
import { Hand } from '../src/engine/game.js';
import { HandModel } from '../src/gto/handModel.js';
import { getAdvice, gradeDecision } from '../src/gto/advisor.js';
import { preflopPolicy, rangeShare } from '../src/gto/preflopStrategy.js';
import { boardTexture, drawFeatures, holdingLabel } from '../src/gto/features.js';
import { parseCards } from '../src/engine/cards.js';
import { makeRng } from '../src/engine/rng.js';
import { buildSpot } from '../src/ui/train.js';

const cls = (l) => LABEL_TO_CLASS.get(l);

test('heads-up push/fold matches published Nash ranges', () => {
  const ten = headsUpPushFold(10);
  // Nash HU at 10bb: SB jams ~58%, BB calls ~37%
  assert.ok(Math.abs(rangeFraction(ten.push) - 0.58) < 0.03, `push ${rangeFraction(ten.push)}`);
  assert.ok(Math.abs(rangeFraction(ten.call) - 0.37) < 0.03, `call ${rangeFraction(ten.call)}`);
  assert.ok(ten.push[cls('K2o')] > 0.5, 'K2o is a 10bb jam');
  assert.ok(ten.push[cls('72o')] < 0.5, '72o folds');
  assert.ok(ten.call[cls('A2o')] > 0.5, 'A2o calls');
  const five = headsUpPushFold(5);
  assert.ok(rangeFraction(five.push) > rangeFraction(ten.push), 'shorter stacks jam wider');
});

test('opening charts widen toward the button and scale with tendencies', () => {
  const order = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN'];
  for (let i = 1; i < order.length; i++) assert.ok(rangePercent(RFI[order[i]]) > rangePercent(RFI[order[i - 1]]));
  for (let c = 0; c < 169; c++) if (RFI.UTG[c] > 0) assert.ok(RFI.BTN[c] > 0, 'charts are nested');
  const wide = scaleRange(RFI.UTG, 2);
  assert.ok(Math.abs(rangePercent(wide) - 2 * rangePercent(RFI.UTG)) < 0.01);
  const tight = scaleRange(RFI.BTN, 0.5);
  assert.ok(tight[cls('AA')] === 1 && tight[cls('72o')] === 0);
  assert.ok(rangePercent(VS_OPEN.LP.BB.call) > rangePercent(VS_OPEN.EP.BB.call), 'BB defends wider vs late opens');
});

function foldTo(hand, model, target) {
  while (hand.toAct !== target) {
    const idx = hand.toAct;
    const ctx = model.context(idx);
    model.record(idx, hand.act({ type: 'fold' }), ctx);
  }
}

test('advisor: premium hands open, trash folds, short stacks jam', () => {
  const rng = makeRng(3);
  const players = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, stack: 20000 }));
  const h = new Hand({ players, button: 0, sb: 100, bb: 200, ante: 200, rng }).start();
  const m = new HandModel(h);
  const utg = h.toAct;
  h.players[utg].hole = parseCards('AsAd');
  let a = getAdvice(m, utg, { rng });
  assert.equal(a.best.type, 'raise');
  assert.equal(a.mode, 'open');
  h.players[utg].hole = parseCards('7c2d');
  a = getAdvice(m, utg, { rng });
  assert.equal(a.best.type, 'fold');
  // grade: folding 72o is best, calling it is a mistake
  assert.equal(gradeDecision(a, { type: 'fold' }).grade, 'best');
  assert.ok(['mistake', 'blunder'].includes(gradeDecision(a, { type: 'call' }).grade));

  const short = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, stack: i === 7 ? 1600 : 20000 }));
  const h2 = new Hand({ players: short, button: 8, sb: 100, bb: 200, ante: 200, rng }).start();
  const m2 = new HandModel(h2);
  foldTo(h2, m2, 7); // seat 7 is the cutoff with 8bb
  h2.players[7].hole = parseCards('KhTd');
  const a2 = getAdvice(m2, 7, { rng });
  assert.equal(a2.mode, 'push/fold');
  assert.ok(a2.best.allIn, `8bb KTo from the CO should jam (${a2.best.label})`);
});

test('advisor postflop: value-bets the nuts and folds air to a big bet', () => {
  const rng = makeRng(9);
  const players = [{ id: 'a', name: 'A', stack: 20000 }, { id: 'b', name: 'B', stack: 20000 }];
  const h = new Hand({ players, button: 0, sb: 100, bb: 200, rng }).start();
  const m = new HandModel(h);
  let ctx = m.context(0); m.record(0, h.act({ type: 'raise', to: 500 }), ctx);
  ctx = m.context(1); m.record(1, h.act({ type: 'call' }), ctx);
  assert.equal(h.street, 'flop');
  h.board = parseCards('AhKhQh');
  h.players[1].hole = parseCards('JhTh'); // royal flush, BB acts first
  const a = getAdvice(m, 1, { rng, iterations: 600 });
  assert.ok(a.info.equity > 0.95);
  ctx = m.context(1); m.record(1, h.act({ type: 'check' }), ctx);
  ctx = m.context(0); m.record(0, h.act({ type: 'raise', to: 1000 }), ctx);
  h.players[1].hole = parseCards('3c2d');
  const b = getAdvice(m, 1, { rng, iterations: 600 });
  const fold = b.mix.find((x) => x.type === 'fold');
  assert.ok(fold.freq > 0.6, `3-2 offsuit folds on AKQ monotone (${fold.freq})`);
});

test('preflop policy responds to tendencies', () => {
  const { model, heroIdx } = buildSpot('rfi', makeRng(5));
  const ctx = model.context(heroIdx);
  const base = preflopPolicy(ctx);
  const loose = preflopPolicy(ctx, { openMult: 1.8 });
  assert.ok(rangeShare(loose.raise) > rangeShare(base.raise) * 1.5);
  const tight = preflopPolicy(ctx, { openMult: 0.5 });
  assert.ok(rangeShare(tight.raise) < rangeShare(base.raise));
});

test('board texture and draw features', () => {
  const t = boardTexture(parseCards('Jh Th 9c'));
  assert.ok(t.wetness > 0.4 && t.flushDrawPossible);
  const dry = boardTexture(parseCards('Kd 7s 2c'));
  assert.ok(dry.wetness < t.wetness);
  const f = drawFeatures(...parseCards('Ah 5h'), parseCards('Kh 8h 2c'));
  assert.ok(f.flushDraw && f.nutFlushDraw);
  const s = drawFeatures(...parseCards('8d 7c'), parseCards('9h 6s 2c'));
  assert.ok(s.oesd, 'open-ended');
  assert.equal(holdingLabel(...parseCards('Ah Tc'), parseCards('5s 7d 7c')), 'A-high (paired board)');
  assert.equal(holdingLabel(...parseCards('7h 7s'), parseCards('Ks 7d 2c')), 'a set');
  assert.equal(holdingLabel(...parseCards('Kh Qs'), parseCards('Ks 7d 2c')), 'top pair');
});
