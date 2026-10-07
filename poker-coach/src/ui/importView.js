// Import tab: paste or upload PokerStars/GGPoker-style hand histories to
// build your style profile from real games and scout real opponents.

import { parseHandHistories } from '../stats/hhParser.js';
import { handFlags, addFlags, emptyAgg, deriveStats } from '../stats/stats.js';
import { classifyStyle } from '../stats/style.js';
import { saveStore } from './store.js';
import { esc, fmt, pct } from './dom.js';

const SAMPLE = `PokerStars Hand #250000000001: Tournament #3500000000, $10+$1 USD Hold'em No Limit - Level V (100/200) - 2024/06/01 12:00:00 ET
Table '3500000000 1' 9-max Seat #3 is the button
Seat 1: Alice (12000 in chips)
Seat 2: Bob (9000 in chips)
Seat 3: Hero (15000 in chips)
Seat 4: Carol (8000 in chips)
Seat 5: Dave (10000 in chips)
Carol: posts small blind 100
Dave: posts big blind 200
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
Alice: folds
Bob: raises 250 to 450
Hero: raises 800 to 1250
Carol: folds
Dave: folds
Bob: calls 800
*** FLOP *** [Ks 7h 2c]
Bob: checks
Hero: bets 900
Bob: folds
Uncalled bet (900) returned to Hero
Hero collected 2900 from pot
*** SUMMARY ***

PokerStars Hand #250000000002: Tournament #3500000000, $10+$1 USD Hold'em No Limit - Level V (100/200) - 2024/06/01 12:01:00 ET
Table '3500000000 1' 9-max Seat #4 is the button
Seat 1: Alice (11900 in chips)
Seat 2: Bob (7650 in chips)
Seat 3: Hero (16650 in chips)
Seat 4: Carol (7900 in chips)
Seat 5: Dave (9800 in chips)
Dave: posts small blind 100
Alice: posts big blind 200
*** HOLE CARDS ***
Dealt to Hero [7c 7d]
Bob: calls 200
Hero: raises 400 to 600
Carol: folds
Dave: folds
Alice: calls 400
Bob: calls 400
*** FLOP *** [7s Td 2h]
Alice: checks
Bob: bets 1000
Hero: raises 1700 to 2700
Alice: folds
Bob: calls 1700
*** TURN *** [7s Td 2h] [Qc]
Bob: checks
Hero: bets 4000
Bob: calls 4000
*** RIVER *** [7s Td 2h Qc] [3d]
Bob: checks
Hero: bets 4300
Bob: folds
Uncalled bet (4300) returned to Hero
Hero collected 15300 from pot
*** SUMMARY ***
`;

export class ImportView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.result = null;
  }

  get store() { return this.app.store; }

  mount() {
    const r = this.result;
    this.root.innerHTML = `
      <div class="eyebrow">Your real games</div>
      <h1 class="section-title" style="font-size:36px">Import hand histories</h1>
      <p class="muted" style="margin:4px 0 14px;max-width:72ch">Paste or upload PokerStars-format hand histories (GGPoker and most sites export the same format). Your hands feed your style report; every opponent gets a HUD profile you can study or clone into an AI to practice against. Everything is processed in this browser.</p>
      <div class="grid-2" style="align-items:start">
        <div class="panel panel-pad stack">
          <label for="hh-text" class="eyebrow">Hand histories</label>
          <textarea id="hh-text" class="hh" placeholder="PokerStars Hand #...">${esc(this.text || '')}</textarea>
          <div class="row">
            <label class="btn" style="cursor:pointer">Choose .txt files<input type="file" id="hh-files" accept=".txt,text/plain" multiple hidden></label>
            <button class="btn" id="hh-sample">Load a 2-hand sample</button>
            <button class="btn primary" id="hh-parse">Analyze</button>
          </div>
        </div>
        <div class="panel panel-pad" id="hh-result">
          ${r ? this.resultHTML(r) : '<div class="empty small">Results appear here: hands found, your stats from these hands, and every opponent with their HUD.</div>'}
        </div>
      </div>`;
    this.root.querySelector('#hh-sample').addEventListener('click', () => { this.text = SAMPLE; this.mount(); });
    this.root.querySelector('#hh-files').addEventListener('change', async (e) => {
      const texts = await Promise.all([...e.target.files].map((f) => f.text()));
      this.text = texts.join('\n\n');
      this.mount();
    });
    this.root.querySelector('#hh-parse').addEventListener('click', () => {
      this.text = this.root.querySelector('#hh-text').value;
      this.analyze();
    });
    this.root.querySelector('#hh-save')?.addEventListener('click', () => this.save());
  }

  analyze() {
    const parsed = parseHandHistories(this.text || '');
    const heroName = parsed.heroName;
    const heroAgg = emptyAgg();
    const players = new Map();
    for (const rec of parsed.records) {
      const flags = handFlags(rec);
      rec.players.forEach((p, i) => {
        if (p.name === heroName) addFlags(heroAgg, flags[i], p.canon);
        else {
          const agg = players.get(p.name) || emptyAgg();
          addFlags(agg, flags[i], p.canon);
          players.set(p.name, agg);
        }
      });
    }
    this.result = { parsed, heroName, heroAgg, players, saved: false };
    this.mount();
  }

  resultHTML(r) {
    const { parsed } = r;
    if (!parsed.records.length) {
      return `<p><b>No hold'em hands found.</b></p><p class="small muted">Check that the text is a PokerStars-style export (lines like "PokerStars Hand #…", "Seat 1: name (1500 in chips)", "*** HOLE CARDS ***").${parsed.skipped ? ` ${parsed.skipped} non-NLHE hands were skipped.` : ''}</p>${parsed.errors.length ? `<pre class="hand-text">${esc(parsed.errors.slice(0, 5).join('\n'))}</pre>` : ''}`;
    }
    const hs = deriveStats(r.heroAgg);
    const opps = [...r.players.entries()].sort((a, b) => b[1].hands - a[1].hands);
    return `
      <div class="row" style="justify-content:space-between"><b>${fmt(parsed.records.length)} hands parsed</b><span class="small muted">${parsed.errors.length ? `${parsed.errors.length} could not be read · ` : ''}${parsed.skipped ? `${parsed.skipped} skipped` : ''}</span></div>
      ${r.heroName ? `<p class="small" style="margin:8px 0">You are <b>${esc(r.heroName)}</b> (from "Dealt to"): VPIP ${pct(hs.vpip)} · PFR ${pct(hs.pfr)} · 3-bet ${pct(hs.threeBet)} · AF ${hs.af == null ? '—' : hs.af.toFixed(1)} · ${esc(classifyStyle(hs).label)}</p>` : '<p class="small muted">No "Dealt to" line found, so these hands only build opponent profiles.</p>'}
      <div class="tbl-wrap" style="max-height:300px;overflow:auto"><table class="tbl">
        <thead><tr><th>Opponent</th><th class="num">Hands</th><th class="num">VPIP</th><th class="num">PFR</th><th class="num">AF</th><th>Style</th></tr></thead>
        <tbody>${opps.slice(0, 80).map(([name, agg]) => { const d = deriveStats(agg); return `<tr><td>${esc(name)}</td><td class="num">${fmt(d.hands)}</td><td class="num">${pct(d.vpip)}</td><td class="num">${pct(d.pfr)}</td><td class="num">${d.af == null ? '—' : d.af.toFixed(1)}</td><td class="small">${esc(classifyStyle(d).label)}</td></tr>`; }).join('')}</tbody>
      </table></div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" id="hh-save" ${r.saved ? 'disabled' : ''}>${r.saved ? 'Saved' : 'Add to my profile'}</button>
        <span class="small muted">${r.saved ? 'Saved. See My Style and Opponents.' : 'Adds your hands to My Style and saves every opponent\'s HUD.'}</span>
      </div>`;
  }

  save() {
    const r = this.result;
    if (!r || r.saved) return;
    const st = this.store;
    st.hero.importedAgg ||= emptyAgg();
    for (const k of Object.keys(r.heroAgg)) {
      if (k === 'byPos') continue;
      st.hero.importedAgg[k] = (st.hero.importedAgg[k] || 0) + r.heroAgg[k];
    }
    for (const [pos, v] of Object.entries(r.heroAgg.byPos)) {
      const bp = (st.hero.importedAgg.byPos[pos] ||= { hands: 0, vpip: 0, pfr: 0, netBB: 0 });
      bp.hands += v.hands; bp.vpip += v.vpip; bp.pfr += v.pfr; bp.netBB += v.netBB;
    }
    for (const [name, agg] of r.players) {
      const o = (st.opponents[name] ||= { agg: emptyAgg(), profileId: null, source: 'import', lastSeen: 0 });
      for (const k of Object.keys(agg)) {
        if (k === 'byPos') continue;
        o.agg[k] = (o.agg[k] || 0) + agg[k];
      }
      o.lastSeen = Date.now();
    }
    r.saved = true;
    saveStore(st);
    this.mount();
  }
}
