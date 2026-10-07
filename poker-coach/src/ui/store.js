// Persistent player data (this browser only). Everything that matters can be
// exported/imported as JSON from Settings, since browser storage can be
// cleared or unavailable (private windows).

import { emptyAgg, addFlags, mergeAgg } from '../stats/stats.js';

const KEY = 'bracelet-hunt.v1';
const MAX_HANDS = 300;
const MAX_DECISIONS = 4000;

export function defaultStore() {
  return {
    version: 1,
    settings: {
      heroName: 'You',
      coachMode: 'after', // 'live' | 'after' | 'off'
      speed: 'normal', // 'slow' | 'normal' | 'fast'
      showHud: true,
      fourColor: true,
      autoNext: false,
      apiKey: '',
      rememberKey: false,
      scenario: 'main_event',
      tableSize: 9,
      lineup: ['ivey', 'negreanu', 'hellmuth', 'mizrachi', 'seidel', 'dwan', 'chan', 'rec'],
      theme: 'system',
    },
    hero: { agg: emptyAgg(), importedAgg: emptyAgg(), decisions: [], sessions: [] },
    opponents: {}, // name → { agg, profileId, source, lastSeen }
    customProfiles: [], // cloned/imported AI profiles
    hands: [],
    drills: { attempts: 0, correct: 0, byType: {} },
  };
}

let memoryOnly = false;
let saveHook = null;

/** Called after every save (cloud sync uses it). */
export function setSaveHook(fn) {
  saveHook = fn;
}

export function loadStore() {
  const base = defaultStore();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const data = JSON.parse(raw);
    return {
      ...base,
      ...data,
      settings: { ...base.settings, ...(data.settings || {}) },
      hero: { ...base.hero, ...(data.hero || {}) },
      drills: { ...base.drills, ...(data.drills || {}) },
    };
  } catch {
    memoryOnly = true;
    return base;
  }
}

export function saveStore(store) {
  store.updatedAt = Date.now();
  saveHook?.(store);
  const data = { ...store, settings: { ...store.settings } };
  if (!store.settings.rememberKey) data.settings.apiKey = '';
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    memoryOnly = false;
    return true;
  } catch {
    // quota exceeded: drop old hand texts and retry once
    try {
      data.hands = data.hands.slice(0, 80).map((h) => ({ ...h, text: undefined }));
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch {
      memoryOnly = true;
      return false;
    }
  }
}

export const storageAvailable = () => !memoryOnly;

/** Record a finished live hand into the persistent store. */
export function recordHand(store, result, { canonHero }) {
  const rec = result.record;
  store.hands.unshift(rec);
  if (store.hands.length > MAX_HANDS) store.hands.length = MAX_HANDS;
  addFlags(store.hero.agg, result.heroFlags, canonHero);
  rec.players.forEach((p, i) => {
    if (i === rec.heroIdx) return;
    const o = (store.opponents[p.name] ||= { agg: emptyAgg(), profileId: p.profileId, source: 'live', lastSeen: 0 });
    addFlags(o.agg, result.flags[i], p.canon);
    o.profileId = p.profileId || o.profileId;
    o.lastSeen = rec.ts;
  });
  for (const d of result.decisions) {
    store.hero.decisions.push({
      ts: rec.ts, spot: d.spot, grade: d.grade, evLossBB: Math.round((d.evLossBB || 0) * 100) / 100,
      street: d.street, handId: rec.id,
    });
  }
  if (store.hero.decisions.length > MAX_DECISIONS) store.hero.decisions.splice(0, store.hero.decisions.length - MAX_DECISIONS);
}

/** The hero's full aggregate: live play plus any imported hand histories. */
export function heroAggAll(store) {
  return mergeAgg(store.hero.agg, store.hero.importedAgg || emptyAgg());
}

export function exportData(store) {
  const data = { ...store, settings: { ...store.settings, apiKey: '' } };
  return JSON.stringify(data);
}

export function importData(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !data.hero || !data.settings) throw new Error('This does not look like a Bracelet Hunt export.');
  const base = defaultStore();
  return { ...base, ...data, settings: { ...base.settings, ...data.settings }, hero: { ...base.hero, ...data.hero } };
}
