// Small, fast, seedable PRNG (mulberry32). Seeded RNGs make hands and tests
// reproducible; unseeded ones pull entropy from crypto when available.

export function makeRng(seed) {
  let s = (seed === undefined ? randomSeed() : seed) >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (n) => Math.floor(next() * n);
  next.seed = () => s;
  return next;
}

export function randomSeed() {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const a = new Uint32Array(1);
    globalThis.crypto.getRandomValues(a);
    return a[0];
  }
  return Math.floor(Math.random() * 4294967296);
}

/** Pick an index from a list of non-negative weights. */
export function weightedPick(weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return 0;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}
