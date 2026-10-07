// Hand-history importer for PokerStars-style text (also matches GGPoker and
// most sites that copy the PokerStars format). Produces the same records as
// live play, so imported hands feed your style profile and build HUD
// profiles of the real opponents you faced.

import { positionsFor } from '../engine/game.js';

const START_RE = /^(?:PokerStars|Poker|GGPoker|Game|PokerStars Zoom|PokerStars Home Game)?\s*(?:Zoom\s+)?(?:Hand|Game) #/i;
const NUM = (s) => Number(String(s).replace(/[^\d.]/g, ''));

/** Split a big text blob into individual hand texts. */
export function splitHands(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const hands = [];
  let cur = null;
  for (const line of lines) {
    if (START_RE.test(line.trim()) && /hold.?em/i.test(line)) {
      if (cur) hands.push(cur.join('\n'));
      cur = [line.trim()];
    } else if (cur) {
      cur.push(line);
    }
  }
  if (cur) hands.push(cur.join('\n'));
  return hands;
}

/**
 * Parse hand histories.
 * @returns {{records:object[], errors:string[], heroName:string|null, skipped:number}}
 */
export function parseHandHistories(text) {
  const records = [];
  const errors = [];
  let heroName = null;
  let skipped = 0;
  for (const block of splitHands(text)) {
    try {
      if (!/no.?limit/i.test(block.split('\n')[0])) { skipped++; continue; }
      const rec = parseHand(block);
      if (!rec) { skipped++; continue; }
      if (rec.heroName) heroName = rec.heroName;
      records.push(rec);
    } catch (e) {
      errors.push(`${block.split('\n')[0].slice(0, 80)} — ${e.message}`);
    }
  }
  return { records, errors, heroName, skipped };
}

export function parseHand(block) {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  const header = lines[0];
  const blinds = header.match(/\(\s*[^\d\s(]?\s*([\d.,]+)\s*\/\s*[^\d\s]?\s*([\d.,]+)/);
  if (!blinds) throw new Error('could not find blinds');
  const sb = NUM(blinds[1]);
  const bb = NUM(blinds[2]);
  const idMatch = header.match(/#\s*([\w-]+)/);
  const btnMatch = block.match(/Seat #(\d+) is the button/);
  const seats = [];
  for (const l of lines) {
    if (l.startsWith('*** ')) break;
    const m = l.match(/^Seat (\d+): (.+?) \(\s*[^\d\s]?\s*([\d.,]+)(?: in chips)?.*\)(.*)$/);
    if (m && !/sitting out/i.test(m[4])) seats.push({ seat: Number(m[1]), name: m[2], stack: NUM(m[3]) });
  }
  if (seats.length < 2) return null;
  seats.sort((a, b) => a.seat - b.seat);
  const names = seats.map((s) => s.name).sort((a, b) => b.length - a.length);
  const idxOf = new Map(seats.map((s, i) => [s.name, i]));
  const n = seats.length;
  const btnSeat = btnMatch ? Number(btnMatch[1]) : seats[0].seat;
  let button = seats.findIndex((s) => s.seat === btnSeat);
  if (button < 0) {
    // button on an empty seat: the last occupied seat before it
    button = n - 1;
    for (let i = n - 1; i >= 0; i--) if (seats[i].seat < btnSeat) { button = i; break; }
  }
  const positions = positionsFor(n, button);

  const contrib = new Array(n).fill(0);
  const won = new Array(n).fill(0);
  const actions = [];
  const shown = [];
  let street = -1; // -1 = posting phase
  let streetBet = new Array(n).fill(0);
  let currentBet = 0;
  let pot = 0;
  let board = '';
  let showdown = false;
  let heroName = null;
  let heroCards = null;
  let ante = 0;

  const who = (l) => names.find((nm) => l.startsWith(`${nm}: `) || l.startsWith(`${nm} `));

  for (const l of lines.slice(1)) {
    if (l.startsWith('*** HOLE CARDS')) { street = 0; continue; }
    const st = l.match(/^\*\*\* (FLOP|TURN|RIVER) \*\*\*\s*(.*)$/);
    if (st) {
      street = { FLOP: 1, TURN: 2, RIVER: 3 }[st[1]];
      board = (st[2].match(/\[([^\]]+)\]/g) || []).map((x) => x.slice(1, -1)).join(' ');
      streetBet = new Array(n).fill(0);
      currentBet = 0;
      continue;
    }
    if (l.startsWith('*** SHOW') ) { showdown = true; continue; }
    if (l.startsWith('*** SUMMARY')) break;
    const dealt = l.match(/^Dealt to (.+?) \[([^\]]+)\]/);
    if (dealt && idxOf.has(dealt[1])) { heroName = dealt[1]; heroCards = dealt[2]; continue; }
    const unc = l.match(/^Uncalled bet \(\s*[^\d\s]?\s*([\d.,]+)\) returned to (.+)$/);
    if (unc && idxOf.has(unc[2])) { const i = idxOf.get(unc[2]); contrib[i] -= NUM(unc[1]); pot -= NUM(unc[1]); continue; }
    const name = who(l);
    if (!name) continue;
    const i = idxOf.get(name);
    const rest = l.slice(name.length).replace(/^:\s*/, '').trim();
    const allIn = /all-in/i.test(rest);
    let m;
    if ((m = rest.match(/^posts (?:the )?ante\s+[^\d]*([\d.,]+)/i))) {
      const a = NUM(m[1]); contrib[i] += a; pot += a; ante = Math.max(ante, a); continue;
    }
    if ((m = rest.match(/^posts (?:small blind|big blind|small & big blinds|the big blind|big blind ante|straddle)\s+[^\d]*([\d.,]+)/i))) {
      const a = NUM(m[1]);
      if (/big blind ante/i.test(rest)) { contrib[i] += a; pot += a; ante = Math.max(ante, a); continue; }
      contrib[i] += a; pot += a;
      streetBet[i] += a;
      currentBet = Math.max(currentBet, streetBet[i]);
      continue;
    }
    if ((m = rest.match(/^collected\s+[^\d]*([\d.,]+)/i))) { won[i] += NUM(m[1]); continue; }
    if ((m = rest.match(/^shows \[([^\]]+)\](?:\s*\((.*)\))?/i))) { shown.push({ i, cards: m[1], desc: m[2] || '' }); continue; }
    if (street < 0) continue;
    const facing = currentBet - streetBet[i];
    const potBefore = pot;
    if (/^folds/i.test(rest)) actions.push({ st: street, i, t: 'fold', amt: 0, to: 0, ai: 0, facing, pot: potBefore });
    else if (/^checks/i.test(rest)) actions.push({ st: street, i, t: 'check', amt: 0, to: 0, ai: 0, facing, pot: potBefore });
    else if ((m = rest.match(/^calls\s+[^\d]*([\d.,]+)/i))) {
      const a = NUM(m[1]); contrib[i] += a; pot += a; streetBet[i] += a;
      actions.push({ st: street, i, t: 'call', amt: a, to: 0, ai: allIn ? 1 : 0, facing, pot: potBefore });
    } else if ((m = rest.match(/^bets\s+[^\d]*([\d.,]+)/i))) {
      const a = NUM(m[1]); contrib[i] += a; pot += a; streetBet[i] += a; currentBet = streetBet[i];
      actions.push({ st: street, i, t: street === 0 ? 'raise' : 'bet', amt: a, to: streetBet[i], ai: allIn ? 1 : 0, facing, pot: potBefore });
    } else if ((m = rest.match(/^raises\s+[^\d]*([\d.,]+)\s+to\s+[^\d]*([\d.,]+)/i))) {
      const to = NUM(m[2]); const a = to - streetBet[i];
      contrib[i] += a; pot += a; streetBet[i] = to; currentBet = to;
      actions.push({ st: street, i, t: 'raise', amt: a, to, ai: allIn ? 1 : 0, facing, pot: potBefore });
    }
  }

  const players = seats.map((s, i) => ({
    name: s.name,
    profileId: null,
    pos: positions[i].display,
    canon: positions[i].canonical,
    start: s.stack,
    end: Math.round((s.stack - contrib[i] + won[i]) * 100) / 100,
    hole: s.name === heroName ? heroCards : shown.find((x) => x.i === i)?.cards || null,
  }));
  return {
    v: 1,
    id: `hh-${idMatch ? idMatch[1] : Math.random().toString(36).slice(2)}`,
    ts: Date.now(),
    source: 'import',
    sb, bb, ante,
    button,
    heroIdx: heroName ? idxOf.get(heroName) : -1,
    heroName,
    players,
    actions,
    board,
    showdown,
    shown: shown.map((s) => ({ i: s.i, cards: s.cards, desc: s.desc })),
    won,
    decisions: [],
    text: block,
  };
}
