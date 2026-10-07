// UI-agnostic game session: runs a tournament with the hero and AI
// opponents, tracks perceived ranges, HUD stats and the hero's graded
// decisions, and produces hand records for history and style learning.

import { Tournament } from '../engine/tournament.js';
import { makeRng } from '../engine/rng.js';
import { HandModel } from '../gto/handModel.js';
import { getAdvice, gradeDecision } from '../gto/advisor.js';
import { BotBrain } from '../ai/bot.js';
import { getProfile } from '../ai/profiles.js';
import { recordFromHand } from '../stats/handRecord.js';
import { handFlags, addFlags, emptyAgg, mergeAgg, deriveStats } from '../stats/stats.js';
import { statsToTendencies } from '../stats/style.js';
import { cardsToString } from '../engine/cards.js';

export const HERO_ID = 'hero';

/** Name a decision spot for leak grouping. */
export function spotName(advice) {
  const ctx = advice.ctx || {};
  if (advice.street === 'preflop') {
    const m = advice.mode || '';
    if (m === 'push/fold') return 'Preflop: push/fold';
    if (m === 'raise/jam') return 'Preflop: short-stack open';
    if (m === 'open') return 'Preflop: first in (open)';
    if (m === 'vs limp') return 'Preflop: vs limpers';
    if (m === 'reshove') return 'Preflop: re-shove vs open';
    if (m === 'vs all-in') return 'Preflop: facing all-in';
    if (m === 'squeeze') return 'Preflop: squeeze spot';
    if (m === 'vs 3-bet' || m === 'cold vs 3-bet') return 'Preflop: facing 3-bet';
    if (m === 'vs 4-bet+') return 'Preflop: facing 4-bet+';
    if (m === 'vs open') return ctx.pos === 'BB' ? 'Preflop: big blind defense' : ctx.pos === 'SB' ? 'Preflop: small blind vs open' : 'Preflop: facing an open';
    return `Preflop: ${m}`;
  }
  const st = advice.street[0].toUpperCase() + advice.street.slice(1);
  if (ctx.toCall > 0) {
    if (ctx.villainAllIn || ctx.toCall >= ctx.heroStack) return `${st}: facing all-in`;
    if (advice.street === 'flop' && ctx.villainIdx !== undefined && ctx.villainIdx === ctx.pfaIdxHint) return 'Flop: facing c-bet';
    return `${st}: facing a bet`;
  }
  if (advice.street === 'flop') return ctx.isPFA ? 'Flop: c-bet decision' : 'Flop: checked to / out of position';
  return `${st}: ${ctx.isPFA ? 'betting as aggressor' : 'bet or check'}`;
}

export class Session {
  /**
   * @param {object} cfg
   * @param {string} cfg.scenario
   * @param {string[]} cfg.lineup profile ids for the AI seats
   * @param {string} [cfg.heroName]
   * @param {number} [cfg.seed]
   * @param {object} [cfg.heroAgg] persisted hero aggregate (for bot exploitation)
   * @param {object} [cfg.knownAggs] persisted aggregates by player name
   * @param {(id:string)=>object|null} [cfg.resolveProfile] for custom/imported/mirror profiles
   * @param {boolean} [cfg.autoHero] let a GTO bot play the hero seat (simulations)
   * @param {string|null} [cfg.heroProfileId] profile for autoHero
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.rng = makeRng(cfg.seed);
    this.heroName = cfg.heroName || 'You';
    const resolve = (id) => cfg.resolveProfile?.(id) || getProfile(id);
    const seatsN = cfg.lineup.length + 1;
    // hero sits at seat 0; AI seats follow
    const players = [{ id: HERO_ID, name: this.heroName, isHero: true }];
    this.profiles = [null];
    cfg.lineup.forEach((pid, i) => {
      const prof = resolve(pid) || getProfile('gto');
      this.profiles.push(prof);
      players.push({ id: `${prof.id}#${i}`, name: uniqueName(prof.name, players), profileId: prof.id });
    });
    this.tournament = new Tournament({ players, scenario: cfg.scenario, rng: this.rng, buyIn: cfg.buyIn });
    this.bots = this.profiles.map((p) => (p ? new BotBrain(p) : null));
    this.heroBot = cfg.autoHero ? new BotBrain(resolve(cfg.heroProfileId || 'gto')) : null;
    this.sessionAggs = new Map(); // name → agg observed in this session
    this.knownAggs = cfg.knownAggs || {}; // name → persisted agg
    this.heroAggPersisted = cfg.heroAgg || emptyAgg();
    this.records = [];
    this.decisions = [];
    this.current = null;
    this.handCount = 0;
    this.n = seatsN;
  }

  /** Aggregate of everything known about a player name (persisted + this session). */
  aggFor(name, isHero) {
    const sess = this.sessionAggs.get(name) || emptyAgg();
    const known = isHero ? this.heroAggPersisted : this.knownAggs[name];
    return known ? mergeAgg(known, sess) : sess;
  }

  statsForSeat(seat) {
    const s = this.tournament.seats[seat];
    return deriveStats(this.aggFor(s.name, s.id === HERO_ID));
  }

  startHand() {
    const hand = this.tournament.nextHand();
    const heroIdx = hand.seatMap.indexOf(0);
    const remaining = this.tournament.activeSeats().length;
    const payouts = this.tournament.payouts.slice(0, remaining);
    const model = new HandModel(hand, {
      payouts: payouts.length ? payouts : null,
      perceivedTendencies: (idx) => {
        const seat = this.tournament.seats[hand.seatMap[idx]];
        const agg = this.aggFor(seat.name, seat.id === HERO_ID);
        if (agg.hands < 20) return null;
        return statsToTendencies(deriveStats(agg));
      },
    });
    this.current = { hand, model, heroIdx, decisions: [], exploits: [], adviceCache: null, botActions: [] };
    this.handCount++;
    return this.current;
  }

  get hand() {
    return this.current?.hand;
  }

  isHeroTurn() {
    const c = this.current;
    return c && !c.hand.complete && c.hand.toAct === c.heroIdx && !this.heroBot;
  }

  /** Advice for the hero's current decision (cached until the hero acts). */
  heroAdvice() {
    const c = this.current;
    if (!c || c.hand.complete || c.hand.toAct !== c.heroIdx) return null;
    const key = `${c.hand.street}|${c.hand.log.length}`;
    if (c.adviceCache?.key === key) return c.adviceCache.advice;
    const advice = getAdvice(c.model, c.heroIdx, { rng: this.rng });
    advice.ctx.pfaIdxHint = c.model.pfaIdx;
    c.adviceCache = { key, advice };
    return advice;
  }

  envFor() {
    const c = this.current;
    return {
      rng: this.rng,
      heroIdx: c.heroIdx,
      statsOf: (idx) => {
        const seat = this.tournament.seats[c.hand.seatMap[idx]];
        return deriveStats(this.aggFor(seat.name, seat.id === HERO_ID));
      },
    };
  }

  /** Let the AI player to act take its action. Returns the log entry. */
  botAct() {
    const c = this.current;
    const idx = c.hand.toAct;
    const seat = c.hand.seatMap[idx];
    const brain = seat === 0 ? this.heroBot : this.bots[seat];
    if (!brain) throw new Error('Not a bot seat');
    if (seat === 0) this.heroAdvice(); // still grade auto-hero decisions in simulations
    const ctx = c.model.context(idx);
    const res = brain.decide(c.model, idx, this.envFor());
    for (const e of res.exploits) if (!c.exploits.includes(e)) c.exploits.push(e);
    const entry = c.hand.act(res.action);
    c.model.record(idx, entry, ctx);
    if (seat === 0) this._gradeHero(entry, ctx);
    c.botActions.push({ idx, entry });
    return { idx, entry, choice: res.choice };
  }

  /** Apply the hero's action ({type, to}). Returns {entry, decision}. */
  heroAct(action) {
    const c = this.current;
    if (c.hand.toAct !== c.heroIdx) throw new Error('Not hero turn');
    const ctx = c.model.context(c.heroIdx);
    this.heroAdvice();
    const entry = c.hand.act(action);
    c.model.record(c.heroIdx, entry, ctx);
    const decision = this._gradeHero(entry, ctx);
    return { entry, decision };
  }

  _gradeHero(entry, ctx) {
    const c = this.current;
    const advice = c.adviceCache?.advice;
    if (!advice) return null;
    c.adviceCache = null;
    const g = gradeDecision(advice, { type: entry.type, to: entry.to, allIn: entry.allIn });
    const decision = {
      street: advice.street,
      spot: spotName(advice),
      grade: g.grade,
      freq: g.freq,
      evLossBB: g.evLossBB,
      message: g.message,
      taken: describeEntry(entry),
      best: advice.best?.label,
      mix: advice.mix.map((a) => ({ label: a.label, freq: Math.round(a.freq * 100) / 100 })),
      notes: advice.notes.slice(0, 6),
      cards: cardsToString(c.hand.players[c.heroIdx].hole),
      board: ctx.board ? cardsToString(ctx.board) : '',
      pos: ctx.posDisplay,
      handNo: c.hand.id,
    };
    c.decisions.push(decision);
    return decision;
  }

  /** Run bots until it's the hero's turn or the hand ends (headless use). */
  runBots(limit = 500) {
    const c = this.current;
    let k = 0;
    while (!c.hand.complete && (c.hand.toAct !== c.heroIdx || this.heroBot) && k++ < limit) this.botAct();
  }

  /** Finalize a completed hand: records, stats, tilt, tournament bookkeeping. */
  finishHand() {
    const c = this.current;
    const hand = c.hand;
    if (!hand.complete) throw new Error('Hand not complete');
    const profileIds = hand.seatMap.map((s) => this.profiles[s]?.id || null);
    const rec = recordFromHand(hand, {
      heroIdx: c.heroIdx, profileIds, scenario: this.cfg.scenario, decisions: c.decisions, includeText: true,
    });
    rec.exploits = c.exploits;
    const flags = handFlags(rec);
    flags.forEach((fl, i) => {
      const name = hand.players[i].name;
      const agg = this.sessionAggs.get(name) || emptyAgg();
      addFlags(agg, fl, hand.players[i].position.canonical);
      this.sessionAggs.set(name, agg);
    });
    hand.players.forEach((p, i) => {
      const seat = hand.seatMap[i];
      const bot = this.bots[seat];
      if (bot) bot.onHandEnd((p.stack - p.startStack) / hand.bb);
    });
    const busted = this.tournament.completeHand(hand);
    this.records.push(rec);
    this.decisions.push(...c.decisions);
    return { record: rec, flags, heroFlags: flags[c.heroIdx], busted, decisions: c.decisions };
  }

  heroSeat() {
    return this.tournament.seats[0];
  }

  isOver() {
    return this.tournament.isOver() || (this.heroSeat().busted && !this.cfg.continueAfterBust);
  }
}

function uniqueName(name, players) {
  let n = name;
  let k = 2;
  while (players.some((p) => p.name === n)) n = `${name} ${k++}`;
  return n;
}

function describeEntry(e) {
  switch (e.type) {
    case 'fold': return 'Fold';
    case 'check': return 'Check';
    case 'call': return `Call ${e.amount}${e.allIn ? ' (all-in)' : ''}`;
    case 'bet': return `Bet ${e.amount}${e.allIn ? ' (all-in)' : ''}`;
    case 'raise': return `Raise to ${e.to}${e.allIn ? ' (all-in)' : ''}`;
    default: return e.type;
  }
}
