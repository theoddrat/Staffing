/**
 * Exact rational numbers on BigInt, mirroring the parts of Python's `fractions.Fraction` that the
 * backend uses: construction from integers, decimal strings and "a/b" strings, arithmetic,
 * comparison, and `str()` formatting ("3/4", "-2", "0").
 */
function bgcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

export class Fraction {
  readonly n: bigint;
  readonly d: bigint;

  constructor(n: bigint | number, d: bigint | number = 1n) {
    let nn = typeof n === "number" ? toBig(n) : n;
    let dd = typeof d === "number" ? toBig(d) : d;
    if (dd === 0n) throw new RangeError("Fraction(_, 0)");
    if (dd < 0n) {
      nn = -nn;
      dd = -dd;
    }
    const g = bgcd(nn, dd) || 1n;
    this.n = nn / g;
    this.d = dd / g;
  }

  /**
   * Like `Fraction(str)`: an optional sign, then an integer, a decimal ("0.75", ".5", "3."),
   * an exponent form ("1e3", "2.5E-2"), or "a/b" with integers. Surrounding whitespace is
   * allowed. Returns null (instead of raising) for anything else.
   */
  static parse(raw: string | number | bigint): Fraction | null {
    if (typeof raw === "bigint") return new Fraction(raw);
    if (typeof raw === "number") return Number.isFinite(raw) ? Fraction.parse(String(raw)) : null;
    const s = raw.trim();
    let m = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(s);
    if (m) {
      const den = BigInt(m[2]);
      return den === 0n ? null : new Fraction(BigInt(m[1]), den);
    }
    m = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m || (!m[2] && !m[3])) return null;
    const sign = m[1] === "-" ? -1n : 1n;
    const intPart = m[2] || "0";
    const frac = m[3] || "";
    const exp = m[4] ? parseInt(m[4], 10) : 0;
    let n = BigInt(intPart + frac) * sign;
    let d = 10n ** BigInt(frac.length);
    if (exp > 0) n *= 10n ** BigInt(exp);
    else if (exp < 0) d *= 10n ** BigInt(-exp);
    return new Fraction(n, d);
  }

  static from(x: Fraction | bigint | number | string): Fraction {
    if (x instanceof Fraction) return x;
    const f = Fraction.parse(x as string | number | bigint);
    if (!f) throw new RangeError(`not a number: ${String(x)}`);
    return f;
  }

  add(o: Fraction | number): Fraction {
    const b = Fraction.from(o);
    return new Fraction(this.n * b.d + b.n * this.d, this.d * b.d);
  }
  sub(o: Fraction | number): Fraction {
    const b = Fraction.from(o);
    return new Fraction(this.n * b.d - b.n * this.d, this.d * b.d);
  }
  mul(o: Fraction | number): Fraction {
    const b = Fraction.from(o);
    return new Fraction(this.n * b.n, this.d * b.d);
  }
  div(o: Fraction | number): Fraction {
    const b = Fraction.from(o);
    if (b.n === 0n) throw new RangeError("division by zero");
    return new Fraction(this.n * b.d, this.d * b.n);
  }
  neg(): Fraction {
    return new Fraction(-this.n, this.d);
  }
  abs(): Fraction {
    return this.n < 0n ? this.neg() : this;
  }
  /** -1, 0 or 1. */
  cmp(o: Fraction | number): number {
    const b = Fraction.from(o);
    const l = this.n * b.d;
    const r = b.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  eq(o: Fraction | number): boolean {
    return this.cmp(o) === 0;
  }
  lt(o: Fraction | number): boolean {
    return this.cmp(o) < 0;
  }
  le(o: Fraction | number): boolean {
    return this.cmp(o) <= 0;
  }
  gt(o: Fraction | number): boolean {
    return this.cmp(o) > 0;
  }
  ge(o: Fraction | number): boolean {
    return this.cmp(o) >= 0;
  }
  isInteger(): boolean {
    return this.d === 1n;
  }
  get numerator(): bigint {
    return this.n;
  }
  get denominator(): bigint {
    return this.d;
  }
  toNumber(): number {
    return Number(this.n) / Number(this.d);
  }
  /** Python `str(Fraction)`: "3/4", "-2", "0". */
  toString(): string {
    return this.d === 1n ? this.n.toString() : `${this.n}/${this.d}`;
  }
}

function toBig(x: number): bigint {
  if (!Number.isInteger(x)) throw new RangeError(`Fraction needs integers, got ${x}; use Fraction.parse for decimals`);
  return BigInt(x);
}
