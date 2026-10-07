// Hands tab: your recent hands with per-decision grades, and a review view
// with the full history and the coach's reasoning (plus optional AI review).

import { esc, fmt, cardsHTML, gradeHTML, openModal, copyText } from './dom.js';
import { askCoach, coachAvailable, handReviewPrompt } from '../coach/llmCoach.js';
import { SCENARIOS } from '../engine/tournament.js';

const GRADE_ORDER = ['blunder', 'mistake', 'inaccuracy', 'good', 'best'];

export class HandsView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.onlyMistakes = false;
  }

  get store() { return this.app.store; }

  mount() {
    const hands = this.store.hands.filter((h) => h.source !== 'import' && h.heroIdx >= 0);
    const list = this.onlyMistakes ? hands.filter((h) => (h.decisions || []).some((d) => d.grade === 'mistake' || d.grade === 'blunder')) : hands;
    this.root.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-end;margin-bottom:12px">
        <div><div class="eyebrow">History</div><h1 class="section-title" style="font-size:36px">Your hands</h1>
          <p class="muted" style="margin:4px 0 0">The last ${fmt(hands.length)} hands you played, with every decision graded. Click a hand to review it.</p></div>
        <label class="row small"><input type="checkbox" id="only-mistakes" ${this.onlyMistakes ? 'checked' : ''}> Only hands with mistakes</label>
      </div>
      ${list.length ? `<div class="panel tbl-wrap"><table class="tbl">
        <thead><tr><th>Hand</th><th>When</th><th>Pos</th><th>Cards</th><th>Board</th><th class="num">Result</th><th>Decisions</th></tr></thead>
        <tbody>${list.slice(0, 200).map((h) => {
          const hero = h.players[h.heroIdx];
          const net = (hero.end - hero.start) / h.bb;
          const worst = (h.decisions || []).map((d) => d.grade).sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b))[0];
          return `<tr class="clickable" data-id="${esc(h.id)}">
            <td class="data">#${h.handNo}${h.level ? ` <span class="muted">L${h.level}</span>` : ''}</td>
            <td class="small muted">${new Date(h.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
            <td>${esc(hero.pos)}</td>
            <td><span class="row" style="gap:3px;flex-wrap:nowrap">${cardsHTML(hero.hole, 'sm')}</span></td>
            <td><span class="row" style="gap:3px;flex-wrap:nowrap">${cardsHTML(h.board, 'sm')}</span></td>
            <td class="num ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${net > 0 ? '+' : ''}${net.toFixed(1)}bb</td>
            <td>${h.decisions?.length ? `${gradeHTML(worst)} <span class="small muted">${h.decisions.length}</span>` : '<span class="small muted">—</span>'}</td>
          </tr>`;
        }).join('')}</tbody></table></div>` : `<div class="panel empty">No hands yet. Play a tournament and every hand lands here with its graded decisions.<div style="margin-top:12px"><button class="btn primary" id="go-play">Play now</button></div></div>`}`;
    this.root.querySelector('#only-mistakes').addEventListener('change', (e) => { this.onlyMistakes = e.target.checked; this.mount(); });
    this.root.querySelector('#go-play')?.addEventListener('click', () => this.app.go('play'));
    this.root.querySelectorAll('[data-id]').forEach((tr) => tr.addEventListener('click', () => {
      const rec = this.store.hands.find((h) => h.id === tr.dataset.id);
      if (rec) this.review(rec);
    }));
  }

  review(rec) {
    const hero = rec.heroIdx >= 0 ? rec.players[rec.heroIdx] : null;
    const net = hero ? (hero.end - hero.start) / rec.bb : 0;
    const decisions = rec.decisions || [];
    const m = openModal(`
      <div class="row" style="justify-content:space-between">
        <div><div class="eyebrow">${esc(SCENARIOS[rec.scenario]?.name || 'Imported hand')} · Hand #${rec.handNo ?? ''} · ${fmt(rec.sb)}/${fmt(rec.bb)}${rec.ante ? ` ante ${fmt(rec.ante)}` : ''}</div>
        <h2>${hero ? `${esc(hero.pos)} ${''}` : ''}<span class="row" style="display:inline-flex;gap:4px;vertical-align:middle">${cardsHTML(hero?.hole, '')}</span></h2></div>
        <div class="${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}" style="font-weight:700;font-size:18px">${net > 0 ? '+' : ''}${net.toFixed(1)}bb</div>
      </div>
      ${rec.board ? `<div class="row" style="gap:4px;margin:10px 0">${cardsHTML(rec.board, '')}</div>` : ''}
      ${decisions.length ? `<div class="stack" style="gap:10px;margin:12px 0">${decisions.map((d) => `
        <div class="panel panel-pad" style="padding:10px 12px">
          <div class="row" style="justify-content:space-between">${gradeHTML(d.grade)}<span class="small muted">${esc(d.spot)}</span></div>
          <p style="margin:6px 0 2px"><b>${esc(d.street)}:</b> you chose <b>${esc(d.taken)}</b>${d.board ? ` on ${esc(d.board)}` : ''}.</p>
          <p class="small" style="margin:0 0 6px;color:var(--ink-2)">${esc(d.message)}</p>
          <div class="mix">${d.mix.map((a) => `<div class="mix-row"><span>${esc(a.label)}</span><span class="pct">${Math.round(a.freq * 100)}%</span><span class="bar"><i style="width:${a.freq * 100}%"></i></span></div>`).join('')}</div>
          <ul class="notes">${d.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        </div>`).join('')}</div>` : ''}
      ${rec.exploits?.length ? `<div class="panel panel-pad" style="margin-bottom:12px"><b>Opponent reads during this hand</b><ul class="notes">${rec.exploits.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
      ${rec.text ? `<details open><summary class="small muted" style="cursor:pointer;margin-bottom:6px">Hand history</summary><pre class="hand-text" id="hh-text">${esc(rec.text)}</pre></details>` : ''}
      <div id="ai-review" class="small" style="white-space:pre-wrap;margin-top:12px;color:var(--ink-2)"></div>
      <div class="row" style="justify-content:flex-end;margin-top:14px">
        ${rec.text ? '<button class="btn" id="copy-hh">Copy hand history</button>' : ''}
        <button class="btn dark" id="ai-btn">Ask Claude about this hand</button>
        <button class="btn" data-close>Close</button>
      </div>`, { wide: true });
    m.el.querySelector('#copy-hh')?.addEventListener('click', async (e) => {
      const ok = await copyText(rec.text);
      e.target.textContent = ok ? 'Copied' : 'Select and copy above';
      if (!ok) { const pre = m.el.querySelector('#hh-text'); const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    });
    m.el.querySelector('#ai-btn').addEventListener('click', async (e) => {
      const out = m.el.querySelector('#ai-review');
      if (!coachAvailable(this.store.settings)) {
        out.innerHTML = 'The AI coach needs an Anthropic API key. Add one in <b>Settings</b> (it stays in this browser).';
        return;
      }
      e.target.disabled = true;
      out.textContent = 'Claude is reviewing the hand…';
      try {
        out.textContent = await askCoach(this.store.settings, handReviewPrompt(rec, decisions));
      } catch (err) {
        out.textContent = `Couldn't reach the AI coach: ${err.message}`;
      } finally {
        e.target.disabled = false;
      }
    });
  }
}
