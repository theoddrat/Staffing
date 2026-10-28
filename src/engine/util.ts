// Small numeric helpers shared by the engine. Nothing here may return NaN/Infinity.

export function isFiniteNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Finite number or fallback. */
export function fin(x: unknown, fallback = 0): number {
  return isFiniteNum(x) ? x : fallback;
}

/** Finite number or null. */
export function finOrNull(x: unknown): number | null {
  return isFiniteNum(x) ? x : null;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** ln(1+R) for a simple return R, guarded so (1+R) never reaches 0. */
export function log1pSafe(r: number): number {
  return Math.log(Math.max(1 + r, 1e-9));
}

/** exp(x)-1, guarded against overflow. */
export function expm1Safe(x: number): number {
  return Math.exp(clamp(x, -50, 50)) - 1;
}

/** 1 - prod(1 - x_k): combine fractional cuts multiplicatively. */
export function combineCuts(xs: number[]): number {
  let keep = 1;
  for (const x of xs) keep *= 1 - x;
  return 1 - keep;
}

/** Linear-interpolated quantile of an ascending-sorted array (q in [0,1]). */
export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const pos = clamp(q, 0, 1) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, n - 1);
  const w = pos - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

export function percentiles(values: Float64Array): { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number } {
  const s = Float64Array.from(values).sort();
  let m = 0;
  for (let i = 0; i < s.length; i++) m += s[i];
  m = s.length ? m / s.length : 0;
  return {
    p5: quantileSorted(s, 0.05),
    p25: quantileSorted(s, 0.25),
    p50: quantileSorted(s, 0.5),
    p75: quantileSorted(s, 0.75),
    p95: quantileSorted(s, 0.95),
    mean: m,
  };
}

/** Format a fraction as a percent string for driver notes. */
export function p(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function uniq(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

/** Count weekdays strictly after `start` up to and including `end` (ISO dates). Approximates trading days. */
export function weekdaysBetween(start: string, end: string): number {
  const a = Date.parse(start + 'T00:00:00Z');
  const b = Date.parse(end + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  let n = 0;
  for (let t = a + 86400000; t <= b; t += 86400000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}
