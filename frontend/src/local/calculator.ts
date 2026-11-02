/**
 * A safe exact calculator the AI tutor can call as a tool - a port of backend/app/ai/calculator.py.
 *
 * The tutor must never invent arithmetic: any computation it reports should come from here. The
 * Python version evaluates a whitelisted Python-expression subset with SymPy; this port has its own
 * tokenizer and recursive-descent parser (nothing is ever passed to eval/Function) and evaluates:
 *
 * - exact rationals on BigInt (`Fraction`), so 1/3 stays 1/3 and 0.1 + 0.2 is 3/10;
 * - exact irrationals in SymPy's style: sums of rational multiples of products of powers of primes,
 *   pi, E and (when nothing simpler exists) positive sums, e.g. `sqrt(8)` -> `2*sqrt(2)`,
 *   `(1+sqrt(5))/2` -> `1/2 + sqrt(5)/2`, printed like SymPy and followed by
 *   `  (approximately 2.82842712474619)` exactly as `sp.N(x, 15)` formats it;
 * - `decimal(x, digits)` as SymPy Floats (binary precision, mpmath formatting), e.g. `3.1416`;
 * - the same functions, constants and safety limits as the Python module.
 *
 * Differences from SymPy are deliberate and small: non-real results (sqrt(-4), (-8)**(1/3)) and
 * "zoo" results (0**-1, factorial(-1)) are errors instead of complex numbers; products of sums are
 * expanded (`(1+sqrt(2))**2` -> `3 + 2*sqrt(2)`) and square roots are rationalised out of
 * denominators; `decimal(x)` defaults to 20 digits (the Python version rejects the default).
 */
import { Fraction } from "./fraction";

export const MAX_INT_DIGITS = 2000;
export const MAX_EXPONENT = 10_000;
export const MAX_EXPRESSION_LENGTH = 500;
/** Python cannot print integers longer than this (its int-to-str limit), so neither do we. */
const MAX_SHOWN_DIGITS = 4300;
/** Expanded sums with more terms than this are refused. */
const MAX_TERMS = 256;

export class CalcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalcError";
  }
}

/** An exact expansion would have too many terms (callers may fall back to an unexpanded power). */
class TooComplex extends CalcError {
  constructor() {
    super("this expression is too complicated to evaluate exactly");
  }
}

/** The tool description the AI sees (identical to TOOL_SPEC["description"] in calculator.py). */
export const CALCULATOR_TOOL_DESCRIPTION =
  "Exact calculator. Use it for EVERY arithmetic or number-theory computation you report to the learner, " +
  "instead of computing in your head. Supports + - * / ** (or ^), // (floor division), % (remainder), " +
  "parentheses, comparisons (< <= > >= == !=), the constants pi and E, and the functions gcd(a,b), lcm(a,b), " +
  "isprime(n), factorint(n) (prime factorization as {prime: exponent}), divisors(n), sqrt(x), abs(x), floor(x), " +
  "ceiling(x), factorial(n), binomial(n,k), mod(a,b), primepi(n) (number of primes <= n), prime(k) (k-th prime), " +
  "nextprime(n), decimal(x, digits). Arithmetic is exact: 1/3 stays 1/3.";

/** TOOL_SPEC["input_schema"] from calculator.py. */
export const CALCULATOR_INPUT_SCHEMA = {
  type: "object",
  properties: {
    expression: { type: "string", description: "The expression to evaluate, e.g. 'gcd(84, 120)' or '3/4 + 1/6'." },
  },
  required: ["expression"],
  additionalProperties: false,
} as const;

/** The whole tool definition, as TOOL_SPEC in calculator.py. */
export const CALCULATOR_TOOL_SPEC = {
  name: "calculate",
  description: CALCULATOR_TOOL_DESCRIPTION,
  input_schema: CALCULATOR_INPUT_SCHEMA,
  strict: true,
} as const;

/** Evaluate an expression exactly and return the result as text (throws CalcError). */
export function calculate(expression: string): { expression: string; result: string } {
  const src = String(expression);
  const expr = src.trim().split("^").join("**").split("−").join("-").split("×").join("*").split("÷").join("/");
  if (Array.from(expr).length > MAX_EXPRESSION_LENGTH) throw new CalcError("expression too long");
  const tree = new Parser(tokenize(expr)).parseTop();
  return { expression: src.trim(), result: show(evaluate(tree)) };
}

/** Execute a tool call, like run_tool in calculator.py. Returns [result text, isError]. */
export function runTool(name: string, input: Record<string, unknown> | null | undefined): [string, boolean] {
  if (name !== "calculate") return [`Unknown tool ${name}`, true];
  try {
    return [calculate(String(input?.expression ?? "")).result, false];
  } catch (e) {
    if (e instanceof CalcError) return [`Error: ${e.message}`, true];
    // defensive: never crash the tutor on odd input
    return [`Error: could not evaluate (${e instanceof Error ? e.name : "Error"})`, true];
  }
}

// =====================================================================================
// BigInt helpers and number theory
// =====================================================================================

const babs = (n: bigint): bigint => (n < 0n ? -n : n);

function bgcd(a: bigint, b: bigint): bigint {
  a = babs(a);
  b = babs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

function ndigits(n: bigint): number {
  return babs(n).toString().length;
}

/** log10 |n| as a float (n != 0), safe for huge n. */
function blog10(n: bigint): number {
  const s = babs(n).toString();
  return s.length - 1 + Math.log10(parseFloat(s[0] + "." + s.slice(1, 16)));
}

function bitLength(n: bigint): number {
  return n === 0n ? 0 : babs(n).toString(2).length;
}

const P10: bigint[] = [1n];
function pow10(k: number): bigint {
  if (k < 0) throw new RangeError("negative power of ten");
  if (k < 4096) {
    while (P10.length <= k) P10.push(P10[P10.length - 1] * 10n);
    return P10[k];
  }
  return 10n ** BigInt(k);
}

/** floor(sqrt(n)) */
function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError("isqrt of a negative number");
  if (n < 2n) return n;
  let x = 1n << BigInt((bitLength(n) + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** floor(n ** (1/k)) for n >= 0 */
function iroot(n: bigint, k: number): bigint {
  if (n < 2n || k === 1) return n;
  const K = BigInt(k);
  let x = 1n << BigInt(Math.ceil(bitLength(n) / k));
  for (;;) {
    const y = ((K - 1n) * x + n / x ** (K - 1n)) / K;
    if (y >= x) return x;
    x = y;
  }
}

function modpow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  b %= m;
  if (b < 0n) b += m;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

function sieve(limit: number): number[] {
  const comp = new Uint8Array(limit + 1);
  const out: number[] = [];
  for (let i = 2; i <= limit; i++) {
    if (comp[i]) continue;
    out.push(i);
    for (let j = i * i; j <= limit; j += i) comp[j] = 1;
  }
  return out;
}

const SMALL_PRIMES = sieve(32768).map((p) => BigInt(p));

function jacobi(a: bigint, n: bigint): number {
  a %= n;
  if (a < 0n) a += n;
  let t = 1;
  while (a !== 0n) {
    while ((a & 1n) === 0n) {
      a >>= 1n;
      const r = n & 7n;
      if (r === 3n || r === 5n) t = -t;
    }
    [a, n] = [n, a];
    if ((a & 3n) === 3n && (n & 3n) === 3n) t = -t;
    a %= n;
  }
  return n === 1n ? t : 0;
}

function millerRabin(n: bigint, a: bigint): boolean {
  let d = n - 1n;
  let s = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s++;
  }
  let x = modpow(a, d, n);
  if (x === 1n || x === n - 1n) return true;
  for (let i = 1; i < s; i++) {
    x = (x * x) % n;
    if (x === n - 1n) return true;
  }
  return false;
}

/** Strong Lucas probable-prime test with Selfridge's parameters (the second half of BPSW). */
function strongLucas(n: bigint): boolean {
  const r = isqrt(n);
  if (r * r === n) return false;
  let D = 5n;
  for (;;) {
    const j = jacobi(D, n);
    if (j === -1) break;
    if (j === 0 && babs(D) !== n) return false;
    D = D > 0n ? -D - 2n : -D + 2n;
  }
  const P = 1n;
  const Q = (1n - D) / 4n;
  const mod = (x: bigint) => ((x % n) + n) % n;
  const half = (x: bigint) => {
    x = mod(x);
    return ((x & 1n) === 1n ? x + n : x) / 2n;
  };
  let d = n + 1n;
  let s = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s++;
  }
  let U = 1n;
  let V = P;
  let Qk = mod(Q);
  const bits = d.toString(2);
  for (let i = 1; i < bits.length; i++) {
    U = mod(U * V);
    V = mod(V * V - 2n * Qk);
    Qk = mod(Qk * Qk);
    if (bits[i] === "1") {
      const U2 = half(P * U + V);
      const V2 = half(D * U + P * V);
      U = U2;
      V = V2;
      Qk = mod(Qk * Q);
    }
  }
  if (U === 0n || V === 0n) return true;
  for (let i = 1; i < s; i++) {
    V = mod(V * V - 2n * Qk);
    if (V === 0n) return true;
    Qk = mod(Qk * Qk);
  }
  return false;
}

/** Primality: trial division, then Baillie-PSW (as SymPy's isprime does for large numbers). */
export function isPrimeBig(n: bigint): boolean {
  if (n < 2n) return false;
  for (let i = 0; i < 168; i++) {
    const p = SMALL_PRIMES[i]; // the primes below 1000
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  if (n < 1_000_000n) return true;
  return millerRabin(n, 2n) && strongLucas(n);
}

function pollardBrent(n: bigint): bigint {
  if ((n & 1n) === 0n) return 2n;
  for (let c = 1n; ; c++) {
    const f = (v: bigint) => (v * v + c) % n;
    let y = 2n;
    let x = 2n;
    let ys = 2n;
    let q = 1n;
    let g = 1n;
    let r = 1;
    const m = 128;
    do {
      x = y;
      for (let i = 0; i < r; i++) y = f(y);
      let k = 0;
      do {
        ys = y;
        const lim = Math.min(m, r - k);
        for (let i = 0; i < lim; i++) {
          y = f(y);
          q = (q * babs(x - y)) % n;
        }
        g = bgcd(q, n);
        k += m;
      } while (k < r && g === 1n);
      r *= 2;
    } while (g === 1n);
    if (g === n) {
      do {
        ys = f(ys);
        g = bgcd(babs(x - ys), n);
      } while (g === 1n);
    }
    if (g !== n) return g;
  }
}

/** Complete factorisation of n >= 1 as a map prime -> exponent. */
function factorFull(n: bigint): Map<bigint, number> {
  const out = new Map<bigint, number>();
  const add = (p: bigint, e = 1) => out.set(p, (out.get(p) ?? 0) + e);
  for (const p of SMALL_PRIMES) {
    if (p * p > n) break;
    while (n % p === 0n) {
      n /= p;
      add(p);
    }
  }
  const stack = n > 1n ? [n] : [];
  while (stack.length) {
    const m = stack.pop()!;
    if (m < 32768n * 32768n || isPrimeBig(m)) add(m);
    else {
      const d = pollardBrent(m);
      stack.push(d, m / d);
    }
  }
  return new Map([...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

/**
 * Factor n >= 1 as far as cheap methods allow (trial division below 2**15, then a perfect-power
 * test of the cofactor), like SymPy does when it simplifies roots. The last base may be composite.
 */
function factorSmall(n: bigint): [bigint, number][] {
  const out: [bigint, number][] = [];
  for (const p of SMALL_PRIMES) {
    if (p * p > n) break;
    let e = 0;
    while (n % p === 0n) {
      n /= p;
      e++;
    }
    if (e) out.push([p, e]);
  }
  if (n > 1n) {
    if (n < 32768n * 32768n || (ndigits(n) <= 40 && isPrimeBig(n))) out.push([n, 1]);
    else {
      let found = false;
      for (let k = Math.min(64, Math.floor(bitLength(n) / 15)); k >= 2 && !found; k--) {
        const r = iroot(n, k);
        if (r ** BigInt(k) === n) {
          out.push([r, k]);
          found = true;
        }
      }
      if (!found) out.push([n, 1]);
    }
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

function primePi(n: number): number {
  if (n < 2) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  const small = new Float64Array(r + 2);
  const large = new Float64Array(r + 2);
  for (let v = 1; v <= r; v++) small[v] = v - 1;
  for (let i = 1; i <= r; i++) large[i] = Math.floor(n / i) - 1;
  for (let p = 2; p <= r; p++) {
    if (small[p] === small[p - 1]) continue;
    const sp = small[p - 1];
    const p2 = p * p;
    const lim = Math.min(r, Math.floor(n / p2));
    for (let i = 1; i <= lim; i++) {
      const d = i * p;
      large[i] -= (d <= r ? large[d] : small[Math.floor(n / d)]) - sp;
    }
    for (let v = r; v >= p2; v--) small[v] -= small[Math.floor(v / p)] - sp;
  }
  return large[1];
}

function nthPrime(k: number): number {
  const bound = k < 6 ? 15 : Math.ceil(k * (Math.log(k) + Math.log(Math.log(k))));
  const comp = new Uint8Array(bound + 1);
  let count = 0;
  for (let i = 2; i <= bound; i++) {
    if (comp[i]) continue;
    if (++count === k) return i;
    for (let j = i * i; j <= bound; j += i) comp[j] = 1;
  }
  throw new RangeError("prime bound too small");
}

function nextPrime(n: bigint): bigint {
  if (n < 2n) return 2n;
  let c = n + 1n;
  if (c > 2n && (c & 1n) === 0n) c++;
  while (!isPrimeBig(c)) c += 2n;
  return c;
}

function binomialInt(n: bigint, k: bigint): bigint {
  if (k < 0n) return 0n;
  if (n < 0n) {
    const v = binomialInt(-n + k - 1n, k);
    return k % 2n === 0n ? v : -v;
  }
  if (k > n) return 0n;
  const kk = k < n - k ? k : n - k;
  // estimate the size first: Python cannot print more than MAX_SHOWN_DIGITS digits
  let lg = 0;
  const N = Number(n);
  const K = Number(kk);
  for (let i = 1; i <= K; i++) {
    lg += Math.log10((N - K + i) / i);
    if (lg > MAX_SHOWN_DIGITS + 1) throw new CalcError("result is too large to display");
  }
  let c = 1n;
  for (let i = 1n; i <= kk; i++) c = (c * (n - kk + i)) / i;
  if (ndigits(c) > MAX_SHOWN_DIGITS) throw new CalcError("result is too large to display");
  return c;
}

// =====================================================================================
// Arbitrary-precision decimal floating point (value = m * 10^e)
// =====================================================================================

type BF = { m: bigint; e: number };

const BF0: BF = { m: 0n, e: 0 };
const BF1: BF = { m: 1n, e: 0 };

/** Round half away from zero: a / b for b > 0. */
function divRound(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a - q * b;
  if (2n * babs(r) >= b) return a < 0n ? q - 1n : q + 1n;
  return q;
}

function bfNorm(x: BF, p: number): BF {
  const d = ndigits(x.m);
  if (d <= p) return x;
  const s = d - p;
  return { m: divRound(x.m, pow10(s)), e: x.e + s };
}

function bfFromFrac(f: Fraction, p: number): BF {
  if (f.n === 0n) return BF0;
  const s = p + 1 + ndigits(f.d) - ndigits(f.n);
  const m = s >= 0 ? divRound(f.n * pow10(s), f.d) : divRound(f.n, f.d * pow10(-s));
  return bfNorm({ m, e: -s }, p);
}

function bfToFrac(x: BF): Fraction {
  return x.e >= 0 ? new Fraction(x.m * pow10(x.e)) : new Fraction(x.m, pow10(-x.e));
}

function bfAdd(a: BF, b: BF, p: number): BF {
  if (a.m === 0n) return bfNorm(b, p);
  if (b.m === 0n) return bfNorm(a, p);
  const ta = a.e + ndigits(a.m);
  const tb = b.e + ndigits(b.m);
  if (ta - tb > p + 2) return bfNorm(a, p);
  if (tb - ta > p + 2) return bfNorm(b, p);
  a = bfNorm(a, p + 4);
  b = bfNorm(b, p + 4);
  const e = Math.min(a.e, b.e);
  return bfNorm({ m: a.m * pow10(a.e - e) + b.m * pow10(b.e - e), e }, p);
}

function bfMul(a: BF, b: BF, p: number): BF {
  return bfNorm({ m: a.m * b.m, e: a.e + b.e }, p);
}

function bfDiv(a: BF, b: BF, p: number): BF {
  if (b.m === 0n) throw new CalcError("division by zero");
  const s = p + 2 + ndigits(b.m) - ndigits(a.m);
  const m = s >= 0 ? (a.m * pow10(s)) / b.m : a.m / (b.m * pow10(-s));
  return bfNorm({ m, e: a.e - b.e - s }, p);
}

function bfSqrt(a: BF, p: number): BF {
  if (a.m < 0n) throw new CalcError("the result is not a real number");
  if (a.m === 0n) return BF0;
  let s = 2 * p + 4 - ndigits(a.m);
  if ((a.e - s) % 2 !== 0) s += 1;
  const N = s >= 0 ? a.m * pow10(s) : a.m / pow10(-s);
  return bfNorm({ m: isqrt(N), e: (a.e - s) / 2 }, p);
}

function bfPowInt(a: BF, k: number, p: number): BF {
  if (k < 0) return bfDiv(BF1, bfPowInt(a, -k, p + 5), p);
  const q = p + 5 + Math.ceil(Math.log2(k + 1));
  let r = BF1;
  let b = bfNorm(a, q);
  while (k > 0) {
    if (k & 1) r = bfMul(r, b, q);
    k = Math.floor(k / 2);
    if (k) b = bfMul(b, b, q);
  }
  return bfNorm(r, p);
}

/** log10 |x| as a float (x != 0). */
function bfLog10(x: BF): number {
  const s = babs(x.m).toString();
  return x.e + s.length - 1 + Math.log10(parseFloat(s[0] + "." + s.slice(1, 17)));
}

function bfToNumber(x: BF): number {
  return parseFloat(`${x.m}e${x.e}`);
}

/** round(x * 10^W) */
function toFixedPoint(x: BF, W: number): bigint {
  return x.e + W >= 0 ? x.m * pow10(x.e + W) : divRound(x.m, pow10(-(x.e + W)));
}

let piCache: { W: number; v: bigint } = { W: 0, v: 3n };
function piFixed(W: number): bigint {
  if (piCache.W < W) {
    const Wg = W + 10;
    const one = pow10(Wg);
    const atanInv = (x: bigint) => {
      let term = one / x;
      let sum = term;
      const x2 = x * x;
      for (let n = 1n, sign = -1n; term !== 0n; n++, sign = -sign) {
        term /= x2;
        sum += (sign * term) / (2n * n + 1n);
      }
      return sum;
    };
    piCache = { W: Wg, v: 4n * (4n * atanInv(5n) - atanInv(239n)) };
  }
  return piCache.v / pow10(piCache.W - W);
}

function bfPi(p: number): BF {
  return bfNorm({ m: piFixed(p + 3), e: -(p + 3) }, p);
}

/** ln(Y / 10^W) * 10^W for Y / 10^W in [1, 10]. */
function lnFixed(Y: bigint, W: number): bigint {
  const g = 15;
  const k = 14;
  const Wg = W + g;
  const one = pow10(Wg);
  let Z = Y * pow10(g);
  for (let i = 0; i < k; i++) Z = isqrt(Z * one);
  const U = ((Z - one) * one) / (Z + one);
  const U2 = (U * U) / one;
  let sum = 0n;
  let term = U;
  for (let n = 1n; term !== 0n; n += 2n) {
    sum += term / n;
    term = (term * U2) / one;
  }
  return ((2n * sum) << BigInt(k)) / pow10(g);
}

let ln10Cache: { W: number; v: bigint } = { W: 0, v: 2n };
function ln10Fixed(W: number): bigint {
  if (ln10Cache.W < W) {
    const Wg = W + 10;
    ln10Cache = { W: Wg, v: lnFixed(10n * pow10(Wg), Wg) };
  }
  return ln10Cache.v / pow10(ln10Cache.W - W);
}

function bfLn(x: BF, p: number): BF {
  if (x.m <= 0n) throw new CalcError("the result is not a real number");
  const t = ndigits(x.m);
  const shift = x.e + t - 1;
  const W = p + 20 + String(Math.abs(shift)).length;
  let L = lnFixed(toFixedPoint({ m: x.m, e: 1 - t }, W), W);
  if (shift) L += BigInt(shift) * ln10Fixed(W);
  return bfNorm({ m: L, e: -W }, p);
}

function bfExp(x: BF, p: number): BF {
  if (x.m === 0n) return BF1;
  const xv = bfToNumber(x);
  if (!(Math.abs(xv) < 1e9)) throw new CalcError("result is too large to display");
  const j = Math.round(xv / Math.LN10);
  const jd = String(Math.abs(j)).length + 2;
  const k = Math.min(60, Math.max(8, Math.floor(Math.sqrt(p) * 1.5)));
  const W = p + 20 + Math.ceil(k * 0.31);
  let X = toFixedPoint(x, W + jd) - BigInt(j) * ln10Fixed(W + jd);
  X /= pow10(jd);
  const one = pow10(W);
  const t = X / (1n << BigInt(k));
  let sum = one;
  let term = one;
  for (let n = 1n; ; n++) {
    term = (term * t) / one / n;
    if (term === 0n) break;
    sum += term;
  }
  for (let i = 0; i < k; i++) sum = (sum * sum) / one;
  return bfNorm({ m: sum, e: j - W }, p);
}

// =====================================================================================
// Exact numbers: linear combinations of monomials (SymPy-like canonical forms)
// =====================================================================================

/** A base of a power: a positive integer (a prime, or a cofactor we could not split), pi, E, or a positive sum. */
type Base = { k: "int"; n: bigint } | { k: "pi" } | { k: "E" } | { k: "sum"; s: Lin };
/** base ** x, with x a non-zero exact number. Integer bases with rational x keep 0 < x < 1. */
type Factor = { b: Base; x: Lin; bkey: string };
/** c * (product of factors), factors sorted by base key. */
type Term = { c: Fraction; f: Factor[]; key: string };
/** A sum of terms with distinct monomials, sorted by key. The empty sum is zero. */
type Lin = { t: Term[]; key: string };

const FR0 = new Fraction(0);
const FR1 = new Fraction(1);
const HALF = new Fraction(1, 2);

function baseKey(b: Base): string {
  return b.k === "int" ? `#${b.n}` : b.k === "pi" ? "pi" : b.k === "E" ? "e" : `(${b.s.key})`;
}

function mkFactor(b: Base, x: Lin): Factor {
  return { b, x, bkey: baseKey(b) };
}

function mkTerm(c: Fraction, fs: Factor[]): Term {
  const f = fs.slice().sort((a, b) => (a.bkey < b.bkey ? -1 : a.bkey > b.bkey ? 1 : 0));
  return { c, f, key: f.map((x) => `${x.bkey}^[${x.x.key}]`).join("*") };
}

function mkLin(terms: Term[]): Lin {
  const t = terms.filter((x) => x.c.n !== 0n).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { t, key: t.length ? t.map((x) => (x.key ? `${x.c}·${x.key}` : `${x.c}`)).join(" + ") : "0" };
}

function linQ(q: Fraction | number | bigint): Lin {
  const f = q instanceof Fraction ? q : new Fraction(q);
  return mkLin([mkTerm(f, [])]);
}

const ZERO = mkLin([]);
const ONE = linQ(1);
const PI = mkLin([mkTerm(FR1, [mkFactor({ k: "pi" }, ONE)])]);
const EE = mkLin([mkTerm(FR1, [mkFactor({ k: "E" }, ONE)])]);

const isRat = (L: Lin): boolean => L.t.length === 0 || (L.t.length === 1 && L.t[0].f.length === 0);
const ratOf = (L: Lin): Fraction => (L.t.length ? L.t[0].c : FR0);
const isZero = (L: Lin): boolean => L.t.length === 0;

function floorFrac(r: Fraction): bigint {
  const q = r.n / r.d;
  return r.n < 0n && q * r.d !== r.n ? q - 1n : q;
}

function sizeCheck(f: Fraction): void {
  if (ndigits(f.n) > MAX_SHOWN_DIGITS || ndigits(f.d) > MAX_SHOWN_DIGITS) throw new CalcError("result is too large to display");
}

function intPow(n: bigint, k: bigint): Fraction {
  if (babs(k) > 10n ** 6n || Number(babs(k)) * blog10(n) > MAX_SHOWN_DIGITS + 10) {
    throw new CalcError("result is too large to display");
  }
  return k >= 0n ? new Fraction(n ** k) : new Fraction(1n, n ** -k);
}

function linAdd(A: Lin, B: Lin): Lin {
  if (isZero(A)) return B;
  if (isZero(B)) return A;
  const m = new Map<string, Term>();
  for (const t of A.t) m.set(t.key, t);
  for (const t of B.t) {
    const u = m.get(t.key);
    m.set(t.key, u ? { ...u, c: u.c.add(t.c) } : t);
  }
  return mkLin([...m.values()]);
}

function linScale(L: Lin, q: Fraction): Lin {
  if (q.n === 0n) return ZERO;
  return mkLin(L.t.map((t) => ({ ...t, c: t.c.mul(q) })));
}

const linNeg = (L: Lin): Lin => linScale(L, new Fraction(-1));
const linSub = (A: Lin, B: Lin): Lin => linAdd(A, linNeg(B));

/** Build c * product(base ** x), merging equal bases and normalising exponents. */
function buildTerm(c: Fraction, parts: { b: Base; x: Lin }[]): Lin {
  const merged = new Map<string, { b: Base; x: Lin }>();
  for (const p of parts) {
    const k = baseKey(p.b);
    const u = merged.get(k);
    merged.set(k, u ? { b: p.b, x: linAdd(u.x, p.x) } : p);
  }
  let coef = c;
  const fs: Factor[] = [];
  let extra: Lin | null = null;
  for (const { b, x } of merged.values()) {
    if (isZero(x)) continue;
    if (isRat(x)) {
      const r = ratOf(x);
      if (b.k === "int") {
        const k = floorFrac(r);
        if (k !== 0n) coef = coef.mul(intPow(b.n, k));
        const f = r.sub(new Fraction(k));
        if (f.n !== 0n) fs.push(mkFactor(b, linQ(f)));
        continue;
      }
      if (b.k === "sum" && r.ge(1)) {
        const k = floorFrac(r);
        const pw = tryExpand(b.s, Number(k));
        if (pw) {
          extra = extra ? linMul(extra, pw) : pw;
          const f = r.sub(new Fraction(k));
          if (f.n !== 0n) fs.push(mkFactor(b, linQ(f)));
          continue;
        }
      }
    }
    fs.push(mkFactor(b, x));
  }
  if (coef.n === 0n) return ZERO;
  sizeCheck(coef);
  const term = mkLin([mkTerm(coef, fs)]);
  return extra ? linMul(extra, term) : term;
}

function termMul(a: Term, b: Term): Lin {
  if (!a.f.length && !b.f.length) return mkLin([mkTerm(a.c.mul(b.c), [])]);
  return buildTerm(
    a.c.mul(b.c),
    [...a.f, ...b.f].map((f) => ({ b: f.b, x: f.x })),
  );
}

const hasSumBase = (L: Lin): boolean => L.t.some((t) => t.f.some((f) => f.b.k === "sum"));

/** If A (a sum) is a rational multiple of a sum used as a base in B, write it as that power. */
function matchSumBase(A: Lin, B: Lin): Lin {
  if (A.t.length < 2 || !hasSumBase(B)) return A;
  const c = content(A);
  if (!c) return A;
  const key = `(${c.P.key})`;
  if (!B.t.some((t) => t.f.some((f) => f.bkey === key))) return A;
  return mkLin([mkTerm(c.g, [mkFactor({ k: "sum", s: c.P }, ONE)])]);
}

function linMul(A: Lin, B: Lin): Lin {
  if (isZero(A) || isZero(B)) return ZERO;
  if (isRat(A)) return linScale(B, ratOf(A));
  if (isRat(B)) return linScale(A, ratOf(B));
  A = matchSumBase(A, B);
  B = matchSumBase(B, A);
  const acc = new Map<string, Term>();
  for (const a of A.t) {
    for (const b of B.t) {
      for (const t of termMul(a, b).t) {
        const u = acc.get(t.key);
        acc.set(t.key, u ? { ...u, c: u.c.add(t.c) } : t);
      }
      if (acc.size > MAX_TERMS) throw new TooComplex();
    }
  }
  return mkLin([...acc.values()]);
}

/** S ** k for k >= 1, expanded (TooComplex when that needs too many terms or huge coefficients). */
function linPowExpand(S: Lin, k: number): Lin {
  const small = (L: Lin) => {
    for (const t of L.t) if (ndigits(t.c.n) > MAX_INT_DIGITS || ndigits(t.c.d) > MAX_INT_DIGITS) throw new TooComplex();
    return L;
  };
  let r = ONE;
  let b = S;
  while (k > 0) {
    if (k & 1) r = small(linMul(r, b));
    k = Math.floor(k / 2);
    if (k) b = small(linMul(b, b));
  }
  return r;
}

/** S ** k expanded, or null when that has too many terms (SymPy keeps such powers unexpanded too). */
function tryExpand(S: Lin, k: number): Lin | null {
  try {
    return linPowExpand(S, k);
  } catch (e) {
    if (e instanceof TooComplex) return null;
    throw e;
  }
}

function checkTerms(L: Lin): Lin {
  for (const t of L.t) sizeCheck(t.c);
  return L;
}

/** (g, P) with L = g * P, P a positive sum with coprime integer coefficients; null if L is (numerically) zero. */
function content(L: Lin): { g: Fraction; P: Lin } | null {
  let num = 0n;
  let den = 1n;
  for (const t of L.t) {
    num = bgcd(num, t.c.n);
    den = (den / bgcd(den, t.c.d)) * t.c.d;
  }
  let g = new Fraction(num, den);
  let P = linScale(L, FR1.div(g));
  const s = signOf(P);
  if (s === 0) return null;
  if (s < 0) {
    g = g.neg();
    P = linNeg(P);
  }
  return { g, P };
}

const notReal = () => new CalcError("the result is not a real number");

/** A sum of rational multiples of square roots involving at most two primes (worth rationalising). */
function isQuadraticSurd(L: Lin): boolean {
  const primes = new Set<string>();
  for (const t of L.t) {
    for (const f of t.f) {
      if (f.b.k !== "int" || !isRat(f.x) || !ratOf(f.x).eq(HALF)) return false;
      primes.add(f.bkey);
    }
  }
  return primes.size <= 2;
}

function linInv(L: Lin): Lin {
  if (isZero(L)) throw new CalcError("division by zero");
  if (L.t.length === 1) {
    const t = L.t[0];
    return buildTerm(
      FR1.div(t.c),
      t.f.map((f) => ({ b: f.b, x: linNeg(f.x) })),
    );
  }
  if (isQuadraticSurd(L)) {
    // rationalise the denominator: multiply by conjugates until no square roots are left
    let num = ONE;
    let den = L;
    for (let i = 0; i < 16 && !isRat(den); i++) {
      const key = den.t.find((t) => t.f.length)!.f[0].bkey;
      const conj = mkLin(den.t.map((t) => (t.f.some((f) => f.bkey === key) ? { ...t, c: t.c.neg() } : t)));
      num = linMul(num, conj);
      den = linMul(den, conj);
    }
    if (isRat(den) && !isZero(den)) return checkTerms(linScale(num, FR1.div(ratOf(den))));
  }
  const c = content(L);
  if (!c) throw new CalcError("division by zero");
  return mkLin([mkTerm(FR1.div(c.g), [mkFactor({ k: "sum", s: c.P }, linQ(-1))])]);
}

/** Prime-power parts of a positive rational q raised to x. */
function ratPowParts(q: Fraction, x: Lin): { b: Base; x: Lin }[] {
  const out: { b: Base; x: Lin }[] = [];
  for (const [p, e] of factorSmall(q.n)) out.push({ b: { k: "int", n: p }, x: linScale(x, new Fraction(e)) });
  for (const [p, e] of factorSmall(q.d)) out.push({ b: { k: "int", n: p }, x: linScale(x, new Fraction(-e)) });
  return out;
}

/** A ** x for a non-integer exponent x (A must be positive). */
function powPositive(A: Lin, x: Lin): Lin {
  if (A.t.length === 1) {
    const t = A.t[0];
    if (t.c.lt(0)) throw notReal();
    return buildTerm(FR1, [...ratPowParts(t.c, x), ...t.f.map((f) => ({ b: f.b, x: linMul(f.x, x) }))]);
  }
  const c = content(A);
  if (!c) {
    if (signOf(x) > 0) return ZERO;
    throw new CalcError("division by zero");
  }
  if (c.g.lt(0)) throw notReal();
  return buildTerm(FR1, [...ratPowParts(c.g, x), { b: { k: "sum", s: c.P }, x }]);
}

function linPowInt(A: Lin, k: number): Lin {
  if (k === 0) return ONE;
  if (isZero(A)) {
    if (k > 0) return ZERO;
    throw new CalcError("division by zero");
  }
  if (A.t.length === 1) {
    const t = A.t[0];
    const K = BigInt(k);
    const lg = Math.abs(k) * Math.max(blog10(t.c.n), blog10(t.c.d));
    if (lg > MAX_SHOWN_DIGITS + 10) throw new CalcError("result is too large to display");
    const c = K >= 0n ? new Fraction(t.c.n ** K, t.c.d ** K) : new Fraction(t.c.d ** -K, t.c.n ** -K);
    if (!t.f.length) return checkTerms(linQ(c));
    return buildTerm(
      c,
      t.f.map((f) => ({ b: f.b, x: linScale(f.x, new Fraction(k)) })),
    );
  }
  const base = k > 0 ? A : linInv(A);
  if (base.t.length === 1) return linPowInt(base, Math.abs(k));
  const pw = tryExpand(base, Math.abs(k));
  if (pw) return pw;
  const c = content(base);
  if (!c) throw new CalcError("division by zero");
  const K = BigInt(Math.abs(k));
  return checkTerms(mkLin([mkTerm(new Fraction(c.g.n ** K, c.g.d ** K), [mkFactor({ k: "sum", s: c.P }, linQ(Math.abs(k)))])]));
}

function linPow(A: Lin, B: Lin): Lin {
  if (isRat(B)) {
    const r = ratOf(B);
    if (r.isInteger()) {
      if (babs(r.n) > BigInt(MAX_EXPONENT)) throw new CalcError("exponent too large");
      return linPowInt(A, Number(r.n));
    }
    if (r.abs().gt(MAX_EXPONENT)) throw new CalcError("exponent too large");
    if (isZero(A)) {
      if (r.gt(0)) return ZERO;
      throw new CalcError("division by zero");
    }
    return powPositive(A, B);
  }
  if (isZero(A)) {
    if (signOf(B) > 0) return ZERO;
    throw new CalcError("division by zero");
  }
  if (isRat(A) && ratOf(A).eq(1)) return ONE;
  const bx = approx(B, 5);
  if (bx.m !== 0n && bfLog10(bx) > Math.log10(MAX_EXPONENT)) throw new CalcError("exponent too large");
  if (signOf(A) < 0) throw notReal();
  return powPositive(A, B);
}

// ------------------------------------------------------------------ numeric evaluation

/**
 * Whether zero tests on L are exact: only rational powers of primes, pi and E, and integer powers of
 * such sums. Roots of sums (which may denest) and irrational exponents are tested numerically.
 */
function isSafe(L: Lin): boolean {
  return L.t.every((t) => t.f.every((f) => isRat(f.x) && (f.b.k !== "sum" || (ratOf(f.x).isInteger() && isSafe(f.b.s)))));
}

function evalFactor(f: Factor, p: number): BF {
  const q = p + 5;
  const { b, x } = f;
  const r = isRat(x) ? ratOf(x) : null;
  if (r && b.k !== "E") {
    if (r.eq(HALF)) return bfSqrt(baseValue(b, q + 2), q);
    if (r.isInteger() && babs(r.n) <= 100000n) return bfPowInt(baseValue(b, q + 5), Number(r.n), q);
  }
  // exp(x * ln(base)), with x * ln(base) accurate to about q digits after the point
  const lnb = b.k === "E" ? null : bfLn(baseValue(b, q + 25), 25);
  const xv = r ? r.toNumber() : bfToNumber(approx(x, 20));
  const ylog = Math.log10(Math.abs(xv * (lnb ? bfToNumber(lnb) : 1)) || 1);
  const py = q + 5 + Math.max(0, Math.ceil(ylog));
  const xb = r ? bfFromFrac(r, py) : approx(x, py);
  const y = lnb ? bfMul(xb, bfLn(baseValue(b, py + 5), py), py) : xb;
  return bfExp(y, q);
}

function baseValue(b: Base, p: number): BF {
  if (b.k === "int") return { m: b.n, e: 0 };
  if (b.k === "pi") return bfPi(p);
  if (b.k === "E") return bfExp(BF1, p);
  return approx(b.s, p);
}

function evalTerm(t: Term, p: number): BF {
  const q = p + 5;
  let v = bfFromFrac(t.c, q);
  for (const f of t.f) v = bfMul(v, evalFactor(f, q), q);
  return bfNorm(v, p);
}

/** The value of L and log10 of its largest term (for error estimates). */
function evalLin(L: Lin, p: number): { v: BF; mag: number } {
  let v = BF0;
  let mag = -Infinity;
  for (const t of L.t) {
    const tv = evalTerm(t, p + 3);
    if (tv.m !== 0n) mag = Math.max(mag, bfLog10(tv));
    v = bfAdd(v, tv, p + 3);
  }
  return { v, mag };
}

/** L to about `digits` significant digits (zero if L is zero within the precision limit). */
function approx(L: Lin, digits: number): BF {
  if (isRat(L)) return bfFromFrac(ratOf(L), digits + 5);
  const cap = isSafe(L) ? 4600 + digits : 200 + digits;
  let p = digits + 10;
  for (;;) {
    const { v, mag } = evalLin(L, p);
    const err = mag - p + 3 + Math.log10(L.t.length);
    if (v.m !== 0n) {
      const good = bfLog10(v) - err;
      if (good >= digits + 3) return bfNorm(v, digits + 3);
      if (p >= cap) {
        if (isSafe(L)) throw new CalcError("could not evaluate this expression precisely enough");
        return BF0;
      }
      p = Math.min(cap, p + Math.ceil(digits + 3 - good) + 10);
    } else {
      if (p >= cap) {
        if (isSafe(L)) throw new CalcError("could not evaluate this expression precisely enough");
        return BF0;
      }
      p = Math.min(cap, 2 * p + 20);
    }
  }
}

/** -1, 0 or 1. Exact for "safe" numbers; others count as zero when they vanish to ~200 digits. */
function signOf(L: Lin): number {
  if (isZero(L)) return 0;
  if (isRat(L)) return ratOf(L).cmp(0);
  const safe = isSafe(L);
  const cap = safe ? 4600 : 200;
  for (let p = 30; ; p = Math.min(cap, 2 * p + 20)) {
    const { v, mag } = evalLin(L, p);
    const err = mag - p + 3 + Math.log10(L.t.length);
    if (v.m !== 0n && bfLog10(v) > err + 1) return v.m > 0n ? 1 : -1;
    if (p >= cap) {
      if (!safe) return 0;
      throw new CalcError("could not decide the sign of this expression precisely enough");
    }
  }
}

function linFloor(L: Lin): bigint {
  if (isRat(L)) return floorFrac(ratOf(L));
  const rough = approx(L, 20);
  const lg = rough.m === 0n ? 0 : bfLog10(rough);
  const v = approx(L, Math.max(20, Math.ceil(lg) + 15));
  let n = floorFrac(bfToFrac(v));
  for (let i = 0; i < 8; i++) {
    if (signOf(linSub(L, linQ(n))) < 0) n -= 1n;
    else if (signOf(linSub(L, linQ(n + 1n))) >= 0) n += 1n;
    else return n;
  }
  return n;
}

// ------------------------------------------------------------------ printing (SymPy's str)

function termValue(t: Term): number {
  return bfToNumber(evalTerm(t, 20));
}

function expStr(x: Lin): string {
  const s = linStr(x);
  return s === "pi" || s === "E" ? s : `(${s})`;
}

/** sqrt(base), base**(e) etc. for a positive exponent e. */
function powStr(base: string, isAtom: boolean, e: Lin): string {
  if (isRat(e) && ratOf(e).eq(HALF)) return `sqrt(${base})`;
  const b = isAtom ? base : `(${base})`;
  if (isRat(e)) {
    const r = ratOf(e);
    return r.isInteger() ? (r.eq(1) ? b : `${b}**${r}`) : `${b}**(${r})`;
  }
  return `${b}**${expStr(e)}`;
}

/** Whether an exponent counts as negative for SymPy's printer (a negative leading coefficient). */
function negExp(x: Lin): boolean {
  return x.t.length === 1 && x.t[0].c.lt(0);
}

type Group = { s: string; den: boolean; order: string; alone?: string };

function groupsOf(fs: Factor[]): Group[] {
  const out: Group[] = [];
  const ints = new Map<string, { n: bigint; x: Lin }>();
  for (const f of fs) {
    if (f.b.k === "int") {
      const u = ints.get(f.x.key);
      ints.set(f.x.key, u ? { n: u.n * f.b.n, x: f.x } : { n: f.b.n, x: f.x });
    }
  }
  for (const { n, x } of ints.values()) {
    const N = n.toString();
    const neg = negExp(x);
    out.push({
      s: powStr(N, true, neg ? linNeg(x) : x),
      den: neg,
      order: `0:${N}:${x.key}`,
      alone: neg ? `${N}**(${linStr(x)})` : undefined,
    });
  }
  for (const f of fs) {
    if (f.b.k === "int") continue;
    if (f.b.k === "E") {
      const one = isRat(f.x) && ratOf(f.x).eq(1);
      out.push({ s: one ? "E" : `exp(${linStr(f.x)})`, den: false, order: one ? "1:E" : `4:${f.x.key}` });
      continue;
    }
    const isPi = f.b.k === "pi";
    const bs = isPi ? "pi" : linStr((f.b as { s: Lin }).s);
    const neg = negExp(f.x);
    const pos = neg ? linNeg(f.x) : f.x;
    let alone: string | undefined;
    if (neg) {
      const r = isRat(f.x) ? ratOf(f.x) : null;
      const b = isPi ? bs : `(${bs})`;
      if (r && r.eq(-1)) alone = `1/${b}`;
      else if (r && r.eq(HALF.neg())) alone = `1/sqrt(${bs})`;
      else alone = `${b}**(${linStr(f.x)})`;
    }
    out.push({ s: powStr(bs, isPi, pos), den: neg, order: isPi ? "2:pi" : `3:${f.bkey}`, alone });
  }
  return out.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
}

function termStr(t: Term): string {
  if (!t.f.length) return t.c.toString();
  const groups = groupsOf(t.f);
  const neg = t.c.lt(0);
  const c = t.c.abs();
  if (groups.length === 1 && !neg && c.eq(1) && groups[0].den) return groups[0].alone!;
  const numer: string[] = [];
  const denom: string[] = [];
  if (c.n !== 1n) numer.push(c.n.toString());
  if (c.d !== 1n) denom.push(c.d.toString());
  for (const g of groups) (g.den ? denom : numer).push(g.s);
  const n = numer.length ? numer.join("*") : "1";
  const d = denom.length === 0 ? "" : denom.length === 1 ? `/${denom[0]}` : `/(${denom.join("*")})`;
  return (neg ? "-" : "") + n + d;
}

function linStr(L: Lin): string {
  if (!L.t.length) return "0";
  if (L.t.length === 1) return termStr(L.t[0]);
  let terms = L.t.slice();
  // SymPy keeps "positive number - multiple of one thing" in that order (1 - sqrt(2)); otherwise
  // it orders the terms of a numeric sum by value.
  const atomLike = (t: Term) =>
    (!t.f.length && t.c.gt(0)) || (t.c.eq(1) && t.f.length === 1 && t.f[0].b.k !== "int" && t.f[0].b.k !== "sum" && isRat(t.f[0].x) && ratOf(t.f[0].x).eq(1));
  const negMul = (t: Term) => t.f.length > 0 && t.c.lt(0) && groupsOf(t.f).length === 1;
  if (terms.length === 2 && atomLike(terms[0]) !== atomLike(terms[1])) {
    const [a, b] = atomLike(terms[0]) ? terms : [terms[1], terms[0]];
    if (negMul(b) && !(b.f.length === 0)) terms = [a, b];
    else terms.sort((x, y) => termValue(x) - termValue(y));
  } else terms.sort((x, y) => termValue(x) - termValue(y));
  let out = "";
  terms.forEach((t, i) => {
    let s = termStr(t);
    const neg = s.startsWith("-");
    if (neg) s = s.slice(1);
    out += i === 0 ? (neg ? "-" : "") + s : (neg ? " - " : " + ") + s;
  });
  return out;
}

// ------------------------------------------------------------------ SymPy Floats (mpmath formatting)

function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;
}

const dpsToPrec = (n: number): number => Math.max(1, pyRound((n + 1) * 3.3219280948873626));
const precToDps = (n: number): number => Math.max(1, pyRound(n / 3.3219280948873626) - 1);

function roundHalfEven(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = 2n * (n - q * d);
  return r2 > d || (r2 === d && (q & 1n) === 1n) ? q + 1n : q;
}

/** Round a rational to `prec` significant bits, ties to even (mpmath's round_nearest). */
function roundBits(v: Fraction, prec: number): Fraction {
  if (v.n === 0n) return v;
  const n = babs(v.n);
  const d = v.d;
  // find E with 2^(prec-1) <= n / (d * 2^E) < 2^prec
  let E = bitLength(n) - bitLength(d) - prec;
  const scaled = (e: number): [bigint, bigint] => (e >= 0 ? [n, d << BigInt(e)] : [n << BigInt(-e), d]);
  const lo = 1n << BigInt(prec - 1);
  for (;;) {
    const [a, b] = scaled(E);
    if (a < lo * b) E--;
    else if (a >= 2n * lo * b) E++;
    else break;
  }
  const [a, b] = scaled(E);
  let M = roundHalfEven(a, b);
  if (M === 2n * lo) {
    M = lo;
    E++;
  }
  const r = E >= 0 ? new Fraction(M << BigInt(E)) : new Fraction(M, 1n << BigInt(-E));
  return v.n < 0n ? r.neg() : r;
}

function floorLog10(v: Fraction): number {
  // v > 0
  let e = ndigits(v.n) - ndigits(v.d);
  const ge = (k: number) => (k >= 0 ? v.n >= v.d * pow10(k) : v.n * pow10(-k) >= v.d);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  return e;
}

/** mpmath.libmp.to_str for an exact binary value. */
function mpToStr(v: Fraction, dps: number, stripZeros: boolean): string {
  if (v.n === 0n) return dps ? "0.0" : ".0";
  const sign = v.n < 0n ? "-" : "";
  const a = v.abs();
  let exponent = floorLog10(a);
  const k = dps + 2 - exponent;
  const D = k >= 0 ? (a.n * pow10(k)) / a.d : a.n / (a.d * pow10(-k));
  let digits = D.toString();
  if (digits.length > dps && "56789".includes(digits[dps])) {
    digits = digits.slice(0, dps);
    let i = dps - 1;
    while (i >= 0 && digits[i] === "9") i--;
    if (i >= 0) digits = digits.slice(0, i) + String(Number(digits[i]) + 1) + "0".repeat(dps - i - 1);
    else {
      digits = "1" + "0".repeat(dps - 1);
      exponent += 1;
    }
  } else digits = digits.slice(0, dps);
  const minFixed = Math.min(-Math.floor(dps / 3), -5);
  const maxFixed = dps;
  let split = 1;
  if (minFixed < exponent && exponent < maxFixed) {
    if (exponent < 0) digits = "0".repeat(-exponent) + digits;
    else {
      split = exponent + 1;
      if (split > dps) digits += "0".repeat(split - dps);
    }
    exponent = 0;
  }
  digits = digits.slice(0, split) + "." + digits.slice(split);
  if (stripZeros) {
    digits = digits.replace(/0+$/, "");
    if (digits.endsWith(".")) digits += "0";
  }
  if (exponent === 0 && dps) return sign + digits;
  return sign + digits + (exponent >= 0 ? "e+" : "e") + exponent;
}

/** str(Float) in SymPy. */
function floatStr(v: Fraction, prec: number): string {
  if (v.n === 0n) return "0";
  const dps = prec < 5 ? 0 : precToDps(prec);
  let rv = mpToStr(v, dps, false);
  if (rv.startsWith("-.0")) rv = "-0." + rv.slice(3);
  else if (rv.startsWith(".0")) rv = "0." + rv.slice(2);
  return rv.replace(/^\+/, "");
}

/** format(decimal.Decimal(s), "") */
function decimalFormat(s: string): string {
  const m = /^(-?)(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i.exec(s);
  if (!m) return s;
  const sign = m[1];
  const all = (m[2] + m[3]).replace(/^0+/, "") || "0";
  const exp = (m[4] ? parseInt(m[4], 10) : 0) - m[3].length;
  const left = exp + all.length;
  const dot = exp <= 0 && left > -6 ? left : 1;
  let intPart: string;
  let frac: string;
  if (dot < 0) {
    intPart = "0";
    frac = "0".repeat(-dot) + all;
  } else if (dot > all.length) {
    intPart = all + "0".repeat(dot - all.length);
    frac = "";
  } else {
    intPart = all.slice(0, dot) || "0";
    frac = all.slice(dot);
  }
  const e = left - dot;
  return sign + intPart + (frac ? "." + frac : "") + (e !== 0 ? `E${e > 0 ? "+" : "-"}${Math.abs(e)}` : "");
}

/** The exact value of L, or a close rational approximation good to about `digits` digits. */
function valueFrac(L: Lin, digits: number): Fraction {
  return isRat(L) ? ratOf(L) : bfToFrac(approx(L, digits));
}

/** sp.N(L, n) as an exact binary value and its precision (in bits). */
function nFloat(L: Lin, n: number): { v: Fraction; prec: number } {
  const prec = dpsToPrec(n);
  const v = valueFrac(L, n + 25);
  return { v: roundBits(roundBits(v, prec + 4), prec), prec };
}

function approxText(L: Lin): string {
  const { v, prec } = nFloat(L, 15);
  if (v.n === 0n) return "0";
  return decimalFormat(mpToStr(v, precToDps(prec), false));
}

// =====================================================================================
// Values and evaluation
// =====================================================================================

type Val =
  | { t: "num"; v: Lin }
  | { t: "float"; v: Fraction; prec: number }
  | { t: "bool"; v: boolean }
  | { t: "list"; v: bigint[] }
  | { t: "dict"; v: [bigint, bigint][] };

const num = (v: Lin): Val => ({ t: "num", v });

function checkSize(L: Lin): Lin {
  if (isRat(L)) {
    const q = ratOf(L);
    if (q.d === 1n && ndigits(q.n) > MAX_INT_DIGITS) throw new CalcError("result is too large to display");
  }
  return checkTerms(L);
}

function show(v: Val): string {
  switch (v.t) {
    case "bool":
      return v.v ? "True" : "False";
    case "list":
      return `[${v.v.join(", ")}]`;
    case "dict":
      return `{${v.v.map(([k, e]) => `${k}: ${e}`).join(", ")}}`;
    case "float":
      return floatStr(v.v, v.prec);
    case "num": {
      const s = linStr(v.v);
      return isRat(v.v) ? s : `${s}  (approximately ${approxText(v.v)})`;
    }
  }
}

function plainNum(v: Val, what: string): Lin {
  if (v.t === "num") return v.v;
  if (v.t === "bool") return linQ(v.v ? 1 : 0);
  throw new CalcError(`${what} needs a number`);
}

function asFrac(v: Val, bits: number): Fraction {
  if (v.t === "float") return v.v;
  return valueFrac(plainNum(v, "this operation"), Math.ceil(bits * 0.302) + 20);
}

function floatOp(op: string, a: Val, b: Val): Val {
  const prec = Math.max(a.t === "float" ? a.prec : 0, b.t === "float" ? b.prec : 0);
  const conv = (v: Val) => (v.t === "float" ? v.v : roundBits(asFrac(v, prec + 20), prec));
  const x = conv(a);
  const y = conv(b);
  const fl = (r: Fraction): Val => {
    const v = roundBits(r, prec);
    return v.n === 0n ? num(ZERO) : { t: "float", v, prec };
  };
  switch (op) {
    case "+":
      return fl(x.add(y));
    case "-":
      return fl(x.sub(y));
    case "*":
      return fl(x.mul(y));
    case "/":
      if (y.n === 0n) throw new CalcError("division by zero");
      return fl(x.div(y));
    case "//":
      if (y.n === 0n) throw new CalcError("division by zero");
      return num(linQ(floorFrac(x.div(y))));
    case "%":
      if (y.n === 0n) throw new CalcError("division by zero");
      return fl(x.sub(y.mul(new Fraction(floorFrac(x.div(y))))));
    case "**": {
      if (x.n === 0n) {
        if (y.gt(0)) return num(ZERO);
        if (y.n === 0n) return num(ONE);
        throw new CalcError("division by zero");
      }
      if (y.abs().gt(MAX_EXPONENT)) throw new CalcError("exponent too large");
      if (x.lt(0) && !y.isInteger()) throw notReal();
      const digits = Math.ceil(prec * 0.302) + 15;
      let r: BF;
      if (y.isInteger()) r = bfPowInt(bfFromFrac(x.abs(), digits + 10), Number(y.n), digits);
      else r = bfExp(bfMul(bfFromFrac(y, digits + 10), bfLn(bfFromFrac(x, digits + 10), digits + 10), digits + 10), digits);
      const rv = bfToFrac(r);
      return fl(x.lt(0) && y.n % 2n !== 0n ? rv.neg() : rv);
    }
  }
  throw new CalcError("operator not allowed");
}

function binop(op: string, a: Val, b: Val): Val {
  if (!["+", "-", "*", "/", "//", "%", "**"].includes(op)) throw new CalcError("operator not allowed");
  for (const v of [a, b]) {
    if (v.t === "list" || v.t === "dict") throw new CalcError("divisors() and factorint() results cannot be used in arithmetic");
  }
  if (a.t === "float" || b.t === "float") return floatOp(op, a, b);
  const x = plainNum(a, "arithmetic");
  const y = plainNum(b, "arithmetic");
  switch (op) {
    case "+":
      return num(checkSize(linAdd(x, y)));
    case "-":
      return num(checkSize(linSub(x, y)));
    case "*":
      return num(checkSize(linMul(x, y)));
    case "/":
      if (isZero(y)) throw new CalcError("division by zero");
      return num(checkSize(linMul(x, linInv(y))));
    case "//":
      if (isZero(y)) throw new CalcError("division by zero");
      return num(checkSize(linQ(linFloor(linMul(x, linInv(y))))));
    case "%":
      if (isZero(y)) throw new CalcError("division by zero");
      return num(checkSize(modLin(x, y)));
    default:
      return num(checkSize(linPow(x, y)));
  }
}

function modLin(x: Lin, y: Lin): Lin {
  return linSub(x, linMul(y, linQ(linFloor(linMul(x, linInv(y))))));
}

function compare(op: string, a: Val, b: Val): boolean {
  for (const v of [a, b]) {
    if (v.t === "list" || v.t === "dict") throw new CalcError("divisors() and factorint() results cannot be compared");
  }
  const lin = (v: Val) => (v.t === "float" ? linQ(v.v) : plainNum(v, "a comparison"));
  const s = signOf(linSub(lin(a), lin(b)));
  switch (op) {
    case "<":
      return s < 0;
    case "<=":
      return s <= 0;
    case ">":
      return s > 0;
    case ">=":
      return s >= 0;
    case "==":
      return s === 0;
    default:
      return s !== 0;
  }
}

function intArg(v: Val, name: string, limit: bigint): bigint {
  if (v.t !== "num" || !isRat(v.v) || ratOf(v.v).d !== 1n) throw new CalcError(`${name} needs a whole number`);
  const n = ratOf(v.v).n;
  if (babs(n) > limit) throw new CalcError(`${name} argument is too large (limit ${limit})`);
  return n;
}

function ratArg(v: Val, name: string): Fraction {
  if (v.t !== "num" || !isRat(v.v)) throw new CalcError(`${name} needs rational numbers`);
  return ratOf(v.v);
}

const ARITY: Record<string, [number, number]> = {
  gcd: [2, 2],
  lcm: [2, 2],
  isprime: [1, 1],
  factorint: [1, 1],
  divisors: [1, 1],
  sqrt: [1, 1],
  abs: [1, 1],
  floor: [1, 1],
  ceiling: [1, 1],
  factorial: [1, 1],
  binomial: [2, 2],
  mod: [2, 2],
  primepi: [1, 1],
  prime: [1, 1],
  nextprime: [1, 1],
  decimal: [1, 2],
};

function callFn(name: string, args: Val[]): Val {
  const [lo, hi] = ARITY[name];
  if (args.length < lo || args.length > hi) {
    const want = lo === hi ? `${lo} argument${lo > 1 ? "s" : ""}` : `${lo} or ${hi} arguments`;
    throw new CalcError(`${name}() takes ${want} (${args.length} given)`);
  }
  const [a, b] = args;
  switch (name) {
    case "gcd": {
      const x = ratArg(a, name);
      const y = ratArg(b, name);
      const d = (x.d / bgcd(x.d, y.d)) * y.d;
      return num(linQ(new Fraction(bgcd(x.n, y.n), d)));
    }
    case "lcm": {
      const x = ratArg(a, name);
      const y = ratArg(b, name);
      if (x.n === 0n || y.n === 0n) return num(ZERO);
      const nn = babs((x.n / bgcd(x.n, y.n)) * y.n);
      return num(checkSize(linQ(new Fraction(nn, bgcd(x.d, y.d)))));
    }
    case "isprime":
      return { t: "bool", v: isPrimeBig(intArg(a, name, 10n ** 30n)) };
    case "factorint": {
      const n = intArg(a, name, 10n ** 18n);
      if (n === 0n) return { t: "dict", v: [[0n, 1n]] };
      const out: [bigint, bigint][] = [...factorFull(babs(n)).entries()].map(([p, e]) => [p, BigInt(e)]);
      if (n < 0n) out.push([-1n, 1n]);
      return { t: "dict", v: out };
    }
    case "divisors": {
      const n = babs(intArg(a, name, 10n ** 12n));
      if (n === 0n) return { t: "list", v: [] };
      let ds = [1n];
      for (const [p, e] of factorFull(n)) {
        const next: bigint[] = [];
        for (const d of ds) for (let i = 0, pp = 1n; i <= e; i++, pp *= p) next.push(d * pp);
        ds = next;
      }
      return { t: "list", v: ds.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)) };
    }
    case "sqrt":
      return binop("**", a.t === "bool" ? notANumber(name) : a, num(linQ(HALF)));
    case "abs": {
      if (a.t === "float") return { t: "float", v: a.v.abs(), prec: a.prec };
      const x = fnNum(a, name);
      return num(signOf(x) < 0 ? linNeg(x) : x);
    }
    case "floor":
      if (a.t === "float") return num(linQ(floorFrac(a.v)));
      return num(linQ(linFloor(fnNum(a, name))));
    case "ceiling":
      if (a.t === "float") return num(linQ(-floorFrac(a.v.neg())));
      return num(linQ(-linFloor(linNeg(fnNum(a, name)))));
    case "factorial": {
      const n = intArg(a, name, 1000n);
      if (n < 0n) throw new CalcError("factorial needs a whole number that is not negative");
      let f = 1n;
      for (let i = 2n; i <= n; i++) f *= i;
      return num(linQ(f));
    }
    case "binomial":
      return num(linQ(binomialInt(intArg(a, name, 10n ** 6n), intArg(b, name, 10n ** 6n))));
    case "mod":
      return binop("%", a, b);
    case "primepi": {
      const n = intArg(a, name, 10n ** 8n);
      return num(linQ(primePi(Number(n))));
    }
    case "prime": {
      const n = intArg(a, name, 10n ** 6n);
      if (n < 1n) throw new CalcError("prime needs a positive whole number (prime(1) is 2)");
      return num(linQ(nthPrime(Number(n))));
    }
    case "nextprime":
      return num(linQ(nextPrime(intArg(a, name, 10n ** 30n))));
    case "decimal": {
      const digits = b === undefined ? 20 : Number(intArg(b, name, 200n));
      if (digits < 1) throw new CalcError("decimal needs at least 1 digit");
      return decimalOf(a, digits);
    }
  }
  throw new CalcError(`unknown function '${name}'`);
}

function notANumber(name: string): never {
  throw new CalcError(`${name} needs a number`);
}

function fnNum(v: Val, name: string): Lin {
  if (v.t !== "num") notANumber(name);
  return v.v;
}

/** sp.N(x, digits) */
function decimalOf(a: Val, digits: number): Val {
  if (a.t === "float") {
    const prec = dpsToPrec(digits);
    return { t: "float", v: roundBits(roundBits(a.v, prec + 4), prec), prec };
  }
  const L = fnNum(a, "decimal");
  if (isZero(L)) return num(ZERO);
  if (digits === 1 && isRat(L)) {
    // SymPy rounds numbers to one digit in two steps and keeps two digits for whole results
    const v2 = roundBits(roundBits(ratOf(L), 14), 10);
    const a2 = v2.abs();
    const m = floorLog10(a2) + 1;
    const scale = (e: number) => (e >= 0 ? new Fraction(pow10(e)) : new Fraction(1n, pow10(-e)));
    const y = a2.mul(scale(2 - m));
    const xi = roundHalfEven(y.n, y.d);
    const xr = roundHalfEven(xi, 10n) * 10n;
    let rv = new Fraction(xr).mul(scale(m - 2));
    if (v2.lt(0)) rv = rv.neg();
    if (rv.isInteger()) return { t: "float", v: roundBits(rv, 10), prec: 10 };
    return { t: "float", v: roundBits(rv, 7), prec: 7 };
  }
  const f = nFloat(L, digits);
  return f.v.n === 0n ? num(ZERO) : { t: "float", v: f.v, prec: f.prec };
}

// =====================================================================================
// Tokenizer and parser (a strict subset of Python's expression grammar)
// =====================================================================================

type Tok = { t: "num"; v: Fraction | null; big?: boolean } | { t: "name"; v: string } | { t: "op"; v: string } | { t: "str" } | { t: "end" };

type Node =
  | { k: "num"; v: Fraction }
  | { k: "bool"; v: boolean }
  | { k: "bad"; msg: string }
  | { k: "name"; id: string }
  | { k: "un"; op: string; x: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "cmp"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

const UNSUPPORTED = "this kind of expression is not supported";
const bad = (msg = UNSUPPORTED): Node => ({ k: "bad", msg });
const syntax = (msg = "invalid syntax") => new CalcError(`could not read the expression: ${msg}`);

const KEYWORDS = new Set(
  "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(
    " ",
  ),
);

const DIGITPART = "\\d(?:_?\\d)*";
const NUMBER_RE = new RegExp(`^(?:(${DIGITPART})?(\\.(?:${DIGITPART})?)?)([eE][+-]?${DIGITPART})?([jJ])?`);

function readNumber(s: string, i: number): [Tok, number] {
  const rest = s.slice(i);
  const radix = /^0([xXoObB])/.exec(rest);
  if (radix) {
    const kind = radix[1].toLowerCase();
    const cls = kind === "x" ? "[0-9a-fA-F]" : kind === "o" ? "[0-7]" : "[01]";
    const m = new RegExp(`^0[xXoObB]((?:_?${cls})+)`).exec(rest);
    const name = kind === "x" ? "hexadecimal" : kind === "o" ? "octal" : "binary";
    if (!m || /^[\p{L}\p{N}_]/u.test(rest.slice(m[0].length))) throw syntax(`invalid ${name} literal`);
    return [{ t: "num", v: new Fraction(BigInt(`0${kind}${m[1].replace(/_/g, "")}`)) }, i + m[0].length];
  }
  const m = NUMBER_RE.exec(rest)!;
  const lit = m[0];
  if (/^[\p{L}\p{N}_]/u.test(rest.slice(lit.length))) throw syntax("invalid decimal literal");
  const clean = lit.replace(/_/g, "");
  if (m[4]) return [{ t: "num", v: null }, i + lit.length];
  if (!m[2] && !m[3]) {
    if (/^0+[1-9]/.test(clean)) throw syntax("leading zeros in decimal integer literals are not permitted; use an 0o prefix for octal integers");
    return [{ t: "num", v: new Fraction(BigInt(clean)) }, i + lit.length];
  }
  // floats in the input are interpreted exactly as written decimals (via Python's repr of the float)
  const x = Number(clean);
  if (!Number.isFinite(x)) return [{ t: "num", v: null, big: true }, i + lit.length];
  return [{ t: "num", v: Fraction.from(String(x)) }, i + lit.length];
}

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  const stack: string[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\f" || c === "\r" || c === "\v") {
      i++;
      continue;
    }
    if (c === "\n") {
      if (!stack.length) throw syntax();
      i++;
      continue;
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(s[i + 1] ?? ""))) {
      const [tok, j] = readNumber(s, i);
      out.push(tok);
      i = j;
      continue;
    }
    const name = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(s.slice(i));
    if (name) {
      out.push({ t: "name", v: name[0] });
      i += name[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== c && s[j] !== "\n") j += s[j] === "\\" ? 2 : 1;
      if (j >= s.length || s[j] !== c) throw syntax("unterminated string literal (detected at line 1)");
      out.push({ t: "str" });
      i = j + 1;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (["**", "//", "<=", ">=", "==", "!=", "<<", ">>"].includes(two)) {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("([{".includes(c)) stack.push(c);
    if (")]}".includes(c)) {
      const open = stack.pop();
      if (!open) throw syntax(`unmatched '${c}'`);
      const want = { "(": ")", "[": "]", "{": "}" }[open];
      if (want !== c) throw syntax(`closing parenthesis '${c}' does not match opening parenthesis '${open}'`);
    }
    if ("+-*/%<>()[]{},.&|~@=:;!".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c.charCodeAt(0) < 128) throw syntax();
    const cp = s.codePointAt(i)!;
    throw syntax(`invalid character '${String.fromCodePoint(cp)}' (U+${cp.toString(16).toUpperCase().padStart(4, "0")})`);
  }
  if (stack.length) throw syntax(`'${stack[stack.length - 1]}' was never closed`);
  out.push({ t: "end" });
  return out;
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.i];
  }
  private isOp(v: string): boolean {
    const t = this.toks[this.i];
    return t.t === "op" && t.v === v;
  }
  private isName(v: string): boolean {
    const t = this.toks[this.i];
    return t.t === "name" && t.v === v;
  }
  private expectOp(v: string): void {
    if (!this.isOp(v)) throw syntax();
    this.i++;
  }

  parseTop(): Node {
    if (this.peek().t === "end") throw syntax();
    const n = this.exprList();
    if (this.peek().t !== "end") throw syntax();
    return n;
  }

  /** expr (, expr)* - a tuple is not supported */
  private exprList(): Node {
    const first = this.test();
    if (!this.isOp(",")) return first;
    while (this.isOp(",")) {
      this.i++;
      if (this.peek().t === "end" || this.isOp(")")) break;
      this.test();
    }
    return bad();
  }

  private test(): Node {
    if (this.isName("lambda")) {
      this.i++;
      while (!this.isOp(":")) {
        const t = this.peek();
        if (t.t === "end") throw syntax();
        this.i++;
      }
      this.i++;
      this.test();
      return bad();
    }
    const n = this.orTest();
    if (this.isName("if")) {
      this.i++;
      this.orTest();
      if (!this.isName("else")) throw syntax();
      this.i++;
      this.test();
      return bad();
    }
    return n;
  }

  private orTest(): Node {
    let n = this.andTest();
    while (this.isName("or")) {
      this.i++;
      this.andTest();
      n = bad();
    }
    return n;
  }

  private andTest(): Node {
    let n = this.notTest();
    while (this.isName("and")) {
      this.i++;
      this.notTest();
      n = bad();
    }
    return n;
  }

  private notTest(): Node {
    if (this.isName("not")) {
      this.i++;
      this.notTest();
      return bad();
    }
    return this.comparison();
  }

  private comparison(): Node {
    const first = this.bitOr();
    const ops: string[] = [];
    const xs: Node[] = [first];
    for (;;) {
      const t = this.peek();
      if (t.t === "op" && ["<", ">", "<=", ">=", "==", "!="].includes(t.v)) {
        this.i++;
        ops.push(t.v);
      } else if (this.isName("in")) {
        this.i++;
        ops.push("in");
      } else if (this.isName("not") && this.toks[this.i + 1].t === "name" && (this.toks[this.i + 1] as { v: string }).v === "in") {
        this.i += 2;
        ops.push("in");
      } else if (this.isName("is")) {
        this.i++;
        if (this.isName("not")) this.i++;
        ops.push("is");
      } else break;
      xs.push(this.bitOr());
    }
    if (!ops.length) return first;
    if (ops.length > 1 || ops[0] === "in" || ops[0] === "is") return bad();
    return { k: "cmp", op: ops[0], a: xs[0], b: xs[1] };
  }

  private binLevel(ops: string[], next: () => Node): Node {
    let n = next();
    for (;;) {
      const t = this.peek();
      if (t.t !== "op" || !ops.includes(t.v)) return n;
      this.i++;
      n = { k: "bin", op: t.v, a: n, b: next() };
    }
  }

  private bitOr(): Node {
    return this.binLevel(["|"], () => this.bitAnd());
  }
  private bitAnd(): Node {
    return this.binLevel(["&"], () => this.shift());
  }
  private shift(): Node {
    return this.binLevel(["<<", ">>"], () => this.arith());
  }
  private arith(): Node {
    return this.binLevel(["+", "-"], () => this.term());
  }
  private term(): Node {
    return this.binLevel(["*", "/", "//", "%", "@"], () => this.factor());
  }

  private factor(): Node {
    const t = this.peek();
    if (t.t === "op" && (t.v === "-" || t.v === "+" || t.v === "~")) {
      this.i++;
      const x = this.factor();
      return t.v === "~" ? bad() : { k: "un", op: t.v, x };
    }
    return this.power();
  }

  private power(): Node {
    const base = this.postfix();
    if (this.isOp("**")) {
      this.i++;
      return { k: "bin", op: "**", a: base, b: this.factor() };
    }
    return base;
  }

  /** Skip to just after the bracket that closes the one already consumed (the tokenizer checked they balance). */
  private skipBracket(): void {
    let depth = 1;
    while (depth) {
      const t = this.peek();
      if (t.t === "end") throw syntax();
      if (t.t === "op" && "([{".includes(t.v)) depth++;
      if (t.t === "op" && ")]}".includes(t.v)) depth--;
      this.i++;
    }
  }

  private postfix(): Node {
    let n = this.atom();
    for (;;) {
      if (this.isOp("(")) {
        this.i++;
        const args: Node[] = [];
        let ok = true;
        while (!this.isOp(")")) {
          if (this.isOp("*") || this.isOp("**")) {
            this.i++;
            this.test();
            ok = false;
          } else if (this.peek().t === "name" && this.toks[this.i + 1].t === "op" && (this.toks[this.i + 1] as { v: string }).v === "=") {
            this.i += 2;
            this.test();
            ok = false;
          } else args.push(this.test());
          if (this.isName("for")) {
            this.skipBracket();
            this.i--;
            ok = false;
            break;
          }
          if (!this.isOp(",")) break;
          this.i++;
        }
        this.expectOp(")");
        if (!ok) n = bad();
        else if (n.k === "name" && Object.prototype.hasOwnProperty.call(ARITY, n.id)) n = { k: "call", fn: n.id, args };
        else if (n.k === "name" && !["pi", "E"].includes(n.id)) n = bad(`unknown function '${n.id}'`);
        else n = bad();
      } else if (this.isOp("[")) {
        this.i++;
        this.skipBracket();
        n = bad();
      } else if (this.isOp(".")) {
        this.i++;
        if (this.peek().t !== "name") throw syntax();
        this.i++;
        n = bad();
      } else return n;
    }
  }

  private atom(): Node {
    const t = this.peek();
    this.i++;
    if (t.t === "num") {
      if (t.v) return { k: "num", v: t.v };
      return bad(t.big ? "number is too large" : "only numbers are allowed");
    }
    if (t.t === "str") {
      while (this.peek().t === "str") this.i++;
      return bad("only numbers are allowed");
    }
    if (t.t === "name") {
      if (t.v === "True" || t.v === "False") return { k: "bool", v: t.v === "True" };
      if (t.v === "None") return bad("only numbers are allowed");
      if (KEYWORDS.has(t.v)) throw syntax();
      return { k: "name", id: t.v };
    }
    if (t.t === "op") {
      if (t.v === "(") {
        if (this.isOp(")")) {
          this.i++;
          return bad();
        }
        const n = this.test();
        if (this.isOp(",") || this.isName("for")) {
          this.skipBracket();
          return bad();
        }
        this.expectOp(")");
        return n;
      }
      if (t.v === "[" || t.v === "{") {
        this.skipBracket();
        return bad();
      }
    }
    throw syntax();
  }
}

function evaluate(n: Node): Val {
  switch (n.k) {
    case "num":
      return num(checkSize(linQ(n.v)));
    case "bool":
      return { t: "bool", v: n.v };
    case "bad":
      throw new CalcError(n.msg);
    case "name":
      if (n.id === "pi") return num(PI);
      if (n.id === "E") return num(EE);
      throw new CalcError(`unknown name '${n.id}'`);
    case "un": {
      const v = evaluate(n.x);
      if (n.op === "+") return v;
      if (v.t === "float") return { t: "float", v: v.v.neg(), prec: v.prec };
      if (v.t === "list" || v.t === "dict") throw new CalcError("divisors() and factorint() results cannot be used in arithmetic");
      return num(linNeg(plainNum(v, "arithmetic")));
    }
    case "bin": {
      const a = evaluate(n.a);
      const b = evaluate(n.b);
      return binop(n.op, a, b);
    }
    case "cmp": {
      const a = evaluate(n.a);
      const b = evaluate(n.b);
      return { t: "bool", v: compare(n.op, a, b) };
    }
    case "call":
      return callFn(n.fn, n.args.map(evaluate));
  }
}
export const __dbg = { linFloor, approx, signOf, linPow, linAdd, linQ, linSub, evalLin, ONE, isSafe, bfLog10, bfToFrac, floorFrac, linStr };
