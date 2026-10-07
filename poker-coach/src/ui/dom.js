// Small DOM/string helpers shared by the views.

import { RANKS, SUITS, SUIT_SYMBOLS } from '../engine/cards.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const fmt = (n) => (n == null || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US'));
export const fmtBB = (n, bb) => (bb ? `${(n / bb).toFixed(n / bb >= 100 ? 0 : 1)}bb` : '');
export const pct = (x, d = 0) => (x == null || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(d)}%`);
export const signed = (x, d = 1) => (x == null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}`);

export function compact(n) {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return fmt(n);
}

/** Card markup from an int (0..51) or a string like "As". */
export function cardHTML(c, size = '', extra = '') {
  if (c == null) return `<span class="pcard back ${size} ${extra}"></span>`;
  let r;
  let s;
  if (typeof c === 'string') { r = RANKS.indexOf(c[0].toUpperCase()); s = SUITS.indexOf(c[1]); }
  else { r = c >> 2; s = c & 3; }
  const rank = RANKS[r] === 'T' ? '10' : RANKS[r];
  const label = `${rank}${SUIT_SYMBOLS[s]}`;
  return `<span class="pcard ${size} s-${SUITS[s] === 's' ? 's' : SUITS[s]} ${extra}" role="img" aria-label="${label}"><span class="r">${rank}</span><span class="s">${SUIT_SYMBOLS[s]}</span></span>`;
}

export function cardsHTML(str, size = '') {
  if (!str) return '';
  return str.split(' ').filter(Boolean).map((c) => cardHTML(c, size)).join('');
}

export function initials(name) {
  const parts = String(name).replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarHTML(name, color = '#5b6b64') {
  return `<span class="avatar" style="background:${esc(color)}" aria-hidden="true">${esc(initials(name))}</span>`;
}

export const GRADE_LABEL = { best: 'Best', good: 'Good', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder' };

export function gradeHTML(g) {
  return `<span class="grade ${esc(g)}">${GRADE_LABEL[g] || esc(g)}</span>`;
}

let tipEl = null;
/** Lightweight hover tooltip for chart marks: elements with data-tip. */
export function bindTooltips(root) {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tooltip';
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
  }
  root.addEventListener('pointermove', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t || !root.contains(t)) { tipEl.hidden = true; return; }
    tipEl.innerHTML = t.getAttribute('data-tip');
    tipEl.hidden = false;
    const x = Math.min(window.innerWidth - tipEl.offsetWidth - 8, e.clientX + 12);
    const y = Math.max(8, e.clientY - tipEl.offsetHeight - 10);
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y}px`;
  });
  root.addEventListener('pointerleave', () => { tipEl.hidden = true; });
}

/** In-page modal (the artifact viewer blocks alert/confirm). Returns a close function. */
export function openModal(innerHTML, { onClose, wide } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" ${wide ? 'style="max-width:880px"' : ''}>${innerHTML}</div>`;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  wrap.querySelector('button, [tabindex], input, select, textarea')?.focus();
  return { el: wrap.firstElementChild, close };
}

/** In-page confirm dialog. */
export function confirmModal(message, confirmLabel = 'Confirm') {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal(`<p style="margin:0 0 16px">${esc(message)}</p><div class="row" style="justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="confirm-yes">${esc(confirmLabel)}</button></div>`, {
      onClose: () => { if (!done) resolve(false); },
    });
    m.el.querySelector('#confirm-yes').addEventListener('click', () => { done = true; m.close(); resolve(true); });
  });
}

export async function copyText(text, fallbackEl) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallbackEl) { fallbackEl.focus(); fallbackEl.select(); }
    return false;
  }
}
