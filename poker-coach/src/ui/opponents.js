// Opponents tab: pro and archetype profiles, your observed HUD on each of
// them, imported real opponents, and your mirror profile.

import { PROFILE_HUD } from '../data/profileHud.js';
import { deriveStats } from '../stats/stats.js';
import { classifyStyle, statsToTendencies, exploitTips } from '../stats/style.js';
import { saveStore } from './store.js';
import { esc, pct, fmt, avatarHTML, confirmModal, openModal } from './dom.js';

export class OpponentsView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.filter = 'all';
  }

  get store() { return this.app.store; }

  mount() {
    const s = this.store.settings;
    const tableSize = s.scenario === 'heads_up' ? 2 : s.tableSize;
    const lineup = s.lineup.slice(0, tableSize - 1);
    const all = this.app.allProfiles();
    const shown = all.filter((p) => this.filter === 'all' || p.kind === this.filter || (this.filter === 'mine' && (p.kind === 'imported' || p.kind === 'mirror')));
    const imported = Object.entries(this.store.opponents)
      .filter(([, o]) => o.source === 'import' && o.agg.hands >= 10)
      .sort((a, b) => b[1].agg.hands - a[1].agg.hands);
    this.root.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-end;margin-bottom:12px">
        <div>
          <div class="eyebrow">Scouting room</div>
          <h1 class="section-title" style="font-size:36px">Opponent profiles</h1>
          <p class="muted" style="margin:4px 0 0;max-width:72ch">Each AI opponent bends the GTO baseline in its own way. The adaptive ones also watch your HUD and exploit what they see. Click <b>Seat</b> to add a player to your next table.</p>
        </div>
        <div class="seg" role="group" aria-label="Filter profiles">
          ${[['all', 'All'], ['pro', 'WSOP pros'], ['archetype', 'Archetypes'], ['mine', 'Imported & mirror']].map(([k, l]) => `<button data-filter="${k}" aria-pressed="${this.filter === k}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="panel panel-pad" style="margin-bottom:14px">
        <div class="row" style="justify-content:space-between"><div class="eyebrow">Your next table (${lineup.length + 1}-handed)</div><button class="btn small" id="to-play">Go to the table</button></div>
        <div class="row" style="margin-top:8px">${lineup.map((id, i) => { const p = this.app.resolveProfile(id); return p ? `<span class="chip-tag on" style="display:inline-flex;align-items:center;gap:6px">${esc(p.name)}<button class="icon-btn" style="padding:0 5px;border:0;background:transparent;color:inherit" data-unseat="${i}" aria-label="Remove ${esc(p.name)}">×</button></span>` : ''; }).join('')}</div>
      </div>
      <div class="profiles">${shown.map((p) => this.cardHTML(p, lineup)).join('') || '<div class="empty">Nothing here yet.</div>'}</div>
      ${imported.length ? `
      <div class="panel panel-pad" style="margin-top:18px">
        <h3 style="font-size:17px">Players from your imported hand histories</h3>
        <p class="small muted" style="margin:4px 0 10px">Real opponents you have played, with their HUD built from your hands. Clone one to practice against an AI that plays like them.</p>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Player</th><th class="num">Hands</th><th class="num">VPIP</th><th class="num">PFR</th><th class="num">3-bet</th><th class="num">AF</th><th class="num">WTSD</th><th>Style</th><th></th></tr></thead>
          <tbody>${imported.slice(0, 60).map(([name, o]) => { const d = deriveStats(o.agg); const st = classifyStyle(d); const cloned = this.store.customProfiles.some((c) => c.sourceName === name); return `<tr class="clickable" data-player="${esc(name)}"><td>${esc(name)}</td><td class="num">${fmt(d.hands)}</td><td class="num">${pct(d.vpip)}</td><td class="num">${pct(d.pfr)}</td><td class="num">${pct(d.threeBet)}</td><td class="num">${d.af == null ? '—' : d.af.toFixed(1)}</td><td class="num">${pct(d.wtsd)}</td><td>${esc(st.label)}</td><td><button class="btn small" data-clone="${esc(name)}" ${cloned ? 'disabled' : ''}>${cloned ? 'Cloned' : 'Clone as AI'}</button></td></tr>`; }).join('')}</tbody>
        </table></div>
      </div>` : ''}
      <p class="disclaimer" style="margin-top:18px">WSOP facts (bracelets and results) are current through the 2026 WSOP. Playing tendencies are modeled from each player's public reputation, books, interviews and televised play, not from private hand data; the "measured HUD" numbers are what each AI profile actually does in simulation. Not affiliated with the WSOP or any player.</p>`;

    this.root.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { this.filter = b.dataset.filter; this.mount(); }));
    this.root.querySelector('#to-play').addEventListener('click', () => this.app.go('play'));
    this.root.querySelectorAll('[data-unseat]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.unseat);
      const s2 = this.store.settings;
      const rest = s2.lineup.filter((_, k) => k !== i);
      const pool = ['gto', 'grinder', 'rec'];
      while (rest.length < 8) rest.push(pool[rest.length % pool.length]);
      s2.lineup = rest;
      saveStore(this.store);
      this.mount();
    }));
    this.root.querySelectorAll('[data-seat-id]').forEach((b) => b.addEventListener('click', () => this.seat(b.dataset.seatId)));
    this.root.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', () => {
      const p = this.app.resolveProfile(b.dataset.detail);
      const o = this.store.opponents[p.name];
      this.app.showPlayerCard(p.name, p, o ? deriveStats(o.agg) : null);
    }));
    this.root.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.delete;
      if (!(await confirmModal('Delete this custom profile?', 'Delete'))) return;
      this.store.customProfiles = this.store.customProfiles.filter((c) => c.id !== id);
      this.store.settings.lineup = this.store.settings.lineup.map((x) => (x === id ? 'gto' : x));
      saveStore(this.store);
      this.mount();
    }));
    this.root.querySelectorAll('[data-clone]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.clone(b.dataset.clone);
    }));
    this.root.querySelectorAll('[data-player]').forEach((tr) => tr.addEventListener('click', () => {
      const name = tr.dataset.player;
      this.app.showPlayerCard(name, null, deriveStats(this.store.opponents[name].agg));
    }));
  }

  cardHTML(p, lineup) {
    const t = p.tendencies;
    const hud = PROFILE_HUD[p.id] || (p.kind !== 'pro' && p.kind !== 'archetype' ? p.hud : null);
    const seated = lineup.includes(p.id);
    const observed = this.store.opponents[p.name];
    const obs = observed ? deriveStats(observed.agg) : null;
    const trait = (label, v) => `<span>${label}</span><span class="trait-bar" data-tip="${esc(`${label}: ${v.toFixed(2)}× the GTO baseline`)}"><i style="width:${Math.max(3, Math.min(100, (v / 2) * 100))}%"></i></span>`;
    return `
      <article class="panel pcard-pro">
        <div class="pro-head">
          ${avatarHTML(p.name, p.color)}
          <div style="min-width:0"><div class="pro-name">${esc(p.name)}</div><div class="pro-tag">${esc(p.tagline || '')}</div></div>
          ${p.kind === 'pro' ? `<div class="bracelets" aria-label="${p.wsop.bracelets} WSOP bracelets">${p.wsop.bracelets}<small>bracelets</small></div>` : `<span class="chip-tag">${esc(p.kind === 'mirror' ? 'Mirror' : p.kind === 'imported' ? 'Imported' : 'Archetype')}</span>`}
        </div>
        <div class="row" style="gap:6px"><span class="chip-tag">${esc(p.style || '')}</span>${t.adapt >= 0.7 ? '<span class="chip-tag">Adapts to you</span>' : ''}${t.tilt >= 0.4 ? '<span class="chip-tag">Can tilt</span>' : ''}</div>
        ${p.wsop?.facts?.length ? `<ul class="facts-list">${p.wsop.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
        <p class="small" style="margin:0;color:var(--ink-2)">${esc(p.bio || '')}</p>
        <div class="traits">
          ${trait('Looseness', (t.openMult + t.callMult) / 2)}
          ${trait('Aggression', t.aggression)}
          ${trait('Bluffing', t.bluff)}
          ${trait('Calling down', t.stickiness)}
          ${trait('Adapts to you', t.adapt * 2)}
        </div>
        ${hud ? `<div class="hud-line">Measured HUD · VPIP ${pct(hud.vpip)} · PFR ${pct(hud.pfr)} · 3B ${pct(hud.threeBet)} · AF ${hud.af == null ? '—' : hud.af.toFixed(1)} · WTSD ${pct(hud.wtsd)}</div>` : ''}
        ${obs && obs.hands ? `<div class="hud-line">Vs you · ${fmt(obs.hands)} hands · VPIP ${pct(obs.vpip)} · PFR ${pct(obs.pfr)} · AF ${obs.af == null ? '—' : obs.af.toFixed(1)}</div>` : ''}
        <div class="row" style="margin-top:auto">
          <button class="btn small ${seated ? '' : 'dark'}" data-seat-id="${esc(p.id)}" ${seated ? 'disabled' : ''}>${seated ? 'Seated' : 'Seat'}</button>
          <button class="btn small" data-detail="${esc(p.id)}">Scouting report</button>
          ${p.kind === 'imported' ? `<button class="btn small" data-delete="${esc(p.id)}">Delete</button>` : ''}
        </div>
      </article>`;
  }

  seat(id) {
    const s = this.store.settings;
    const tableSize = s.scenario === 'heads_up' ? 2 : s.tableSize;
    const n = tableSize - 1;
    const lineup = s.lineup.slice();
    // replace the last archetype seat if there is one, else the last seat
    let slot = -1;
    for (let i = n - 1; i >= 0; i--) {
      const p = this.app.resolveProfile(lineup[i]);
      if (!p || p.kind === 'archetype') { slot = i; break; }
    }
    if (slot < 0) slot = n - 1;
    lineup[slot] = id;
    s.lineup = lineup;
    saveStore(this.store);
    this.mount();
  }

  clone(name) {
    const o = this.store.opponents[name];
    if (!o) return;
    const d = deriveStats(o.agg);
    const st = classifyStyle(d);
    const id = `imp:${name}`.slice(0, 60);
    const prof = {
      id, kind: 'imported', name, short: name, sourceName: name,
      color: '#8a7f6a', style: st.label, tagline: `Cloned from ${fmt(d.hands)} imported hands`,
      bio: `An AI that plays like ${name} did in your hand histories. ${st.blurb}`,
      tendencies: statsToTendencies(d),
      hud: { vpip: d.vpip, pfr: d.pfr, threeBet: d.threeBet, af: d.af, wtsd: d.wtsd },
    };
    this.store.customProfiles = this.store.customProfiles.filter((c) => c.id !== id).concat(prof);
    saveStore(this.store);
    const m = openModal(`<h2>${esc(name)} cloned</h2><p class="muted">The new AI opponent is in your profiles. Seat it now?</p><div class="row" style="justify-content:flex-end"><button class="btn" data-close>Later</button><button class="btn primary" data-close id="seat-now">Seat at my table</button></div>`, { onClose: () => this.mount() });
    m.el.querySelector('#seat-now').addEventListener('click', () => this.seat(id));
  }
}

export { exploitTips };
