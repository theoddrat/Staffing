/**
 * A small seedable random number generator with the subset of Python's `random.Random` API that the
 * backend's practice generators and grading use. Same method names and semantics (inclusive
 * `randint`, in-place `shuffle`, `sample` without replacement), so ported code reads like the original.
 * Sequences differ from CPython's Mersenne Twister; nothing depends on exact values.
 */
export class Random {
  private s: number;

  constructor(seed?: number | string) {
    if (seed === undefined) seed = Math.floor(Math.random() * 2 ** 32);
    if (typeof seed === "string") {
      // FNV-1a hash of the string
      let h = 2166136261;
      for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      seed = h >>> 0;
    }
    this.s = seed >>> 0;
  }

  /** Float in [0, 1) (mulberry32). */
  random(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer N with a <= N <= b (both inclusive, like Python). */
  randint(a: number, b: number): number {
    if (b < a) throw new RangeError(`randint(${a}, ${b}): empty range`);
    return a + Math.floor(this.random() * (b - a + 1));
  }

  /** A random element of a non-empty array. */
  choice<T>(xs: readonly T[]): T {
    if (!xs.length) throw new RangeError("choice from an empty sequence");
    return xs[Math.floor(this.random() * xs.length)];
  }

  /** Shuffle in place (Fisher-Yates), like Python's `random.shuffle`. */
  shuffle<T>(xs: T[]): void {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
  }

  /** k distinct elements chosen without replacement, in selection order, like `random.sample`. */
  sample<T>(xs: readonly T[], k: number): T[] {
    if (k < 0 || k > xs.length) throw new RangeError("sample larger than population");
    const pool = xs.slice();
    const out: T[] = [];
    for (let i = 0; i < k; i++) {
      const j = Math.floor(this.random() * pool.length);
      out.push(pool[j]);
      pool.splice(j, 1);
    }
    return out;
  }
}

/** `range(a, b)` / `range(n)` as an array, for porting Python loops. */
export function range(a: number, b?: number, step = 1): number[] {
  const [lo, hi] = b === undefined ? [0, a] : [a, b];
  const out: number[] = [];
  if (step > 0) for (let i = lo; i < hi; i += step) out.push(i);
  else for (let i = lo; i > hi; i += step) out.push(i);
  return out;
}
