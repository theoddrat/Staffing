// Independent Chip Model (Malmuth–Harville): converts tournament chip stacks
// into expected prize equity. Memoized over subsets of remaining players.

/**
 * @param {number[]} stacks chip stacks (0 = busted, excluded)
 * @param {number[]} payouts prize for 1st, 2nd, ... (remaining places pay 0)
 * @returns {number[]} expected prize per player
 */
export function icmEquity(stacks, payouts) {
  const n = stacks.length;
  const alive = [];
  for (let i = 0; i < n; i++) if (stacks[i] > 0) alive.push(i);
  const m = alive.length;
  const out = new Array(n).fill(0);
  if (m === 0) return out;
  if (m > 14) return chipProportional(stacks, payouts);
  const memo = new Map();
  const full = (1 << m) - 1;

  // f(mask) = equity vector (indexed by alive slot) for remaining players in mask,
  // who are competing for places starting at `place` = m - popcount(mask).
  function f(mask) {
    if (memo.has(mask)) return memo.get(mask);
    const res = new Float64Array(m);
    const place = m - popcount(mask);
    if (place >= payouts.length || mask === 0) { memo.set(mask, res); return res; }
    let total = 0;
    for (let k = 0; k < m; k++) if (mask & (1 << k)) total += stacks[alive[k]];
    for (let k = 0; k < m; k++) {
      if (!(mask & (1 << k))) continue;
      const p = stacks[alive[k]] / total;
      res[k] += p * payouts[place];
      const sub = f(mask & ~(1 << k));
      for (let j = 0; j < m; j++) res[j] += p * sub[j];
    }
    memo.set(mask, res);
    return res;
  }
  const eq = f(full);
  for (let k = 0; k < m; k++) out[alive[k]] = eq[k];
  return out;
}

function popcount(x) {
  let c = 0;
  while (x) { x &= x - 1; c++; }
  return c;
}

function chipProportional(stacks, payouts) {
  const total = stacks.reduce((a, b) => a + b, 0);
  const pool = payouts.reduce((a, b) => a + b, 0);
  return stacks.map((s) => (s / total) * pool);
}
