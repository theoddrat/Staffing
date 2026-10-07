// No-limit hold'em hand state machine: blinds/antes, betting rounds with
// full-raise rules, all-ins, side pots, run-outs and showdown.

import { Deck, cardsToString } from './cards.js';
import { evaluate, describeScore } from './evaluator.js';
import { makeRng } from './rng.js';

export const STREETS = ['preflop', 'flop', 'turn', 'river'];

// Canonical position names by number of non-blind seats (distance from the
// button decides strategy; these line up with 9-max chart names).
const CANONICAL = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN'];
const DISPLAY = {
  1: ['BTN'],
  2: ['CO', 'BTN'],
  3: ['HJ', 'CO', 'BTN'],
  4: ['UTG', 'HJ', 'CO', 'BTN'],
  5: ['UTG', 'LJ', 'HJ', 'CO', 'BTN'],
  6: ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN'],
  7: ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN'],
};

/**
 * Position info for each seat index given the button index and player count.
 * Returns [{ canonical, display }] where canonical is used for strategy lookups.
 */
export function positionsFor(n, button) {
  const out = new Array(n);
  if (n === 2) {
    out[button] = { canonical: 'SB', display: 'BTN/SB', headsUp: true };
    out[(button + 1) % 2] = { canonical: 'BB', display: 'BB', headsUp: true };
    return out;
  }
  out[(button + 1) % n] = { canonical: 'SB', display: 'SB' };
  out[(button + 2) % n] = { canonical: 'BB', display: 'BB' };
  const k = n - 2;
  const canon = CANONICAL.slice(CANONICAL.length - k);
  const disp = DISPLAY[k] || canon;
  for (let p = 0; p < k; p++) {
    const seat = (button + 3 + p) % n;
    out[seat] = { canonical: canon[p], display: disp[p] };
  }
  return out;
}

export class Hand {
  /**
   * @param {object} cfg
   * @param {Array<{id:string,name:string,stack:number}>} cfg.players  seat order, all with chips
   * @param {number} cfg.button  index into players
   * @param {number} cfg.sb
   * @param {number} cfg.bb
   * @param {number} [cfg.ante]  big-blind ante amount (WSOP style); 0 for none
   * @param {Function} [cfg.rng]
   * @param {{deal:(n:number)=>number[]}} [cfg.deck]  override for tests
   */
  constructor(cfg) {
    this.id = cfg.id ?? 0;
    this.sb = cfg.sb;
    this.bb = cfg.bb;
    this.ante = cfg.ante || 0;
    this.button = cfg.button;
    this.rng = cfg.rng || makeRng();
    this.deck = cfg.deck || new Deck(this.rng);
    this.players = cfg.players.map((p, i) => ({
      idx: i,
      id: p.id,
      name: p.name,
      startStack: p.stack,
      stack: p.stack,
      bet: 0,
      contrib: 0, // live-bet contributions this hand (excludes antes)
      anteContrib: 0,
      folded: false,
      allIn: false,
      acted: false,
      actedAtBet: 0,
      hole: [],
    }));
    this.n = this.players.length;
    if (this.n < 2) throw new Error('Need at least two players');
    this.positions = positionsFor(this.n, this.button);
    this.players.forEach((p, i) => (p.position = this.positions[i]));
    this.board = [];
    this.street = 'preflop';
    this.streetIndex = 0;
    this.currentBet = 0;
    this.minRaise = this.bb;
    this.deadMoney = 0;
    this.toAct = -1;
    this.lastAggressor = -1;
    this.streetAggressor = -1;
    this.log = [];
    this.complete = false;
    this.result = null;
    this.raisesThisStreet = 0;
  }

  get sbIndex() {
    return this.n === 2 ? this.button : (this.button + 1) % this.n;
  }
  get bbIndex() {
    return this.n === 2 ? (this.button + 1) % 2 : (this.button + 2) % this.n;
  }

  /** Total chips in the middle (bets this street included). */
  get pot() {
    let t = this.deadMoney;
    for (const p of this.players) t += p.contrib;
    return t;
  }

  /** Pot excluding the current street's outstanding bets. */
  get potBeforeStreet() {
    let t = this.pot;
    for (const p of this.players) t -= p.bet;
    return t;
  }

  start() {
    const sbP = this.players[this.sbIndex];
    const bbP = this.players[this.bbIndex];
    this._post(sbP, Math.min(this.sb, sbP.stack), 'sb');
    this._post(bbP, Math.min(this.bb, bbP.stack), 'bb');
    if (this.ante > 0 && bbP.stack > 0) {
      const a = Math.min(this.ante, bbP.stack);
      bbP.stack -= a;
      bbP.anteContrib += a;
      this.deadMoney += a;
      if (bbP.stack === 0) bbP.allIn = true;
      this.log.push({ type: 'post', idx: bbP.idx, kind: 'ante', amount: a });
    }
    this.currentBet = this.bb;
    this.minRaise = this.bb;
    // deal two cards to each player, one at a time starting left of the button
    for (let round = 0; round < 2; round++) {
      for (let k = 1; k <= this.n; k++) {
        const p = this.players[(this.button + k) % this.n];
        p.hole.push(this.deck.deal(1)[0]);
      }
    }
    this.log.push({ type: 'deal' });
    const first = this.n === 2 ? this.button : (this.bbIndex + 1) % this.n;
    this.toAct = this._nextToAct(first, true);
    this._checkProgress();
    return this;
  }

  _post(p, amount, kind) {
    p.stack -= amount;
    p.bet += amount;
    p.contrib += amount;
    if (p.stack === 0) p.allIn = true;
    this.log.push({ type: 'post', idx: p.idx, kind, amount });
  }

  _needsAction(p) {
    if (p.folded || p.allIn) return false;
    if (p.bet < this.currentBet) return true;
    if (p.acted) return false;
    // Nobody left to play against: a lone player with chips who has matched
    // every bet doesn't need to act.
    const others = this.players.filter((q) => q !== p && !q.folded && !q.allIn).length;
    return others > 0;
  }

  /** Index of the next player (starting at `from`, inclusive if `inclusive`) needing action, or -1. */
  _nextToAct(from, inclusive = false) {
    for (let k = inclusive ? 0 : 1; k <= this.n; k++) {
      const i = (from + k) % this.n;
      if (this._needsAction(this.players[i])) return i;
    }
    return -1;
  }

  activePlayers() {
    return this.players.filter((p) => !p.folded);
  }

  /** Legal options for the player to act. Amounts are "raise to" totals for this street. */
  legalActions() {
    if (this.complete || this.toAct < 0) return null;
    const p = this.players[this.toAct];
    const toCall = Math.max(0, Math.min(this.currentBet - p.bet, p.stack));
    const maxTo = p.bet + p.stack;
    const othersCanAct = this.players.some((q) => q !== p && !q.folded && !q.allIn);
    const reopened = !p.acted || this.currentBet - p.actedAtBet >= this.minRaise;
    const canRaise = othersCanAct && reopened && maxTo > this.currentBet;
    const minTo = Math.min(maxTo, this.currentBet + this.minRaise);
    return {
      idx: p.idx,
      canCheck: p.bet >= this.currentBet,
      canCall: toCall > 0,
      toCall,
      callIsAllIn: toCall > 0 && toCall === p.stack,
      canRaise,
      isBet: this.currentBet === 0,
      minTo: canRaise ? minTo : 0,
      maxTo: canRaise ? maxTo : 0,
      pot: this.pot,
      currentBet: this.currentBet,
      playerBet: p.bet,
      stack: p.stack,
    };
  }

  /**
   * Apply an action for the player to act.
   * @param {{type:'fold'|'check'|'call'|'bet'|'raise'|'allin', to?:number}} action
   */
  act(action) {
    if (this.complete) throw new Error('Hand is complete');
    const la = this.legalActions();
    const p = this.players[this.toAct];
    let { type } = action;
    const potBefore = this.pot;
    const facing = this.currentBet - p.bet;

    if (type === 'allin') {
      if (la.canRaise) { type = 'raise'; action = { type, to: la.maxTo }; }
      else if (la.canCall) type = 'call';
      else type = 'check';
    }
    if (type === 'bet') type = 'raise';
    if (type === 'check' && !la.canCheck) type = la.canCall ? 'call' : 'fold';
    if (type === 'raise' && !la.canRaise) type = la.canCall ? 'call' : 'check';

    let entry;
    if (type === 'fold') {
      p.folded = true;
      entry = { type: 'fold' };
    } else if (type === 'check') {
      entry = { type: 'check' };
    } else if (type === 'call') {
      const amt = la.toCall;
      p.stack -= amt;
      p.bet += amt;
      p.contrib += amt;
      if (p.stack === 0) p.allIn = true;
      entry = { type: 'call', amount: amt, allIn: p.allIn };
    } else {
      let to = Math.round(action.to ?? la.minTo);
      to = Math.max(la.minTo, Math.min(la.maxTo, to));
      const amt = to - p.bet;
      const increment = to - this.currentBet;
      const wasBet = this.currentBet === 0;
      p.stack -= amt;
      p.bet = to;
      p.contrib += amt;
      if (p.stack === 0) p.allIn = true;
      if (increment >= this.minRaise) this.minRaise = increment;
      this.currentBet = to;
      this.lastAggressor = p.idx;
      this.streetAggressor = p.idx;
      this.raisesThisStreet++;
      entry = { type: wasBet ? 'bet' : 'raise', amount: amt, to, allIn: p.allIn };
    }
    p.acted = true;
    p.actedAtBet = this.currentBet;
    this.log.push({
      type: 'action', street: this.street, idx: p.idx, action: entry.type,
      amount: entry.amount || 0, to: entry.to || 0, allIn: !!entry.allIn,
      facing, potBefore, potAfter: this.pot,
    });
    this.toAct = this._nextToAct(p.idx);
    this._checkProgress();
    return entry;
  }

  _checkProgress() {
    const live = this.activePlayers();
    if (live.length === 1) {
      this._finish(false);
      return;
    }
    if (this.toAct >= 0) return;
    // betting round complete
    const canAct = live.filter((p) => !p.allIn);
    if (this.street === 'river' || canAct.length <= 1) {
      // run out the board if needed, then showdown
      const runout = this.street !== 'river' && canAct.length <= 1;
      while (this.board.length < 5) this._dealStreet(runout);
      this._finish(true);
      return;
    }
    this._dealStreet(false);
    this._resetStreet();
    this.toAct = this._nextToAct(this.button);
    if (this.toAct < 0) this._checkProgress();
  }

  _dealStreet(runout) {
    this.deck.deal(1); // burn
    const n = this.board.length === 0 ? 3 : 1;
    const cards = this.deck.deal(n);
    this.board.push(...cards);
    this.streetIndex++;
    this.street = STREETS[Math.min(3, this.streetIndex)];
    this.log.push({ type: 'street', street: this.street, cards, board: this.board.slice(), runout });
  }

  _resetStreet() {
    for (const p of this.players) {
      p.bet = 0;
      p.acted = false;
      p.actedAtBet = 0;
    }
    this.currentBet = 0;
    this.minRaise = this.bb;
    this.streetAggressor = -1;
    this.raisesThisStreet = 0;
  }

  /** Build main/side pots from live contributions; antes go to the main pot. */
  computePots() {
    const levels = [...new Set(this.players.map((p) => p.contrib).filter((c) => c > 0))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const p of this.players) amount += Math.max(0, Math.min(p.contrib, level) - prev);
      const eligible = this.players.filter((p) => !p.folded && p.contrib >= level).map((p) => p.idx);
      if (amount > 0) {
        const last = pots[pots.length - 1];
        // merge layers with identical eligibility (e.g. folded players' partial bets)
        if (last && sameSet(last.eligible, eligible)) last.amount += amount;
        else pots.push({ amount, eligible });
      }
      prev = level;
    }
    if (this.deadMoney > 0) {
      if (pots.length) pots[0].amount += this.deadMoney;
      else pots.push({ amount: this.deadMoney, eligible: this.activePlayers().map((p) => p.idx) });
    }
    // Layers nobody live is eligible for (everyone in them folded) roll into the previous pot.
    for (let i = pots.length - 1; i > 0; i--) {
      if (pots[i].eligible.length === 0) {
        pots[i - 1].amount += pots[i].amount;
        pots.splice(i, 1);
      }
    }
    return pots;
  }

  _finish(showdown) {
    this.street = showdown ? 'showdown' : this.street;
    this.toAct = -1;
    const pots = this.computePots();
    const live = this.activePlayers();
    const scores = new Map();
    const shown = [];
    if (showdown) {
      for (const p of live) {
        const s = evaluate(p.hole, this.board);
        scores.set(p.idx, s);
        shown.push({ idx: p.idx, cards: p.hole.slice(), score: s, desc: describeScore(s) });
      }
    }
    const awards = [];
    const won = new Array(this.n).fill(0);
    for (const pot of pots) {
      let winners;
      if (!showdown || pot.eligible.length === 1) {
        winners = pot.eligible.length ? pot.eligible : [live[0].idx];
      } else {
        const best = Math.max(...pot.eligible.map((i) => scores.get(i)));
        winners = pot.eligible.filter((i) => scores.get(i) === best);
      }
      // order winners clockwise from the button for odd-chip distribution
      winners.sort((a, b) => ((a - this.button - 1 + this.n) % this.n) - ((b - this.button - 1 + this.n) % this.n));
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      for (const w of winners) {
        const amt = share + (odd > 0 ? 1 : 0);
        if (odd > 0) odd--;
        won[w] += amt;
        this.players[w].stack += amt;
      }
      awards.push({ amount: pot.amount, eligible: pot.eligible, winners });
    }
    this.complete = true;
    const net = this.players.map((p) => p.stack - p.startStack);
    this.result = { showdown, pots: awards, shown, won, net, board: this.board.slice() };
    this.log.push({ type: 'end', showdown, awards, shown });
  }

  /** Plain-text summary of the hand (PokerStars-like), for history and AI review. */
  toText(heroIdx = -1, meta = {}) {
    const L = [];
    const nm = (i) => this.players[i].name;
    L.push(`Hand #${this.id}${meta.title ? ` — ${meta.title}` : ''}: Hold'em No Limit (${this.sb}/${this.bb}${this.ante ? ` ante ${this.ante}` : ''})`);
    this.players.forEach((p, i) => {
      L.push(`Seat ${i + 1}: ${p.name} [${p.position.display}] (${p.startStack} in chips)${i === heroIdx ? ' (hero)' : ''}`);
    });
    if (heroIdx >= 0) L.push(`Dealt to ${nm(heroIdx)} [${cardsToString(this.players[heroIdx].hole)}]`);
    let street = 'preflop';
    L.push('*** PREFLOP ***');
    for (const e of this.log) {
      if (e.type === 'post') L.push(`${nm(e.idx)}: posts ${e.kind === 'ante' ? 'big blind ante' : e.kind === 'sb' ? 'small blind' : 'big blind'} ${e.amount}`);
      if (e.type === 'street') {
        street = e.street;
        L.push(`*** ${street.toUpperCase()} *** [${cardsToString(e.board)}]`);
      }
      if (e.type === 'action') {
        const a = e.action;
        const txt = a === 'fold' ? 'folds' : a === 'check' ? 'checks' : a === 'call' ? `calls ${e.amount}` : a === 'bet' ? `bets ${e.amount}` : `raises to ${e.to}`;
        L.push(`${nm(e.idx)}: ${txt}${e.allIn ? ' and is all-in' : ''}`);
      }
      if (e.type === 'end') {
        if (e.showdown) {
          L.push('*** SHOWDOWN ***');
          for (const s of e.shown) L.push(`${nm(s.idx)}: shows [${cardsToString(s.cards)}] (${s.desc})`);
        }
        e.awards.forEach((aw, k) => {
          L.push(`${aw.winners.map(nm).join(' & ')} ${aw.winners.length > 1 ? 'split' : 'collected'} ${aw.amount} from ${k === 0 ? 'main pot' : `side pot ${k}`}`);
        });
      }
    }
    return L.join('\n');
  }
}

function sameSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}
