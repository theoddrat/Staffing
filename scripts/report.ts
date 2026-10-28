// npm run report [-- --horizon 1D|1M|12M] [--runs 5000] [--seed N] [--file public/data.json] [--json]
// Prints the Full bubble pop scenario (HYPOTHETICAL) from public/data.json using the same engine as the UI.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultParams, paramSpecs, runMonteCarlo, runScenario, withRanges } from '../src/engine/index';
import type { DataBundle } from '../src/types/data';
import type { Channel, Horizon, IndiaResult, MCResult, ScenarioResult } from '../src/types/engine';

const CHANNEL: Record<Channel, string> = {
  parent: 'Parent link',
  revenue: 'Revenue (IT budgets)',
  capex: 'Capex orders',
  credit: 'Credit (AI debt)',
  sentiment: 'Sentiment (US AI)',
  fx_fpi: 'FX/FPI (Nifty flows)',
  fx: 'FX offset',
  own: 'Own shock',
};

function arg(name: string, dflt: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return dflt;
}

const sp = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%`);
const fx2 = (x: number | null | undefined, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d));
const cr = (x: number | null | undefined) =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : `${x < 0 ? '-' : '+'}₹${Math.abs(x).toLocaleString('en-IN', { maximumFractionDigits: 0 })} cr`;

function table(rows: string[][], align: ('l' | 'r')[]): string {
  const w = rows[0].map((_, c) => Math.max(...rows.map((r) => [...r[c]].length)));
  return rows
    .map((r, i) => {
      const line = r.map((cell, c) => (align[c] === 'r' ? cell.padStart(w[c]) : cell.padEnd(w[c]))).join('  ');
      return i === 0 ? `${line}\n${w.map((n) => '-'.repeat(n)).join('  ')}` : line;
    })
    .join('\n');
}

function rowsFor(list: IndiaResult[], mc: MCResult | null): string[][] {
  const head = ['#', 'Ticker', 'Tier', 'Dominant channel', 'βtot', 'Market', 'MC p5', 'p50', 'p95', 'Fund (net)', 'Gap', 'AI prem', 'Mcap chg', 'Conf'];
  const body = list.map((x, i) => {
    const q = mc?.perStock[x.ticker]?.market ?? x.range;
    return [
      String(i + 1),
      x.display,
      x.tier,
      CHANNEL[x.dominant_channel] ?? x.dominant_channel,
      fx2(x.beta_total),
      sp(x.market_move),
      sp(q?.p5),
      sp(q?.p50),
      sp(q?.p95),
      sp(x.fundamental_net),
      sp(x.gap),
      x.ai_premium === null ? '—' : `${sp(x.ai_premium, 0)}${x.ai_premium_status === 'USER_ASSUMPTION' ? '*' : ''}`,
      cr(x.mcap_change_inr_cr),
      `${x.confidence.score} ${x.confidence.grade}`,
    ];
  });
  return [head, ...body];
}

const ALIGN: ('l' | 'r')[] = ['r', 'l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'];

function summary(r: ScenarioResult, mc: MCResult | null, label: string): string {
  const f = r.factors;
  const lines = [
    `${label}: SOX ${sp(f.SOX)}  NDX ${sp(f.NDX)}  NIFTY ${sp(f.NIFTY)}  INR depreciation ${sp(f.inr_depr)}  US tech revenue shock ${sp(f.tech_revenue_shock)}`,
  ];
  if (f.capex_cut_usd !== null) lines.push(`  hyperscaler capex cut ≈ $${(f.capex_cut_usd / 1e9).toFixed(0)}B (TTM basis); supplier revenue absorbed ${f.capex_absorbed_share === null ? '—' : `${(f.capex_absorbed_share * 100).toFixed(0)}%`}`);
  if (mc) lines.push(`  MC (${mc.runs} runs, seed ${mc.seed}, ${mc.days}d): NIFTY p5/p50/p95 ${sp(mc.factors.NIFTY.p5)} / ${sp(mc.factors.NIFTY.p50)} / ${sp(mc.factors.NIFTY.p95)}`);
  lines.push(`  India mcap change (sum of targets, market-implied): ${cr(r.totals.india_mcap_change_inr_cr)}`);
  return lines.join('\n');
}

function main() {
  const file = resolve(process.cwd(), arg('file', 'public/data.json')!);
  if (!existsSync(file)) {
    console.error(`ERROR: ${file} not found. Build it first:  python build_data.py`);
    process.exit(1);
  }
  const bundle = JSON.parse(readFileSync(file, 'utf8')) as DataBundle;
  const horizon = (arg('horizon', '12M') as Horizon) ?? '12M';
  if (!['1D', '1M', '12M'].includes(horizon)) {
    console.error(`ERROR: --horizon must be 1D, 1M or 12M (got ${horizon})`);
    process.exit(1);
  }
  const runs = Number(arg('runs', '5000'));
  const seed = Number(arg('seed', '20221130'));

  const params = defaultParams(bundle, 'fullpop', horizon);
  const base = runScenario(bundle, params);
  const mc = runMonteCarlo(bundle, params, { runs, seed });
  const res = withRanges(base, mc);

  if (process.argv.includes('--json')) {
    const top = res.india.slice(0, 10);
    const gaps = [...res.india].filter((x) => x.gap !== null).sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0)).slice(0, 10);
    console.log(JSON.stringify({ as_of: bundle.meta?.as_of, horizon, factors: res.factors, top, gaps, warnings: res.warnings }, null, 2));
    return;
  }

  const out: string[] = [];
  out.push('='.repeat(110));
  out.push(`AI CRASH MONITOR — HYPOTHETICAL "${res.preset.label}" scenario, horizon ${horizon}   (data as of ${bundle.meta?.as_of ?? '—'}, US ${bundle.meta?.as_of_us ?? '—'})`);
  out.push('='.repeat(110));
  const specs = paramSpecs(bundle, 'fullpop', horizon);
  out.push(
    'Parameters: ' +
      specs
        .filter((s) => s.kind === 'number' && params.values[s.key] !== null && params.values[s.key] !== undefined)
        .map((s) => `${s.key}=${params.values[s.key]}${s.status === 'USER_ASSUMPTION' ? ' [USER ASSUMPTION]' : s.status === 'SOURCED' ? ' [SOURCED]' : ''}`)
        .join(', '),
  );
  out.push('');
  out.push(summary(res, mc, `Factor moves (${horizon})`));
  out.push('');
  out.push(`Top 10 most exposed Indian names (ranked by market-implied move, most negative first):`);
  out.push(table(rowsFor(res.india.slice(0, 10), mc), ALIGN));
  out.push('');
  const gaps = [...res.india].filter((x) => x.gap !== null).sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0));
  out.push('Where the market-implied move most exceeds fundamental damage (most negative gap = sentiment overreaction):');
  out.push(table(rowsFor(gaps.slice(0, 10), mc), ALIGN));
  out.push('');
  for (const h of ['1D', '1M', '12M'] as const) {
    if (h === horizon) continue;
    const p = defaultParams(bundle, 'fullpop', h);
    const r = runScenario(bundle, p);
    const m = runMonteCarlo(bundle, p, { runs, seed });
    out.push(summary(r, m, `Full bubble pop ${h}`));
    out.push(
      '  most exposed: ' +
        r.india
          .slice(0, 5)
          .map((x) => `${x.display} ${sp(x.market_move)} (${CHANNEL[x.dominant_channel]})`)
          .join('; '),
    );
  }
  const notes = res.warnings.filter((w) => !w.startsWith('INFO'));
  const infos = res.warnings.filter((w) => w.startsWith('INFO'));
  if (infos.length) out.push('', ...infos.map((w) => `  ${w}`));
  if (notes.length) out.push('', 'Warnings:', ...notes.map((w) => `  - ${w}`));
  out.push('');
  out.push('Columns: Market = Layer-2 market-implied move from today\'s betas; MC = 5th/50th/95th percentile with bootstrapped residuals;');
  out.push('Fund (net) = Layer-3 fundamental move incl. FX offset; Gap = market − fundamental; * = AI premium is a tier-median USER ASSUMPTION.');
  out.push(res.lowConfidence ? 'LOW-CONFIDENCE SCENARIO: includes the AI credit-event channel.' : '');
  out.push('HYPOTHETICAL SCENARIO — not a forecast. Educational model. Not investment advice.');
  console.log(out.join('\n'));
}

main();
