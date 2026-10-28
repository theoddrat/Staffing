// Shared number/date formatting. All functions accept null/undefined/NaN and render an em dash.

const DASH = '—';

export function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** 0.1234 -> "12.3%" */
export function pct(x: number | null | undefined, digits = 1): string {
  return isNum(x) ? `${(x * 100).toFixed(digits)}%` : DASH;
}

/** 0.1234 -> "+12.3%", -0.05 -> "-5.0%" */
export function spct(x: number | null | undefined, digits = 1): string {
  if (!isNum(x)) return DASH;
  const v = x * 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

export function num(x: number | null | undefined, digits = 2): string {
  return isNum(x) ? x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : DASH;
}

export function snum(x: number | null | undefined, digits = 2): string {
  if (!isNum(x)) return DASH;
  return `${x > 0 ? '+' : ''}${num(x, digits)}`;
}

/** Compact big numbers: 1.2T / 345.6B / 12.3M */
export function compact(x: number | null | undefined, digits = 1): string {
  if (!isNum(x)) return DASH;
  const a = Math.abs(x);
  const s = x < 0 ? '-' : '';
  if (a >= 1e12) return `${s}${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(digits)}K`;
  return `${s}${a.toFixed(digits)}`;
}

export function usd(x: number | null | undefined, digits = 1): string {
  return isNum(x) ? `$${compact(x, digits)}` : DASH;
}

/** INR crore with Indian grouping: 123456.7 -> "₹1,23,457 cr" */
export function crore(x: number | null | undefined, digits = 0): string {
  if (!isNum(x)) return DASH;
  return `₹${x.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits })} cr`;
}

export function times(x: number | null | undefined, digits = 1): string {
  return isNum(x) ? `${x.toFixed(digits)}x` : DASH;
}

export function bps(x: number | null | undefined): string {
  return isNum(x) ? `${x.toFixed(0)} bps` : DASH;
}

/** CSS class for a signed value: 'up' | 'down' | 'flat' */
export function signClass(x: number | null | undefined, eps = 1e-9): 'up' | 'down' | 'flat' {
  if (!isNum(x) || Math.abs(x) < eps) return 'flat';
  return x > 0 ? 'up' : 'down';
}

export function fmtDate(d: string | null | undefined): string {
  return d ?? DASH;
}
