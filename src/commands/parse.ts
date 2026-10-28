// Command-bar grammar. Pure: no React, no engine — fully unit tested in parse.test.ts.
//
//   <TICKER> [US|IN|ADR] [EQUITY] <GO>   security page (India display symbols resolve first)
//   CAPEX -30                            preset 1, capex cut c = 30%
//   GUIDE <CHIP> -20                     preset 2, guided revenue cut g = 20% at a chip origin
//   RESTATE <TICKER> -30 [25]            preset 3, profit restated down r = 30%, de-rating d = 25%
//   MULT 50 | MULT PE 25                 preset 4, lambda = 50% toward pre-ChatGPT median | target P/E 25x
//   CREDIT 400                           preset 5, spread widening 400 bps
//   REPLAY <WINDOW>                      preset 6, historical replay window id
//   POP [1D|1M|12M]                      preset 7, full bubble pop at a horizon
//   INDIA [TIER] A|B|C|D|ALL             F2 filtered by tier
//   HIST <CASE|EVENT>                    F4 focused on a case / event study
//   MC | RESET | HELP | F1..F6
// Case-insensitive; a trailing `<GO>` (or `GO`) is optional.
import type { DataBundle, Tier } from '../types/data';
import type { Horizon, ParamValue, PresetId } from '../types/engine';
import type { PanelId } from '../panels/types';

export type Command =
  | { kind: 'panel'; panel: PanelId }
  | { kind: 'help' }
  | { kind: 'mc' }
  | { kind: 'reset' }
  | { kind: 'security'; ticker: string; note: string | null }
  | {
      kind: 'scenario';
      preset: PresetId;
      horizon: Horizon | null;
      values: Record<string, ParamValue>;
      label: string;
    }
  | { kind: 'tier'; tier: Tier | 'ALL' }
  | { kind: 'hist'; id: string | null }
  | { kind: 'error'; message: string };

export interface ParseContext {
  /** Every security key in bundle.securities. */
  securities: string[];
  /** India display symbol (upper-case) -> price ticker, e.g. INFY -> INFY.NS, MOSCHIP -> MOSCHIP.BO */
  indiaDisplay: Record<string, string>;
  indiaTickers: string[];
  origins: string[];
  chips: string[];
  replayWindows: string[];
  historyIds: string[];
}

export function contextFromBundle(bundle: DataBundle): ParseContext {
  const indiaDisplay: Record<string, string> = {};
  for (const t of bundle.india) indiaDisplay[(t.display || t.ticker).toUpperCase()] = t.ticker;
  const historyIds = [
    ...bundle.history.cases.map((c) => c.id),
    ...bundle.history.event_studies.map((e) => e.id),
  ];
  return {
    securities: Object.keys(bundle.securities),
    indiaDisplay,
    indiaTickers: bundle.india.map((t) => t.ticker),
    origins: bundle.origins.map((o) => o.ticker),
    chips: bundle.origins.filter((o) => o.group === 'chips').map((o) => o.ticker),
    replayWindows: bundle.history.replay_windows.map((w) => w.id),
    historyIds: Array.from(new Set(historyIds)),
  };
}

const SUFFIX_FOREIGN = new Set(['US', 'ADR', 'UN', 'UW', 'UQ']);
const SUFFIX_INDIA = new Set(['IN', 'IS', 'IB', 'NSE', 'BSE']);
const FILLER = new Set(['EQUITY', 'EQ']);
const HORIZONS: Horizon[] = ['1D', '1M', '12M'];

/** Parse "-30", "30", "-30%", "+12.5" -> 30 / 12.5 (absolute value). null if not numeric. */
export function parseMagnitude(tok: string | undefined): number | null {
  if (tok == null) return null;
  const m = /^[+-]?(\d+(?:\.\d+)?|\.\d+)%?$/.exec(tok.trim());
  if (!m) return null;
  const v = Math.abs(parseFloat(tok.replace('%', '')));
  return Number.isFinite(v) ? v : null;
}

function upperKeyMap(keys: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const k of keys) m.set(k.toUpperCase(), k);
  return m;
}

/** Resolve a user-typed symbol to a security ticker. */
export function resolveTicker(
  sym: string,
  ctx: ParseContext,
  prefer: 'india' | 'foreign' | 'auto' = 'auto',
): string | null {
  const s = sym.toUpperCase();
  const secs = upperKeyMap(ctx.securities);
  const india = (): string | null => {
    if (ctx.indiaDisplay[s]) return ctx.indiaDisplay[s];
    const exact = ctx.indiaTickers.find((t) => t.toUpperCase() === s);
    if (exact) return exact;
    for (const suf of ['.NS', '.BO']) {
      const t = ctx.indiaTickers.find((x) => x.toUpperCase() === s + suf);
      if (t) return t;
    }
    return null;
  };
  const foreign = (): string | null => secs.get(s) ?? null;
  if (prefer === 'foreign') return foreign() ?? india();
  if (prefer === 'india') return india() ?? foreign();
  return india() ?? foreign();
}

function matchId(raw: string, ids: string[]): string | null {
  const s = raw.toUpperCase();
  const exact = ids.find((i) => i.toUpperCase() === s);
  if (exact) return exact;
  const prefix = ids.filter((i) => i.toUpperCase().startsWith(s));
  if (prefix.length === 1) return prefix[0];
  const contains = ids.filter((i) => i.toUpperCase().includes(s));
  if (contains.length === 1) return contains[0];
  return null;
}

export function normalize(input: string): string[] {
  let s = input.replace(/\s+/g, ' ').trim().toUpperCase();
  s = s.replace(/\s*<GO>\s*$/, '').replace(/\s+GO$/, '').trim();
  if (s === '<GO>' || s === 'GO') return [];
  return s.length ? s.split(' ') : [];
}

export function parseCommand(input: string, ctx: ParseContext): Command {
  const tok = normalize(input);
  if (!tok.length) return { kind: 'error', message: 'EMPTY COMMAND — TYPE HELP <GO>' };
  const [head, ...rest] = tok;

  if (/^F[1-6]$/.test(head) && rest.length === 0) return { kind: 'panel', panel: head as PanelId };
  if (head === 'HELP' || head === '?' || head === 'H') return { kind: 'help' };
  if (head === 'MC' || head === 'MONTECARLO' || (head === 'RUN' && rest[0] === 'MC')) return { kind: 'mc' };
  if (head === 'RESET') return { kind: 'reset' };

  switch (head) {
    case 'CAPEX': {
      const v = parseMagnitude(rest[0]);
      if (v == null) return { kind: 'error', message: 'USAGE: CAPEX -30 <GO>  (cut combined hyperscaler AI capex by 30%)' };
      return {
        kind: 'scenario',
        preset: 'capex',
        horizon: null,
        values: { c: v / 100 },
        label: `HYPERSCALER CAPEX -${v}%`,
      };
    }
    case 'GUIDE':
    case 'GUIDANCE': {
      const sym = rest[0];
      const v = parseMagnitude(rest[1]);
      if (!sym || v == null) return { kind: 'error', message: 'USAGE: GUIDE <CHIP> -20 <GO>  e.g. GUIDE AMD -20' };
      const t = ctx.chips.find((c) => c.toUpperCase() === sym);
      if (!t) return { kind: 'error', message: `GUIDE TAKES A CHIP ORIGIN: ${ctx.chips.join(' ')}` };
      return {
        kind: 'scenario',
        preset: 'guidance',
        horizon: null,
        values: { target: t, g: v / 100 },
        label: `${t} GUIDES REVENUE -${v}%`,
      };
    }
    case 'RESTATE':
    case 'RESTATEMENT': {
      const sym = rest[0];
      const r = parseMagnitude(rest[1]);
      if (!sym || r == null) return { kind: 'error', message: 'USAGE: RESTATE <TICKER> -30 [25] <GO>  (profit -30%, de-rating 25%)' };
      const t = resolveTicker(sym, ctx);
      const allowed = new Set([...ctx.origins, ...ctx.indiaTickers]);
      if (!t || !allowed.has(t)) return { kind: 'error', message: `RESTATE TARGET MUST BE A SHOCK ORIGIN OR INDIA TARGET: ${sym}` };
      const values: Record<string, ParamValue> = { target: t, r: r / 100 };
      const d = parseMagnitude(rest[2]);
      if (rest[2] != null && d == null) return { kind: 'error', message: `BAD DE-RATING: ${rest[2]}` };
      if (d != null) values.d = d / 100;
      return {
        kind: 'scenario',
        preset: 'restatement',
        horizon: null,
        values,
        label: `${t} RESTATES PROFIT -${r}%${d != null ? `, DE-RATING ${d}%` : ''}`,
      };
    }
    case 'MULT':
    case 'MULTIPLE': {
      if (rest[0] === 'PE' || rest[0] === 'P/E') {
        const pe = parseMagnitude(rest[1]);
        if (pe == null || pe <= 0) return { kind: 'error', message: 'USAGE: MULT PE 25 <GO>  (AI basket to 25x)' };
        return {
          kind: 'scenario',
          preset: 'multiple',
          horizon: null,
          values: { mode: 'multiple', target_pe: pe },
          label: `AI BASKET P/E → ${pe}x`,
        };
      }
      if (rest.length === 0) {
        return { kind: 'scenario', preset: 'multiple', horizon: null, values: {}, label: 'MULTIPLE COMPRESSION (DEFAULTS)' };
      }
      const lam = parseMagnitude(rest[0]);
      if (lam == null || lam > 100) return { kind: 'error', message: 'USAGE: MULT 50 <GO>  (revert 50% toward pre-ChatGPT median P/E)' };
      return {
        kind: 'scenario',
        preset: 'multiple',
        horizon: null,
        values: { mode: 'median', lambda: lam / 100 },
        label: `P/E REVERTS ${lam}% TOWARD PRE-CHATGPT MEDIAN`,
      };
    }
    case 'CREDIT': {
      if (rest.length === 0) return { kind: 'scenario', preset: 'credit', horizon: null, values: {}, label: 'AI CREDIT EVENT (DEFAULTS)' };
      const v = parseMagnitude(rest[0]);
      if (v == null) return { kind: 'error', message: 'USAGE: CREDIT 400 <GO>  (spread widening, bps)' };
      return {
        kind: 'scenario',
        preset: 'credit',
        horizon: null,
        values: { ds_bps: v },
        label: `AI CREDIT EVENT +${v} BPS`,
      };
    }
    case 'REPLAY': {
      if (!rest[0]) return { kind: 'error', message: `USAGE: REPLAY <WINDOW> <GO>  windows: ${ctx.replayWindows.join(' ')}` };
      const id = matchId(rest.join('_'), ctx.replayWindows) ?? matchId(rest[0], ctx.replayWindows);
      if (!id) return { kind: 'error', message: `UNKNOWN REPLAY WINDOW ${rest.join(' ')} — AVAILABLE: ${ctx.replayWindows.join(' ')}` };
      return { kind: 'scenario', preset: 'replay', horizon: null, values: { window: id }, label: `HISTORICAL REPLAY: ${id}` };
    }
    case 'POP':
    case 'FULLPOP':
    case 'BUBBLE': {
      const h = rest[0] as Horizon | undefined;
      if (h != null && !HORIZONS.includes(h)) return { kind: 'error', message: 'USAGE: POP 1D|1M|12M <GO>' };
      return {
        kind: 'scenario',
        preset: 'fullpop',
        horizon: h ?? null,
        values: {},
        label: `FULL BUBBLE POP${h ? ' ' + h : ''}`,
      };
    }
    case 'INDIA':
    case 'TIER': {
      const args = rest[0] === 'TIER' ? rest.slice(1) : rest;
      const t = (args[0] ?? 'ALL') as Tier | 'ALL';
      if (!['A', 'B', 'C', 'D', 'ALL'].includes(t)) return { kind: 'error', message: 'USAGE: INDIA TIER A|B|C|D|ALL <GO>' };
      return { kind: 'tier', tier: t };
    }
    case 'HIST':
    case 'HISTORY': {
      if (!rest.length) return { kind: 'hist', id: null };
      const id = matchId(rest.join('_'), ctx.historyIds) ?? matchId(rest[0], ctx.historyIds);
      if (!id) return { kind: 'error', message: `UNKNOWN HISTORY ID ${rest.join(' ')} — AVAILABLE: ${ctx.historyIds.join(' ')}` };
      return { kind: 'hist', id };
    }
    default:
      break;
  }

  // Security lookup: <SYM> [US|IN|ADR] [EQUITY]
  const extra = rest.filter((t) => !FILLER.has(t));
  let prefer: 'india' | 'foreign' | 'auto' = 'auto';
  if (extra.length === 1 && SUFFIX_FOREIGN.has(extra[0])) prefer = 'foreign';
  else if (extra.length === 1 && SUFFIX_INDIA.has(extra[0])) prefer = 'india';
  else if (extra.length > 0) return { kind: 'error', message: `UNKNOWN COMMAND: ${tok.join(' ')} — TYPE HELP <GO>` };
  const t = resolveTicker(head, ctx, prefer);
  if (!t) return { kind: 'error', message: `UNKNOWN COMMAND OR TICKER: ${head} — TYPE HELP <GO>` };
  let note: string | null = null;
  if (prefer === 'auto' && ctx.indiaDisplay[head] && ctx.securities.some((s) => s.toUpperCase() === head) && t !== head) {
    note = `${head} → ${t} (TYPE ${head} US <GO> FOR THE US LISTING)`;
  }
  return { kind: 'security', ticker: t, note };
}

/** Templates shown as autocomplete hints. */
export const COMMAND_HELP: { cmd: string; desc: string }[] = [
  { cmd: 'NVDA <GO>', desc: 'Security page: price, P/E vs pre-ChatGPT, exposures, scenario waterfall' },
  { cmd: 'INFY <GO>', desc: 'India target page (display symbols work: INFY, LTM, MOSCHIP …)' },
  { cmd: 'CAPEX -30 <GO>', desc: 'Shock 1: cut combined hyperscaler AI capex by 30%' },
  { cmd: 'GUIDE AMD -20 <GO>', desc: 'Shock 2: a chipmaker guides revenue down 20%' },
  { cmd: 'RESTATE SMCI -30 25 <GO>', desc: 'Shock 3: profit restated -30%, credibility de-rating 25%' },
  { cmd: 'MULT 50 <GO>', desc: 'Shock 4: AI basket P/E reverts 50% toward pre-ChatGPT median' },
  { cmd: 'MULT PE 25 <GO>', desc: 'Shock 4: AI basket P/E to a user-set 25x' },
  { cmd: 'CREDIT 400 <GO>', desc: 'Shock 5: AI credit event, +400 bps spreads (LOW CONFIDENCE)' },
  { cmd: 'REPLAY DOTCOM <GO>', desc: "Shock 6: replay a historical window's US factor moves" },
  { cmd: 'POP 12M <GO>', desc: 'Shock 7: full bubble pop (1 + 4 + 5) at 1D / 1M / 12M' },
  { cmd: 'INDIA TIER C <GO>', desc: 'F2 India impact filtered to a tier (A/B/C/D/ALL)' },
  { cmd: 'HIST DEEPSEEK <GO>', desc: 'F4 history focused on a case / event study' },
  { cmd: 'MC <GO>', desc: 'Run the 5,000-path Monte Carlo now' },
  { cmd: 'RESET <GO>', desc: 'Reset the current preset to its universe.yaml defaults' },
  { cmd: 'F1 … F6', desc: 'SHOCK · INDIA IMPACT · TRANSMISSION MAP · HISTORY · MODEL · SOURCES' },
  { cmd: 'HELP <GO>', desc: 'This list' },
];

/** Autocomplete suggestions for a partial input (commands first, then tickers). */
export function suggest(input: string, ctx: ParseContext, limit = 8): string[] {
  const s = input.toUpperCase().trim();
  if (!s) return [];
  const heads = ['CAPEX', 'GUIDE', 'RESTATE', 'MULT', 'MULT PE', 'CREDIT', 'REPLAY', 'POP', 'INDIA TIER', 'HIST', 'MC', 'RESET', 'HELP'];
  const out: string[] = [];
  const [first, ...more] = s.split(' ');
  if (more.length === 0) {
    for (const h of heads) if (h.startsWith(first)) out.push(h);
    const syms = [...Object.keys(ctx.indiaDisplay), ...ctx.securities.map((x) => x.toUpperCase())];
    for (const sym of Array.from(new Set(syms))) if (sym.startsWith(first) && !out.includes(sym)) out.push(sym);
  } else if (first === 'REPLAY') {
    for (const w of ctx.replayWindows) if (w.toUpperCase().startsWith(more.join('_'))) out.push(`REPLAY ${w}`);
  } else if (first === 'HIST' || first === 'HISTORY') {
    for (const w of ctx.historyIds) if (w.toUpperCase().startsWith(more.join('_'))) out.push(`HIST ${w.toUpperCase()}`);
  } else if (first === 'GUIDE') {
    for (const c of ctx.chips) if (c.startsWith(more[0] ?? '')) out.push(`GUIDE ${c} -20`);
  } else if (first === 'POP') {
    for (const h of HORIZONS) if (h.startsWith(more[0] ?? '')) out.push(`POP ${h}`);
  } else if (first === 'INDIA' || first === 'TIER') {
    for (const t of ['A', 'B', 'C', 'D', 'ALL']) out.push(`INDIA TIER ${t}`);
  }
  return out.slice(0, limit);
}
