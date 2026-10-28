// F4 / SCATTERS — (A) US shock size vs Indian response by tier, (B) pre-crash P/E vs peak-to-trough drawdown.
import { useMemo, useState } from 'react';
import type { DataBundle, Tier } from '../../../types/data';
import Chart, { axisStyle, CHART_COLORS } from '../../../components/Chart';
import { SourceLinks, StatusBadge } from '../../../components/StatusBadge';
import { isNum, num, pct, spct, times } from '../../../lib/format';
import { Empty, Note, Section } from '../common';
import { olsLine, robustRange, TIERS } from '../util';

const pctAxis = (v: number) => `${(v * 100).toFixed(0)}%`;

export function UsIndiaScatter({ bundle }: { bundle: DataBundle }) {
  const pts = bundle.history?.us_vs_india ?? [];
  const [tiers, setTiers] = useState<Set<Tier>>(new Set(TIERS));
  const [namedOnly, setNamedOnly] = useState(false);
  const names = useMemo(() => new Map((bundle.india ?? []).map((t) => [t.ticker, t.display || t.ticker])), [bundle.india]);

  const { option, fits, outside } = useMemo(() => {
    const visible = pts.filter((p) => tiers.has(p.tier) && (!namedOnly || p.event));
    const series: any[] = [];
    const fitRows: { tier: Tier; n: number; b: number | null; r2: number | null }[] = [];
    let xmin = Infinity;
    let xmax = -Infinity;
    for (const p of visible) {
      if (isNum(p.x_sox)) {
        xmin = Math.min(xmin, p.x_sox);
        xmax = Math.max(xmax, p.x_sox);
      }
    }
    for (const tier of TIERS) {
      if (!tiers.has(tier)) continue;
      const tp = visible.filter((p) => p.tier === tier && isNum(p.x_sox) && isNum(p.r));
      const color = CHART_COLORS.tiers[tier];
      series.push({
        type: 'scatter',
        name: `Tier ${tier}`,
        symbolSize: (v: any, params: any) => (params?.data?.event ? 9 : 5),
        itemStyle: { color, opacity: 0.75 },
        data: tp.map((p) => ({
          value: [p.x_sox, p.r],
          symbol: p.event ? 'diamond' : 'circle',
          event: p.event,
          ticker: p.ticker,
          date: p.date,
          us_date: p.us_date,
        })),
      });
      const fit = olsLine(
        tp.map((p) => p.x_sox),
        tp.map((p) => p.r),
      );
      fitRows.push({ tier, n: tp.length, b: fit?.b ?? null, r2: fit?.r2 ?? null });
      if (fit && Number.isFinite(xmin)) {
        series.push({
          type: 'line',
          name: `Tier ${tier} OLS`,
          data: [
            [xmin, fit.a + fit.b * xmin],
            [xmax, fit.a + fit.b * xmax],
          ],
          showSymbol: false,
          lineStyle: { color, width: 2, type: 'dashed' },
          tooltip: { show: false },
          silent: true,
        });
      }
    }
    const yr = robustRange(visible.map((p) => p.r));
    const opt = {
      grid: { left: 60, right: 18, top: 30, bottom: 46 },
      legend: { top: 0, data: TIERS.filter((t) => tiers.has(t)).map((t) => `Tier ${t}`) },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
        { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
      ],
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => {
          const d = p.data ?? {};
          if (!d.ticker) return '';
          return [
            `<b>${names.get(d.ticker) ?? d.ticker}</b> (${p.seriesName})`,
            `India session ${d.date}${d.us_date ? ` · US close ${d.us_date}` : ''}`,
            d.event ? `event: ${d.event}` : 'worst-5% SOX day',
            `aligned SOX: ${spct(d.value[0], 2)} · stock: ${spct(d.value[1], 2)}`,
          ].join('<br/>');
        },
      },
      xAxis: {
        type: 'value',
        name: 'US shock: aligned SOX log return (US close before the NSE session)',
        scale: true,
        nameLocation: 'middle',
        nameGap: 28,
        ...axisStyle({ axisLabel: { color: CHART_COLORS.amber, fontSize: 10, formatter: pctAxis }, axisLine: { onZero: false, lineStyle: { color: CHART_COLORS.grey } } }),
      },
      yAxis: {
        type: 'value',
        name: 'Indian stock log return',
        min: yr ? yr.min : undefined,
        max: yr ? yr.max : undefined,
        ...axisStyle({ axisLabel: { color: CHART_COLORS.amber, fontSize: 10, formatter: pctAxis }, axisLine: { onZero: false, lineStyle: { color: CHART_COLORS.grey } } }),
      },
      series,
    };
    return { option: opt, fits: fitRows, outside: yr?.outside ?? 0 };
  }, [pts, tiers, namedOnly, names]);

  if (!pts.length) return <Empty note="history.us_vs_india is empty in data.json" />;
  const toggleTier = (t: Tier) =>
    setTiers((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next.size ? next : new Set(TIERS);
    });

  return (
    <Section title="US shock size vs Indian response (by tier)">
      <div className="b-toolbar">
        {TIERS.map((t) => (
          <button key={t} className={`b-chip${tiers.has(t) ? ' active' : ''}`} onClick={() => toggleTier(t)} style={tiers.has(t) ? { background: CHART_COLORS.tiers[t] } : undefined}>
            TIER {t}
          </button>
        ))}
        <label>
          <input type="checkbox" checked={namedOnly} onChange={(e) => setNamedOnly(e.target.checked)} /> named AI events only (◆)
        </label>
      </div>
      <Chart option={option} height={360} />
      {outside > 0 ? (
        <div className="b-chart-caption">
          {outside} point{outside === 1 ? '' : 's'} lie outside the default y-range (0.5th–99.5th percentile, padded) — scroll on the chart to zoom out;
          they are still included in the fitted slopes.
        </div>
      ) : null}
      <table className="tbl b-tbl" style={{ marginTop: 4 }}>
        <thead>
          <tr>
            <th>TIER</th>
            <th className="num">POINTS</th>
            <th className="num">OLS SLOPE (stock per 1 SOX)</th>
            <th className="num">R²</th>
          </tr>
        </thead>
        <tbody>
          {fits.map((f) => (
            <tr key={f.tier}>
              <td className="lbl" style={{ color: CHART_COLORS.tiers[f.tier] }}>
                Tier {f.tier}
              </td>
              <td className="num">{f.n}</td>
              <td className="num">{num(f.b, 2)}</td>
              <td className="num">{num(f.r2, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Note>
        Points: every India session in the regression window whose aligned SOX move was in its worst 5%, plus named AI events (◆). Slopes are
        COMPUTED here from the plotted points (pooled within tier); they are descriptive and differ from the multi-factor betas in F5.
      </Note>
    </Section>
  );
}

export function PeDrawdownScatter({ bundle }: { bundle: DataBundle }) {
  const h = bundle.history;
  const pts = h?.pe_vs_drawdown ?? [];
  const fit = h?.pe_fit;
  const basket = h?.ai_basket_pe;

  const option = useMemo(() => {
    const pes = pts.map((p) => p.pe).filter(isNum);
    if (isNum(basket?.now)) pes.push(basket!.now as number);
    const xmin = pes.length ? Math.min(...pes) : 0;
    const xmax = pes.length ? Math.max(...pes) : 1;
    const kinds: ('CAPE' | 'trailing')[] = ['CAPE', 'trailing'];
    const series: any[] = kinds.map((kind) => ({
      type: 'scatter',
      name: kind === 'CAPE' ? 'Shiller CAPE' : 'Trailing P/E',
      symbolSize: 9,
      itemStyle: { color: kind === 'CAPE' ? CHART_COLORS.cyan : CHART_COLORS.amber },
      label: { show: true, formatter: (p: any) => p.data?.label ?? '', position: 'right', color: CHART_COLORS.white, fontSize: 9 },
      labelLayout: { moveOverlap: 'shiftY' },
      data: pts
        .filter((p) => p.pe_kind === kind && isNum(p.pe) && isNum(p.drawdown))
        .map((p) => ({
          value: [p.pe, p.drawdown],
          label: p.label,
          symbol: p.pe_status === 'COMPUTED' ? 'rect' : 'circle',
          pt: p,
        })),
    })).filter((s) => s.data.length > 0);
    if (fit && isNum(fit.slope) && isNum(fit.intercept)) {
      const lo = Math.max(0, xmin * 0.9);
      const hi = xmax * 1.05;
      series.push({
        type: 'line',
        name: `OLS fit (R² ${num(fit.r2, 2)}, n=${fit.n})`,
        data: [
          [lo, fit.intercept + fit.slope * lo],
          [hi, fit.intercept + fit.slope * hi],
        ],
        showSymbol: false,
        lineStyle: { color: CHART_COLORS.grey, type: 'dashed', width: 2 },
        silent: true,
        tooltip: { show: false },
        markLine: isNum(basket?.now)
          ? {
              symbol: 'none',
              lineStyle: { color: CHART_COLORS.red, width: 2 },
              label: {
                color: CHART_COLORS.red,
                formatter: `AI basket now ${times(basket!.now, 1)}${isNum(basket?.implied_drawdown) ? `\nfit-implied ${pct(basket!.implied_drawdown, 0)}` : ''}`,
                position: 'end',
                fontSize: 10,
              },
              data: [{ xAxis: basket!.now }],
            }
          : undefined,
      });
    }
    return {
      grid: { left: 60, right: 24, top: 52, bottom: 46 },
      legend: { top: 0 },
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => {
          const pt = p.data?.pt;
          if (!pt) return '';
          return [
            `<b>${pt.label}</b> (${pt.market}${pt.peak_date ? `, peak ${pt.peak_date}` : ''})`,
            `pre-crash ${pt.pe_kind === 'CAPE' ? 'CAPE' : 'trailing P/E'}: ${times(pt.pe, 1)} [${pt.pe_status}]`,
            `peak-to-trough: ${pct(pt.drawdown, 1)} [${pt.drawdown_status}]`,
            pt.note ?? '',
          ]
            .filter(Boolean)
            .join('<br/>');
        },
      },
      xAxis: { type: 'value', name: 'pre-crash P/E (x)', nameLocation: 'middle', nameGap: 28, ...axisStyle() },
      yAxis: {
        type: 'value',
        name: 'peak-to-trough drawdown',
        max: 0,
        ...axisStyle({ axisLabel: { color: CHART_COLORS.amber, fontSize: 10, formatter: pctAxis } }),
      },
      series,
    };
  }, [pts, fit, basket]);

  if (!pts.length) return <Empty note="history.pe_vs_drawdown is empty in data.json" />;
  return (
    <Section title="Pre-crash P/E vs peak-to-trough drawdown — calibration for shock 4 (multiple compression)">
      <Chart option={option} height={360} />
      <div className="b-chart-caption">■ = P/E COMPUTED from Shiller's data · ● = P/E SOURCED (hover for the source) · dashed = OLS fit · red line = today's AI-basket P/E.</div>
      <div className="b-kv" style={{ margin: '4px 0' }}>
        <span className="k">FIT</span>
        <span className="v">
          {fit && isNum(fit.slope)
            ? `drawdown = ${num(fit.intercept, 3)} + ${num(fit.slope, 4)} × P/E   (R² ${num(fit.r2, 2)}, n = ${fit.n}) — COMPUTED`
            : '—'}
        </span>
        <span className="k">AI BASKET P/E</span>
        <span className="v">
          now {times(basket?.now, 1)} · pre-ChatGPT median {times(basket?.pre_chatgpt_median, 1)} · fit-implied drawdown{' '}
          {pct(basket?.implied_drawdown, 0)} <StatusBadge status="COMPUTED" />
        </span>
      </div>
      <div className="b-scroll" style={{ maxHeight: 220 }}>
        <table className="tbl b-tbl">
          <thead>
            <tr>
              <th>EPISODE</th>
              <th>MARKET</th>
              <th>PEAK</th>
              <th className="num">P/E</th>
              <th>KIND</th>
              <th>P/E STATUS</th>
              <th className="num">DRAWDOWN</th>
              <th>DD STATUS</th>
              <th>SOURCES</th>
              <th className="wrap">NOTE</th>
            </tr>
          </thead>
          <tbody>
            {pts.map((p) => (
              <tr key={p.id}>
                <td className="lbl">{p.label}</td>
                <td>{p.market}</td>
                <td>{p.peak_date ?? '—'}</td>
                <td className="num">{times(p.pe, 1)}</td>
                <td>{p.pe_kind}</td>
                <td>
                  <StatusBadge status={p.pe_status} />
                </td>
                <td className="num down">{pct(p.drawdown, 1)}</td>
                <td>
                  <StatusBadge status={p.drawdown_status} />
                </td>
                <td>
                  <SourceLinks ids={p.src ?? []} bundle={bundle} />
                </td>
                <td className="txt muted">{p.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Note>
        Shiller-episode CAPE / trailing P/E and drawdowns are COMPUTED from Robert Shiller's monthly S&P data; other P/E points are SOURCED and
        their drawdowns COMPUTED from Yahoo index closes where available. The fit is descriptive (few points) — use it as a sanity range for
        the λ / target-multiple sliders in F1, not as a forecast.
      </Note>
    </Section>
  );
}
