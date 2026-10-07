// App shell: tabs, settings, profile resolution and shared dialogs.

import { loadStore, saveStore, setSaveHook, exportData, importData, defaultStore, storageAvailable, heroAggAll } from './store.js';
import { initCloudSync } from './cloudSync.js';
import { initHostBridge, hostBridgeReady } from '../coach/llmCoach.js';
import { PROFILES, getProfile, BASELINE } from '../ai/profiles.js';
import { deriveStats } from '../stats/stats.js';
import { statsToTendencies, classifyStyle, exploitTips } from '../stats/style.js';
import { PROFILE_HUD } from '../data/profileHud.js';
import { PlayView } from './play.js';
import { ReportView } from './report.js';
import { OpponentsView } from './opponents.js';
import { HandsView } from './hands.js';
import { TrainView } from './train.js';
import { ImportView } from './importView.js';
import { esc, pct, fmt, avatarHTML, openModal, confirmModal, copyText } from './dom.js';

const TABS = [
  ['play', 'Play'],
  ['report', 'My Style'],
  ['opponents', 'Opponents'],
  ['hands', 'Hands'],
  ['train', 'Train'],
  ['import', 'Import'],
];

class App {
  constructor() {
    this.store = loadStore();
    this.applyTheme();
    this.root = document.getElementById('app');
    this.root.innerHTML = `
      <div class="shell">
        <header class="topbar">
          <div class="brand"><span class="brand-mark">Bracelet <span>Hunt</span></span><span class="brand-sub">AI poker coach</span></div>
          <nav class="tabs" role="tablist" aria-label="Sections">${TABS.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="false">${l}</button>`).join('')}</nav>
          <span class="small muted" id="sync-status"></span>
          <button class="icon-btn" id="settings-btn">Settings</button>
        </header>
        <main>${TABS.map(([k]) => `<section id="view-${k}" hidden></section>`).join('')}</main>
        <footer class="footer">Bracelet Hunt trains no-limit hold'em with a GTO-approximate model (preflop charts, Nash push/fold with ICM, theory-based postflop play). It is a learning tool, not a solver. Pro opponents are modeled caricatures; not affiliated with the WSOP or any player.</footer>
      </div>`;
    this.views = {
      play: new PlayView(this.view('play'), this),
      report: new ReportView(this.view('report'), this),
      opponents: new OpponentsView(this.view('opponents'), this),
      hands: new HandsView(this.view('hands'), this),
      train: new TrainView(this.view('train'), this),
      import: new ImportView(this.view('import'), this),
    };
    this.root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => this.go(b.dataset.tab)));
    this.root.querySelector('#settings-btn').addEventListener('click', () => this.openSettings());
    const hash = location.hash.replace('#', '');
    this.go(TABS.some(([k]) => k === hash) ? hash : 'play');
    this.setStatus(storageAvailable() ? 'Saved in this browser' : 'Not saved (browser storage unavailable)');
    this.initRuntime();
  }

  view(k) { return this.root.querySelector(`#view-${k}`); }

  async initRuntime() {
    await initHostBridge();
    const sync = await initCloudSync(this.store, {
      onRemoteNewer: () => { if (!this.views.play.session || this.views.play.ended) this.views[this.currentTab]?.mount(); },
      onStatus: (s) => this.setStatus(s === 'synced' ? 'Synced to your Claude account' : 'Saved in this browser'),
    });
    if (sync) setSaveHook((st) => sync.schedule(st));
  }

  setStatus(text) {
    const el = this.root.querySelector('#sync-status');
    if (el) el.textContent = text;
  }

  go(tab) {
    if (this.currentTab === 'play' && tab !== 'play') this.views.play.unmountTimers?.();
    const leavingPlay = this.currentTab === 'play' && tab !== 'play';
    this.currentTab = tab;
    for (const [k] of TABS) {
      this.view(k).hidden = k !== tab;
      this.root.querySelector(`[data-tab="${k}"]`).setAttribute('aria-selected', String(k === tab));
    }
    try { history.replaceState(null, '', `#${tab}`); } catch { /* sandboxed */ }
    if (tab === 'play' && this.views.play.session && !this.views.play.ended) {
      this.views.play.renderGame();
      this.views.play.loop();
    } else {
      this.views[tab].mount();
    }
    if (leavingPlay) { /* table timers paused; resumes on return */ }
    window.scrollTo({ top: 0 });
  }

  applyTheme() {
    const t = this.store.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }

  /** Mirror profile from the hero's own stats. */
  mirrorProfile() {
    const stats = deriveStats(heroAggAll(this.store));
    if (stats.hands < 30) return null;
    const st = classifyStyle(stats);
    return {
      id: 'mirror', kind: 'mirror', name: 'Mirror You', short: 'Mirror', color: '#c9a227',
      style: st.label, tagline: `An AI built from your ${fmt(stats.hands)} hands`,
      bio: 'Plays with your measured tendencies. Watch how a strong opponent exploits them, or how your own style holds up against itself.',
      tendencies: { ...BASELINE, ...statsToTendencies(stats), adapt: 0.3 },
      hud: { vpip: stats.vpip, pfr: stats.pfr, threeBet: stats.threeBet, af: stats.af, wtsd: stats.wtsd },
    };
  }

  resolveProfile(id) {
    if (id === 'mirror') return this.mirrorProfile() || getProfile('gto');
    const custom = this.store.customProfiles.find((c) => c.id === id);
    if (custom) return { ...custom, tendencies: { ...BASELINE, ...custom.tendencies } };
    return getProfile(id);
  }

  allProfiles() {
    const out = [...PROFILES];
    const m = this.mirrorProfile();
    if (m) out.push(m);
    for (const c of this.store.customProfiles) out.push(this.resolveProfile(c.id));
    return out;
  }

  reviewHand(rec) {
    if (!rec) return;
    this.views.hands.review(rec);
  }

  /** Scouting report for one player: profile, observed HUD, exploits. */
  showPlayerCard(name, profile, stats) {
    const hud = profile ? PROFILE_HUD[profile.id] || profile.hud : null;
    const s = stats && stats.hands ? stats : null;
    const row = (label, key, f = pct) => `<tr><td>${label}</td><td class="num">${s ? (s[key] == null ? '—' : f(s[key])) : '—'}</td><td class="num">${hud && hud[key] != null ? f(hud[key]) : '—'}</td></tr>`;
    const af = (v) => v.toFixed(1);
    openModal(`
      <div class="pro-head" style="grid-template-columns:44px minmax(0,1fr)">
        ${avatarHTML(name, profile?.color)}
        <div><h2 style="font-size:26px">${esc(name)}</h2><div class="small muted">${esc(profile?.tagline || (s ? classifyStyle(s).label : ''))}</div></div>
      </div>
      ${profile?.wsop?.facts?.length ? `<ul class="facts-list" style="margin-top:10px">${profile.wsop.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      <div class="tbl-wrap" style="margin-top:12px"><table class="tbl">
        <thead><tr><th>Stat</th><th class="num">Vs you${s ? ` (${fmt(s.hands)}h)` : ''}</th><th class="num">Measured profile</th></tr></thead>
        <tbody>${row('VPIP', 'vpip')}${row('PFR', 'pfr')}${row('3-bet', 'threeBet')}${row('Fold to 3-bet', 'foldTo3Bet')}${row('Flop c-bet', 'cbet')}${row('Fold to c-bet', 'foldToCbet')}${row('Aggression factor', 'af', af)}${row('Went to showdown', 'wtsd')}${row('Won at showdown', 'wsd')}</tbody>
      </table></div>
      <h3 style="font-size:16px;margin-top:14px">How to beat ${esc(profile?.short || name)}</h3>
      <ul class="notes">${exploitTips(s || (hud ? { ...hud, hands: 100, samples: { foldTo3Bet: 20, threeBet: 50, foldToCbet: 30, cbet: 30, af: 60, wtsd: 40, foldToSteal: 20 } } : null)).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close>Close</button></div>`);
  }

  openSettings() {
    const st = this.store.settings;
    const m = openModal(`
      <h2>Settings</h2>
      <div class="stack" style="margin-top:12px">
        <label class="stack" style="gap:4px"><span class="eyebrow">Your name at the table</span><input class="text" id="set-name" maxlength="24" value="${esc(st.heroName)}"></label>
        <div class="row"><span class="eyebrow" style="min-width:120px">Bot speed</span><div class="seg">${['slow', 'normal', 'fast'].map((v) => `<button data-speed="${v}" aria-pressed="${st.speed === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div>
        <div class="row"><span class="eyebrow" style="min-width:120px">Theme</span><div class="seg">${['system', 'light', 'dark'].map((v) => `<button data-theme-set="${v}" aria-pressed="${st.theme === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div>
        <label class="row small"><input type="checkbox" id="set-hud" ${st.showHud ? 'checked' : ''}> Show HUD stats on opponents' seats</label>
        <label class="row small"><input type="checkbox" id="set-four" ${st.fourColor ? 'checked' : ''}> Four-color deck</label>
        <div class="panel panel-pad" style="background:var(--surface-2)">
          <div class="eyebrow">AI coach (Claude)</div>
          <p class="small muted" style="margin:4px 0 8px">${hostBridgeReady() ? 'This page can ask Claude directly, so no key is needed. You can still use your own key.' : 'Study plans and hand reviews use Claude through your own Anthropic API key. The key is sent only to api.anthropic.com.'}</p>
          <input class="text" id="set-key" type="password" autocomplete="off" placeholder="sk-ant-..." value="${esc(st.apiKey)}" style="width:100%">
          <label class="row small" style="margin-top:6px"><input type="checkbox" id="set-remember" ${st.rememberKey ? 'checked' : ''}> Remember the key in this browser</label>
        </div>
        <div class="panel panel-pad" style="background:var(--surface-2)">
          <div class="eyebrow">Your data</div>
          <p class="small muted" style="margin:4px 0 8px">${fmt(deriveStats(heroAggAll(this.store)).hands)} hands in your profile · ${fmt(this.store.hands.length)} hand histories · ${fmt(Object.keys(this.store.opponents).length)} scouted players. Copy a backup to move it to another browser.</p>
          <div class="row"><button class="btn small" id="data-export">Copy backup</button><button class="btn small" id="data-import">Restore backup</button><button class="btn small" id="data-reset">Reset everything</button></div>
          <textarea id="data-box" class="hh" style="min-height:80px;margin-top:8px" hidden></textarea>
          <div class="small" id="data-msg" style="margin-top:6px"></div>
        </div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn primary" data-close>Done</button></div>`, {
      onClose: () => {
        st.heroName = m.el.querySelector('#set-name').value.trim() || 'You';
        st.showHud = m.el.querySelector('#set-hud').checked;
        st.fourColor = m.el.querySelector('#set-four').checked;
        st.apiKey = m.el.querySelector('#set-key').value.trim();
        st.rememberKey = m.el.querySelector('#set-remember').checked;
        saveStore(this.store);
        if (this.currentTab === 'play' && this.views.play.session && !this.views.play.ended) this.views.play.renderGame();
        else this.views[this.currentTab].mount();
      },
    });
    m.el.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
      st.speed = b.dataset.speed;
      m.el.querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    m.el.querySelectorAll('[data-theme-set]').forEach((b) => b.addEventListener('click', () => {
      st.theme = b.dataset.themeSet;
      this.applyTheme();
      m.el.querySelectorAll('[data-theme-set]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    const box = m.el.querySelector('#data-box');
    const msg = m.el.querySelector('#data-msg');
    m.el.querySelector('#data-export').addEventListener('click', async () => {
      box.hidden = false;
      box.value = exportData(this.store);
      const ok = await copyText(box.value, box);
      msg.textContent = ok ? 'Backup copied to the clipboard. Paste it somewhere safe.' : 'Select the text above and copy it.';
    });
    m.el.querySelector('#data-import').addEventListener('click', () => {
      if (box.hidden) { box.hidden = false; box.value = ''; msg.textContent = 'Paste a backup into the box, then press Restore backup again.'; return; }
      try {
        const data = importData(box.value);
        Object.assign(this.store, data);
        saveStore(this.store);
        msg.textContent = 'Backup restored.';
      } catch (e) {
        msg.textContent = e.message || 'That backup could not be read.';
      }
    });
    m.el.querySelector('#data-reset').addEventListener('click', async () => {
      m.close();
      if (!(await confirmModal('Erase all hands, stats, scouting data and settings? This cannot be undone.', 'Erase everything'))) return;
      const fresh = defaultStore();
      for (const k of Object.keys(this.store)) delete this.store[k];
      Object.assign(this.store, fresh);
      saveStore(this.store);
      this.views.play.quit?.();
      this.go('play');
    });
  }
}

function boot() {
  if (!window.braceletHunt) window.braceletHunt = new App();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
