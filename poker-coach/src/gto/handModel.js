// HandModel follows a hand as it is played: it tracks every player's
// perceived range (narrowed by each action they take) and builds the decision
// context the strategy modules need.

import { NUM_COMBOS, COMBO_CLASS, comboRangeToClasses } from '../engine/combos.js';
import { preflopPolicy, DEFAULT_TENDENCIES } from './preflopStrategy.js';
import { updateRangePostflop, combineRanges } from './postflop.js';

const FLOOR = 0.01; // players deviate: never rule a hand out completely

export class HandModel {
  /**
   * @param {import('../engine/game.js').Hand} hand
   * @param {object} [opts]
   * @param {(idx:number)=>object|null} [opts.perceivedTendencies] how loose/aggressive each player appears (from HUD stats)
   * @param {number[]} [opts.payouts] remaining tournament payouts (enables ICM)
   */
  constructor(hand, opts = {}) {
    this.hand = hand;
    this.perceived = opts.perceivedTendencies || (() => null);
    this.payouts = opts.payouts && opts.payouts.length ? opts.payouts : null;
    this.ranges = hand.players.map(() => new Float64Array(NUM_COMBOS).fill(1));
    this.pf = {
      raises: 0, limpers: 0, openerIdx: -1, lastRaiserIdx: -1, lastRaiseTo: 0,
      callersAfterRaise: 0, raisedBy: new Set(), lastRaiseAllIn: false,
    };
    this.pfaIdx = -1;
    this.history = [];
  }

  /** Postflop acting order: SB = 0 ... BTN = n-1 (heads-up: BB first). */
  postflopOrder(i) {
    const h = this.hand;
    if (h.n === 2) return i === h.button ? 1 : 0;
    return (i - h.button - 1 + h.n) % h.n;
  }

  range169(i) {
    return comboRangeToClasses(this.ranges[i]);
  }

  context(idx) {
    const h = this.hand;
    const p = h.players[idx];
    const la = h.toAct === idx ? h.legalActions() : null;
    const live = h.players.filter((q) => !q.folded);
    // opponents in the order they act after hero
    const opponents = [];
    for (let k = 1; k < h.n; k++) {
      const q = h.players[(idx + k) % h.n];
      if (q.folded) continue;
      opponents.push({
        idx: q.idx, bet: q.bet, stack: q.stack, allIn: q.allIn, acted: q.acted,
        pos: q.position.canonical, name: q.name,
        range169: h.street === 'preflop' ? this.range169(q.idx) : null,
      });
    }
    const maxOther = Math.max(0, ...opponents.map((o) => o.stack + o.bet));
    const effStack = Math.min(p.stack + p.bet, maxOther);
    const toCall = la ? la.toCall : Math.max(0, Math.min(h.currentBet - p.bet, p.stack));
    const lastRaiser = this.pf.lastRaiserIdx >= 0 ? h.players[this.pf.lastRaiserIdx] : null;
    const ctx = {
      idx,
      street: h.street,
      pos: p.position.canonical,
      posDisplay: p.position.display,
      n: h.n,
      bb: h.bb, sb: h.sb, ante: h.ante,
      pot: h.pot,
      toCall,
      heroBet: p.bet,
      heroStack: p.stack,
      currentBet: h.currentBet,
      canRaise: la ? la.canRaise : false,
      minRaiseTo: la ? la.minTo : 0,
      maxRaiseTo: la ? la.maxTo : 0,
      opponents,
      effStack,
      nLive: live.length,
      icm: this.payouts ? { stacks: h.players.map((q) => q.stack), payouts: this.payouts } : null,
    };
    if (h.street === 'preflop') {
      Object.assign(ctx, {
        raises: this.pf.raises,
        limpers: this.pf.limpers,
        openerIdx: this.pf.openerIdx,
        openerPos: this.pf.openerIdx >= 0 ? h.players[this.pf.openerIdx].position.canonical : null,
        openerDisplay: this.pf.openerIdx >= 0 ? `${h.players[this.pf.openerIdx].name}'s ${h.players[this.pf.openerIdx].position.display}` : null,
        lastRaiserIdx: this.pf.lastRaiserIdx,
        lastRaiseTo: this.pf.lastRaiseTo,
        callersAfterRaise: this.pf.callersAfterRaise,
        heroRaisedThisStreet: this.pf.raisedBy.has(idx),
        facingAllIn: !!(lastRaiser && lastRaiser.allIn && toCall > 0),
        inPositionPreflop: lastRaiser ? this.postflopOrder(idx) > this.postflopOrder(lastRaiser.idx) : idx === h.button,
      });
    } else {
      const lastPosOrder = Math.max(...live.map((q) => this.postflopOrder(q.idx)));
      const aggressor = h.streetAggressor >= 0 ? h.players[h.streetAggressor] : null;
      Object.assign(ctx, {
        ip: this.postflopOrder(idx) === lastPosOrder,
        isPFA: this.pfaIdx === idx,
        villainIdx: aggressor && aggressor.idx !== idx ? aggressor.idx : undefined,
        villainAllIn: !!(aggressor && aggressor.allIn && toCall > 0),
        board: h.board.slice(),
      });
    }
    return ctx;
  }

  /** Update ranges and preflop state after player `idx` acted (ctx captured before the action). */
  record(idx, entry, ctx) {
    const h = this.hand;
    const type = entry.type;
    this.history.push({ idx, type, street: ctx.street, entry });
    if (ctx.street === 'preflop') {
      if (type !== 'fold') {
        const tend = this.perceived(idx) || DEFAULT_TENDENCIES;
        const pol = preflopPolicy(ctx, tend);
        let L;
        if (type === 'raise' || type === 'bet') {
          L = new Float64Array(169);
          const jamSum = pol.jam.reduce((a, b) => a + b, 0);
          const useJam = entry.allIn && jamSum > 0;
          for (let c = 0; c < 169; c++) L[c] = useJam ? pol.jam[c] + pol.raise[c] * 0.5 : pol.raise[c] + pol.jam[c] * 0.5;
        } else {
          L = pol.call; // includes checks
        }
        const r = this.ranges[idx];
        let any = 0;
        for (let k = 0; k < NUM_COMBOS; k++) { r[k] *= Math.max(FLOOR, L[COMBO_CLASS[k]]); any += r[k]; }
        if (any <= 0) r.fill(1);
      }
      if (type === 'raise' || type === 'bet') {
        this.pf.raises++;
        if (this.pf.raises === 1) this.pf.openerIdx = idx;
        this.pf.lastRaiserIdx = idx;
        this.pf.lastRaiseTo = entry.to;
        this.pf.callersAfterRaise = 0;
        this.pf.raisedBy.add(idx);
        this.pf.lastRaiseAllIn = !!entry.allIn;
        this.pfaIdx = idx;
      } else if (type === 'call') {
        if (this.pf.raises === 0) this.pf.limpers++;
        else this.pf.callersAfterRaise++;
      }
      return;
    }
    if (type === 'fold') return;
    const others = h.players.filter((q) => !q.folded && q.idx !== idx).map((q) => this.ranges[q.idx]);
    if (!others.length) return;
    const opp = combineRanges(others);
    const potBefore = Math.max(1, ctx.pot);
    let size = 0.5;
    if (type === 'bet') size = entry.amount / potBefore;
    else if (type === 'raise') size = (entry.to - ctx.currentBet) / Math.max(1, potBefore + ctx.toCall);
    else if (type === 'call') size = ctx.toCall / Math.max(1, potBefore - ctx.toCall);
    const tend = this.perceived(idx);
    const aggression = tend?.aggression ?? 1;
    updateRangePostflop(this.ranges[idx], opp, h.board, type, size, ctx.street, aggression);
  }
}
