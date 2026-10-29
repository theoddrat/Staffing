// Plain-language number formatting for the guided UI. True minus signs, lakh/crore for rupees,
// $B for dollars, and short words instead of symbols where it helps a first-time reader.
import { isNum } from '../../lib/format';

const MINUS = '−';

/** 0.165 → "+16.5%", −0.04 → "−4.0%". */
export function pct(x: number | null | undefined, digits = 1): string {
  if (!isNum(x)) return '—';
  const v = Math.abs(x * 100).toFixed(digits);
  if (Number(v) === 0) return `0${digits ? '.' + '0'.repeat(digits) : ''}%`;
  return `${x < 0 ? MINUS : '+'}${v}%`;
}

/** Magnitude without sign: 0.165 → "16.5%". */
export function pctAbs(x: number | null | undefined, digits = 0): string {
  return isNum(x) ? `${Math.abs(x * 100).toFixed(digits)}%` : '—';
}

/** Rupees in crore with lakh-crore shorthand: −262598 → "−₹2.6 lakh cr", 4327 → "₹4,327 cr". */
export function rupeesCr(x: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (!isNum(x)) return '—';
  const a = Math.abs(x);
  const s = x < 0 ? MINUS : opts.sign && x > 0 ? '+' : '';
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)} lakh cr`;
  if (a >= 100) return `${s}₹${Math.round(a).toLocaleString('en-IN')} cr`;
  return `${s}₹${a.toFixed(a >= 10 ? 0 : 1)} cr`;
}

/** Dollars: 1.74e11 → "$174B", 5.2e12 → "$5.2T". */
export function dollars(x: number | null | undefined): string {
  if (!isNum(x)) return '—';
  const a = Math.abs(x);
  const s = x < 0 ? MINUS : '';
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e11 ? 0 : 1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`;
  return `${s}$${a.toFixed(0)}`;
}

/** "falls about 16%" / "rises about 2%" / "barely moves". */
export function moveWords(x: number | null | undefined): string {
  if (!isNum(x)) return 'has no estimate';
  const a = Math.abs(x);
  if (a < 0.005) return 'barely moves';
  const n = a < 0.1 ? (a * 100).toFixed(1).replace(/\.0$/, '') : Math.round(a * 100).toString();
  return `${x < 0 ? 'falls' : 'rises'} about ${n}%`;
}

export const HORIZON_WORDS: Record<'1D' | '1M' | '12M', string> = {
  '1D': 'the next day',
  '1M': 'over a month',
  '12M': 'over a year',
};

export const HORIZON_CHIP: Record<'1D' | '1M' | '12M', string> = {
  '1D': '1 day',
  '1M': '1 month',
  '12M': '1 year',
};

/** Clamp to [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
