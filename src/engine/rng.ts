// Seeded PRNG: xoshiro128** seeded through splitmix32. Deterministic across browser and node.

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    const sm = splitmix32(seed);
    this.a = sm();
    this.b = sm();
    this.c = sm();
    this.d = sm();
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
  }

  /** Next 32-bit unsigned integer. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.b, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.b << 9) >>> 0;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = rotl(this.d, 11);
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    return result;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    if (n <= 1) return 0;
    return Math.floor(this.next() * n);
  }

  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Triangular(lo, mode, hi) by inverse CDF. Degenerate ranges return the mode. */
  triangular(lo: number, mode: number, hi: number): number {
    if (!(hi > lo)) return mode;
    const m = Math.min(Math.max(mode, lo), hi);
    const u = this.next();
    const f = (m - lo) / (hi - lo);
    if (u < f) return lo + Math.sqrt(u * (hi - lo) * (m - lo));
    return hi - Math.sqrt((1 - u) * (hi - lo) * (hi - m));
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
