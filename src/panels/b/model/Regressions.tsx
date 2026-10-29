// F5 / REGRESSIONS — Layer-2 betas with HAC t-stats, R², downside model, total AI beta.
import { useMemo, useState } from 'react';
import type { DataBundle, IndiaTarget, RegressionResult, StockModels } from '../../../types/data';
import { isNum, num, pct } from '../../../lib/format';
import { HelpChip } from '../../../learn/Term';
import { CoefCell, Empty, Note, Section } from '../common';
import { median } from '../util';

/** Blend weights of one stock's ensemble ("huber 84% · ewma 16%"), remainder = the no-change forecast. */
function weightsText(m: StockModels): string {
  const parts = Object.entries(m.components ?? {})
    .filter(([, c]) => isNum(c.weight) && c.weight > 0.005)
    .sort((a, b) => b[1].weight - a[1].weight);
  const used = parts.reduce((s, [, c]) => s + c.weight, 0);
  const out = parts.map(([id, c]) => `${id} ${Math.round(c.weight * 100)}%`);
  if (1 - used > 0.005) out.push(`no change ${Math.round((1 - used) * 100)}%`);
  return out.join(' · ');
}

/** Ensemble (validated) coefficients next to the original OLS fit — what the scenario engine uses. */
function EnsembleTable({ bundle, rows, selected, onSelect }: { bundle: DataBundle; rows: IndiaTarget[]; selected: string | null; onSelect: (t: string) => void }) {
  const models = useMemo(() => new Map((bundle.models ?? []).map((m) => [m.ticker, m])), [bundle.models]);
  const hs = useMemo(() => [...new Set((bundle.models ?? []).flatMap((m) => m.horizons.map((h) => h.h)))].sort((a, b) => a - b), [bundle.models]);
  const [h, setH] = useState<number>(1);
  const hh = hs.includes(h as 1 | 5 | 21) ? h : (hs[0] ?? 1);
  const bt = bundle.backtest;
  const nh = bt?.nifty_horizons?.find((x) => x.h === hh) ?? null;
  if (!bundle.models?.length) return null;
  return (
    <Section
      title={
        <>
          Validated ensemble — what scenarios use (h = {hh} session{hh === 1 ? '' : 's'}) <HelpChip id="ensemble" /> <HelpChip id="oos" />
        </>
      }
      right={
        hs.length > 1 ? (
          <span className="b-toolbar" style={{ margin: 0 }}>
            <label>horizon</label>
            <select value={hh} onChange={(e) => setH(Number(e.target.value))}>
              {hs.map((x) => (
                <option key={x} value={x}>
                  h = {x}
                </option>
              ))}
            </select>
          </span>
        ) : undefined
      }
    >
      <div className="b-callout">
        <b>Scenarios use the validated ensemble; the OLS table is the original single model.</b>
      </div>
      {nh ? (
        <div className="muted" style={{ margin: '4px 0 6px' }}>
          Nifty model (walk-forward, h = {nh.h}): c_SOX {num(nh.SOX, 3)} · c_NDX {num(nh.NDX, 3)} · OOS R² {num(nh.r2, 3)} · n {nh.n}
        </div>
      ) : null}
      <div className="b-scroll-lg">
        <table className="tbl b-tbl">
          <thead>
            <tr>
              <th>NAME</th>
              <th>TIER</th>
              <th className="num">b_SOX</th>
              <th className="num">b_NDX</th>
              <th className="num">b_P</th>
              <th className="num">b_N</th>
              <th className="num">β TOTAL ENS</th>
              <th className="num">β TOTAL OLS</th>
              <th className="num">OOS R²</th>
              <th className="num">n OOS</th>
              <th className="num">90% COVER</th>
              <th>BLEND WEIGHTS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const m = models.get(t.ticker);
              const hc = m?.horizons.find((x) => x.h === hh) ?? null;
              const tested = !!m && (m.oos_resid ?? []).some(isNum) && isNum(hc?.r2_oos);
              return (
                <tr key={t.ticker} className={`clickable${t.ticker === selected ? ' sel' : ''}`} onClick={() => onSelect(t.ticker)} title={t.name}>
                  <td className="lbl">{t.display || t.ticker}</td>
                  <td>{t.tier}</td>
                  <td className="num">{num(hc?.SOX, 3)}</td>
                  <td className="num">{num(hc?.NDX, 3)}</td>
                  <td className="num">{num(hc?.PARENT, 3)}</td>
                  <td className="num">{num(hc?.NIFTY, 3)}</td>
                  <td className={`num ${isNum(hc?.beta_total) ? 'white' : 'muted'}`}>{num(hc?.beta_total, 2)}</td>
                  <td className="num muted">{num(t.beta_total, 2)}</td>
                  <td className="num">{tested ? num(hc!.r2_oos, 3) : '—'}</td>
                  <td className="num">{tested ? hc!.n_oos : '—'}</td>
                  <td className="num">{tested && isNum(m!.coverage90) ? pct(m!.coverage90, 0) : '—'}</td>
                  <td className="muted">
                    {!m ? <span className="b-flag">NO MODEL</span> : !tested ? <span className="b-flag" title="no out-of-sample history yet">TOO NEW TO TEST</span> : weightsText(m)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Note>
        Ensemble = non-negative blend of the scenario-usable models, weighted by out-of-sample accuracy before each refit; its coefficients are the
        weighted average of the components' coefficients. OOS R² is measured against the no-change forecast on sessions the models never saw.
        {bt ? ` Walk-forward ${bt.start} → ${bt.end}, refit every ${bt.refit_every} sessions on ${bt.train_years} years.` : ''}
      </Note>
    </Section>
  );
}

type SortKey = 'tier' | 'beta_total' | 'beta_total_down' | 'r2' | 'SOX' | 'NIFTY';

const coef = (r: RegressionResult | null | undefined, k: string) => r?.coef?.[k] ?? null;

function sortValue(t: IndiaTarget, k: SortKey): number | string {
  switch (k) {
    case 'tier':
      return `${t.tier}-${t.display || t.ticker}`;
    case 'beta_total':
      return t.beta_total ?? Infinity;
    case 'beta_total_down':
      return t.beta_total_down ?? Infinity;
    case 'r2':
      return -(t.reg?.r2 ?? -Infinity);
    case 'SOX':
      return coef(t.reg, 'SOX')?.b ?? Infinity;
    case 'NIFTY':
      return coef(t.reg, 'NIFTY')?.b ?? Infinity;
  }
}

export default function Regressions({
  bundle,
  selected,
  onSelect,
}: {
  bundle: DataBundle;
  selected: string | null;
  onSelect: (ticker: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('tier');
  const rows = useMemo(() => {
    const xs = [...(bundle.india ?? [])];
    xs.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb);
      return (va as number) - (vb as number);
    });
    return xs;
  }, [bundle.india, sortKey]);
  const nm = bundle.nifty_model;
  const w = bundle.meta?.regression_window;
  const tierB = useMemo(() => {
    const tb = (bundle.india ?? []).filter((t) => t.tier === 'B' && isNum(t.reg?.coef?.SOX?.b));
    const neg = tb.filter((t) => (t.reg!.coef.SOX.b as number) < 0);
    return {
      n: tb.length,
      neg: neg.length,
      negSig: neg.filter((t) => Math.abs(t.reg!.coef.SOX.t) >= 1.96).length,
      medSox: median(tb.map((t) => t.reg!.coef.SOX.b)),
      medNdx: median(tb.map((t) => t.reg?.coef?.NDX?.b ?? null)),
      medTot: median(tb.map((t) => t.beta_total)),
    };
  }, [bundle.india]);

  if (!rows.length) return <Empty note="no India targets in data.json" />;

  return (
    <div>
      <Section title="Nifty model — propagates a US shock into r_N">
        {nm ? (
          <table className="tbl b-tbl">
            <thead>
              <tr>
                <th>SPEC</th>
                <th className="num">n</th>
                <th>WINDOW</th>
                <th className="num">c0 (t)</th>
                <th className="num">c_SOX (t)</th>
                <th className="num">c_NDX (t)</th>
                <th className="num">R²</th>
                <th className="num">adj R²</th>
                <th className="num">σ(ε)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="white">{nm.spec}</td>
                <td className="num">{nm.n}</td>
                <td>
                  {nm.start} → {nm.end}
                </td>
                <CoefCell c={coef(nm, 'const')} digits={4} />
                <CoefCell c={coef(nm, 'SOX')} />
                <CoefCell c={coef(nm, 'NDX')} />
                <td className="num">{num(nm.r2, 3)}</td>
                <td className="num">{num(nm.adj_r2, 3)}</td>
                <td className="num">{num(nm.resid_sd, 4)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <Empty note="nifty_model missing" />
        )}
      </Section>
      <EnsembleTable bundle={bundle} rows={rows} selected={selected} onSelect={onSelect} />
      <Section
        title={
          <>
            {`India targets — original single model (OLS): r_i,t = a + b_SOX x_SOX,t + b_NDX x_NDX,t + b_P x_P,t + b_N r_N,t + e   ${w ? `(${w.start} → ${w.end})` : ''}`}{' '}
            <HelpChip id="beta" /> <HelpChip id="r2" />
          </>
        }
        right={
          <span className="b-toolbar" style={{ margin: 0 }}>
            <label>sort</label>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
              <option value="tier">tier / name</option>
              <option value="beta_total">β total (most negative first)</option>
              <option value="beta_total_down">β total downside</option>
              <option value="SOX">b_SOX</option>
              <option value="NIFTY">b_N</option>
              <option value="r2">R² (highest first)</option>
            </select>
          </span>
        }
      >
        {tierB.n > 0 ? (
          <div className="b-callout">
            {tierB.neg * 2 >= tierB.n ? (
              <>
                <b>TIER B FINDING (COMPUTED):</b> lagged b_SOX is negative for {tierB.neg} of {tierB.n} Indian IT names ({tierB.negSig} with |t| ≥ 1.96; median{' '}
                {num(tierB.medSox, 2)}), while b_NDX is positive (median {num(tierB.medNdx, 2)}) and β total is near zero (median {num(tierB.medTot, 2)}). That is
                consistent with an AI-disruption channel — strong AI-hardware news reads as substitution risk for labour-based IT services. So a pure US-AI (SOX)
                sell-off can lift Tier B on the market channel (Layer 2) even while the revenue channel (Layer 3: US tech-client IT budgets) hurts it — compare
                market-implied vs fundamental moves in F2.
              </>
            ) : (
              <>
                <b>Tier B (COMPUTED):</b> lagged b_SOX is negative for only {tierB.neg} of {tierB.n} Indian IT names (median {num(tierB.medSox, 2)}; b_NDX median{' '}
                {num(tierB.medNdx, 2)}); the AI-disruption pattern is not dominant in this window.
              </>
            )}
          </div>
        ) : null}
        <div className="b-scroll-lg">
          <table className="tbl b-tbl">
            <thead>
              <tr>
                <th>NAME</th>
                <th>TIER</th>
                <th>PARENT</th>
                <th className="num">n</th>
                <th className="num">b_SOX (t)</th>
                <th className="num">b_NDX (t)</th>
                <th className="num">b_P (t)</th>
                <th className="num">b_N (t)</th>
                <th className="num">R²</th>
                <th className="num">adj R²</th>
                <th className="num">σ(ε)</th>
                <th className="num">↓n</th>
                <th className="num">↓b_SOX (t)</th>
                <th className="num">↓b_NDX (t)</th>
                <th className="num">↓b_P (t)</th>
                <th className="num">↓b_N (t)</th>
                <th className="num">↓R²</th>
                <th className="num">β TOTAL</th>
                <th className="num">β TOTAL ↓</th>
                <th>FLAGS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const r = t.reg;
                const d = t.reg_down;
                return (
                  <tr key={t.ticker} className={`clickable${t.ticker === selected ? ' sel' : ''}`} onClick={() => onSelect(t.ticker)} title={t.name}>
                    <td className="lbl">{t.display || t.ticker}</td>
                    <td>{t.tier}</td>
                    <td className="muted">{t.parent ?? ''}</td>
                    <td className="num">{r ? r.n : '—'}</td>
                    <CoefCell c={coef(r, 'SOX')} />
                    <CoefCell c={coef(r, 'NDX')} />
                    <CoefCell c={coef(r, 'PARENT')} />
                    <CoefCell c={coef(r, 'NIFTY')} />
                    <td className="num">{num(r?.r2, 2)}</td>
                    <td className="num">{num(r?.adj_r2, 2)}</td>
                    <td className="num">{num(r?.resid_sd, 4)}</td>
                    <td className="num">{d ? d.n : '—'}</td>
                    <CoefCell c={coef(d, 'SOX')} />
                    <CoefCell c={coef(d, 'NDX')} />
                    <CoefCell c={coef(d, 'PARENT')} />
                    <CoefCell c={coef(d, 'NIFTY')} />
                    <td className="num">{num(d?.r2, 2)}</td>
                    <td className={`num ${isNum(t.beta_total) ? 'white' : 'muted'}`}>{num(t.beta_total, 2)}</td>
                    <td className={`num ${isNum(t.beta_total_down) ? 'white' : 'muted'}`}>{num(t.beta_total_down, 2)}</td>
                    <td>
                      {t.short_history ? <span className="b-flag" title="less than 3 years of data in the window">SHORT</span> : null}
                      {!r ? <span className="b-flag">NO FIT</span> : null}
                      {t.notes?.length ? (
                        <span className="b-flag" title={t.notes.join('\n')}>
                          NOTE
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Note>
          All coefficients COMPUTED (OLS on daily log returns; parentheses = HAC Newey–West t-stats, bold amber when |t| ≥ 1.96). ↓ = downside model
          on sessions with the aligned SOX move in its worst 5%. β total = response of the stock to a 1-unit log SOX move along the typical joint path
          (NDX, parent and Nifty co-moving). Click a row to load its rolling betas.
        </Note>
      </Section>
    </div>
  );
}
