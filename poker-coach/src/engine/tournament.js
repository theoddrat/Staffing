// Single-table tournament runner with a WSOP Main Event–style structure:
// 60,000 starting chips, 100/200 blinds with a 200 big-blind ante, and blinds
// rising on a fixed hand count (we compress 2-hour levels into N hands).

import { Hand } from './game.js';
import { makeRng } from './rng.js';
import { icmEquity } from './icm.js';

// [small blind, big blind]; big-blind ante equals the big blind.
export const WSOP_LEVELS = [
  [100, 200], [200, 300], [200, 400], [300, 500], [300, 600], [400, 800],
  [500, 1000], [600, 1200], [800, 1600], [1000, 2000], [1200, 2400], [1500, 3000],
  [2000, 4000], [2500, 5000], [3000, 6000], [4000, 8000], [5000, 10000], [6000, 12000],
  [8000, 16000], [10000, 20000], [12000, 24000], [15000, 30000], [20000, 40000],
  [25000, 50000], [30000, 60000], [40000, 80000], [50000, 100000], [60000, 120000],
  [80000, 160000], [100000, 200000], [120000, 240000], [150000, 300000], [200000, 400000],
  [250000, 500000], [300000, 600000], [400000, 800000], [500000, 1000000],
];

export const SCENARIOS = {
  main_event: {
    name: 'WSOP Main Event (deep)',
    blurb: '60,000 chips, 100/200 with BB ante. Slow structure: 10 hands per level.',
    startingStack: 60000, handsPerLevel: 10, startLevel: 0,
    payoutPct: [50, 30, 20],
  },
  turbo: {
    name: 'Bracelet Event Turbo',
    blurb: 'Same chips, faster clock: 5 hands per level. More push/fold spots.',
    startingStack: 60000, handsPerLevel: 5, startLevel: 0,
    payoutPct: [50, 30, 20],
  },
  final_table: {
    name: 'Main Event Final Table',
    blurb: 'Nine left, uneven stacks (~10–90bb), big pay jumps. ICM matters every hand.',
    startingStack: null, handsPerLevel: 12, startLevel: 24,
    payoutPct: [30, 18, 13, 10, 8, 6.5, 5.5, 4.8, 4.2],
    unevenStacks: true,
  },
  heads_up: {
    name: 'Heads-Up Challenge',
    blurb: 'One opponent, 60,000 each, 8 hands per level. Winner takes all.',
    startingStack: 60000, handsPerLevel: 8, startLevel: 0,
    payoutPct: [100],
    maxPlayers: 2,
  },
  cash: {
    name: 'Deep-Stack Practice (100bb)',
    blurb: 'Blinds never rise (100/200, BB ante); stacks below 40bb top back up to 100bb. Pure strategy reps.',
    startingStack: 20000, handsPerLevel: Infinity, startLevel: 0,
    payoutPct: [],
    cash: true,
    rebuyBelowBB: 40,
  },
};

export class Tournament {
  /**
   * @param {object} cfg
   * @param {Array<{id:string,name:string,isHero?:boolean,profileId?:string}>} cfg.players  in seat order
   * @param {string} cfg.scenario key of SCENARIOS
   * @param {number} [cfg.seed]
   * @param {number} [cfg.buyIn] for display of prize amounts
   */
  constructor(cfg) {
    this.scenario = SCENARIOS[cfg.scenario || 'main_event'];
    this.scenarioKey = cfg.scenario || 'main_event';
    this.rng = cfg.rng || makeRng(cfg.seed);
    this.levels = WSOP_LEVELS;
    this.level = this.scenario.startLevel;
    this.handsPerLevel = cfg.handsPerLevel || this.scenario.handsPerLevel;
    this.handsThisLevel = 0;
    this.handCount = 0;
    this.buyIn = cfg.buyIn ?? 10000;
    const n = cfg.players.length;
    let stacks;
    if (this.scenario.unevenStacks) stacks = unevenStacks(n, this.levels[this.level][1], this.rng);
    else stacks = new Array(n).fill(this.scenario.startingStack);
    this.seats = cfg.players.map((p, i) => ({
      ...p,
      seat: i,
      stack: stacks[i],
      busted: false,
      finish: null,
      rebuys: 0,
    }));
    this.totalChips = stacks.reduce((a, b) => a + b, 0);
    this.button = Math.floor(this.rng() * n);
    this.eliminations = [];
    const pool = this.buyIn * n;
    this.payouts = this.scenario.payoutPct.slice(0, n).map((pct) => Math.round((pct / 100) * pool));
    this.currentHand = null;
  }

  get blinds() {
    const [sb, bb] = this.levels[Math.min(this.level, this.levels.length - 1)];
    return { sb, bb, ante: this.scenario.noAnte ? 0 : bb, level: this.level + 1 };
  }

  activeSeats() {
    return this.seats.filter((s) => !s.busted);
  }

  isOver() {
    return !this.scenario.cash && this.activeSeats().length <= 1;
  }

  handsUntilLevelUp() {
    return this.handsPerLevel === Infinity ? Infinity : this.handsPerLevel - this.handsThisLevel;
  }

  /** Create (and start) the next hand. */
  nextHand() {
    if (this.isOver()) throw new Error('Tournament is over');
    if (this.scenario.cash) {
      const { bb } = this.blinds;
      for (const s of this.seats) {
        if (s.stack < bb * (this.scenario.rebuyBelowBB || 1)) {
          this.totalChips += this.scenario.startingStack - s.stack;
          s.stack = this.scenario.startingStack;
          s.rebuys++;
        }
      }
    }
    // move the button to the next live seat
    const n = this.seats.length;
    if (this.handCount > 0) {
      for (let k = 1; k <= n; k++) {
        const s = this.seats[(this.button + k) % n];
        if (!s.busted) { this.button = s.seat; break; }
      }
    } else if (this.seats[this.button].busted) {
      this.button = this.activeSeats()[0].seat;
    }
    const active = this.activeSeats();
    const buttonIdx = active.findIndex((s) => s.seat === this.button);
    const { sb, bb, ante } = this.blinds;
    this.handCount++;
    const hand = new Hand({
      id: this.handCount,
      players: active.map((s) => ({ id: s.id, name: s.name, stack: s.stack })),
      button: buttonIdx,
      sb, bb, ante,
      rng: this.rng,
    });
    hand.seatMap = active.map((s) => s.seat);
    hand.level = this.level + 1;
    this.currentHand = hand;
    hand.start();
    return hand;
  }

  /** Apply the result of a completed hand: stacks, eliminations, level clock. */
  completeHand(hand) {
    if (!hand.complete) throw new Error('Hand not complete');
    const busted = [];
    hand.players.forEach((p, i) => {
      const seat = this.seats[hand.seatMap[i]];
      seat.stack = p.stack;
      if (p.stack <= 0 && !this.scenario.cash) busted.push({ seat, startStack: p.startStack });
    });
    // players busting on the same hand: larger starting stack finishes higher
    busted.sort((a, b) => a.startStack - b.startStack);
    for (const b of busted) {
      const remaining = this.activeSeats().length;
      b.seat.busted = true;
      b.seat.finish = remaining;
      b.seat.prize = this.payouts[remaining - 1] || 0;
      this.eliminations.push({ seat: b.seat.seat, name: b.seat.name, place: remaining, hand: hand.id });
    }
    if (this.isOver()) {
      const winner = this.activeSeats()[0];
      if (winner) { winner.finish = 1; winner.prize = this.payouts[0] || 0; }
    }
    this.handsThisLevel++;
    if (this.handsThisLevel >= this.handsPerLevel && this.level < this.levels.length - 1) {
      this.level++;
      this.handsThisLevel = 0;
    }
    return busted.map((b) => b.seat);
  }

  /** ICM prize equity per seat at the current stacks. */
  icm() {
    if (!this.payouts.length) return this.seats.map(() => 0);
    return icmEquity(this.seats.map((s) => (s.busted ? 0 : s.stack)), this.payouts);
  }

  averageStack() {
    const a = this.activeSeats();
    return a.reduce((t, s) => t + s.stack, 0) / Math.max(1, a.length);
  }
}

/** Uneven final-table stacks between ~10 and ~90 big blinds. */
function unevenStacks(n, bb, rng) {
  const raw = Array.from({ length: n }, () => 0.25 + rng() ** 1.6 * 2.2);
  const sum = raw.reduce((a, b) => a + b, 0);
  const avgBB = 38;
  return raw.map((r) => Math.max(8 * bb, Math.round(((r / sum) * avgBB * n * bb) / 1000) * 1000));
}
