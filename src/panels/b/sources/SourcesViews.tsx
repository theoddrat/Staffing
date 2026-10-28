// F6 / sub-views: sources table, ticker verification log, data provenance & labelling legend.
import { useMemo, useState } from 'react';
import type { DataBundle, Source } from '../../../types/data';
import { SourceLinks } from '../../../components/StatusBadge';
import { isNum, num } from '../../../lib/format';
import { Empty, Note, Section, StatusLegend, VerificationBadge } from '../common';
import { hostOf, sourceUsage } from '../util';

export function SourcesTable({ bundle }: { bundle: DataBundle }) {
  const [q, setQ] = useState('');
  const [ver, setVer] = useState<'all' | Source['verification']>('all');
  const [openUse, setOpenUse] = useState<string | null>(null);
  const { usage, missing } = useMemo(() => sourceUsage(bundle), [bundle]);
  const sources = bundle.sources ?? [];
  const filtered = sources.filter((s) => {
    if (ver !== 'all' && s.verification !== ver) return false;
    if (!q) return true;
    const hay = `${s.id} ${s.title} ${s.publisher ?? ''} ${s.quote ?? ''} ${s.url} ${s.note ?? ''}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });
  const counts = sources.reduce((acc, s) => ({ ...acc, [s.verification]: (acc[s.verification] ?? 0) + 1 }), {} as Record<string, number>);

  return (
    <Section
      title={`Sources — ${sources.length} documents (${counts.PRIMARY ?? 0} primary · ${counts.SECONDARY ?? 0} secondary · ${counts.UNVERIFIED ?? 0} unverified)`}
    >
      <div className="b-toolbar">
        <input className="b-search" type="text" placeholder="search id, title, quote, url…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label>verification</label>
        <select value={ver} onChange={(e) => setVer(e.target.value as typeof ver)}>
          <option value="all">all</option>
          <option value="PRIMARY">PRIMARY</option>
          <option value="SECONDARY">SECONDARY</option>
          <option value="UNVERIFIED">UNVERIFIED</option>
        </select>
        <span className="muted">
          showing {filtered.length} / {sources.length}
        </span>
      </div>
      {missing.size ? (
        <div className="b-bad" style={{ marginBottom: 4 }}>
          ⚠ {missing.size} source id{missing.size === 1 ? ' is' : 's are'} cited but missing from the source list:{' '}
          {[...missing.entries()].map(([id, where]) => (
            <span key={id} className="b-chip" title={where.join('\n')}>
              {id} ({where.length})
            </span>
          ))}
        </div>
      ) : (
        <div className="b-note">Integrity check: every cited source id resolves to an entry below.</div>
      )}
      <div className="b-scroll-lg" style={{ maxHeight: 720 }}>
        <table className="tbl b-tbl">
          <thead>
            <tr>
              <th>ID</th>
              <th className="wrap">TITLE / PUBLISHER</th>
              <th>DATE</th>
              <th>VERIFICATION</th>
              <th className="wrap">VERBATIM QUOTE</th>
              <th>LINK</th>
              <th className="num">USED BY</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const used = usage.get(s.id) ?? [];
              return (
                <tr key={s.id}>
                  <td className="lbl">{s.id}</td>
                  <td className="txt white">
                    {s.title}
                    {s.publisher ? <div className="muted">{s.publisher}</div> : null}
                    {s.note ? <div className="muted">note: {s.note}</div> : null}
                  </td>
                  <td>
                    {s.date ?? '—'}
                    <div className="muted">read {s.accessed}</div>
                  </td>
                  <td>
                    <VerificationBadge v={s.verification} />
                  </td>
                  <td className="quote">{s.quote ? `“${s.quote}”` : <span className="muted">—</span>}</td>
                  <td>
                    <a href={s.url} target="_blank" rel="noreferrer" title={s.url}>
                      {hostOf(s.url)}
                    </a>
                  </td>
                  <td className="num">
                    {used.length ? (
                      <button className="b-chip" onClick={() => setOpenUse(openUse === s.id ? null : s.id)} title={used.join('\n')}>
                        {used.length}
                      </button>
                    ) : (
                      <span className="muted" title="not referenced by any number in this build">0</span>
                    )}
                    {openUse === s.id ? (
                      <div className="muted" style={{ textAlign: 'left', whiteSpace: 'normal', maxWidth: 260 }}>
                        {used.map((u) => (
                          <div key={u}>{u}</div>
                        ))}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!filtered.length ? (
              <tr>
                <td colSpan={7} className="muted">
                  — no sources match
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Note>
        PRIMARY = read in the company's / regulator's own document (10-K, 20-F, 6-K, CFO commentary, fact sheet, exchange filing). SECONDARY =
        reputable outlet or broker citing company data. UNVERIFIED = single weak source or conflicting reports. Quotes are verbatim excerpts.
      </Note>
    </Section>
  );
}

export function TickerLog({ bundle }: { bundle: DataBundle }) {
  const log = bundle.meta?.ticker_log ?? [];
  const counts = log.reduce((acc, e) => ({ ...acc, [e.action]: (acc[e.action] ?? 0) + 1 }), {} as Record<string, number>);
  if (!log.length) return <Empty note="meta.ticker_log is empty" />;
  const order: Record<string, number> = { dropped: 0, fixed: 1, warning: 2, ok: 3 };
  const rows = [...log].sort((a, b) => (order[a.action] ?? 9) - (order[b.action] ?? 9) || a.requested.localeCompare(b.requested));
  return (
    <Section
      title={`Ticker verification log — ${log.length} requested · ${counts.ok ?? 0} ok · ${counts.fixed ?? 0} fixed · ${counts.dropped ?? 0} dropped · ${counts.warning ?? 0} warnings`}
    >
      <div className="b-scroll-lg" style={{ maxHeight: 720 }}>
        <table className="tbl b-tbl">
          <thead>
            <tr>
              <th>REQUESTED</th>
              <th>RESOLVED</th>
              <th>ACTION</th>
              <th className="wrap">NOTE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <tr key={`${e.requested}-${i}`}>
                <td className="lbl">{e.requested}</td>
                <td className="white">{e.resolved ?? '—'}</td>
                <td className={e.action === 'dropped' ? 'b-bad' : e.action === 'fixed' || e.action === 'warning' ? 'b-warn' : 'up'}>{e.action.toUpperCase()}</td>
                <td className="txt">{e.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Note>Every ticker in universe.yaml is checked against yfinance at build time; fixes and drops are logged here, never silently applied.</Note>
    </Section>
  );
}

const WARN_PREVIEW = 12;
const PROBLEM_RE = /(fail|error|missing|drop|stale|short|could not|unavailable|not found|no data|invalid|nan|skipp)/i;
export function isProblem(line: string): boolean {
  return PROBLEM_RE.test(line);
}

export function Provenance({ bundle }: { bundle: DataBundle }) {
  const [showAllWarn, setShowAllWarn] = useState(false);
  const m = bundle.meta;
  const settings = Object.entries(bundle.settings ?? {});
  const fx = Object.entries(m?.fx_rates_usd ?? {});
  return (
    <div className="b-grid-2">
      <div>
        <Section title="Build & data provenance">
          {m ? (
            <div className="b-kv">
              <span className="k">APP</span>
              <span className="v">
                {m.app ?? '—'} · schema v{m.schema_version ?? '—'}
              </span>
              <span className="k">BUILT AT</span>
              <span className="v">{m.built_at ?? '—'}</span>
              <span className="k">DATA AS OF (NSE)</span>
              <span className="v">{m.as_of ?? '—'}</span>
              <span className="k">DATA AS OF (US)</span>
              <span className="v">{m.as_of_us ?? '—'}</span>
              <span className="k">REGRESSION WINDOW</span>
              <span className="v">
                {m.regression_window?.start ?? '—'} → {m.regression_window?.end ?? '—'} · {num(m.regression_window?.years, 0)} years ·{' '}
                {num(m.regression_window?.n_india_days, 0)} NSE sessions
              </span>
              <span className="k">PRE-CHATGPT WINDOW</span>
              <span className="v">
                {m.pre_chatgpt?.window_start ?? '—'} → {m.pre_chatgpt?.window_end ?? '—'} (ChatGPT launch {m.pre_chatgpt?.date ?? '—'}){' '}
                <SourceLinks ids={m.pre_chatgpt?.src ?? []} bundle={bundle} />
              </span>
              <span className="k">USD/INR</span>
              <span className="v">{num(m.usd_inr, 2)}</span>
              {fx.length ? (
                <>
                  <span className="k">FX (USD per unit)</span>
                  <span className="v">
                    {fx.map(([ccy, v]) => (
                      <span key={ccy} className="b-chip">
                        {ccy} {isNum(v) ? v.toPrecision(4) : '—'}
                      </span>
                    ))}
                  </span>
                </>
              ) : null}
              <span className="k">CALENDAR ALIGNMENT</span>
              <span className="v">
                {m.alignment?.rule ?? '—'}
                <div className="muted">
                  US-holiday zero days: {num(m.alignment?.us_holiday_zero_days, 0)} · India-holiday accumulations: {num(m.alignment?.india_holiday_accumulations, 0)}
                </div>
              </span>
            </div>
          ) : (
            <Empty note="meta missing" />
          )}
        </Section>
        <Section title="Data sources">
          {m?.data_sources?.length ? (
            <table className="tbl b-tbl">
              <tbody>
                {m.data_sources.map((d) => (
                  <tr key={d.name}>
                    <td className="lbl">{d.name}</td>
                    <td>
                      <a href={d.url} target="_blank" rel="noreferrer">
                        {hostOf(d.url)}
                      </a>
                    </td>
                    <td className="txt white">{d.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty note="meta.data_sources is empty" />
          )}
        </Section>
        <Section
          title={`Build log & warnings (${m?.warnings?.length ?? 0})`}
          right={
            (m?.warnings?.length ?? 0) > WARN_PREVIEW ? (
              <button className="b-chip" onClick={() => setShowAllWarn((v) => !v)}>
                {showAllWarn ? 'show fewer' : `show all ${m!.warnings.length}`}
              </button>
            ) : null
          }
        >
          {m?.warnings?.length ? (
            <ul className="b-list">
              {[...m.warnings]
                .sort((a, b) => Number(isProblem(b)) - Number(isProblem(a)))
                .slice(0, showAllWarn ? undefined : WARN_PREVIEW)
                .map((w, i) => (
                  <li key={i} className={isProblem(w) ? 'b-warn' : 'muted'}>
                    {w}
                  </li>
                ))}
            </ul>
          ) : (
            <span className="muted">none</span>
          )}
          <Note>Orange = a data problem worth checking (missing, failed, dropped, stale, short history); grey = informational build log (e.g. research-overlay sources applied).</Note>
        </Section>
      </div>
      <div>
        <Section title="How numbers are labelled">
          <StatusLegend />
          <Note>
            Scenarios are HYPOTHETICAL: they are stress tests of a model, not forecasts. Historical moves and betas describe the past, which may not
            repeat. Educational model. Not investment advice.
          </Note>
        </Section>
        <Section title={`Model settings (${settings.length})`}>
          {settings.length ? (
            <table className="tbl b-tbl">
              <tbody>
                {settings.map(([k, v]) => (
                  <tr key={k}>
                    <td className="lbl">{k}</td>
                    <td className="white">{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty note="settings missing" />
          )}
        </Section>
      </div>
    </div>
  );
}
