// Play tab: lobby (pick a structure and opponents) and the live table with
// the GTO coach docked beside it.

import { Session, HERO_ID } from '../app/session.js';
import { SCENARIOS } from '../engine/tournament.js';
import { PROFILES, getProfile } from '../ai/profiles.js';
import { CLASSES } from '../engine/ranges.js';
import { findDecisionLeaks } from '../stats/style.js';
import { recordHand, saveStore, heroAggAll } from './store.js';
import { esc, fmt, fmtBB, pct, cardHTML, avatarHTML, gradeHTML, openModal, bindTooltips, compact } from './dom.js';
import { rangeGridHTML, rangeLegendHTML } from './rangeGrid.js';
import { GRADE_SCORE } from '../gto/advisor.js';
import { rangePosition } from '../gto/postflop.js';

const DELAY = { slow: 1100, normal: 620, fast: 220 };

export const TABLE_PRESETS = {
  legends: { name: 'Legends table', ids: ['ivey', 'hellmuth', 'brunson', 'chan', 'seidel', 'ungar', 'negreanu', 'harman'] },
  modern: { name: 'Modern high-roller table', ids: ['bonomo', 'holz', 'selbst', 'mizrachi', 'deeb', 'ivey', 'negreanu', 'grinder'] },
  dayone: { name: 'Main Event Day 1 table', ids: ['rec', 'rec', 'grinder', 'station', 'nit', 'moneymaker', 'maniac', 'negreanu'] },
  mixed: { name: 'Featured table', ids: ['ivey', 'negreanu', 'hellmuth', 'mizrachi', 'seidel', 'dwan', 'chan', 'rec'] },
};

export class PlayView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.session = null;
    this.timer = null;
    this.hint = false;
    this.lastDecision = null;
    this.sessionLog = null;
    this.fastForward = false;
    this.onKey = this.onKey.bind(this);
    document.addEventListener('keydown', this.onKey);
  }

  get store() { return this.app.store; }
  get settings() { return this.app.store.settings; }

  mount() {
    if (this.session && !this.ended) this.renderGame();
    else this.renderLobby();
  }

  unmountTimers() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  // ------------------------------------------------------------------ lobby
  renderLobby() {
    const s = this.settings;
    const tableSize = s.scenario === 'heads_up' ? 2 : s.tableSize;
    const lineup = s.lineup.slice(0, tableSize - 1);
    const lastSessions = this.store.hero.sessions.slice(-3).reverse();
    const scen = Object.entries(SCENARIOS).map(([k, v]) => `
      <button class="panel panel-pad scen ${k === s.scenario ? 'on' : ''}" data-scen="${k}" style="text-align:left;cursor:pointer;${k === s.scenario ? 'border-color:var(--ink);box-shadow:0 0 0 1px var(--ink)' : ''}">
        <div style="font-weight:700">${esc(v.name)}</div>
        <div class="small muted">${esc(v.blurb)}</div>
      </button>`).join('');
    const seats = lineup.map((id, i) => {
      const p = this.app.resolveProfile(id) || getProfile('gto');
      return `<div class="row" style="gap:8px;padding:6px 0;border-top:${i ? '1px solid var(--line)' : '0'}">
        ${avatarHTML(p.name, p.color)}
        <div style="flex:1;min-width:0"><div style="font-weight:700">${esc(p.name)}</div><div class="small muted">${esc(p.style || '')} · ${esc(p.tagline || '')}</div></div>
        <select class="text small" data-seat="${i}" aria-label="Opponent in seat ${i + 2}">${this.app.allProfiles().map((q) => `<option value="${esc(q.id)}" ${q.id === p.id ? 'selected' : ''}>${esc(q.name)}</option>`).join('')}</select>
      </div>`;
    }).join('');
    this.root.innerHTML = `
      <div class="grid-2" style="align-items:start">
        <div class="stack">
          <div>
            <div class="eyebrow">New tournament</div>
            <h1 class="section-title" style="font-size:40px">Chase a bracelet</h1>
            <p class="muted" style="margin:6px 0 0;max-width:60ch">Play a WSOP-style tournament against AI opponents modeled on famous pros. The coach grades every decision against a GTO-approximate model, and the app learns your style as you play.</p>
          </div>
          <div class="stack" style="gap:8px">${scen}</div>
          <div class="row">
            <span class="eyebrow">Table size</span>
            <div class="seg" role="group" aria-label="Table size">
              ${[2, 6, 9].map((n) => `<button data-size="${n}" aria-pressed="${tableSize === n}">${n === 2 ? 'Heads-up' : `${n}-max`}</button>`).join('')}
            </div>
          </div>
          <div class="row">
            <button class="btn primary" id="start-btn" style="font-size:17px;padding:12px 22px">Shuffle up and deal</button>
            <span class="small muted">Keys: F fold · C check/call · R raise · A all-in · H hint · N next hand</span>
          </div>
          ${lastSessions.length ? `<div class="panel panel-pad"><div class="eyebrow" style="margin-bottom:6px">Recent tournaments</div>${lastSessions.map((x) => `<div class="row small" style="justify-content:space-between;padding:3px 0"><span>${new Date(x.ts).toLocaleDateString()} · ${esc(SCENARIOS[x.scenario]?.name || x.scenario)}</span><span class="data">${x.finish ? `${ordinal(x.finish)} of ${x.entrants}` : 'unfinished'} · ${x.hands}h · ${x.decisions ? pct(x.score / x.decisions) : '—'} accuracy</span></div>`).join('')}</div>` : ''}
        </div>
        <div class="panel panel-pad">
          <div class="row" style="justify-content:space-between;margin-bottom:6px">
            <div><div class="eyebrow">Your opponents</div><div class="small muted">Seat 1 is you. Change any seat, or load a preset table.</div></div>
          </div>
          <div class="row" style="margin-bottom:10px">${Object.entries(TABLE_PRESETS).map(([k, v]) => `<button class="btn small" data-preset="${k}">${esc(v.name)}</button>`).join('')}<button class="btn small" data-preset="random">Random</button></div>
          ${seats}
          <p class="disclaimer" style="margin:12px 0 0">Pro profiles use verified WSOP results, but their play is modeled from public reputation. They are practice opponents, not the real players. Not affiliated with the WSOP or any player.</p>
        </div>
      </div>`;
    this.root.querySelectorAll('[data-scen]').forEach((b) => b.addEventListener('click', () => {
      s.scenario = b.dataset.scen;
      saveStore(this.store);
      this.renderLobby();
    }));
    this.root.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => {
      const n = Number(b.dataset.size);
      if (n === 2) s.scenario = 'heads_up';
      else { s.tableSize = n; if (s.scenario === 'heads_up') s.scenario = 'main_event'; }
      saveStore(this.store);
      this.renderLobby();
    }));
    this.root.querySelectorAll('[data-seat]').forEach((sel) => sel.addEventListener('change', () => {
      s.lineup[Number(sel.dataset.seat)] = sel.value;
      saveStore(this.store);
      this.renderLobby();
    }));
    this.root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.preset;
      if (k === 'random') {
        const pool = this.app.allProfiles().map((p) => p.id);
        s.lineup = Array.from({ length: 8 }, () => pool[Math.floor(Math.random() * pool.length)]);
      } else s.lineup = TABLE_PRESETS[k].ids.slice();
      saveStore(this.store);
      this.renderLobby();
    }));
    this.root.querySelector('#start-btn').addEventListener('click', () => this.start());
  }

  // ------------------------------------------------------------------ game
  start() {
    const s = this.settings;
    const tableSize = s.scenario === 'heads_up' ? 2 : s.tableSize;
    const lineup = s.lineup.slice(0, tableSize - 1);
    const knownAggs = {};
    for (const [name, o] of Object.entries(this.store.opponents)) knownAggs[name] = o.agg;
    this.session = new Session({
      scenario: s.scenario,
      lineup,
      heroName: s.heroName || 'You',
      heroAgg: heroAggAll(this.store),
      knownAggs,
      resolveProfile: (id) => this.app.resolveProfile(id),
    });
    this.ended = false;
    this.lastDecision = null;
    this.sessionLog = {
      id: `s${Date.now()}`, ts: Date.now(), scenario: s.scenario, hands: 0, decisions: 0, score: 0, evLoss: 0,
      entrants: tableSize, finish: null, prize: 0, lineup,
    };
    this.store.hero.sessions.push(this.sessionLog);
    if (this.store.hero.sessions.length > 200) this.store.hero.sessions.shift();
    this.nextHand();
  }

  nextHand() {
    this.unmountTimers();
    if (this.session.isOver()) { this.finishTournament(); return; }
    this.session.startHand();
    this.hint = this.settings.coachMode === 'live';
    this.fastForward = false;
    this.handResult = null;
    this.renderGame();
    this.loop();
  }

  loop() {
    this.unmountTimers();
    const hand = this.session.hand;
    if (hand.complete) { this.onHandComplete(); return; }
    if (this.session.isHeroTurn()) {
      this.renderActionBar();
      this.renderCoach();
      // compute the advice off the critical render path (it also feeds grading)
      this.timer = setTimeout(() => { this.session.heroAdvice(); this.renderCoach(); }, 30);
      return;
    }
    this.renderActionBar();
    const heroFolded = hand.players[this.session.current.heroIdx].folded;
    const base = DELAY[this.settings.speed] || DELAY.normal;
    const delay = this.fastForward ? 60 : heroFolded ? Math.min(base, 300) : base;
    this.timer = setTimeout(() => {
      const before = hand.board.length;
      this.session.botAct();
      this.renderTable();
      this.renderClock();
      if (hand.board.length !== before && !hand.complete) {
        this.timer = setTimeout(() => this.loop(), this.fastForward ? 30 : 280);
      } else this.loop();
    }, delay);
  }

  heroAction(action) {
    if (!this.session?.isHeroTurn()) return;
    const { decision } = this.session.heroAct(action);
    this.lastDecision = decision;
    this.hint = this.settings.coachMode === 'live';
    this.renderTable();
    this.renderCoach();
    this.loop();
  }

  onHandComplete() {
    const result = this.session.finishHand();
    this.handResult = result;
    const rec = result.record;
    recordHand(this.store, result, { canonHero: rec.players[rec.heroIdx].canon });
    const sl = this.sessionLog;
    sl.hands++;
    for (const d of result.decisions) {
      sl.decisions++;
      sl.score += GRADE_SCORE[d.grade] ?? 0.5;
      sl.evLoss += d.evLossBB || 0;
    }
    const hero = this.session.heroSeat();
    if (hero.busted || this.session.tournament.isOver()) {
      sl.finish = hero.finish || 1;
      sl.prize = hero.prize || 0;
    }
    saveStore(this.store);
    this.renderGame();
    if (this.session.isOver()) {
      this.timer = setTimeout(() => this.finishTournament(), 1200);
      return;
    }
    if (this.settings.autoNext) this.timer = setTimeout(() => this.nextHand(), 2400);
  }

  finishTournament() {
    this.unmountTimers();
    this.ended = true;
    const t = this.session.tournament;
    const hero = this.session.heroSeat();
    const place = hero.finish || (t.isOver() ? 1 : null);
    const sl = this.sessionLog;
    sl.finish = place;
    sl.prize = hero.prize || 0;
    saveStore(this.store);
    const leaks = findDecisionLeaks(this.session.decisions, 2).slice(0, 3);
    const acc = sl.decisions ? sl.score / sl.decisions : null;
    const winner = t.seats.find((x) => x.finish === 1);
    const m = openModal(`
      <div class="eyebrow">${esc(t.scenario.name)}</div>
      <h2>${place === 1 ? 'You won the bracelet!' : `You finished ${ordinal(place)} of ${t.seats.length}`}</h2>
      <p class="muted" style="margin:6px 0 14px">${place === 1 ? 'Every opponent is out.' : `${winner ? `${esc(winner.name)} ${t.isOver() ? 'won the tournament' : 'is still playing'}. ` : ''}`}${hero.prize ? `Prize: $${fmt(hero.prize)} (of a $${fmt(t.buyIn * t.seats.length)} prize pool).` : t.scenario.cash ? '' : 'No prize at this finish.'}</p>
      <div class="tiles" style="margin-bottom:14px">
        <div class="tile"><div class="k">Hands played</div><div class="v">${sl.hands}</div></div>
        <div class="tile"><div class="k">GTO accuracy</div><div class="v">${acc == null ? '—' : pct(acc)}</div><div class="d">${sl.decisions} graded decisions</div></div>
        <div class="tile"><div class="k">Est. EV given up</div><div class="v">${sl.evLoss.toFixed(1)}bb</div><div class="d">on measurable spots</div></div>
      </div>
      ${leaks.length ? `<div class="eyebrow" style="margin-bottom:4px">Spots to study</div><ul class="notes" style="margin-top:0">${leaks.map((l) => `<li><b>${esc(l.spot)}</b>: ${pct(l.accuracy)} accuracy over ${l.n} decisions${l.evLoss > 0.5 ? `, ~${l.evLoss.toFixed(1)}bb lost` : ''}</li>`).join('')}</ul>` : ''}
      <div class="row" style="justify-content:flex-end;margin-top:16px">
        <button class="btn" data-close id="to-report">See my style report</button>
        <button class="btn primary" data-close id="again">Play again</button>
      </div>`, { onClose: () => this.renderLobby() });
    m.el.querySelector('#to-report').addEventListener('click', () => setTimeout(() => this.app.go('report'), 0));
    m.el.querySelector('#again').addEventListener('click', () => setTimeout(() => this.start(), 0));
  }

  quit() {
    this.unmountTimers();
    this.ended = true;
    this.renderLobby();
  }

  // ------------------------------------------------------------------ render
  renderGame() {
    this.root.innerHTML = `
      <div class="play">
        <div class="play-main">
          <div class="clock" id="clock"></div>
          <div class="table-wrap ${this.settings.fourColor ? '' : 'two-color'}" id="table"></div>
          <div class="panel actionbar" id="actionbar"></div>
        </div>
        <aside class="coach" id="coach"></aside>
      </div>`;
    bindTooltips(this.root);
    this.renderClock();
    this.renderTable();
    this.renderActionBar();
    this.renderCoach();
  }

  renderClock() {
    const el = this.root.querySelector('#clock');
    if (!el || !this.session) return;
    const t = this.session.tournament;
    const { sb, bb, ante, level } = t.blinds;
    const hero = this.session.heroSeat();
    const left = t.handsUntilLevelUp();
    const active = t.activeSeats().length;
    const icm = t.payouts.length ? t.icm()[0] : null;
    el.innerHTML = `
      <div><div class="k">${t.scenario.cash ? 'Blinds' : `Level ${level}`}</div><div class="v">${compact(sb)}/${compact(bb)}${ante ? `<small>ante ${compact(ante)}</small>` : ''}</div></div>
      <div><div class="k">Next level</div><div class="v">${left === Infinity ? '—' : `${left}<small>hands</small>`}</div></div>
      <div><div class="k">${t.scenario.cash ? 'Players' : 'Players left'}</div><div class="v">${active}<small>/ ${t.seats.length}</small></div></div>
      <div><div class="k">Your stack</div><div class="v">${hero.busted ? 'Out' : `${compact(hero.stack)}<small>${fmtBB(hero.stack, bb)}</small>`}</div></div>
      <div><div class="k">Avg stack</div><div class="v">${compact(t.averageStack())}<small>${fmtBB(t.averageStack(), bb)}</small></div></div>
      ${icm != null ? `<div data-tip="${esc(`Independent Chip Model: your share of the $${fmt(t.payouts.reduce((a, b) => a + b, 0))} prize pool at current stacks. Payouts: ${t.payouts.map((p, i) => `${ordinal(i + 1)} $${fmt(p)}`).join(', ')}.`)}"><div class="k">ICM equity</div><div class="v">$${compact(icm)}</div></div>` : ''}`;
  }

  seatLayout(n) {
    const narrow = window.matchMedia('(max-width: 640px)').matches;
    const rx = narrow ? 39 : 44;
    const ry = narrow ? 45 : 40;
    return Array.from({ length: n }, (_, k) => {
      const a = ((90 + (k * 360) / n) * Math.PI) / 180;
      return { x: 50 + rx * Math.cos(a), y: 50 + ry * Math.sin(a), a };
    });
  }

  renderTable() {
    const el = this.root.querySelector('#table');
    if (!el || !this.session) return;
    const t = this.session.tournament;
    const c = this.session.current;
    const hand = c?.hand;
    const N = t.seats.length;
    this.narrow = window.matchMedia('(max-width: 640px)').matches;
    const layout = this.seatLayout(N);
    const handIdxOfSeat = new Map((hand?.seatMap || []).map((s, i) => [s, i]));
    const lastAct = new Map();
    if (hand) {
      for (const e of hand.log) {
        if (e.type === 'street') lastAct.clear();
        if (e.type === 'action') lastAct.set(e.idx, e);
      }
    }
    const shown = new Map((hand?.result?.shown || []).map((s) => [s.idx, s]));
    const winners = new Set((hand?.result?.pots || []).flatMap((p) => p.winners));
    const showHud = this.settings.showHud;
    let html = `<div class="felt"></div>`;
    const bb = hand?.bb || t.blinds.bb;
    t.seats.forEach((seat, s) => {
      const pos = layout[s];
      const idx = handIdxOfSeat.get(s);
      const p = idx !== undefined ? hand.players[idx] : null;
      const prof = this.session.profiles[s];
      const isHero = s === 0;
      const color = isHero ? 'var(--gold)' : prof?.color || '#5b6b64';
      const classes = ['seat'];
      if (isHero) classes.push('hero');
      if (seat.busted && !p) classes.push('busted');
      if (p?.folded) classes.push('folded');
      if (hand && !hand.complete && hand.toAct === idx) classes.push('acting');
      let cards = '';
      if (p) {
        const reveal = isHero || shown.has(idx);
        const win = hand.complete && winners.has(idx) && hand.result.showdown;
        const size = isHero ? 'lg' : 'sm';
        cards = p.folded && !isHero ? '' : p.hole.map((cd) => (reveal ? cardHTML(cd, size, win ? 'win' : p.folded ? 'dim' : '') : cardHTML(null, size))).join('');
      }
      const stats = !isHero && showHud ? this.session.statsForSeat(s) : null;
      const hud = stats && stats.hands >= 1 ? `VPIP ${pct(stats.vpip)} · PFR ${pct(stats.pfr)} · AF ${stats.af == null ? '—' : stats.af.toFixed(1)} · ${stats.hands}h` : '';
      const la = p ? lastAct.get(idx) : null;
      const bubble = la ? `<span class="act-bubble ${la.allIn ? 'allin' : la.action}">${esc(actionText(la, bb))}</span>` : '';
      const stackTxt = seat.busted && !p ? `Out · ${ordinal(seat.finish)}` : `${compact(p ? p.stack : seat.stack)} · ${fmtBB(p ? p.stack : seat.stack, bb)}${p?.allIn ? ' · ALL-IN' : ''}`;
      html += `
        <div class="${classes.join(' ')}" style="left:${pos.x}%;top:${pos.y}%">
          <div class="seat-cards">${cards}</div>
          <button class="seat-box" data-seat="${s}" aria-label="${esc(seat.name)} details">
            ${avatarHTML(seat.name, color)}
            <span class="seat-name">${esc(seat.name)}</span>
            <span class="seat-stack">${esc(stackTxt)}</span>
            ${hud ? `<span class="seat-hud">${esc(hud)}</span>` : ''}
            ${p ? `<span class="pos-tag">${esc(p.position.display)}</span>` : ''}
            ${bubble}
          </button>
        </div>`;
      if (p && p.bet > 0 && !hand.complete) {
        const f = this.narrow ? 0.66 : 0.58;
        const bx = 50 + (pos.x - 50) * f;
        const by = 50 + (pos.y - 50) * f;
        html += `<div class="bet-chip" style="left:${bx}%;top:${by}%"><span class="chip-dot"></span>${compact(p.bet)}</div>`;
      }
      if (hand && idx === hand.button) {
        const dx = 50 + (pos.x - 50) * 0.74 + (pos.x < 50 ? 4 : -4);
        const dy = 50 + (pos.y - 50) * 0.74;
        html += `<div class="dealer-btn" style="left:${dx}%;top:${dy}%" title="Dealer button">D</div>`;
      }
    });
    // center: pot, board, messages
    let center = '';
    if (hand) {
      const pot = hand.complete ? hand.result.pots.reduce((a, p) => a + p.amount, 0) : hand.pot;
      center += `<div class="pot">Pot <b>${fmt(pot)}</b> · ${fmtBB(pot, bb)}</div>`;
      center += `<div class="board">${hand.board.map((cd) => cardHTML(cd, '', 'deal-in')).join('')}</div>`;
      if (hand.complete) center += `<div class="felt-msg">${this.resultText()}</div>`;
      else center += `<div class="felt-msg">Hand #${hand.id} · ${esc(hand.street)}</div>`;
    } else {
      center += `<div class="felt-logo">Bracelet Hunt</div>`;
    }
    html += `<div class="felt-center">${center}</div>`;
    el.innerHTML = html;
    el.querySelectorAll('[data-seat]').forEach((b) => b.addEventListener('click', () => this.showSeat(Number(b.dataset.seat))));
  }

  resultText() {
    const hand = this.session.hand;
    const r = hand.result;
    const parts = r.pots.map((pot, k) => {
      const names = pot.winners.map((i) => hand.players[i].name).join(' & ');
      const sh = r.showdown ? r.shown.find((x) => x.idx === pot.winners[0]) : null;
      return `${esc(names)} ${pot.winners.length > 1 ? 'split' : 'win' + (pot.winners[0] === this.session.current.heroIdx ? '' : 's')} ${fmt(pot.amount)}${r.pots.length > 1 ? ` (${k ? `side pot ${k}` : 'main'})` : ''}${sh ? ` — ${esc(sh.desc)}` : ''}`;
    });
    return parts.join('<br>');
  }

  renderActionBar() {
    const el = this.root.querySelector('#actionbar');
    if (!el || !this.session) return;
    const hand = this.session.hand;
    if (!hand) { el.innerHTML = ''; return; }
    if (hand.complete) {
      const hero = hand.players[this.session.current.heroIdx];
      const net = hero.stack - hero.startStack;
      const over = this.session.isOver();
      el.innerHTML = `
        <div class="row" style="justify-content:space-between">
          <div class="result-line">${net > 0 ? `<span class="pos">You won ${fmt(net)} (${fmtBB(net, hand.bb)})</span>` : net < 0 ? `<span class="neg">You lost ${fmt(-net)} (${fmtBB(-net, hand.bb)})</span>` : 'Hand over'}</div>
          <div class="row">
            <label class="small row" style="gap:6px"><input type="checkbox" id="auto-next" ${this.settings.autoNext ? 'checked' : ''}> Auto-deal</label>
            <button class="btn" id="review-btn">Review hand</button>
            ${over ? '<button class="btn primary" id="end-btn">Tournament results</button>' : '<button class="btn primary" id="next-btn">Next hand <span class="kbd">N</span></button>'}
          </div>
        </div>`;
      el.querySelector('#auto-next').addEventListener('change', (e) => {
        this.settings.autoNext = e.target.checked;
        saveStore(this.store);
        if (e.target.checked && !over) this.timer = setTimeout(() => this.nextHand(), 600);
      });
      el.querySelector('#review-btn').addEventListener('click', () => this.app.reviewHand(this.handResult?.record));
      el.querySelector('#next-btn')?.addEventListener('click', () => this.nextHand());
      el.querySelector('#end-btn')?.addEventListener('click', () => this.finishTournament());
      return;
    }
    if (!this.session.isHeroTurn()) {
      const p = hand.players[hand.toAct];
      const heroFolded = hand.players[this.session.current.heroIdx].folded;
      el.innerHTML = `<div class="waiting"><span>${esc(p?.name || '')} is thinking…</span>${heroFolded ? '<button class="btn small" id="ff">Skip to result</button>' : ''}<span style="margin-left:auto" class="row"><button class="btn small" id="quit">Leave table</button></span></div>`;
      el.querySelector('#ff')?.addEventListener('click', () => { this.fastForward = true; });
      el.querySelector('#quit').addEventListener('click', () => this.confirmQuit());
      return;
    }
    const la = hand.legalActions();
    const bb = hand.bb;
    const presets = this.sizePresets(hand, la);
    const def = presets.find((p) => p.def)?.to ?? la.minTo;
    el.innerHTML = `
      <div class="action-buttons">
        <button class="btn fold" id="a-fold">Fold <span class="kbd">F</span></button>
        <button class="btn call" id="a-call">${la.canCheck ? 'Check' : `Call ${fmt(la.toCall)}${la.callIsAllIn ? ' all-in' : ''}`} <span class="kbd">C</span></button>
        <button class="btn primary" id="a-raise" ${la.canRaise ? '' : 'disabled'}>${la.isBet ? 'Bet' : 'Raise to'} <span id="raise-amt">${fmt(def)}</span> <span class="kbd">R</span></button>
      </div>
      ${la.canRaise ? `
      <div class="sizing">
        <input type="range" id="raise-range" min="${la.minTo}" max="${la.maxTo}" step="1" value="${def}" aria-label="Bet size">
        <input type="number" id="raise-num" min="${la.minTo}" max="${la.maxTo}" value="${def}" aria-label="Bet size in chips">
        <span class="small muted" id="raise-bb">${fmtBB(def, bb)}</span>
      </div>
      <div class="presets">${presets.map((p) => `<button class="btn small" data-to="${p.to}">${esc(p.label)}</button>`).join('')}</div>` : ''}`;
    const range = el.querySelector('#raise-range');
    const num = el.querySelector('#raise-num');
    const setTo = (v) => {
      let to = Math.round(Number(v));
      if (!Number.isFinite(to)) return;
      to = Math.max(la.minTo, Math.min(la.maxTo, to));
      const step = Math.max(1, Math.round(bb / 20));
      if (to !== la.maxTo && to !== la.minTo) to = Math.round(to / step) * step;
      this.raiseTo = to;
      if (range) range.value = to;
      if (num && document.activeElement !== num) num.value = to;
      el.querySelector('#raise-amt').textContent = to >= la.maxTo ? `${fmt(to)} (all-in)` : fmt(to);
      const rb = el.querySelector('#raise-bb');
      if (rb) rb.textContent = `${fmtBB(to, bb)}${hand.currentBet === 0 && hand.pot ? ` · ${Math.round((to / hand.pot) * 100)}% pot` : ''}`;
    };
    this.raiseTo = def;
    if (la.canRaise) setTo(def);
    range?.addEventListener('input', () => setTo(range.value));
    num?.addEventListener('input', () => setTo(num.value));
    num?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.heroAction({ type: 'raise', to: this.raiseTo }); });
    el.querySelectorAll('[data-to]').forEach((b) => b.addEventListener('click', () => setTo(b.dataset.to)));
    el.querySelector('#a-fold').addEventListener('click', () => this.heroAction({ type: 'fold' }));
    el.querySelector('#a-call').addEventListener('click', () => this.heroAction({ type: la.canCheck ? 'check' : 'call' }));
    el.querySelector('#a-raise').addEventListener('click', () => this.heroAction({ type: 'raise', to: this.raiseTo }));
  }

  sizePresets(hand, la) {
    if (!la.canRaise) return [];
    const bb = hand.bb;
    const out = [];
    const add = (label, to, def = false) => {
      to = Math.round(to);
      if (to < la.minTo || to > la.maxTo) return;
      if (out.some((o) => o.to === to)) return;
      out.push({ label, to, def });
    };
    if (hand.street === 'preflop') {
      const limpers = hand.log.filter((e) => e.type === 'action' && e.action === 'call').length;
      if (hand.currentBet <= bb) {
        add('2bb', 2 * bb + limpers * bb);
        add('2.2bb', 2.2 * bb + limpers * bb, true);
        add('2.5bb', 2.5 * bb + limpers * bb);
        add('3bb', 3 * bb + limpers * bb);
      } else {
        add('3×', hand.currentBet * 3, true);
        add('3.5×', hand.currentBet * 3.5);
        add('4×', hand.currentBet * 4);
      }
    } else if (hand.currentBet === 0) {
      for (const [lab, f, d] of [['⅓ pot', 0.33, true], ['½ pot', 0.5], ['⅔ pot', 0.66], ['¾ pot', 0.75], ['Pot', 1], ['1.5× pot', 1.5]]) add(lab, Math.max(bb, f * hand.pot), d);
    } else {
      const pl = la.toCall;
      add('2.5×', hand.currentBet * 2.5, true);
      add('3×', hand.currentBet * 3);
      add('Pot', hand.currentBet + hand.pot + pl);
    }
    add('Min', la.minTo, out.length === 0);
    add('All-in', la.maxTo);
    return out;
  }

  renderCoach() {
    const el = this.root.querySelector('#coach');
    if (!el || !this.session) return;
    const c = this.session.current;
    const mode = this.settings.coachMode;
    let advisor = '';
    if (c && this.session.isHeroTurn()) {
      const cached = c.adviceCache?.advice;
      if (this.hint || mode === 'live') {
        advisor = cached ? this.adviceHTML(cached) : '<p class="muted small">Solving…</p>';
      } else {
        advisor = `<p class="small muted" style="margin:6px 0 10px">${mode === 'off' ? 'Coach is quiet — grades are saved for your report.' : 'Make your decision. The coach grades it after you act.'}</p><button class="btn small" id="hint-btn">Show GTO hint <span class="kbd">H</span></button>`;
      }
    } else if (c && !c.hand.complete) {
      advisor = '<p class="small muted" style="margin:6px 0 0">Waiting for your turn.</p>';
    } else {
      advisor = '<p class="small muted" style="margin:6px 0 0">Hand complete.</p>';
    }
    const d = this.lastDecision;
    const showFeedback = d && mode !== 'off';
    const exploits = c?.exploits || [];
    const sl = this.sessionLog;
    const acc = sl?.decisions ? sl.score / sl.decisions : null;
    el.innerHTML = `
      <div class="panel panel-pad">
        <div class="row" style="justify-content:space-between">
          <h3>GTO coach</h3>
          <div class="seg" role="group" aria-label="Coach mode">
            ${['live', 'after', 'off'].map((m) => `<button data-mode="${m}" aria-pressed="${mode === m}">${{ live: 'Live hints', after: 'After I act', off: 'Quiet' }[m]}</button>`).join('')}
          </div>
        </div>
        ${advisor}
      </div>
      ${showFeedback ? `
      <div class="panel panel-pad feedback">
        <div class="row" style="justify-content:space-between"><h3>Your last decision</h3>${gradeHTML(d.grade)}</div>
        <p><b>${esc(d.taken)}</b> <span class="muted">· ${esc(d.pos || '')} ${esc(d.cards)}${d.board ? ` on ${esc(d.board)}` : ''}</span></p>
        <p>${esc(d.message)}</p>
        <details><summary class="small muted" style="cursor:pointer">Why</summary>
          <div class="mix">${d.mix.map((a) => `<div class="mix-row"><span>${esc(a.label)}</span><span class="pct">${pct(a.freq)}</span><span class="bar"><i style="width:${a.freq * 100}%"></i></span></div>`).join('')}</div>
          <ul class="notes">${d.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        </details>
      </div>` : ''}
      ${exploits.length ? `<div class="panel panel-pad"><h3>Opponent reads on you</h3><ul class="notes exploits">${exploits.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
      <div class="panel panel-pad">
        <div class="row" style="justify-content:space-between"><h3>This tournament</h3><span class="small muted">${sl ? `${sl.hands} hands` : ''}</span></div>
        <div class="facts">
          <div class="fact"><div class="k">Accuracy</div><div class="v">${acc == null ? '—' : pct(acc)}</div></div>
          <div class="fact"><div class="k">Decisions</div><div class="v">${sl?.decisions ?? 0}</div></div>
          <div class="fact"><div class="k">EV given up</div><div class="v">${(sl?.evLoss ?? 0).toFixed(1)}bb</div></div>
        </div>
      </div>
      <div class="panel panel-pad"><h3>Hand log</h3><div class="log" id="hand-log">${this.logHTML()}</div></div>`;
    el.querySelector('#hint-btn')?.addEventListener('click', () => { this.hint = true; this.session.heroAdvice(); this.renderCoach(); });
    el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      this.settings.coachMode = b.dataset.mode;
      this.hint = b.dataset.mode === 'live';
      saveStore(this.store);
      this.renderCoach();
    }));
    const log = el.querySelector('#hand-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  adviceHTML(a) {
    const best = a.best;
    const info = a.info || {};
    const facts = [];
    if (info.equity != null) facts.push(['Equity', pct(info.equity)]);
    if (info.required != null && info.toCall > 0) facts.push(['Need', pct(info.required, 1)]);
    if (info.mdf != null && info.toCall > 0) facts.push(['MDF', pct(info.mdf)]);
    if (info.pct != null) facts.push(['Range rank', rangePosition(info.pct)]);
    if (info.spr != null) facts.push(['SPR', info.spr.toFixed(1)]);
    if (a.street === 'preflop' && info.rangeWidth) facts.push(['Range', `${pct(info.rangeWidth.aggressive + info.rangeWidth.passive)} play`]);
    const mix = a.mix.filter((m) => m.freq > 0.005 || m === best);
    return `
      <div class="mix">${mix.map((m) => `<div class="mix-row ${m === best ? 'top' : ''}"><span class="label">${esc(m.label)}</span><span class="pct">${pct(m.freq)}</span><span class="bar"><i style="width:${m.freq * 100}%"></i></span></div>`).join('')}</div>
      ${facts.length ? `<div class="facts">${facts.map(([k, v]) => `<div class="fact"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>` : ''}
      <ul class="notes">${a.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      ${a.grid ? `<div style="margin-top:10px">${rangeGridHTML({ aggressive: a.grid.aggressive, passive: a.grid.passive }, { heroClass: a.classIdx })}<div style="margin-top:6px">${rangeLegendHTML({ aggressive: 'Raise / jam', passive: a.ctx?.toCall > 0 ? 'Call' : 'Check / limp' })}</div></div>` : ''}`;
  }

  logHTML() {
    const c = this.session?.current;
    if (!c) return '';
    const hand = c.hand;
    const L = [];
    for (const e of hand.log) {
      if (e.type === 'post') L.push(`<div>${esc(hand.players[e.idx].name)} posts ${e.kind === 'ante' ? 'BB ante' : e.kind.toUpperCase()} ${fmt(e.amount)}</div>`);
      if (e.type === 'deal') {
        const hero = hand.players[c.heroIdx];
        L.push(`<div>Dealt to you: ${hero.hole.map((cd) => cardHTML(cd, 'sm')).join('')}</div>`);
      }
      if (e.type === 'street') L.push(`<div class="street">${e.street} · ${e.board.map((cd) => cardHTML(cd, 'sm')).join('')}</div>`);
      if (e.type === 'action') L.push(`<div>${esc(hand.players[e.idx].name)}: ${esc(actionText(e, hand.bb, true))}</div>`);
      if (e.type === 'end') {
        for (const s of e.shown) L.push(`<div>${esc(hand.players[s.idx].name)} shows ${s.cards.map((cd) => cardHTML(cd, 'sm')).join('')} ${esc(s.desc)}</div>`);
        e.awards.forEach((aw) => L.push(`<div><b>${esc(aw.winners.map((i) => hand.players[i].name).join(' & '))}</b> ${aw.winners.length > 1 ? 'split' : 'collect'} ${fmt(aw.amount)}</div>`));
      }
    }
    return L.join('');
  }

  showSeat(s) {
    const seat = this.session.tournament.seats[s];
    if (s === 0) { this.app.go('report'); return; }
    this.app.showPlayerCard(seat.name, this.session.profiles[s], this.session.statsForSeat(s));
  }

  async confirmQuit() {
    const { confirmModal } = await import('./dom.js');
    if (await confirmModal('Leave this tournament? Hands played so far stay in your history and style report.', 'Leave table')) this.quit();
  }

  onKey(e) {
    if (this.app.currentTab !== 'play' || !this.session || this.ended) return;
    if (e.target.closest?.('input, textarea, select') && e.key !== 'Enter') return;
    if (document.querySelector('.modal-backdrop')) return;
    const k = e.key.toLowerCase();
    const hand = this.session.hand;
    if (hand?.complete) {
      if (k === 'n' || k === ' ') { e.preventDefault(); if (!this.session.isOver()) this.nextHand(); }
      return;
    }
    if (!this.session.isHeroTurn()) return;
    const la = hand.legalActions();
    if (k === 'f') this.heroAction({ type: 'fold' });
    else if (k === 'c' || k === 'k') this.heroAction({ type: la.canCheck ? 'check' : 'call' });
    else if (k === 'r' && la.canRaise) this.heroAction({ type: 'raise', to: this.raiseTo || la.minTo });
    else if (k === 'a' && (la.canRaise || la.canCall)) this.heroAction({ type: 'allin' });
    else if (k === 'h') { this.hint = true; this.session.heroAdvice(); this.renderCoach(); }
  }
}

export function actionText(e, bb, long = false) {
  const amt = (n) => (long ? `${fmt(n)} (${fmtBB(n, bb)})` : compact(n));
  switch (e.action) {
    case 'fold': return long ? 'folds' : 'Fold';
    case 'check': return long ? 'checks' : 'Check';
    case 'call': return `${long ? 'calls' : 'Call'} ${amt(e.amount)}${e.allIn ? ' all-in' : ''}`;
    case 'bet': return `${long ? 'bets' : 'Bet'} ${amt(e.amount)}${e.allIn ? ' all-in' : ''}`;
    case 'raise': return `${long ? 'raises to' : 'Raise'} ${amt(e.to)}${e.allIn ? ' all-in' : ''}`;
    default: return e.action;
  }
}

export function ordinal(n) {
  if (n == null) return '—';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export { CLASSES, PROFILES };
