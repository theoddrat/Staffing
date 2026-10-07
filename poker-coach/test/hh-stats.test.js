import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHandHistories } from '../src/stats/hhParser.js';
import { handFlags, emptyAgg, addFlags, deriveStats } from '../src/stats/stats.js';
import { classifyStyle, findStatLeaks, statsToTendencies } from '../src/stats/style.js';

const SAMPLE = `PokerStars Hand #250000000001: Tournament #3500000000, $10+$1 USD Hold'em No Limit - Level V (100/200) - 2024/06/01 12:00:00 ET
Table '3500000000 1' 9-max Seat #3 is the button
Seat 1: Alice (12000 in chips)
Seat 2: Bob (9000 in chips)
Seat 3: Hero (15000 in chips)
Seat 4: Carol (8000 in chips)
Seat 5: Dave (10000 in chips)
Alice: posts the ante 25
Bob: posts the ante 25
Hero: posts the ante 25
Carol: posts the ante 25
Dave: posts the ante 25
Carol: posts small blind 100
Dave: posts big blind 200
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
Alice: folds
Bob: raises 250 to 450
Hero: raises 800 to 1250
Carol: folds
Dave: folds
Bob: calls 800
*** FLOP *** [Ks 7h 2c]
Bob: checks
Hero: bets 900
Bob: folds
Uncalled bet (900) returned to Hero
Hero collected 2925 from pot
*** SUMMARY ***
Total pot 2925 | Rake 0
Board [Ks 7h 2c]
Seat 3: Hero (button) collected (2925)

PokerStars Hand #250000000002: Tournament #3500000000, $10+$1 USD Hold'em No Limit - Level V (100/200) - 2024/06/01 12:01:00 ET
Table '3500000000 1' 9-max Seat #4 is the button
Seat 1: Alice (11975 in chips)
Seat 2: Bob (7725 in chips)
Seat 3: Hero (16650 in chips)
Seat 4: Carol (7875 in chips)
Seat 5: Dave (9775 in chips)
Dave: posts small blind 100
Alice: posts big blind 200
*** HOLE CARDS ***
Dealt to Hero [7c 7d]
Bob: calls 200
Hero: raises 400 to 600
Carol: folds
Dave: folds
Alice: calls 400
Bob: calls 400
*** FLOP *** [7s Td 2h]
Alice: checks
Bob: bets 1000
Hero: raises 1700 to 2700
Alice: folds
Bob: calls 1700
*** TURN *** [7s Td 2h] [Qc]
Bob: checks
Hero: bets 4000
Bob: calls 4000 and is all-in
*** RIVER *** [7s Td 2h Qc] [3d]
*** SHOW DOWN ***
Bob: shows [Ts Tc] (three of a kind, Tens)
Hero: shows [7c 7d] (three of a kind, Sevens)
Bob collected 16350 from pot
*** SUMMARY ***
`;

test('parses PokerStars hand histories into records', () => {
  const { records, errors, heroName } = parseHandHistories(SAMPLE);
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(records.length, 2);
  assert.equal(heroName, 'Hero');
  const [h1, h2] = records;
  assert.equal(h1.bb, 200);
  assert.equal(h1.players.length, 5);
  assert.equal(h1.players[h1.button].name, 'Hero');
  assert.equal(h1.players.find((p) => p.name === 'Dave').canon, 'BB');
  assert.equal(h1.actions.filter((a) => a.st === 0).length, 6);
  assert.equal(h1.board, 'Ks 7h 2c');
  const hero = h1.players[h1.heroIdx];
  assert.equal(hero.end - hero.start, 2925 - 1250 - 25);
  assert.ok(h2.showdown);
  assert.equal(h2.players.find((p) => p.name === 'Bob').hole, 'Ts Tc');
});

test('HUD flags from imported hands', () => {
  const { records } = parseHandHistories(SAMPLE);
  const [f1, f2] = records.map(handFlags);
  const idx = (rec, nm) => rec.players.findIndex((p) => p.name === nm);
  const r1 = records[0];
  const r2 = records[1];
  // hand 1: Bob opens, Hero 3-bets, Bob calls, Hero c-bets, Bob folds
  assert.equal(f1[idx(r1, 'Bob')].pfr, 1);
  assert.equal(f1[idx(r1, 'Hero')].threeBet, 1);
  assert.equal(f1[idx(r1, 'Hero')].threeBetOpp, 1);
  assert.equal(f1[idx(r1, 'Bob')].foldTo3BetOpp, 1);
  assert.equal(f1[idx(r1, 'Bob')].foldTo3Bet, 0);
  assert.equal(f1[idx(r1, 'Hero')].cbet, 1);
  assert.equal(f1[idx(r1, 'Bob')].foldToCbet, 1);
  assert.equal(f1[idx(r1, 'Alice')].vpip, 0);
  // hand 2: Bob limps, Hero isolates; Bob donk-bets so Hero has no c-bet opportunity
  assert.equal(f2[idx(r2, 'Bob')].limp, 1);
  assert.equal(f2[idx(r2, 'Hero')].cbetOpp, 0);
  assert.equal(f2[idx(r2, 'Hero')].wtsd, 1);
  assert.equal(f2[idx(r2, 'Hero')].wsd, 0);
  assert.equal(f2[idx(r2, 'Bob')].wsd, 1);
  assert.equal(f2[idx(r2, 'Hero')].postAgg, 2);
});

test('style classification, leaks and tendencies', () => {
  const agg = emptyAgg();
  // synthesize a loose-passive player: 100 hands, VPIP 45%, PFR 5%
  Object.assign(agg, { hands: 100, vpip: 45, pfr: 5, postAgg: 10, postCall: 40, postFold: 10, sawFlop: 40, wtsd: 18, wsd: 7, cbetOpp: 3, foldToCbetOpp: 20, foldToCbet: 2 });
  const s = deriveStats(agg);
  const style = classifyStyle(s);
  assert.equal(style.key, 'station');
  const leaks = findStatLeaks(s);
  assert.ok(leaks.some((l) => l.key === 'vpip' && l.dir === 'high'));
  assert.ok(leaks.some((l) => l.key === 'wtsd' && l.dir === 'high'));
  const t = statsToTendencies(s);
  assert.ok(t.callMult > 2, 'calls a lot');
  assert.ok(t.aggression < 1, 'passive');
  assert.ok(t.stickiness > 1.2, 'sticky');
  addFlags(agg, { ...Object.fromEntries(Object.keys(agg).map((k) => [k, 0])), hands: 1 }, 'BTN');
  assert.equal(agg.byPos.BTN.hands, 1);
});
