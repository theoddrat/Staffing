import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/app/session.js';
import { emptyAgg, mergeAgg, deriveStats } from '../src/stats/stats.js';

test('a full turbo tournament plays to completion with every hand recorded', () => {
  const s = new Session({
    scenario: 'turbo', lineup: ['ivey', 'negreanu', 'hellmuth', 'maniac', 'station'],
    seed: 77, autoHero: true, heroProfileId: 'gto', continueAfterBust: true,
  });
  let hands = 0;
  while (!s.tournament.isOver() && hands < 600) {
    s.startHand();
    s.runBots();
    const res = s.finishHand();
    assert.ok(res.record.players.length >= 2); // (a hand can have no actions when blinds put everyone all-in)
    const chips = s.tournament.seats.reduce((t, x) => t + x.stack, 0);
    assert.equal(chips, s.tournament.totalChips);
    hands++;
  }
  assert.ok(s.tournament.isOver(), `finished in ${hands} hands`);
  assert.ok(s.decisions.length > 0, 'auto-hero decisions were graded');
  for (const d of s.decisions) assert.ok(d.spot && d.grade && d.mix.length);
});

test('profiles play measurably differently', () => {
  const s = new Session({
    scenario: 'cash', lineup: ['maniac', 'nit', 'station', 'gto', 'gto'], seed: 5, autoHero: true, heroProfileId: 'gto', continueAfterBust: true,
  });
  for (let i = 0; i < 160; i++) { s.startHand(); s.runBots(); s.finishHand(); }
  const stat = (name) => deriveStats(mergeAgg(emptyAgg(), s.sessionAggs.get(name)));
  const maniac = stat('The Maniac');
  const nit = stat('The Nit');
  const station = stat('Calling Station');
  assert.ok(maniac.vpip > 2 * nit.vpip, `maniac ${maniac.vpip} vs nit ${nit.vpip}`);
  assert.ok(maniac.pfr > station.pfr, 'maniac raises more than the station');
  assert.ok(station.vpip - station.pfr > nit.vpip - nit.pfr, 'station flats much more');
});

test('adaptive bots report how they exploit the hero', () => {
  // A hero who has historically folded to every c-bet and 3-bet
  const heroAgg = emptyAgg();
  Object.assign(heroAgg, { hands: 200, vpip: 40, pfr: 30, foldToCbetOpp: 60, foldToCbet: 50, foldTo3BetOpp: 30, foldTo3Bet: 27, stealOpp: 40, steal: 15, sawFlop: 50, postAgg: 20, postCall: 20, postFold: 40 });
  const s = new Session({ scenario: 'cash', lineup: ['ivey', 'ivey', 'ivey', 'ivey', 'ivey'], seed: 2, heroAgg, autoHero: true, heroProfileId: 'gto', continueAfterBust: true });
  const notes = new Set();
  for (let i = 0; i < 80 && notes.size === 0; i++) {
    s.startHand();
    s.runBots();
    for (const e of s.current.exploits) notes.add(e);
    s.finishHand();
  }
  assert.ok(notes.size > 0, 'Ivey adapts');
  assert.ok([...notes].some((n) => /c-bet|3-bet/.test(n)), [...notes].join(' | '));
});
