// Canonical, storage-friendly record of a played (or imported) hand.
// Both the live game and the hand-history importer produce this shape, so
// the same stats engine works for your games and for imported opponents.

import { cardsToString, parseCards } from '../engine/cards.js';

export const STREET_NAMES = ['preflop', 'flop', 'turn', 'river'];

/**
 * @param {import('../engine/game.js').Hand} hand completed hand
 * @param {object} meta { heroIdx, profileIds?: string[], scenario?, ts?, decisions?, title? }
 */
export function recordFromHand(hand, meta = {}) {
  const shown = new Set((hand.result?.shown || []).map((s) => s.idx));
  return {
    v: 1,
    id: `${meta.ts || Date.now()}-${hand.id}`,
    handNo: hand.id,
    ts: meta.ts || Date.now(),
    source: meta.source || 'live',
    scenario: meta.scenario || null,
    level: hand.level || null,
    sb: hand.sb, bb: hand.bb, ante: hand.ante,
    button: hand.button,
    heroIdx: meta.heroIdx ?? -1,
    players: hand.players.map((p, i) => ({
      name: p.name,
      profileId: meta.profileIds?.[i] || null,
      pos: p.position.display,
      canon: p.position.canonical,
      start: p.startStack,
      end: p.stack,
      hole: i === meta.heroIdx || shown.has(i) ? cardsToString(p.hole) : null,
    })),
    actions: hand.log.filter((e) => e.type === 'action').map((e) => ({
      st: STREET_NAMES.indexOf(e.street),
      i: e.idx,
      t: e.action,
      amt: e.amount,
      to: e.to,
      ai: e.allIn ? 1 : 0,
      facing: e.facing,
      pot: e.potBefore,
    })),
    board: cardsToString(hand.board),
    showdown: !!hand.result?.showdown,
    shown: (hand.result?.shown || []).map((s) => ({ i: s.idx, cards: cardsToString(s.cards), desc: s.desc })),
    won: hand.result?.won || [],
    text: meta.includeText ? hand.toText(meta.heroIdx) : undefined,
    decisions: meta.decisions || [],
  };
}

export function boardCards(rec) {
  return rec.board ? parseCards(rec.board) : [];
}
