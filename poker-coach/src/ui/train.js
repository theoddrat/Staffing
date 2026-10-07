// Train tab: quick drills built on the same strategy the coach uses, and a
// range-chart viewer (opening ranges, big-blind defense, heads-up push/fold).

import { Hand } from '../engine/game.js';
import { makeRng, weightedPick } from '../engine/rng.js';
import { CLASSES, CLASS_COMBOS } from '../engine/ranges.js';
import { HandModel } from '../gto/handModel.js';
import { preflopPolicy, rangeShare } from '../gto/preflopStrategy.js';
import { RFI, VS_OPEN, VS_3BET, PLAYABILITY_RANK } from '../gto/charts.js';
import { headsUpPushFold } from '../gto/pushfold.js';
import { saveStore } from './store.js';
import { esc, pct, fmt, cardHTML, bindTooltips } from './dom.js';
import { rangeGridHTML, rangeLegendHTML } from './rangeGrid.js';

const NINE = ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO']; // canonical by offset from button
const OPEN_POS = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB'];
const DRILLS = {
  rfi: { name: 'Open or fold', blurb: 'Folded to you at 40–60bb. Raise or fold?' },
  bbdef: { name: 'Defend the big blind', blurb: 'Someone opens, you are in the big blind. 3-bet, call or fold?' },
  pushfold: { name: 'Push or fold', blurb: 'Short-stacked and folded to you. Jam or fold?' },
  potodds: { name: 'Pot odds & MDF', blurb: 'How much equity do you need to call?' },
};

export class TrainView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.rng = makeRng();
    this.type = 'rfi';
    this.q = null;
    this.chart = 'rfi:CO';
    this.huStack = 10;
  }

  get store() { return this.app.store; }

  mount() {
    const d = this.store.drills;
    this.root.innerHTML = `
      <div class="eyebrow">Practice</div>
      <h1 class="section-title" style="font-size:36px;margin-bottom:12px">Train</h1>
      <div class="grid-2" style="align-items:start">
        <div class="stack">
          <div class="seg" role="group" aria-label="Drill type" style="align-self:flex-start;flex-wrap:wrap">
            ${Object.entries(DRILLS).map(([k, v]) => `<button data-type="${k}" aria-pressed="${this.type === k}">${v.name}</button>`).join('')}
          </div>
          <div class="panel panel-pad drill-card" id="drill"></div>
          <div class="small muted">Drill record: ${fmt(d.correct)} / ${fmt(d.attempts)} correct${d.attempts ? ` (${pct(d.correct / d.attempts)})` : ''}${Object.entries(d.byType || {}).map(([k, v]) => ` · ${DRILLS[k]?.name || k}: ${v.c}/${v.n}`).join('')}</div>
        </div>
        <div class="panel panel-pad">
          <div class="row" style="justify-content:space-between;margin-bottom:8px">
            <h3 style="font-size:17px">Range charts</h3>
            <select class="text small" id="chart-sel" aria-label="Chart">${this.chartOptions()}</select>
          </div>
          <div id="chart-extra"></div>
          <div id="chart-body"></div>
        </div>
      </div>`;
    this.root.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { this.type = b.dataset.type; this.q = null; this.mount(); }));
    this.root.querySelector('#chart-sel').addEventListener('change', (e) => { this.chart = e.target.value; this.renderChart(); });
    bindTooltips(this.root);
    if (!this.q) this.newQuestion();
    this.renderDrill();
    this.renderChart();
  }

  // ---------------------------------------------------------------- drills
  newQuestion() {
    if (this.type === 'potodds') { this.q = potOddsQuestion(this.rng); return; }
    const spot = buildSpot(this.type, this.rng);
    const ctx = spot.model.context(spot.heroIdx);
    const pol = preflopPolicy(ctx);
    // favour instructive hands near the edge of the range
    const agg = (h) => pol.raise[h] + pol.jam[h];
    const cont = (h) => agg(h) + pol.call[h];
    const weights = CLASSES.map((c) => {
      const a = cont(c.idx);
      const edge = a > 0.05 && a < 0.95 ? 6 : 0;
      const nearEdge = Math.abs(a - 0.5) < 0.5 && (agg(c.idx) > 0 || pol.call[c.idx] > 0) ? 1.5 : 1;
      return c.combos * (1 + edge) * nearEdge;
    });
    const h = weightedPick(weights, this.rng);
    const combos = CLASS_COMBOS[h];
    const cards = combos[Math.floor(this.rng() * combos.length)];
    this.q = { spot, ctx, pol, h, cards, answered: null };
  }

  renderDrill() {
    const el = this.root.querySelector('#drill');
    const q = this.q;
    if (this.type === 'potodds') { this.renderPotOdds(el); return; }
    const { ctx, spot } = q;
    const bb = ctx.bb;
    const facing = this.type === 'bbdef';
    const options = this.type === 'pushfold' ? [['jam', 'All-in'], ['fold', 'Fold']]
      : facing ? [['raise', '3-bet'], ['call', 'Call'], ['fold', 'Fold']]
        : [['raise', 'Raise'], ['fold', 'Fold']];
    el.innerHTML = `
      <div class="eyebrow">${esc(DRILLS[this.type].name)}</div>
      <div class="drill-q">${esc(spot.desc)}</div>
      <div class="drill-hand">${q.cards.map((c) => cardHTML(c, 'lg')).join('')}</div>
      <div class="small muted">${CLASSES[q.h].label} · ${(ctx.heroStack + ctx.heroBet) / bb >= 1 ? `${((ctx.heroStack + ctx.heroBet) / bb).toFixed(0)}bb stack` : ''} · 9-handed, BB ante</div>
      <div class="row">${options.map(([k, l]) => `<button class="btn ${q.answered ? '' : 'dark'}" data-ans="${k}" ${q.answered ? 'disabled' : ''}>${l}</button>`).join('')}</div>
      <div id="drill-fb"></div>`;
    el.querySelectorAll('[data-ans]').forEach((b) => b.addEventListener('click', () => this.answer(b.dataset.ans)));
    if (q.answered) this.renderFeedback();
  }

  answer(a) {
    const q = this.q;
    if (q.answered) return;
    const { pol, h } = q;
    const freqs = { raise: pol.raise[h] + (this.type === 'pushfold' ? 0 : pol.jam[h]), jam: pol.jam[h] + (this.type === 'pushfold' ? pol.raise[h] : 0), call: pol.call[h], fold: pol.fold[h] };
    const best = Math.max(...Object.values(freqs));
    const correct = freqs[a] >= Math.max(0.3, best - 0.15);
    q.answered = { a, correct, freqs };
    const d = this.store.drills;
    d.attempts++;
    if (correct) d.correct++;
    const bt = (d.byType ||= {});
    bt[this.type] ||= { n: 0, c: 0 };
    bt[this.type].n++;
    if (correct) bt[this.type].c++;
    saveStore(this.store);
    this.renderDrill();
  }

  renderFeedback() {
    const q = this.q;
    const el = this.root.querySelector('#drill-fb');
    const { freqs, correct } = q.answered;
    const label = CLASSES[q.h].label;
    const show = Object.entries(freqs).filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
    const names = { raise: this.type === 'bbdef' ? '3-bet' : 'Raise', jam: 'All-in', call: 'Call', fold: 'Fold' };
    let extra = '';
    if (q.pol.shoveEV && Number.isFinite(q.pol.shoveEV[q.h])) extra = `<p class="small" style="margin:6px 0 0">Shove EV vs folding: <b>${(q.pol.shoveEV[q.h] / q.ctx.bb >= 0 ? '+' : '')}${(q.pol.shoveEV[q.h] / q.ctx.bb).toFixed(2)}bb</b> (chip EV, Nash-style calling ranges).</p>`;
    el.innerHTML = `
      <p style="margin:0;font-weight:700" class="${correct ? 'pos' : 'neg'}">${correct ? 'Correct.' : 'Not quite.'} ${esc(label)}: ${show.map(([k, v]) => `${names[k]} ${pct(v)}`).join(' · ')}</p>
      ${extra}
      <ul class="notes">${q.pol.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      <div style="margin-top:10px">${rangeGridHTML({ aggressive: Float64Array.from(CLASSES, (c) => q.pol.raise[c.idx] + q.pol.jam[c.idx]), passive: q.pol.call }, { heroClass: q.h })}<div style="margin-top:6px">${rangeLegendHTML({ aggressive: this.type === 'pushfold' ? 'All-in' : this.type === 'bbdef' ? '3-bet' : 'Raise', passive: 'Call' }, this.type === 'bbdef')}</div></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="next-q">Next hand</button></div>`;
    el.querySelector('#next-q').addEventListener('click', () => { this.newQuestion(); this.renderDrill(); });
  }

  renderPotOdds(el) {
    const q = this.q;
    el.innerHTML = `
      <div class="eyebrow">Pot odds & MDF</div>
      <div class="drill-q">Pot is ${fmt(q.pot)}. Villain bets ${fmt(q.bet)} (${Math.round(q.frac * 100)}% pot). How much equity do you need to call?</div>
      <div class="row">${q.choices.map((c, i) => `<button class="btn ${q.answered ? '' : 'dark'}" data-ch="${i}" ${q.answered ? 'disabled' : ''}>${pct(c, 1)}</button>`).join('')}</div>
      <div id="drill-fb">${q.answered ? `
        <p style="margin:0;font-weight:700" class="${q.answered.correct ? 'pos' : 'neg'}">${q.answered.correct ? 'Correct.' : 'Not quite.'} You need ${pct(q.req, 1)}.</p>
        <ul class="notes"><li>Call ${fmt(q.bet)} to win ${fmt(q.pot + q.bet)}: ${fmt(q.bet)} ÷ (${fmt(q.pot + q.bet)} + ${fmt(q.bet)}) = ${pct(q.req, 1)}.</li>
        <li>Minimum defense frequency: ${fmt(q.pot)} ÷ (${fmt(q.pot)} + ${fmt(q.bet)}) = ${pct(q.mdf)}. Defend at least this share of your range or villain profits by betting any two cards.</li>
        <li>Bigger bets demand more equity but let you fold more: a pot-size bet needs 33% equity, a half-pot bet only 25%.</li></ul>
        <div class="row" style="margin-top:12px"><button class="btn primary" id="next-q">Next question</button></div>` : ''}</div>`;
    el.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.ch);
      const correct = Math.abs(q.choices[i] - q.req) < 1e-9;
      q.answered = { correct };
      const d = this.store.drills;
      d.attempts++;
      if (correct) d.correct++;
      const bt = (d.byType ||= {});
      bt.potodds ||= { n: 0, c: 0 };
      bt.potodds.n++;
      if (correct) bt.potodds.c++;
      saveStore(this.store);
      this.renderPotOdds(el);
    }));
    el.querySelector('#next-q')?.addEventListener('click', () => { this.q = potOddsQuestion(this.rng); this.renderPotOdds(el); });
  }

  // ---------------------------------------------------------------- charts
  chartOptions() {
    const opts = [];
    for (const p of OPEN_POS) opts.push([`rfi:${p}`, `Open (raise first in) · ${p}`]);
    for (const g of ['EP', 'MP', 'LP', 'SB']) opts.push([`bb:${g}`, `Big blind vs ${{ EP: 'early', MP: 'middle', LP: 'late', SB: 'small blind' }[g]} open`]);
    for (const g of ['EP', 'MP', 'LP']) opts.push([`ip:${g}`, `In position vs ${{ EP: 'early', MP: 'middle', LP: 'late' }[g]} open`]);
    opts.push(['v3:IP', 'Facing a 3-bet · in position'], ['v3:OOP', 'Facing a 3-bet · out of position']);
    opts.push(['hu:push', 'Heads-up push/fold · small blind jam'], ['hu:call', 'Heads-up push/fold · big blind call']);
    return opts.map(([v, l]) => `<option value="${v}" ${v === this.chart ? 'selected' : ''}>${esc(l)}</option>`).join('');
  }

  renderChart() {
    const body = this.root.querySelector('#chart-body');
    const extra = this.root.querySelector('#chart-extra');
    const [kind, key] = this.chart.split(':');
    let grid;
    let labels = { aggressive: 'Raise', passive: 'Call' };
    let note = '';
    extra.innerHTML = '';
    if (kind === 'rfi') {
      grid = { aggressive: RFI[key] };
      note = `${pct(rangeShare(RFI[key]), 1)} of hands. ${key === 'SB' ? 'Small blind shown as a simplified raise-or-fold strategy.' : 'Cumulative: every hand here is also an open from later positions.'}`;
    } else if (kind === 'bb' || kind === 'ip') {
      const c = VS_OPEN[key][kind === 'bb' ? 'BB' : 'IP'];
      grid = { aggressive: c.threeBet, passive: c.call };
      labels = { aggressive: '3-bet', passive: 'Call' };
      note = `3-bet ${pct(rangeShare(c.threeBet), 1)} · call ${pct(rangeShare(c.call), 1)} (overlapping hands mix).`;
    } else if (kind === 'v3') {
      const c = VS_3BET[key];
      grid = { aggressive: c.fourBet, passive: c.call };
      labels = { aggressive: '4-bet', passive: 'Call' };
      note = 'Shown for an early-position open. Late-position openers continue wider so they can\'t be 3-bet with any two cards; the coach scales this automatically.';
    } else {
      extra.innerHTML = `<label class="row small" style="margin-bottom:8px">Effective stack <input type="range" id="hu-stack" min="2" max="25" step="1" value="${this.huStack}" aria-label="Effective stack in big blinds"> <b class="data" id="hu-val">${this.huStack}bb</b></label>`;
      extra.querySelector('#hu-stack').addEventListener('input', (e) => { this.huStack = Number(e.target.value); extra.querySelector('#hu-val').textContent = `${this.huStack}bb`; this.renderChart(); });
      const sol = headsUpPushFold(this.huStack, 0);
      grid = { aggressive: key === 'push' ? sol.push : sol.call };
      labels = { aggressive: key === 'push' ? 'Jam' : 'Call the jam' };
      note = `Nash equilibrium (no ante), solved live by fictitious play over the 169 hand classes: ${key === 'push' ? 'jam' : 'call'} ${pct(rangeShare(grid.aggressive), 1)} of hands at ${this.huStack}bb.`;
    }
    body.innerHTML = `${rangeGridHTML(grid, { big: true, labels })}<div style="margin-top:8px">${rangeLegendHTML(labels, !!grid.passive)}</div><p class="small muted" style="margin:8px 0 0">${esc(note)}</p>`;
  }
}

// ------------------------------------------------------------------ helpers

/** Build a 9-handed preflop spot with the hero (seat 0) facing the drill's situation. */
export function buildSpot(type, rng) {
  const n = 9;
  const bb = 200;
  let heroPos;
  let openerPos = null;
  let heroBB = 40 + Math.floor(rng() * 21);
  if (type === 'rfi') heroPos = OPEN_POS[Math.floor(rng() * OPEN_POS.length)];
  else if (type === 'pushfold') { heroPos = OPEN_POS[Math.floor(rng() * OPEN_POS.length)]; heroBB = 4 + Math.floor(rng() * 11); }
  else { heroPos = 'BB'; openerPos = OPEN_POS[Math.floor(rng() * OPEN_POS.length)]; }
  const offset = NINE.indexOf(heroPos);
  const button = (n - offset) % n; // seat 0 sits `offset` seats after the button
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: i === 0 ? 'You' : `Player ${i + 1}`, stack: i === 0 ? heroBB * bb : (25 + Math.floor(rng() * 50)) * bb }));
  const hand = new Hand({ players, button, sb: bb / 2, bb, ante: bb, rng }).start();
  const model = new HandModel(hand);
  let guard = 0;
  while (hand.toAct !== 0 && !hand.complete && guard++ < 20) {
    const idx = hand.toAct;
    const ctx = model.context(idx);
    const pos = hand.players[idx].position.canonical;
    let entry;
    if (openerPos && pos === openerPos && ctx.raises === 0) entry = hand.act({ type: 'raise', to: pos === 'SB' ? 3 * bb : Math.round(2.2 * bb) });
    else entry = hand.act({ type: 'fold' });
    model.record(idx, entry, ctx);
  }
  const desc = type === 'bbdef'
    ? `${openerPos} opens to ${openerPos === 'SB' ? '3' : '2.2'}bb, everyone else folds. You're in the big blind.`
    : type === 'pushfold'
      ? `Folded to you in the ${heroPos} with ${heroBB}bb.`
      : `Folded to you in the ${heroPos}.`;
  return { hand, model, heroIdx: 0, desc };
}

function potOddsQuestion(rng) {
  const pot = (4 + Math.floor(rng() * 40)) * 500;
  const fracs = [0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.25, 1.5, 2];
  const frac = fracs[Math.floor(rng() * fracs.length)];
  const bet = Math.round((pot * frac) / 100) * 100;
  const req = bet / (pot + 2 * bet);
  const mdf = pot / (pot + bet);
  const wrong = [bet / (pot + bet), bet / pot / 2, 1 - mdf + 0.05, req + 0.08, req - 0.06].filter((x) => x > 0.03 && x < 0.9 && Math.abs(x - req) > 0.02);
  const picks = [];
  for (const w of wrong) if (picks.length < 3 && !picks.some((p) => Math.abs(p - w) < 0.02)) picks.push(w);
  const choices = [req, ...picks].sort((a, b) => a - b);
  return { pot, bet, frac, req, mdf, choices, answered: null };
}

export { PLAYABILITY_RANK };
