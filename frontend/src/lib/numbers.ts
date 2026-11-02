// Small exact number helpers used by the interactive widgets.

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export function lcm(a: number, b: number): number {
  return a && b ? Math.abs(a * b) / gcd(a, b) : 0;
}

export function divisors(n: number): number[] {
  n = Math.abs(n);
  const small: number[] = [];
  const large: number[] = [];
  for (let d = 1; d * d <= n; d++) {
    if (n % d === 0) {
      small.push(d);
      if (d !== n / d) large.push(n / d);
    }
  }
  return [...small, ...large.reverse()];
}

export function isPrime(n: number): boolean {
  if (n < 2 || !Number.isInteger(n)) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
}

export function toRoman(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return null;
  const table: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [v, s] of table) while (n >= v) {
    out += s;
    n -= v;
  }
  return out;
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** English words for 0 to 999,999 (British style "and"). */
export function toWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " and " + toWords(n % 100) : "");
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  return toWords(th) + " thousand" + (rest ? (rest < 100 ? " and " : " ") + toWords(rest) : "");
}

// ------------------------------------------------------------------ exact fractions

export type Frac = { n: number; d: number };

export function frac(n: number, d = 1): Frac {
  if (d === 0) throw new Error("zero denominator");
  if (d < 0) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
}

export function parseFrac(s: string): Frac | null {
  const t = s.trim().replace("−", "-");
  let m = /^(-?\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m) return Number(m[2]) === 0 ? null : frac(Number(m[1]), Number(m[2]));
  m = /^(-?)(\d*)\.(\d+)$/.exec(t);
  if (m) {
    const scale = 10 ** m[3].length;
    const whole = Number(m[2] || "0");
    const val = whole * scale + Number(m[3]);
    return frac(m[1] ? -val : val, scale);
  }
  if (/^-?\d+$/.test(t)) return frac(Number(t), 1);
  return null;
}

export const fracEq = (a: Frac, b: Frac) => a.n * b.d === b.n * a.d;
export const fracCmp = (a: Frac, b: Frac) => Math.sign(a.n * b.d - b.n * a.d);
export const fracToNumber = (f: Frac) => f.n / f.d;

export function fracTex(f: Frac): string {
  if (f.d === 1) return String(f.n);
  return `${f.n < 0 ? "-" : ""}\\tfrac{${Math.abs(f.n)}}{${f.d}}`;
}

// ------------------------------------------------------------------ families of numbers

export type Family = "natural" | "whole" | "integers" | "rational";

export const FAMILY_ORDER: Family[] = ["natural", "whole", "integers", "rational"];

export const FAMILY_LABEL: Record<Family, string> = {
  natural: "Natural numbers ℕ",
  whole: "Whole numbers",
  integers: "Integers ℤ",
  rational: "Fractions (rational numbers) ℚ",
};

/** The families a number belongs to (natural numbers start at 1 in this course). */
export function families(f: Frac): Family[] {
  const out: Family[] = [];
  const isInt = f.d === 1;
  if (isInt && f.n >= 1) out.push("natural");
  if (isInt && f.n >= 0) out.push("whole");
  if (isInt) out.push("integers");
  out.push("rational");
  return out;
}

/** The smallest of the shown families containing the number, or null if none does. */
export function smallestFamily(f: Frac, shown: Family[]): Family | null {
  const fams = families(f);
  for (const fam of FAMILY_ORDER) if (shown.includes(fam) && fams.includes(fam)) return fam;
  return null;
}

export function whyNot(f: Frac, fam: Family): string {
  const isInt = f.d === 1;
  switch (fam) {
    case "natural":
      if (!isInt) return "Natural numbers are counting numbers - they have no parts.";
      if (f.n === 0) return "In this course the natural numbers start at 1 (some books include 0).";
      return "Natural numbers are never negative.";
    case "whole":
      return isInt ? "Whole numbers have no minus sign." : "Whole numbers have no parts.";
    case "integers":
      return "Integers are only the evenly spaced points ..., -1, 0, 1, ... - not the numbers in between.";
    default:
      return "";
  }
}
