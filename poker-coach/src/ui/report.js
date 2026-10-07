// "My Style" report: style classification, closest pro, stat fingerprint vs a
// solid baseline, leaks, accuracy trends, positional breakdown and an
// optional AI-written study plan.

import { deriveStats, BASELINE_STATS } from '../stats/stats.js';
import { classifyStyle, playsLike, findStatLeaks, findDecisionLeaks } from '../stats/style.js';
import { PROFILE_HUD } from '../data/profileHud.js';
import { heroAggAll, saveStore } from './store.js';
import { esc, pct, fmt, avatarHTML, gradeHTML, bindTooltips, cardsHTML } from './dom.js';
import { bulletRowsHTML, drawLine, drawGroupedBars, hBarsHTML } from './charts.js';
import { GRADE_SCORE } from '../gto/advisor.js';
import { askCoach, coachAvailable, studyPlanPrompt } from '../coach/llmCoach.js';

const POS_ORDER = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

const FINGERPRINT = [
  ['vpip', 'VPIP', 0.7], ['pfr', 'PFR', 0.6], ['threeBet', '3-bet', 0.3], ['foldTo3Bet', 'Fold to 3-bet', 1],
  ['steal', 'Steal', 1], ['bbDefense', 'BB defense', 1], ['cbet', 'Flop c-bet', 1], ['foldToCbet', 'Fold to c-bet', 1],
  ['af', 'Aggression (AF)', 6], ['wtsd', 'Went to showdown', 0.6], ['wsd', 'Won at showdown', 1],
];

export class ReportView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.onResize = () => { if (this.app.currentTab === 'report') this.drawCharts(); };
    window.addEventListener('resize', debounce(this.onResize, 200));
  }

  get store() { return this.app.store; }

  mount() {
    const agg = heroAggAll(this.store);
    const live = deriveStats(agg);
    const example = live.hands < 15;
    const stats = example ? exampleStats() : live;
    const style = classifyStyle(stats);
    const pros = this.app.allProfiles().filter((p) => p.kind === 'pro' || p.kind === 'archetype');
    const likes = playsLike(stats, pros, PROFILE_HUD).slice(0, 3);
    const twin = likes[0]?.profile;
    const statLeaks = findStatLeaks(stats);
    const decisions = this.store.hero.decisions;
    const decLeaks = findDecisionLeaks(decisions, 4);
    const accAll = decisions.length ? decisions.reduce((s, d) => s + (GRADE_SCORE[d.grade] ?? 0.5), 0) / decisions.length : null;
    const evLost = decisions.reduce((s, d) => s + (d.evLossBB || 0), 0);
    this.state = { stats, live, example, twin, agg, decisions };

    const tile = (k, v, d = '', st = '') => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>${d || st ? `<div class="d">${st}${d}</div>` : ''}</div>`;
    const statusFor = (key) => {
      const v = stats[key];
      const b = BASELINE_STATS[key];
      if (v == null || !b) return '';
      return v < b[0] || v > b[2] ? '<span class="status st-leak">outside range</span> ' : '<span class="status st-ok">solid</span> ';
    };
    const fpRows = FINGERPRINT.map(([key, label, max]) => {
      const [lo, target, hi] = BASELINE_STATS[key];
      const twinV = twin ? PROFILE_HUD[twin.id]?.[key] : null;
      const f = key === 'af' ? (v) => v.toFixed(1) : (v) => pct(v);
      return { label, values: [stats[key], twinV ?? null], lo, hi, target, max, fmt: f };
    });

    const mistakes = [];
    for (const h of this.store.hands) {
      for (const d of h.decisions || []) if (d.grade === 'mistake' || d.grade === 'blunder') mistakes.push({ d, h });
      if (mistakes.length >= 8) break;
    }

    this.root.innerHTML = `
      ${example ? `<div class="panel panel-pad" style="margin-bottom:14px;border-color:var(--gold)"><b>Example report.</b> <span class="muted">The style, stats and leaks below belong to a made-up sample player until you have 15 hands (play, or import your hand histories). Your graded decisions and mistakes further down are real.</span> <button class="btn small" id="go-play" style="margin-left:8px">Play a tournament</button> <button class="btn small" id="go-import">Import hands</button></div>` : ''}
      <div class="eyebrow">${example ? 'Example player' : esc(this.store.settings.heroName || 'You')} · ${fmt(stats.hands)} hands${!example && this.store.hero.importedAgg?.hands ? ` (${fmt(this.store.hero.importedAgg.hands)} imported)` : ''}</div>
      <div class="hero-style" style="margin:8px 0 16px">
        <div class="panel panel-pad">
          <div class="eyebrow">Your style</div>
          <div class="style-name">${esc(style.label)}</div>
          <p style="margin:8px 0 0;max-width:62ch;color:var(--ink-2)">${esc(style.blurb)}</p>
          ${statLeaks[0] ? `<p class="small" style="margin:10px 0 0"><b>Biggest stat leak:</b> ${esc(statLeaks[0].title)}.</p>` : ''}
        </div>
        <div class="panel panel-pad">
          <div class="eyebrow" style="margin-bottom:8px">You play most like</div>
          <div class="likeness">${likes.map((l) => `<div class="like-row">${avatarHTML(l.profile.name, l.profile.color)}<div style="min-width:0"><div style="font-weight:700">${esc(l.profile.name)}</div><div class="meter"><i style="width:${l.similarity}%"></i></div></div><span class="data small" style="text-align:right">${l.similarity}%</span></div>`).join('') || '<span class="muted small">Needs more hands.</span>'}</div>
          <p class="small muted" style="margin:10px 0 0">Similarity compares your HUD stats with each AI profile's measured stats.</p>
          ${!example ? '<div class="row" style="margin-top:10px"><button class="btn small" id="mirror-btn">Play against your mirror</button></div>' : ''}
        </div>
      </div>
      <div class="tiles" style="margin-bottom:16px">
        ${tile('VPIP', pct(stats.vpip), '', statusFor('vpip'))}
        ${tile('PFR', pct(stats.pfr), '', statusFor('pfr'))}
        ${tile('3-bet', pct(stats.threeBet), '', statusFor('threeBet'))}
        ${tile('Aggression', stats.af == null ? '—' : stats.af.toFixed(1), '', statusFor('af'))}
        ${tile('Went to showdown', pct(stats.wtsd), '', statusFor('wtsd'))}
        ${tile('Win rate', stats.bb100 == null ? '—' : `${stats.bb100 >= 0 ? '+' : ''}${stats.bb100.toFixed(1)}`, 'bb/100 hands')}
        ${tile('GTO accuracy', example || accAll == null ? '—' : pct(accAll), example ? '' : `${fmt(decisions.length)} decisions`)}
        ${tile('Est. EV given up', example ? '—' : `${evLost.toFixed(0)}bb`, example ? '' : 'measurable spots only')}
      </div>
      <div class="panel panel-pad" style="margin-bottom:16px">
        <div class="row" style="justify-content:space-between;margin-bottom:6px"><h3 style="font-size:17px">Your fingerprint vs a solid tournament baseline</h3><span class="small muted">${twin ? `Compared with ${esc(twin.name)} (closest profile)` : ''}</span></div>
        ${bulletRowsHTML(fpRows, twin ? [example ? 'Example player' : 'You', twin.name] : ['You'])}
        <p class="small muted" style="margin:8px 0 0">The shaded band is where a solid player lands, and the tick is the target. Bands come from the GTO bot's measured play, widened for normal variance.</p>
      </div>
      <div class="grid-2" style="margin-bottom:16px">
        <div class="panel panel-pad">
          <h3 style="font-size:17px;margin-bottom:6px">Leaks to fix</h3>
          ${statLeaks.length || decLeaks.length ? `<div>${statLeaks.slice(0, 5).map((l) => leakHTML(l.title, l.detail, l.severity)).join('')}${(example ? [] : decLeaks).filter((l) => l.accuracy < 0.8).slice(0, 3).map((l) => leakHTML(`Decisions: ${l.spot}`, `${pct(l.accuracy)} accuracy over ${l.n} decisions${l.evLoss > 0.5 ? `, about ${l.evLoss.toFixed(1)}bb given up` : ''}${l.mistakes ? `, ${l.mistakes} mistakes` : ''}.`, l.accuracy < 0.6 ? 2.5 : 1.5)).join('')}</div>` : '<p class="muted small">No leaks stand out yet. Keep playing: leaks show up once a stat has enough samples.</p>'}
        </div>
        <div class="panel panel-pad">
          <h3 style="font-size:17px;margin-bottom:6px">Accuracy by spot${example ? ' <span class="small muted" style="font-weight:400">· your real decisions</span>' : ''}</h3>
          ${decLeaks.length ? hBarsHTML(decLeaks.slice(0, 9).map((l) => ({ label: l.spot, value: l.accuracy, tip: `<b>${esc(l.spot)}</b><br>${pct(l.accuracy)} accuracy · ${l.n} decisions${l.evLoss > 0 ? ` · ${l.evLoss.toFixed(1)}bb lost` : ''}` }))) : '<p class="muted small">Play more hands to see which spots cost you the most (at least 4 decisions per spot).</p>'}
        </div>
      </div>
      <div class="grid-2" style="margin-bottom:16px">
        <div class="panel panel-pad"><h3 style="font-size:17px">GTO accuracy by tournament</h3><div id="acc-chart" style="margin-top:8px"></div></div>
        <div class="panel panel-pad"><h3 style="font-size:17px">VPIP and PFR by position</h3><div id="pos-legend" class="legend" style="margin-top:6px"><span><i style="background:var(--series-1)"></i>VPIP</span><span><i style="background:var(--series-2)"></i>PFR</span></div><div id="pos-chart"></div></div>
      </div>
      <div class="grid-2">
        <div class="panel panel-pad">
          <h3 style="font-size:17px;margin-bottom:6px">Recent mistakes${example ? ' <span class="small muted" style="font-weight:400">· your real hands</span>' : ''}</h3>
          ${mistakes.length ? `<div class="stack" style="gap:8px">${mistakes.map(({ d, h }) => `<button class="panel panel-pad" data-hand="${esc(h.id)}" style="text-align:left;cursor:pointer;padding:9px 12px"><div class="row" style="justify-content:space-between">${gradeHTML(d.grade)}<span class="small muted">${esc(d.spot)}</span></div><div class="row small" style="margin-top:4px">${cardsHTML(d.cards, 'sm')} <span class="muted">${esc(d.pos || '')} ${d.board ? `on ${esc(d.board)}` : ''}</span></div><div class="small" style="margin-top:4px">You: <b>${esc(d.taken)}</b> · Better: <b>${esc(d.best || '')}</b></div></button>`).join('')}</div>` : '<p class="muted small">No mistakes or blunders recorded yet.</p>'}
        </div>
        <div class="panel panel-pad">
          <h3 style="font-size:17px;margin-bottom:6px">AI study plan</h3>
          <p class="small muted" style="margin:0 0 10px">Claude reads your stats, leaks and recent mistakes, then writes a focused plan for your next sessions.</p>
          <button class="btn dark" id="plan-btn" ${example ? 'disabled' : ''}>Write my study plan</button>
          <div id="plan-out" class="small" style="margin-top:12px;white-space:pre-wrap;color:var(--ink-2)">${esc(this.store.hero.lastPlan || '')}</div>
        </div>
      </div>`;
    bindTooltips(this.root);
    this.drawCharts();
    this.root.querySelector('#go-play')?.addEventListener('click', () => this.app.go('play'));
    this.root.querySelector('#go-import')?.addEventListener('click', () => this.app.go('import'));
    this.root.querySelectorAll('[data-hand]').forEach((b) => b.addEventListener('click', () => {
      const rec = this.store.hands.find((h) => h.id === b.dataset.hand);
      if (rec) this.app.reviewHand(rec);
    }));
    this.root.querySelector('#mirror-btn')?.addEventListener('click', () => {
      const s = this.store.settings;
      if (!s.lineup.includes('mirror')) s.lineup[0] = 'mirror';
      saveStore(this.store);
      this.app.go('play');
    });
    this.root.querySelector('#plan-btn')?.addEventListener('click', () => this.writePlan(statLeaks, decLeaks, mistakes, style, likes));
  }

  drawCharts() {
    if (!this.state) return;
    const accEl = this.root.querySelector('#acc-chart');
    const posEl = this.root.querySelector('#pos-chart');
    if (accEl) {
      const sess = this.store.hero.sessions.filter((s) => s.decisions >= 3);
      if (this.state.example || !sess.length) accEl.innerHTML = '<div class="empty small">Finish a few tournaments to see your accuracy trend.</div>';
      else drawLine(accEl, sess.slice(-30).map((s, i) => ({ y: s.score / s.decisions, xLabel: `#${i + 1}`, label: new Date(s.ts).toLocaleDateString(), tip: `<b>${new Date(s.ts).toLocaleDateString()}</b><br>${pct(s.score / s.decisions)} accuracy · ${s.decisions} decisions · ${s.hands} hands${s.finish ? ` · finished ${s.finish}/${s.entrants}` : ''}` })), { title: 'GTO accuracy by tournament' });
    }
    if (posEl) {
      const byPos = this.state.example ? null : this.state.agg.byPos;
      const cats = POS_ORDER.filter((p) => byPos?.[p]?.hands >= 3);
      if (!cats.length) { posEl.innerHTML = '<div class="empty small">Not enough hands per position yet.</div>'; return; }
      drawGroupedBars(posEl, cats, [
        { name: 'VPIP', color: 'var(--series-1)', values: cats.map((p) => byPos[p].vpip / byPos[p].hands), notes: cats.map((p) => `${byPos[p].hands} hands · ${(byPos[p].netBB / byPos[p].hands * 100).toFixed(0)} bb/100`) },
        { name: 'PFR', color: 'var(--series-2)', values: cats.map((p) => byPos[p].pfr / byPos[p].hands) },
      ], { yMax: Math.min(1, Math.max(0.3, ...cats.map((p) => byPos[p].vpip / byPos[p].hands)) * 1.15), title: 'VPIP and PFR by position' });
    }
  }

  async writePlan(statLeaks, decLeaks, mistakes, style, likes) {
    const out = this.root.querySelector('#plan-out');
    const btn = this.root.querySelector('#plan-btn');
    if (!coachAvailable(this.store.settings)) {
      out.innerHTML = 'The AI coach needs an Anthropic API key. Add one in <b>Settings</b> (it stays in this browser).';
      return;
    }
    btn.disabled = true;
    out.textContent = 'Claude is reading your file…';
    try {
      const prompt = studyPlanPrompt({ stats: this.state.stats, style, likes, statLeaks, decLeaks, mistakes: mistakes.map((m) => m.d) });
      const text = await askCoach(this.store.settings, prompt);
      out.textContent = text;
      this.store.hero.lastPlan = text;
      saveStore(this.store);
    } catch (e) {
      out.textContent = `Couldn't reach the AI coach: ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  }
}

function leakHTML(title, detail, severity) {
  const color = severity >= 2.3 ? 'var(--critical)' : severity >= 1.6 ? 'var(--serious)' : 'var(--warning)';
  const label = severity >= 2.3 ? 'Major' : severity >= 1.6 ? 'Moderate' : 'Minor';
  return `<div class="leak"><span class="sev" style="background:${color}" aria-hidden="true"></span><div><h4>${esc(title)} <span class="small muted" style="font-weight:400">· ${label}</span></h4><p>${esc(detail)}</p></div></div>`;
}

/** A made-up sample player (not any profile) so the empty report still shows what it does. */
function exampleStats() {
  return {
    hands: 420, vpip: 0.27, pfr: 0.16, threeBet: 0.045, foldTo3Bet: 0.66,
    steal: 0.41, bbDefense: 0.31, cbet: 0.78, foldToCbet: 0.56, af: 1.9,
    wtsd: 0.31, wsd: 0.47, bb100: -3.1, turnCbet: 0.44, checkRaise: 0.05, limp: 0.04, foldToSteal: 0.66,
    samples: { threeBet: 120, foldTo3Bet: 30, cbet: 50, foldToCbet: 50, steal: 80, foldToSteal: 40, bbDefense: 40, wtsd: 120, wsd: 35, af: 200, checkRaise: 30, turnCbet: 20 },
  };
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
