// npm run report [-- --horizon 1D|1M|12M] [--runs 5000] [--seed N] [--file public/data.json] [--json]
//                  [--set key=value ...]   e.g. --set mode=calibrated --set lambda=0.6 (applied to every horizon)
// Prints the Full bubble pop scenario (HYPOTHETICAL) from public/data.json using the same engine as the UI,
// plus which Layer-2 model produced the numbers and the out-of-sample accuracy of the model lab (V2).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultParams, paramSpecs, runMonteCarlo, runScenario, withRanges, type MCResultV2 } from '../src/engine/index';
import type { DataBundle } from '../src/types/data';
import type { Channel, Horizon, IndiaResult, MCResult, ParamValue, ScenarioParams, ScenarioResult } from '../src/types/engine';

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
const up = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`);
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
  const head = ['#', 'Ticker', 'Tier', 'Dominant channel', 'βtot', 'Model', 'Market', 'OLS mkt', 'MC p5', 'p50', 'p95', 'Fund (net)', 'Gap', 'AI prem', 'Mcap chg', 'Conf'];
  const body = list.map((x, i) => {
    const q = mc?.perStock[x.ticker]?.market ?? x.range;
    return [
      String(i + 1),
      x.display,
      x.tier,
      CHANNEL[x.dominant_channel] ?? x.dominant_channel,
      fx2(x.beta_total),
      x.model_used === 'ensemble' ? 'ens' : 'ols',
      sp(x.market_move),
      sp(x.market_move_ols),
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

const ALIGN: ('l' | 'r')[] = ['r', 'l', 'l', 'l', 'r', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'];

/** Which Layer-2 coefficients produced the numbers (DESIGN §9.4). */
function modelLine(bundle: DataBundle, r: ScenarioResult): string {
  const nEns = r.india.filter((x) => x.model_used === 'ensemble').length;
  if (!bundle.models?.length || nEns === 0) return 'Layer-2 model: 3y OLS betas (india[i].reg) for every stock — bundle has no validated ensemble (bundle.models).';
  const info = r.warnings.find((w) => w.startsWith('INFO: Layer 2 uses'));
  const diffs = r.india.filter((x) => x.model_used === 'ensemble' && x.market_move_ols !== null && x.market_move_ols !== undefined);
  const mad = diffs.length ? diffs.reduce((a, x) => a + Math.abs(x.market_move - (x.market_move_ols as number)), 0) / diffs.length : null;
  return (
    `Layer-2 model: ${info ? info.replace(/^INFO: Layer 2 uses the /, '') : `walk-forward-validated ensemble for ${nEns} of ${r.india.length} stocks`}.` +
    (mad !== null ? ` Mean |ensemble − OLS| market move ${up(mad)} (OLS mkt column).` : '')
  );
}

/** Out-of-sample scoreboard + interval calibration from bundle.backtest (the model lab). */
function accuracySummary(bundle: DataBundle): string[] {
  const bt = bundle.backtest;
  if (!bt) return ['Out-of-sample accuracy: bundle has no backtest section (the model lab has not been run).'];
  const out = [`Out-of-sample accuracy — ${bt.method} (${bt.start} → ${bt.end}; refit every ${bt.refit_every} sessions on ${bt.train_years}y of training data):`];
  const label = new Map((bt.models ?? []).map((m) => [String(m.id), m.label]));
  const SUBSET: Record<string, string> = { all: 'all days', shock: 'shock days (SOX in its trailing worst 5%)', events: 'named AI events' };
  for (const mode of ['scenario', 'nowcast'] as const)
    for (const subset of ['all', 'shock', 'events'] as const) {
      const rows = (bt.summary ?? []).filter((x) => x.mode === mode && x.subset === subset).sort((a, b) => (Number.isFinite(b.r2) ? b.r2 : -Infinity) - (Number.isFinite(a.r2) ? a.r2 : -Infinity));
      if (!rows.length) continue;
      out.push(`  ${mode} mode, ${SUBSET[subset]} (pooled across stocks; R² vs a zero forecast):`);
      const t = table(
        [
          ['Model', 'OOS R²', 'RMSE', 'MAE', 'Hit rate', 'XS corr', 'n'],
          ...rows.map((x) => [`${x.model}${label.get(x.model) ? ` — ${label.get(x.model)}` : ''}`, fx2(x.r2, 3), up(x.rmse, 2), up(x.mae, 2), up(x.hit, 0), fx2(x.corr_xs), String(x.n)]),
        ],
        ['l', 'r', 'r', 'r', 'r', 'r', 'r'],
      );
      out.push(...t.split('\n').map((l) => `    ${l}`));
    }
  if (bt.calibration?.length)
    out.push(`  Ensemble band calibration (share of actuals inside): ${bt.calibration.map((c) => `${up(c.nominal, 0)} band → ${up(c.coverage)} (n ${c.n})`).join('; ')}`);
  if (bt.horizon_check?.length) out.push(`  Horizon check (OOS R²): ${bt.horizon_check.map((c) => `h${c.h} ${c.model} ${fx2(c.r2, 3)} (n ${c.n})`).join('; ')}`);
  if (bt.nifty_horizons?.length) out.push(`  Nifty link: ${bt.nifty_horizons.map((c) => `h${c.h} SOX ${fx2(c.SOX, 3)} NDX ${fx2(c.NDX, 3)} R² ${fx2(c.r2, 3)}`).join('; ')}`);
  const w = Object.entries(bt.ensemble?.weights ?? {}).filter(([, v]) => Number.isFinite(v) && v > 0);
  if (w.length) out.push(`  Ensemble weights (${bt.ensemble.method}): ${w.sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${up(v, 0)}`).join(', ')}`);
  return out;
}

function summary(r: ScenarioResult, mc: MCResult | null, label: string): string {
  const f = r.factors;
  const lines = [
    `${label}: SOX ${sp(f.SOX)}  NDX ${sp(f.NDX)}  NIFTY ${sp(f.NIFTY)}  INR depreciation ${sp(f.inr_depr)}  US tech revenue ${sp(-f.tech_revenue_shock)}`,
  ];
  if (f.capex_cut_usd !== null) lines.push(`  hyperscaler capex cut ≈ $${(f.capex_cut_usd / 1e9).toFixed(0)}B (TTM basis); supplier revenue absorbed ${f.capex_absorbed_share === null ? '—' : `${(f.capex_absorbed_share * 100).toFixed(0)}%`}`);
  if (mc) {
    const src = (mc as Partial<MCResultV2>).residual_note;
    lines.push(`  MC (${mc.runs} runs, seed ${mc.seed}, ${mc.days}d): NIFTY p5/p50/p95 ${sp(mc.factors.NIFTY.p5)} / ${sp(mc.factors.NIFTY.p50)} / ${sp(mc.factors.NIFTY.p95)}${src ? `; residuals: ${src}` : ''}`);
  }
  lines.push(`  India mcap change (sum of targets, market-implied): ${cr(r.totals.india_mcap_change_inr_cr)}`);
  return lines.join('\n');
}

/** Parse repeated `--set key=value` flags into param values (numbers / booleans / null / strings). */
function setOverrides(): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  process.argv.forEach((a, i) => {
    if (a !== '--set' || i + 1 >= process.argv.length) return;
    const [k, ...rest] = process.argv[i + 1].split('=');
    const raw = rest.join('=');
    if (!k) return;
    out[k] = raw === 'null' || raw === '' ? null : raw === 'true' ? true : raw === 'false' ? false : Number.isFinite(Number(raw)) ? Number(raw) : raw;
  });
  return out;
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

  const sets = setOverrides();
  const withSets = (p: ScenarioParams): ScenarioParams => ({ ...p, values: { ...p.values, ...sets } });
  const params = withSets(defaultParams(bundle, 'fullpop', horizon));
  const base = runScenario(bundle, params);
  const mc = runMonteCarlo(bundle, params, { runs, seed });
  const res = withRanges(base, mc);

  if (process.argv.includes('--json')) {
    const top = res.india.slice(0, 10);
    const gaps = [...res.india].filter((x) => x.gap !== null).sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0)).slice(0, 10);
    console.log(
      JSON.stringify(
        {
          as_of: bundle.meta?.as_of,
          horizon,
          model: { ensemble: res.india.filter((x) => x.model_used === 'ensemble').length, ols: res.india.filter((x) => x.model_used !== 'ensemble').length },
          residual_source: mc.residual_source,
          residual_note: mc.residual_note,
          factors: res.factors,
          top,
          gaps,
          accuracy: bundle.backtest ? { summary: bundle.backtest.summary, calibration: bundle.backtest.calibration } : null,
          warnings: res.warnings,
        },
        null,
        2,
      ),
    );
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
        .filter((s) => (s.kind === 'number' || s.kind === 'enum' || s.kind === 'bool') && params.values[s.key] !== null && params.values[s.key] !== undefined)
        .map((s) => {
          const set = s.key in sets ? ' [--set]' : s.status === 'USER_ASSUMPTION' ? ' [USER ASSUMPTION]' : s.status === 'SOURCED' ? ' [SOURCED]' : '';
          return `${s.key}=${params.values[s.key]}${set}`;
        })
        .join(', '),
  );
  out.push(modelLine(bundle, res));
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
    const p = withSets(defaultParams(bundle, 'fullpop', h));
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
  out.push('');
  out.push(...accuracySummary(bundle));
  const notes = res.warnings.filter((w) => !w.startsWith('INFO'));
  const infos = res.warnings.filter((w) => w.startsWith('INFO'));
  if (infos.length) out.push('', ...infos.map((w) => `  ${w}`));
  if (notes.length) out.push('', 'Warnings:', ...notes.map((w) => `  - ${w}`));
  out.push('');
  out.push('Columns: Model = Layer-2 coefficients used (ens = walk-forward-validated ensemble, ols = 3y OLS); Market = Layer-2 market-implied move;');
  out.push('OLS mkt = the same scenario through the original 3y OLS betas; MC = 5th/50th/95th percentile with bootstrapped residuals (out-of-sample when available);');
  out.push('Fund (net) = Layer-3 fundamental move incl. FX offset; Gap = market − fundamental; * = AI premium is a tier-median USER ASSUMPTION.');
  out.push(res.lowConfidence ? 'LOW-CONFIDENCE SCENARIO: includes the AI credit-event channel.' : '');
  out.push('HYPOTHETICAL SCENARIO — not a forecast. Educational model. Not investment advice.');
  console.log(out.join('\n'));
}

main();
