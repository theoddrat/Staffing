// AI opponent: starts from the GTO advisor's strategy, bends it with the
// profile's tendencies (looser/tighter, more/less aggressive, sizing habits,
// tilt), and — for adaptive profiles — exploits what it has observed about
// its opponents' HUD stats. Exploits against the hero are reported so the
// coach can tell you how you're being attacked.

import { getAdvice, toEngineAction } from '../gto/advisor.js';
import { weightedPick } from '../engine/rng.js';
import { BASELINE } from './profiles.js';
import { fmt } from '../gto/postflop.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const logit = (p) => Math.log(clamp(p, 1e-4, 1 - 1e-4) / (1 - clamp(p, 1e-4, 1 - 1e-4)));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

export class BotBrain {
  constructor(profile) {
    this.profile = profile;
    this.t = { ...BASELINE, ...profile.tendencies };
    this.tilt = 0;
  }

  /** Update tilt after a hand: big losses raise it, everything else cools it down. */
  onHandEnd(netBB) {
    if (netBB < -20) this.tilt = clamp(this.tilt + this.t.tilt * (netBB < -40 ? 0.6 : 0.35), 0, 1);
    else this.tilt *= 0.8;
  }

  effectiveTendencies() {
    const t = { ...this.t };
    const k = this.tilt;
    if (k > 0.05) {
      t.openMult *= 1 + 0.6 * k;
      t.threeBetMult *= 1 + 0.6 * k;
      t.aggression *= 1 + 0.5 * k;
      t.bluff *= 1 + 0.8 * k;
      t.stickiness *= 1 + 0.4 * k;
      t.shoveMult *= 1 + 0.3 * k;
    }
    return t;
  }

  /**
   * @param {import('../gto/handModel.js').HandModel} model
   * @param {number} idx
   * @param {object} env { rng, statsOf(idx) → derived stats|null, heroIdx }
   * @returns {{action:object, mix:Array, advice:object, exploits:string[]}}
   */
  decide(model, idx, env) {
    const hand = model.hand;
    const t = this.effectiveTendencies();
    const exploits = [];
    const ctx = model.context(idx);
    const target = pickTarget(model, ctx, idx);
    const ts = target >= 0 && env.statsOf ? env.statsOf(target) : null;
    const conf = ts ? clamp((ts.hands - 15) / 60, 0, 1) * t.adapt : 0;
    const vsHero = target === env.heroIdx;
    const name = this.profile.short || this.profile.name;
    const note = (msg) => { if (vsHero && conf > 0.15) exploits.push(`${name} ${msg}`); };

    if (hand.street === 'preflop') {
      if (conf > 0) {
        if (ctx.raises === 1 && target === ctx.lastRaiserIdx) {
          if (ts.foldTo3Bet != null && ts.foldTo3Bet > 0.6) {
            t.threeBetMult *= 1 + 0.8 * conf;
            note(`is 3-betting you lighter — you fold to 3-bets ${Math.round(ts.foldTo3Bet * 100)}% of the time.`);
          }
          if (ts.pfr != null && ts.pfr > 0.28) {
            t.threeBetMult *= 1 + 0.3 * conf;
            t.callMult *= 1 + 0.2 * conf;
            note(`is fighting back against your wide opens (PFR ${Math.round(ts.pfr * 100)}%).`);
          }
        }
        if (ctx.raises === 2 && ctx.heroRaisedThisStreet && target === ctx.lastRaiserIdx && ts.threeBet != null && ts.threeBet > 0.12) {
          t.foldTo3BetMult *= 1 - 0.3 * conf;
          note(`is defending more vs your 3-bets (you 3-bet ${Math.round(ts.threeBet * 100)}%).`);
        }
        if (ctx.raises === 0 && ctx.limpers === 0 && ts.foldToSteal != null && ts.foldToSteal > 0.65 && ['CO', 'BTN', 'SB'].includes(ctx.pos)) {
          t.openMult *= 1 + 0.4 * conf;
          note(`is stealing your blinds more — you fold to steals ${Math.round(ts.foldToSteal * 100)}%.`);
        }
      }
      const advice = getAdvice(model, idx, { tendencies: t, rng: env.rng });
      const mix = advice.mix.map((a) => ({ ...a }));
      // open-raise sizing habit
      if (advice.mode === 'open') {
        for (const a of mix) {
          if (a.type === 'raise' && !a.allIn) {
            const to = Math.round(t.openSizeBB * hand.bb);
            a.to = clamp(to, ctx.minRaiseTo, ctx.maxRaiseTo);
            a.label = `Raise to ${fmt(a.to)}`;
          }
        }
      }
      return this.pick(mix, advice, exploits, env.rng);
    }

    // ---- postflop
    const advice = getAdvice(model, idx, { iterations: env.iterations ?? 700, rng: env.rng });
    const parts = advice.parts;
    const info = advice.info;
    let bluff = t.bluff;
    let stick = t.stickiness;
    let cbet = ctx.isPFA && hand.street === 'flop' ? t.cbet : 1;
    let thinBoost = 1;
    if (conf > 0) {
      if (ctx.toCall === 0) {
        if (ctx.isPFA && hand.street === 'flop' && ts.foldToCbet != null) {
          if (ts.foldToCbet > 0.55) {
            cbet *= 1 + (ts.foldToCbet - 0.45) * 2.5 * conf;
            note(`is c-betting you relentlessly — you fold to ${Math.round(ts.foldToCbet * 100)}% of c-bets.`);
          } else if (ts.foldToCbet < 0.3) {
            bluff *= 1 - 0.4 * conf;
            note(`stopped c-bet bluffing you: you rarely fold to c-bets (${Math.round(ts.foldToCbet * 100)}%).`);
          }
        }
        if (ts.wtsd != null && ts.wtsd > 0.33) {
          bluff *= 1 - 0.5 * conf;
          thinBoost = 1 + 0.8 * conf;
          note(`is value-betting thinner and bluffing less — you go to showdown ${Math.round(ts.wtsd * 100)}%.`);
        }
      } else if (target === ctx.villainIdx) {
        if (ts.af != null && ts.af > 3.5) {
          stick *= 1 + 0.35 * conf;
          note(`is calling you down lighter — your aggression factor is ${ts.af.toFixed(1)}.`);
        } else if (ts.af != null && ts.af < 1.4) {
          stick *= 1 - 0.3 * conf;
          note(`believes your bets — your aggression factor is only ${ts.af.toFixed(1)}.`);
        }
      }
    }

    let mix;
    if (ctx.toCall === 0) {
      const strong = info.ehs > 0.9;
      const pV = clamp(parts.value * t.aggression ** 0.3 * (strong ? 1 - t.trap * 0.5 : 1), 0, 1);
      const air = info.hs < 0.4 ? 1 : 0;
      let pB = parts.bluff * bluff * t.aggression ** 0.5 * cbet;
      pB += Math.max(0, bluff * cbet - 1) * 0.15 * air * (hand.street === 'river' ? 0.7 : 1);
      pB = clamp(pB, 0, 1);
      const pThin = clamp((parts.thin || 0) * thinBoost * t.aggression ** 0.3, 0, 1);
      const pBet = Math.max(pV, pB);
      const betEntry = advice.mix.find((a) => a.type === 'raise' && a.kind !== 'thin');
      const thinEntry = advice.mix.find((a) => a.kind === 'thin');
      const to = betEntry ? this.sizeBet(betEntry, ctx, hand, env.rng, pV >= pB) : 0;
      mix = [{ type: 'check', to: 0, freq: Math.max(0, 1 - pBet - pThin), label: 'Check' }];
      if (betEntry) mix.push({ ...betEntry, to, allIn: to >= ctx.maxRaiseTo, freq: pBet, label: to >= ctx.maxRaiseTo ? 'All-in' : `Bet ${fmt(to)}` });
      if (thinEntry) mix.push({ ...thinEntry, freq: pThin });
    } else {
      const facingAllIn = !ctx.canRaise || ctx.toCall >= ctx.heroStack;
      let cont = sigmoid(logit(parts.cont) + 2.5 * Math.log(stick) + (facingAllIn ? Math.log(t.shoveMult) : 0));
      let raise = facingAllIn ? 0 : parts.raise * t.aggression ** 0.7 * (parts.raiseKind === 'value' ? 1 : bluff);
      if (!facingAllIn && t.aggression > 1.3 && info.hs < 0.5) raise += (t.aggression - 1.3) * 0.12;
      raise = clamp(raise, 0, 1);
      const raiseEntry = advice.mix.find((a) => a.type === 'raise');
      if (!raiseEntry) raise = 0;
      const call = Math.max(0, cont - raise);
      const fold = Math.max(0, 1 - Math.max(cont, raise));
      const callEntry = advice.mix.find((a) => a.type === 'call');
      mix = [{ type: 'fold', to: 0, freq: fold, label: 'Fold' }, { ...callEntry, freq: call }];
      if (raiseEntry) mix.push({ ...raiseEntry, freq: raise });
    }
    return this.pick(mix, advice, exploits, env.rng);
  }

  sizeBet(entry, ctx, hand, rng, isValue) {
    const pot = ctx.pot;
    let frac = entry.sizeFrac || entry.to / Math.max(1, pot);
    switch (this.t.sizing) {
      case 'small': frac = Math.max(0.25, frac * 0.65); break;
      case 'big': frac *= 1.3; break;
      case 'overbet': if (hand.street !== 'flop') frac = Math.max(frac, isValue ? 1.25 : 1.4); else frac *= 1.2; break;
      case 'varied': frac = [0.33, 0.5, 0.75, 1.0, frac][Math.floor(rng() * 5)]; break;
      default: break;
    }
    const to = Math.round(frac * pot);
    return clamp(Math.max(to, hand.bb), ctx.minRaiseTo || to, ctx.maxRaiseTo || to);
  }

  pick(mix, advice, exploits, rng) {
    const total = mix.reduce((s, a) => s + (a.freq || 0), 0) || 1;
    mix.forEach((a) => (a.freq = (a.freq || 0) / total));
    const choice = mix[weightedPick(mix.map((a) => a.freq), rng)];
    return { action: toEngineAction(choice), choice, mix, advice, exploits };
  }
}

/** The opponent this decision is mostly "about": the aggressor we face, else the likeliest caller. */
function pickTarget(model, ctx, idx) {
  const hand = model.hand;
  if (hand.street === 'preflop') {
    if (ctx.lastRaiserIdx >= 0 && ctx.lastRaiserIdx !== idx) return ctx.lastRaiserIdx;
    // unopened: the big blind is usually the player we're stealing from
    const bb = hand.bbIndex;
    return bb !== idx ? bb : -1;
  }
  if (ctx.villainIdx !== undefined) return ctx.villainIdx;
  const others = hand.players.filter((p) => !p.folded && p.idx !== idx);
  return others.length === 1 ? others[0].idx : others.length ? others[0].idx : -1;
}
