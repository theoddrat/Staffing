// Cloud sync for the published (Claude artifact) version: mirrors the
// player's data into their private `data/users/<id>/` documents so training
// history survives cleared browser storage and follows them across devices.
// Run locally (no Claude viewer), this is a no-op and localStorage is used.

const LIMIT = 240 * 1024; // stay under the 256 KiB document cap

function fit(obj, shrink) {
  let json = JSON.stringify(obj);
  let guard = 0;
  while (json.length > LIMIT && guard++ < 20) {
    obj = shrink(obj);
    json = JSON.stringify(obj);
  }
  return json.length > LIMIT ? null : obj;
}

function split(store) {
  const s = { ...store.settings, apiKey: '' };
  const core = fit({
    updatedAt: store.updatedAt || Date.now(),
    settings: s,
    hero: { agg: store.hero.agg, importedAgg: store.hero.importedAgg, sessions: store.hero.sessions.slice(-80), lastPlan: store.hero.lastPlan || '' },
    customProfiles: store.customProfiles,
    drills: store.drills,
  }, (o) => ({ ...o, hero: { ...o.hero, sessions: o.hero.sessions.slice(-Math.floor(o.hero.sessions.length / 2)) } }));
  const opp = Object.entries(store.opponents).sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0));
  const opponents = fit({ list: opp.slice(0, 150) }, (o) => ({ list: o.list.slice(0, Math.floor(o.list.length * 0.7)) }));
  const decisions = fit({ list: store.hero.decisions.slice(-1500) }, (o) => ({ list: o.list.slice(-Math.floor(o.list.length * 0.7)) }));
  const handsDoc = (hands) => fit({ list: hands }, (o) => ({ list: o.list.map((h) => ({ ...h, text: undefined })).slice(0, Math.max(1, o.list.length - 3)) }));
  return {
    core,
    opponents,
    decisions,
    hands0: handsDoc(store.hands.slice(0, 20)),
    hands1: handsDoc(store.hands.slice(20, 40)),
  };
}

function merge(store, parts) {
  const { core, opponents, decisions, hands0, hands1 } = parts;
  const apiKey = store.settings.apiKey;
  const rememberKey = store.settings.rememberKey;
  store.settings = { ...store.settings, ...core.settings, apiKey, rememberKey };
  store.hero = {
    ...store.hero,
    agg: core.hero.agg || store.hero.agg,
    importedAgg: core.hero.importedAgg || store.hero.importedAgg,
    sessions: core.hero.sessions || [],
    lastPlan: core.hero.lastPlan || '',
    decisions: decisions?.list || store.hero.decisions,
  };
  store.customProfiles = core.customProfiles || store.customProfiles;
  store.drills = core.drills || store.drills;
  if (opponents?.list) store.opponents = Object.fromEntries(opponents.list);
  const hands = [...(hands0?.list || []), ...(hands1?.list || [])];
  if (hands.length) store.hands = hands;
  store.updatedAt = core.updatedAt;
}

/**
 * @returns {Promise<{status:string, schedule:(store)=>void}|null>}
 *   null when not running inside a Claude viewer with db access.
 */
export async function initCloudSync(store, { onRemoteNewer, onStatus } = {}) {
  if (typeof globalThis.window?.claude?.use !== 'function') return null;
  let db;
  let user;
  try {
    [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
  } catch {
    return null;
  }
  if (!db || !user) return null;
  const uid = await user.id().catch(() => null);
  if (!uid) return null;
  const refs = {};
  for (const k of ['core', 'opponents', 'decisions', 'hands0', 'hands1']) refs[k] = db.doc(`data/users/${uid}/${k}`);
  const lastWritten = {};
  let disabled = false;

  // initial load: newer side wins
  try {
    const snaps = await Promise.all(Object.entries(refs).map(async ([k, r]) => [k, await r.get()]));
    const parts = {};
    for (const [k, snap] of snaps) if (snap.exists) parts[k] = structuredClone(snap.data());
    if (parts.core && (parts.core.updatedAt || 0) > (store.updatedAt || 0)) {
      merge(store, parts);
      for (const [k, v] of Object.entries(parts)) lastWritten[k] = JSON.stringify(v);
      onRemoteNewer?.();
    }
  } catch (e) {
    onStatus?.('local', e?.message);
    return null;
  }

  let timer = null;
  let writing = false;
  let pending = null;
  async function flush() {
    if (disabled || writing || !pending) return;
    writing = true;
    const parts = split(pending);
    pending = null;
    try {
      for (const [k, v] of Object.entries(parts)) {
        if (!v) continue;
        const json = JSON.stringify(v);
        if (lastWritten[k] === json) continue;
        await refs[k].set(JSON.parse(json));
        lastWritten[k] = json;
      }
      onStatus?.('synced');
    } catch (e) {
      if (e?.code === 'invalid_argument' || e?.code === 'not_granted') disabled = true;
      onStatus?.('local', e?.message);
    } finally {
      writing = false;
      if (pending) schedule(pending);
    }
  }
  function schedule(s) {
    pending = s;
    clearTimeout(timer);
    timer = setTimeout(flush, 1500);
  }
  onStatus?.('synced');
  return { schedule };
}
