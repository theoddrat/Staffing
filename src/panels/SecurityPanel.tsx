// SEC — security page: valuation & provenance, scenario waterfall (origins), regression + breakdown (India).
import { useMemo } from 'react';
import type { PanelProps } from './types';
import type { IndiaTarget, OriginInfo, RegressionResult, Security } from '../types/data';
import type { IndiaResult, OriginResult } from '../types/engine';
import { securityWaterfall, type Waterfall } from '../engine';
import Chart, { axisStyle, CHART_COLORS } from '../components/Chart';
import QuantityView from '../components/QuantityView';
import { StatusBadge, SourceLinks } from '../components/StatusBadge';
import { compact, crore, isNum, num, pct, signClass, spct, usd } from '../lib/format';

const PRE_CHATGPT = '2022-11-30';

function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <tr>
      <td className="lbl">{k}</td>
      <td>{children}</td>
    </tr>
  );
}

function SecHeader({ sec, india }: { sec: Security; india: IndiaTarget | null }) {
  return (
    <div className="sec-header">
      <span className="sec-sym">{india?.display ?? sec.ticker}</span>
      <span className="white">{sec.name}</span>
      <span className="muted">
        {sec.ticker} · {sec.role.toUpperCase()} · {sec.market} · {sec.currency}
      </span>
      <span className="spacer" />
      <span className="white">{num(sec.last_close, 2)}</span>
      <span className={signClass(sec.chg_1d)}>{spct(sec.chg_1d, 2)}</span>
      <span className="muted">{sec.last_date ?? '—'}</span>
    </div>
  );
}

function ValuationTable({ sec, state }: { sec: Security } & Pick<PanelProps, 'state'>) {
  const { bundle } = state;
  const ol = sec.op_leverage;
  return (
    <table className="tbl">
      <tbody>
        <KV k="MARKET CAP">
          <span className="white">
            {compact(sec.mcap_local)} {sec.currency}
          </span>{' '}
          · {usd(sec.mcap_usd)} · {isNum(sec.mcap_inr) ? crore(sec.mcap_inr / 1e7) : '—'}
          <StatusBadge status="COMPUTED" />
        </KV>
        <KV k="P/E (TTM)">
          <span className="white">{isNum(sec.pe_ttm) ? `${sec.pe_ttm.toFixed(1)}x` : '—'}</span>{' '}
          <span className="muted">EPS {num(sec.eps_ttm, 2)} · basis {sec.pe_basis ?? '—'}</span>
          {isNum(sec.pe_ttm) && <StatusBadge status="COMPUTED" />}
        </KV>
        <KV k="PRE-CHATGPT MEDIAN P/E">
          <span className="white">{isNum(sec.pe_pre_chatgpt_median) ? `${sec.pe_pre_chatgpt_median.toFixed(1)}x` : '—'}</span>{' '}
          <span className="muted">(3y before {bundle.meta.pre_chatgpt.date}; n = {sec.pe_pre_chatgpt_n ?? 0} days)</span>
          {isNum(sec.pe_pre_chatgpt_median) && <StatusBadge status="COMPUTED" />}
        </KV>
        <KV k="AI PREMIUM">
          <span className={signClass(sec.ai_premium)}>{spct(sec.ai_premium, 0)}</span>
          {isNum(sec.ai_premium) && <StatusBadge status="COMPUTED" />}
          {!isNum(sec.ai_premium) && <span className="muted"> not computable (no pre-ChatGPT P/E or EPS ≤ 0)</span>}
        </KV>
        <KV k="RETURN SINCE 30-NOV-2022">
          <span className={signClass(sec.ret_since_chatgpt)}>{spct(sec.ret_since_chatgpt, 0)}</span>{' '}
          <span className="muted">vs {sec.bench ?? 'bench'}:</span>{' '}
          <span className={signClass(sec.ret_since_chatgpt_vs_bench)}>{spct(sec.ret_since_chatgpt_vs_bench, 0)}</span>
        </KV>
        <KV k="OPERATING LEVERAGE">
          <QuantityView q={ol} bundle={bundle} override={state.params.overrides[ol?.id]} />
          {ol?.note && <span className="muted"> {ol.note}</span>}
        </KV>
        <KV k="EBIT / GROSS MARGIN">
          <span className="white">{pct(sec.ebit_margin)}</span> / <span className="white">{pct(sec.gross_margin)}</span>
        </KV>
        <KV k="REVENUE TTM">
          <span className="white">
            {compact(sec.revenue_ttm)} {sec.currency}
          </span>
        </KV>
        {(sec.notes ?? []).length > 0 && (
          <KV k="NOTES">
            <span className="muted">{(sec.notes ?? []).join(' · ')}</span>
          </KV>
        )}
      </tbody>
    </table>
  );
}

function WaterfallChart({ wf }: { wf: Waterfall | null }) {
  const option = useMemo(() => {
    if (!wf || !wf.steps.length || wf.steps.some((st) => !isNum(st.price))) return null;
    const p = wf.steps.map((st) => st.price as number);
    type Bar = { name: string; from: number; to: number; total: boolean; color?: string; note: string };
    const bars: Bar[] = [{ name: wf.steps[0].label.toUpperCase(), from: 0, to: p[0], total: true, note: wf.steps[0].note }];
    const lastDelta = wf.kind === 'india' ? wf.steps.length - 2 : wf.steps.length - 1;
    for (let i = 1; i <= lastDelta; i++) {
      bars.push({ name: wf.steps[i].label.toUpperCase(), from: p[i - 1], to: p[i], total: false, note: wf.steps[i].note });
    }
    if (wf.kind === 'india') {
      bars.push({ name: 'FUNDAMENTAL PRICE', from: 0, to: p[lastDelta], total: true, note: 'Layer 3 + FX' });
      const last = wf.steps[wf.steps.length - 1];
      bars.push({ name: last.label.toUpperCase(), from: 0, to: p[p.length - 1], total: true, color: CHART_COLORS.cyan, note: last.note });
    } else {
      bars.push({ name: 'NEW PRICE', from: 0, to: p[p.length - 1], total: true, note: `move ${spct(wf.move)}` });
    }
    const base = bars.map((b) => (b.total ? 0 : Math.min(b.from, b.to)));
    const val = bars.map((b) => Math.abs(b.to - b.from));
    return {
      grid: { left: 60, right: 16, top: 22, bottom: 52 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          const b = bars[ps[0]?.dataIndex ?? 0];
          return `${b.name}<br/>${b.total ? num(b.to, 2) : `${num(b.from, 2)} → ${num(b.to, 2)}`}<br/><span style="color:#999">${b.note}</span>`;
        },
      },
      xAxis: {
        type: 'category',
        data: bars.map((b) => b.name),
        ...axisStyle(),
        axisLabel: { color: CHART_COLORS.amber, fontSize: 9, interval: 0, width: 90, overflow: 'break' },
      },
      yAxis: { type: 'value', ...axisStyle() },
      series: [
        { type: 'bar', stack: 'w', data: base, itemStyle: { color: 'transparent' }, emphasis: { disabled: true }, tooltip: { show: false } },
        {
          type: 'bar',
          stack: 'w',
          data: val.map((v, i) => ({
            value: v,
            itemStyle: {
              color: bars[i].color ?? (bars[i].total ? CHART_COLORS.amber : bars[i].to < bars[i].from ? CHART_COLORS.red : CHART_COLORS.green),
            },
          })),
          label: { show: true, position: 'top', color: CHART_COLORS.white, fontSize: 10, formatter: (q: any) => num(bars[q.dataIndex].to, 2) },
        },
      ],
    };
  }, [wf]);
  if (!option) return <div className="panel-body muted">NO PRICE / P/E — WATERFALL NOT AVAILABLE.</div>;
  return <Chart option={option} height={250} />;
}

function OriginBlock({ info, res, state }: { info: OriginInfo; res: OriginResult | undefined } & Pick<PanelProps, 'state'>) {
  const { bundle } = state;
  return (
    <>
      <div className="panel">
        <div className="panel-header">EXPOSURES (LAYER 1 CAPEX / CREDIT CHANNELS)</div>
        <table className="tbl">
          <tbody>
            <KV k="GROUP">{info.group}</KV>
            <KV k="HYPERSCALER-CAPEX SHARE s_j">
              <QuantityView q={info.hyperscaler_share} bundle={bundle} showParts override={state.params.overrides[info.hyperscaler_share.id]} />
            </KV>
            <KV k="NEOCLOUD / AI-CLOUD SHARE">
              <QuantityView q={info.neocloud_share} bundle={bundle} showParts override={state.params.overrides[info.neocloud_share.id]} />
            </KV>
            <KV k="BASKET WEIGHTS">
              chip {pct(info.weight_chip_basket)} · AI {pct(info.weight_ai_basket)} <StatusBadge status="COMPUTED" />
            </KV>
            {isNum(info.capex_ttm_usd) && (
              <KV k="CAPEX TTM (FILINGS)">
                <span className="white">{usd(info.capex_ttm_usd)}</span> <StatusBadge status="COMPUTED" />
                <span className="muted"> {(info.capex_quarters ?? []).map((q) => `${q.period}: ${usd(q.value_usd)}`).join(' · ')}</span>
              </KV>
            )}
            <KV k="CREDIT">
              {info.credit?.stressed ? <span className="down">STRESSED BORROWER (SHOCK 5) </span> : <span className="muted">not stressed · </span>}
              net debt {usd(info.credit?.net_debt_usd)} · EBITDA TTM {usd(info.credit?.ebitda_ttm_usd)} · ND/EBITDA{' '}
              {isNum(info.credit?.nd_ebitda) ? `${info.credit.nd_ebitda.toFixed(1)}x` : '—'}
              <StatusBadge status="COMPUTED" />
            </KV>
            {(info.concentration ?? []).map((c, i) => (
              <KV key={i} k={i === 0 ? 'CUSTOMER CONCENTRATION' : ''}>
                <span className="white">{c.text}</span>
                <StatusBadge status={c.status} />
                <SourceLinks ids={c.src} bundle={bundle} />
              </KV>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <div className="panel-header">
          SCENARIO WATERFALL — PRICE → EPS CUT → DE-RATING → NEW PRICE <span className="spacer" />
          {res && <span className={signClass(res.move)}>{spct(res.move)}</span>}
        </div>
        {res ? (
          <>
            <WaterfallChart wf={securityWaterfall(bundle, state.result, info.ticker)} />
            <table className="tbl">
              <tbody>
                <KV k="REVENUE HIT / e / d">
                  {pct(res.revenue_hit)} / {pct(res.e)} / {pct(res.d)}
                </KV>
                <KV k="ΔMCAP">
                  <span className={signClass(res.mcap_change_usd)}>{usd(res.mcap_change_usd)}</span> ·{' '}
                  <span className={signClass(res.mcap_change_inr_cr)}>{crore(res.mcap_change_inr_cr)}</span>
                </KV>
                <KV k="DRIVERS">
                  {res.drivers.length ? (
                    <ul className="drivers">
                      {res.drivers.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="muted">No direct shock on this name under the current scenario.</span>
                  )}
                </KV>
              </tbody>
            </table>
          </>
        ) : (
          <div className="panel-body muted">NOT MODELLED IN THIS SCENARIO.</div>
        )}
      </div>
    </>
  );
}

function RegTable({ reg, title }: { reg: RegressionResult | null; title: string }) {
  if (!reg) return <div className="panel-body muted">{title}: NOT ESTIMATED (INSUFFICIENT OBSERVATIONS).</div>;
  const keys = ['const', 'SOX', 'NDX', 'PARENT', 'NIFTY'].filter((k) => reg.coef[k]);
  return (
    <div>
      <div className="reg-title">
        {title} <span className="muted">· {reg.spec}</span>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>TERM</th>
            <th className="num">b</th>
            <th className="num">SE (OLS)</th>
            <th className="num">t (HAC)</th>
            <th className="num">p</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const c = reg.coef[k];
            return (
              <tr key={k}>
                <td className="lbl">{k}</td>
                <td className="num white">{num(c.b, 3)}</td>
                <td className="num">{num(c.se, 3)}</td>
                <td className={`num ${Math.abs(c.t) >= 2 ? 'white' : 'muted'}`}>{num(c.t, 2)}</td>
                <td className="num">{num(c.p, 3)}</td>
              </tr>
            );
          })}
          <tr>
            <td className="lbl">R² / ADJ R²</td>
            <td className="num white" colSpan={2}>
              {num(reg.r2, 3)} / {num(reg.adj_r2, 3)}
            </td>
            <td className="num muted" colSpan={2}>
              n {reg.n} · {reg.start} → {reg.end}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function RollingChart({ t }: { t: IndiaTarget }) {
  const option = useMemo(() => {
    const r = t.rolling;
    if (!r || !r.dates.length) return null;
    const mark = r.dates.find((d) => d >= PRE_CHATGPT);
    const ser = (name: string, data: (number | null)[] | null, color: string) =>
      data ? { name, type: 'line', data, symbol: 'none', connectNulls: false, lineStyle: { color, width: 1.4 }, itemStyle: { color } } : null;
    const series = [
      ser('b_SOX', r.SOX, CHART_COLORS.amber),
      ser('b_NDX', r.NDX, CHART_COLORS.cyan),
      ser('b_PARENT', r.PARENT, CHART_COLORS.magenta),
      ser('b_NIFTY', r.NIFTY, CHART_COLORS.green),
    ].filter(Boolean) as any[];
    if (series.length && mark) {
      series[0].markLine = {
        symbol: 'none',
        lineStyle: { color: CHART_COLORS.red, type: 'dashed' },
        label: { color: CHART_COLORS.red, formatter: 'ChatGPT 30-Nov-2022', fontSize: 9 },
        data: [{ xAxis: mark }],
      };
    }
    return {
      grid: { left: 44, right: 14, top: 26, bottom: 30 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => (isNum(v) ? v.toFixed(3) : '—') },
      legend: { top: 0, textStyle: { color: CHART_COLORS.amber, fontSize: 10 } },
      xAxis: { type: 'category', data: r.dates, ...axisStyle() },
      yAxis: { type: 'value', ...axisStyle() },
      series,
    };
  }, [t]);
  if (!option) return <div className="panel-body muted">ROLLING BETAS NOT AVAILABLE.</div>;
  return <Chart option={option} height={220} />;
}

function PriceChart({ sec }: { sec: Security }) {
  const ph = sec.price_history;
  const option = useMemo(() => {
    if (!ph || !ph.dates.length) return null;
    const mark = ph.dates.find((d) => d >= PRE_CHATGPT);
    return {
      grid: { left: 56, right: 14, top: 16, bottom: 30 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => (isNum(v) ? num(v, 2) : '—') },
      xAxis: { type: 'category', data: ph.dates, ...axisStyle() },
      yAxis: { type: 'value', scale: true, ...axisStyle() },
      series: [
        {
          type: 'line',
          data: ph.close,
          symbol: 'none',
          lineStyle: { color: CHART_COLORS.amber, width: 1.4 },
          areaStyle: { color: 'rgba(255,176,0,0.08)' },
          markLine: mark
            ? {
                symbol: 'none',
                lineStyle: { color: CHART_COLORS.red, type: 'dashed' },
                label: { color: CHART_COLORS.red, formatter: 'ChatGPT 30-Nov-2022', fontSize: 9 },
                data: [{ xAxis: mark }],
              }
            : undefined,
        },
      ],
    };
  }, [ph]);
  if (!option) return <div className="panel-body muted">PRICE HISTORY NOT INCLUDED IN THE DATA BUNDLE (optional field price_history).</div>;
  return <Chart option={option} height={220} />;
}

function IndiaLinks({ t, state }: { t: IndiaTarget } & Pick<PanelProps, 'state'>) {
  const { bundle } = state;
  const parentSec = t.parent ? bundle.securities[t.parent] : null;
  return (
      <div className="panel">
        <div className="panel-header">
          TIER {t.tier} LINKS & EXPOSURES {t.short_history && <span className="down"> · SHORT HISTORY</span>}
        </div>
        <table className="tbl">
          <tbody>
            {t.parent && (
              <KV k="PARENT">
                <span className="white">
                  {t.parent} {parentSec ? `— ${parentSec.name}` : ''}
                </span>{' '}
                stake <QuantityView q={t.parent_stake} bundle={bundle} />
                {t.parent_secondary && <span className="muted"> · secondary parent {t.parent_secondary}</span>}
              </KV>
            )}
            {t.adr && <KV k="ADR CROSS-CHECK">{t.adr}</KV>}
            {(t.exposures ?? []).length === 0 && (
              <KV k="EXPOSURES">
                <span className="muted">No fundamental exposure defined — sentiment/market channel only.</span>
              </KV>
            )}
            {(t.exposures ?? []).map((e, i) => (
              <KV key={i} k={`EXPOSURE · ${e.channel.toUpperCase()}`}>
                <QuantityView q={e.share} bundle={bundle} showParts override={state.params.overrides[e.share.id]} />
                {e.driver && <span className="muted"> — {e.driver}</span>}
              </KV>
            ))}
            <KV k="FX MARGIN SENSITIVITY">
              <QuantityView q={t.fx_margin_sens_bps} bundle={bundle} override={state.params.overrides[t.fx_margin_sens_bps.id]} />
              <span className="muted"> EBIT-margin bps per 1% INR depreciation</span>
            </KV>
            <KV k="β TOTAL / β DOWNSIDE">
              <span className="white">{num(t.beta_total, 3)}</span> / <span className="white">{num(t.beta_total_down, 3)}</span>
              <StatusBadge status="COMPUTED" />
              <span className="muted">
                {' '}
                slopes: NDX|SOX {num(t.slopes?.ndx_on_sox, 2)} · P|SOX {num(t.slopes?.parent_on_sox, 2)}
              </span>
            </KV>
            {(t.notes ?? []).length > 0 && (
              <KV k="NOTES">
                <span className="muted">{(t.notes ?? []).join(' · ')}</span>
              </KV>
            )}
          </tbody>
        </table>
      </div>
  );
}

function IndiaDetail({ t, res, state }: { t: IndiaTarget; res: IndiaResult | undefined } & Pick<PanelProps, 'state'>) {
  return (
    <>
      <div className="panel">
        <div className="panel-header">LAYER 2 REGRESSIONS (LOG RETURNS, US t−1 ALIGNED)</div>
        <div className="panel-body grid-2 reg-grid">
          <RegTable reg={t.reg} title="FULL 3Y" />
          <RegTable reg={t.reg_down} title="DOWNSIDE (WORST 5% SOX DAYS)" />
        </div>
      </div>
      <div className="panel">
        <div className="panel-header">
          SCENARIO BREAKDOWN <span className="spacer" />
          {res && (
            <>
              MKT <span className={signClass(res.market_move)}>{spct(res.market_move)}</span>&nbsp;· FUND NET{' '}
              <span className={signClass(res.fundamental_net)}>{spct(res.fundamental_net)}</span>&nbsp;· GAP{' '}
              <span className={signClass(res.gap)}>{spct(res.gap)}</span>
            </>
          )}
        </div>
        {res && <WaterfallChart wf={securityWaterfall(state.bundle, state.result, t.ticker)} />}
        {res ? (
          <div className="grid-2">
            <table className="tbl">
              <thead>
                <tr>
                  <th>MARKET (LAYER 2) CONTRIBUTION</th>
                  <th className="num">LOG</th>
                  <th className="num">≈ %</th>
                </tr>
              </thead>
              <tbody>
                {(['parent', 'sentiment', 'fx_fpi', 'own'] as const).map((k) => (
                  <tr key={k}>
                    <td className="lbl">{k.toUpperCase()}</td>
                    <td className="num">{num(res.market_contrib[k], 4)}</td>
                    <td className={`num ${signClass(res.market_contrib[k])}`}>{spct(Math.expm1(res.market_contrib[k]))}</td>
                  </tr>
                ))}
                <tr>
                  <td className="lbl">MARKET-IMPLIED MOVE</td>
                  <td />
                  <td className={`num ${signClass(res.market_move)}`}>{spct(res.market_move)}</td>
                </tr>
              </tbody>
            </table>
            <table className="tbl">
              <thead>
                <tr>
                  <th>FUNDAMENTAL (LAYER 3+4)</th>
                  <th className="num">VALUE</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="lbl">EaR · REVENUE / CAPEX / CREDIT / OWN</td>
                  <td className="num">
                    {pct(res.ear_contrib.revenue)} / {pct(res.ear_contrib.capex)} / {pct(res.ear_contrib.credit)} / {pct(res.ear_contrib.own)}
                  </td>
                </tr>
                <tr>
                  <td className="lbl">EARNINGS AT RISK</td>
                  <td className="num down">{pct(res.ear)}</td>
                </tr>
                <tr>
                  <td className="lbl">AI-PREMIUM UNWIND d</td>
                  <td className="num">
                    {pct(res.d)} <span className="muted">(premium {spct(res.ai_premium, 0)})</span>
                    <StatusBadge status={res.ai_premium_status} />
                  </td>
                </tr>
                <tr>
                  <td className="lbl">FX EPS EFFECT</td>
                  <td className={`num ${signClass(res.fx_eps)}`}>{spct(res.fx_eps)}</td>
                </tr>
                <tr>
                  <td className="lbl">GROSS → NET OF FX</td>
                  <td className="num">
                    <span className={signClass(res.fundamental_gross)}>{spct(res.fundamental_gross)}</span> →{' '}
                    <span className={signClass(res.fundamental_net)}>{spct(res.fundamental_net)}</span>
                  </td>
                </tr>
                <tr>
                  <td className="lbl">CONFIDENCE</td>
                  <td className={`num conf-${res.confidence.grade.toLowerCase()}`}>
                    {res.confidence.grade} {res.confidence.score.toFixed(0)}{' '}
                    <span className="muted">
                      (R² {num(res.confidence.r2, 2)}, assumptions {pct(res.confidence.assumption_share, 0)}, n {res.confidence.n})
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="lbl">ΔMCAP</td>
                  <td className={`num ${signClass(res.mcap_change_inr_cr)}`}>{crore(res.mcap_change_inr_cr)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="panel-body muted">NOT MODELLED IN THIS SCENARIO.</div>
        )}
      </div>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">ROLLING 1Y BETAS (DID AI LINKAGE RISE AFTER NOV-2022?)</div>
          <RollingChart t={t} />
        </div>
        <div className="panel">
          <div className="panel-header">PRICE SINCE 2021</div>
          <PriceChart sec={state.bundle.securities[t.ticker]} />
        </div>
      </div>
    </>
  );
}

export default function SecurityPanel({ state, actions }: PanelProps) {
  const { bundle, result } = state;
  const ticker = state.selected;
  const sec = ticker ? bundle.securities[ticker] : undefined;
  if (!ticker || !sec) {
    return (
      <div className="panel">
        <div className="panel-header">SECURITY</div>
        <div className="panel-body muted">
          {ticker ? `NO DATA FOR ${ticker}.` : 'TYPE A TICKER AND <GO>, E.G. NVDA <GO> OR INFY <GO>.'}
        </div>
      </div>
    );
  }
  const origin = bundle.origins.find((o) => o.ticker === ticker);
  const india = bundle.india.find((t) => t.ticker === ticker) ?? null;
  const oRes = result.origins.find((o) => o.ticker === ticker);
  const iRes = result.india.find((r) => r.ticker === ticker);
  const childOf = bundle.india.filter((t) => t.parent === ticker || t.parent_secondary === ticker);
  return (
    <div className="security-panel">
      <div className="panel">
        <SecHeader sec={sec} india={india} />
      </div>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">VALUATION & PROVENANCE</div>
          <ValuationTable sec={sec} state={state} />
          {childOf.length > 0 && (
            <div className="panel-body">
              INDIAN ARMS:{' '}
              {childOf.map((c) => (
                <button key={c.ticker} className="btn btn-xs" onClick={() => actions.go(c.display)}>
                  {c.display}
                </button>
              ))}
            </div>
          )}
        </div>
        {origin ? (
          <div>
            <OriginBlock info={origin} res={oRes} state={state} />
          </div>
        ) : india ? (
          <IndiaLinks t={india} state={state} />
        ) : (
          <div className="panel">
            <div className="panel-header">PRICE SINCE 2021</div>
            <PriceChart sec={sec} />
          </div>
        )}
      </div>
      {india && <IndiaDetail t={india} res={iRes} state={state} />}
    </div>
  );
}
