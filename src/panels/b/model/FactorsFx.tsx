// F5 / FACTORS & FX — factor maps, parent Dimson maps, INR calibration, contagion calibration.
import type { DataBundle, Tier } from '../../../types/data';
import { isNum, num, pct } from '../../../lib/format';
import { Empty, MoveCell, Note, QtyInline, Section } from '../common';

export default function FactorsFx({ bundle }: { bundle: DataBundle }) {
  const fm = bundle.factor_map;
  const pm = bundle.parent_maps ?? {};
  const fx = bundle.fx;
  const cal = bundle.calibration;
  const secName = (t: string) => bundle.securities?.[t]?.name ?? '';

  return (
    <div className="b-grid-2">
      <div>
        <Section title="Factor maps (origins → SOX / NDX)">
          {fm ? (
            <table className="tbl b-tbl">
              <thead>
                <tr>
                  <th>MAP</th>
                  <th className="num">BETA</th>
                  <th className="num">R²</th>
                  <th className="num">n</th>
                  <th className="wrap">USE</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="lbl">SOX on chip basket</td>
                  <td className="num">{num(fm.sox_on_chip_basket?.beta, 3)}</td>
                  <td className="num">{num(fm.sox_on_chip_basket?.r2, 3)}</td>
                  <td className="num">{fm.sox_on_chip_basket?.n ?? '—'}</td>
                  <td className="txt muted">x_SOX = β · ln(cap-weighted chip-origin move)</td>
                </tr>
                <tr>
                  <td className="lbl">NDX on AI basket</td>
                  <td className="num">{num(fm.ndx_on_ai_basket?.beta, 3)}</td>
                  <td className="num">{num(fm.ndx_on_ai_basket?.r2, 3)}</td>
                  <td className="num">{fm.ndx_on_ai_basket?.n ?? '—'}</td>
                  <td className="txt muted">x_NDX = β · ln(cap-weighted all-origin move)</td>
                </tr>
                <tr>
                  <td className="lbl">NDX on SOX (aligned window)</td>
                  <td className="num">{num(fm.ndx_on_sox?.beta, 3)}</td>
                  <td className="num">{num(fm.ndx_on_sox?.r2, 3)}</td>
                  <td className="num">{fm.ndx_on_sox?.n ?? '—'}</td>
                  <td className="txt muted">co-movement slope m_NDX|SOX used in β total</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <Empty note="factor_map missing" />
          )}
          <Note>Same-day regressions on each index's own calendar over the regression window — COMPUTED.</Note>
        </Section>
        <Section title="Non-origin parents — Dimson betas on SOX / NDX (lag 0 + lag 1)">
          {Object.keys(pm).length ? (
            <table className="tbl b-tbl">
              <thead>
                <tr>
                  <th>PARENT</th>
                  <th>NAME</th>
                  <th className="num">β SOX</th>
                  <th className="num">β NDX</th>
                  <th className="num">R²</th>
                  <th className="num">n</th>
                  <th>METHOD</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(pm).map(([t, m]) => (
                  <tr key={t}>
                    <td className="lbl">{t}</td>
                    <td className="muted">{secName(t)}</td>
                    <td className="num">{num(m.SOX, 3)}</td>
                    <td className="num">{num(m.NDX, 3)}</td>
                    <td className="num">{num(m.r2, 3)}</td>
                    <td className="num">{m.n}</td>
                    <td className="muted">{m.method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty note="parent_maps missing" />
          )}
          <Note>Used when a Tier-A parent is not itself a shock origin: x_P = β_SOX·x_SOX + β_NDX·x_NDX.</Note>
        </Section>
        <Section title="Contagion calibration (shock 3) & tier-median AI premium">
          <div className="b-kv">
            <span className="k">US (Super Micro, 30-Oct-2024)</span>
            <span className="v">
              <QtyInline q={cal?.contagion_us} bundle={bundle} showParts />
              {cal?.contagion_us?.note ? <span className="muted"> {cal.contagion_us.note}</span> : null}
            </span>
            <span className="k">India (Satyam, 7-Jan-2009)</span>
            <span className="v">
              <QtyInline q={cal?.contagion_india} bundle={bundle} showParts />
              {cal?.contagion_india?.note ? <span className="muted"> {cal.contagion_india.note}</span> : null}
            </span>
            {(['A', 'B', 'C', 'D'] as Tier[]).map((t) => (
              <span key={t} style={{ display: 'contents' }}>
                <span className="k">Tier {t} median AI premium</span>
                <span className="v">{isNum(cal?.tier_median_premium?.[t]) ? pct(cal!.tier_median_premium[t], 0) : '—'}</span>
              </span>
            ))}
          </div>
          <Note>Tier medians are the fallback (labelled USER ASSUMPTION in F2) for stocks without a pre-ChatGPT P/E history.</Note>
        </Section>
      </div>
      <div>
        <Section title="Layer 4 — INR calibration (risk-off → FPI outflow → INR depreciation)">
          {fx ? (
            <>
              <div className="b-kv">
                <span className="k">USD/INR spot</span>
                <span className="v">
                  {num(fx.spot, 2)} <span className="muted">({fx.spot_date})</span>
                </span>
                <span className="k">β INR on NDX (Dimson)</span>
                <span className="v">
                  {num(fx.beta_inr_on_ndx, 3)} <span className="muted">(R² {num(fx.r2, 3)}, n {fx.n})</span>
                </span>
                <span className="k">β INR on NDX, downside</span>
                <span className="v">{num(fx.beta_inr_on_ndx_down, 3)}</span>
                <span className="k">Default INR depreciation f</span>
                <span className="v">
                  <QtyInline q={fx.default_f} bundle={bundle} />
                  {fx.default_f?.note ? <span className="muted"> {fx.default_f.note}</span> : null}
                </span>
              </div>
              <Note>
                Auto f in a scenario = max(0, β·x_NDX): a negative β means USD/INR rises (INR weakens) when the Nasdaq-100 falls. Overridable per
                scenario (f_override).
              </Note>
              <div className="b-scroll" style={{ maxHeight: 360 }}>
                <table className="tbl b-tbl">
                  <thead>
                    <tr>
                      <th>EPISODE</th>
                      <th>FROM</th>
                      <th>TO</th>
                      <th className="num">INR DEPR.</th>
                      <th className="num">NDX</th>
                      <th className="num">SOX</th>
                      <th className="num">NIFTY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(fx.episodes ?? []).map((e) => (
                      <tr key={e.id}>
                        <td className="lbl" title={e.id}>
                          {e.label}
                        </td>
                        <td>{e.start}</td>
                        <td>{e.end}</td>
                        <td className={`num ${isNum(e.inr_depr) && e.inr_depr > 0 ? 'down' : 'up'}`}>{isNum(e.inr_depr) ? `${e.inr_depr > 0 ? '+' : ''}${pct(e.inr_depr, 1)}` : '—'}</td>
                        <MoveCell v={isNum(e.ndx) ? Math.expm1(e.ndx) : null} />
                        <MoveCell v={isNum(e.sox) ? Math.expm1(e.sox) : null} />
                        <MoveCell v={isNum(e.nifty) ? Math.expm1(e.nifty) : null} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Note>INR depreciation = log change of USD/INR (+ = weaker rupee); index moves shown as simple returns. COMPUTED from Yahoo Finance closes.</Note>
            </>
          ) : (
            <Empty note="fx section missing" />
          )}
        </Section>
      </div>
    </div>
  );
}
