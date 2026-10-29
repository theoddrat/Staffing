// F5 / REGRESSIONS — Layer-2 betas with HAC t-stats, R², downside model, total AI beta.
import { useMemo, useState } from 'react';
import type { DataBundle, IndiaTarget, RegressionResult } from '../../../types/data';
import { isNum, num } from '../../../lib/format';
import { CoefCell, Empty, Note, Section } from '../common';
import { median } from '../util';

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
      <Section
        title={`India targets — r_i,t = a + b_SOX x_SOX,t + b_NDX x_NDX,t + b_P x_P,t + b_N r_N,t + e   ${w ? `(${w.start} → ${w.end})` : ''}`}
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
