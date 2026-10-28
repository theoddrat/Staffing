// F4 / CASES — historical bubble crashes & accounting scandals, with computed or sourced drawdowns.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { DataBundle, Drawdown, HistoryCase } from '../../../types/data';
import { SourceLinks, StatusBadge } from '../../../components/StatusBadge';
import { isNum, num, pct } from '../../../lib/format';
import { CrashTags, Empty, Note } from '../common';
import { caseStartKey, LATER_EVENTS_AFTER } from '../historyUtil';

function DrawdownCell({ d }: { d: Drawdown | undefined }) {
  if (!d) return <td className="num muted">—</td>;
  return (
    <td className="num">
      <span className={isNum(d.drawdown) && d.drawdown < 0 ? 'down' : 'white'}>{pct(d.drawdown, 1)}</span>
      <span className="muted"> {d.label}</span>
      <StatusBadge status={d.status} />
    </td>
  );
}

function recoverText(d: Drawdown | undefined, asOf: string): string {
  if (!d) return '—';
  if (isNum(d.days_to_recover)) return `${num(d.days_to_recover, 0)} d${d.recovered_date ? ` (${d.recovered_date})` : ''}`;
  if (d.trough_date) return `not recovered (as of ${asOf})`;
  return '—';
}

function DrawdownTable({ rows, bundle }: { rows: Drawdown[]; bundle: DataBundle }) {
  if (!rows.length) return <Empty note="no drawdown rows for this case" />;
  return (
    <table className="tbl b-tbl">
      <thead>
        <tr>
          <th>SERIES</th>
          <th>PEAK</th>
          <th className="num">PEAK LVL</th>
          <th>TROUGH</th>
          <th className="num">TROUGH LVL</th>
          <th className="num">PEAK→TROUGH</th>
          <th className="num">DAYS TO BOTTOM</th>
          <th>TIME TO RECOVER</th>
          <th>STATUS / SOURCE</th>
          <th className="wrap">NOTE</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d, i) => (
          <tr key={`${d.label}-${i}`}>
            <td className="lbl">
              {d.label}
              {d.ticker && d.ticker !== d.label ? <span className="muted"> {d.ticker}</span> : null}
            </td>
            <td>{d.peak_date ?? '—'}</td>
            <td className="num">{num(d.peak, 2)}</td>
            <td>{d.trough_date ?? '—'}</td>
            <td className="num">{num(d.trough, 2)}</td>
            <td className={`num ${isNum(d.drawdown) && d.drawdown < 0 ? 'down' : ''}`}>{pct(d.drawdown, 1)}</td>
            <td className="num">{isNum(d.days_to_bottom) ? `${num(d.days_to_bottom, 0)} d` : '—'}</td>
            <td>{recoverText(d, bundle.meta.as_of)}</td>
            <td>
              <StatusBadge status={d.status} />
              <SourceLinks ids={d.src ?? []} bundle={bundle} />
            </td>
            <td className="txt muted">{d.note ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CaseDetail({ c, bundle }: { c: HistoryCase; bundle: DataBundle }) {
  return (
    <div className="b-case-detail">
      <div className="b-kv" style={{ marginBottom: 6 }}>
        <span className="k">WHAT BROKE</span>
        <span className="v">{c.what_broke || '—'}</span>
        <span className="k">LINKED COMPANIES</span>
        <span className="v">{c.linked || '—'}</span>
        <span className="k">INDIA</span>
        <span className="v">{c.india || '—'}</span>
        {c.notes?.length ? (
          <>
            <span className="k">NOTES</span>
            <span className="v">
              <ul className="b-list">
                {c.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </span>
          </>
        ) : null}
        <span className="k">SOURCES</span>
        <span className="v">
          {c.src?.length ? <SourceLinks ids={c.src} bundle={bundle} /> : <span className="muted">computed from market data only</span>}
        </span>
      </div>
      <DrawdownTable rows={c.drawdowns ?? []} bundle={bundle} />
    </div>
  );
}

export default function CasesTable({
  bundle,
  focusCaseId,
}: {
  bundle: DataBundle;
  focusCaseId: string | null;
}) {
  const cases = bundle.history?.cases ?? [];
  const [open, setOpen] = useState<Set<string>>(() => new Set(focusCaseId ? [focusCaseId] : []));
  const focusRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (!focusCaseId) return;
    setOpen((prev) => new Set(prev).add(focusCaseId));
    const t = window.setTimeout(() => focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
    return () => window.clearTimeout(t);
  }, [focusCaseId]);

  const groups = useMemo(() => {
    const keyed = cases.map((c, i) => ({ c, i, key: caseStartKey(c.period) }));
    const hist = keyed.filter((k) => k.key <= LATER_EVENTS_AFTER);
    const later = keyed.filter((k) => k.key > LATER_EVENTS_AFTER);
    const byKey = (a: { key: string; i: number }, b: { key: string; i: number }) => (a.key === b.key ? a.i - b.i : a.key < b.key ? -1 : 1);
    return [
      { title: 'HISTORICAL BUBBLE CRASHES & ACCOUNTING SCANDALS', rows: hist.sort(byKey).map((k) => k.c) },
      { title: 'LATER AI DRAWDOWN EVENTS (AFTER THE DEEPSEEK SHOCK, FROM NEWS UP TO THE DATA DATE)', rows: later.sort(byKey).map((k) => k.c) },
    ].filter((g) => g.rows.length);
  }, [cases]);

  if (!cases.length) return <Empty note="history.cases is empty in data.json — run python build_data.py" />;

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <Note>
        Drawdowns are <b>COMPUTED</b> from daily closes where Yahoo Finance has the series; otherwise the figure is <b>SOURCED</b> (hover the [id]
        link for the verbatim quote). "Days" are trading days on the series' own calendar. Click a row to expand.
      </Note>
      <div className="b-scroll-lg">
        <table className="tbl b-tbl">
          <thead>
            <tr>
              <th />
              <th>CASE</th>
              <th>PERIOD</th>
              <th>CRASH TYPE</th>
              <th className="wrap">WHAT BROKE</th>
              <th className="num">HEADLINE PEAK→TROUGH</th>
              <th className="num">WORST LINKED</th>
              <th className="num">TO BOTTOM</th>
              <th>TO RECOVER</th>
              <th className="wrap">INDIA</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.title}>
                <tr className="grp">
                  <th colSpan={10}>{g.title}</th>
                </tr>
                {g.rows.map((c) => {
                  const dd = c.drawdowns ?? [];
                  const head = dd[0];
                  const worst = dd.filter((d) => isNum(d.drawdown)).sort((a, b) => (a.drawdown as number) - (b.drawdown as number))[0];
                  const isOpen = open.has(c.id);
                  const isFocus = c.id === focusCaseId;
                  return (
                    <Fragment key={c.id}>
                      <tr
                        className={`clickable${isFocus ? ' focus' : ''}`}
                        onClick={() => toggle(c.id)}
                        ref={isFocus ? focusRef : undefined}
                        id={`hist-case-${c.id}`}
                      >
                        <td className="b-caret">{isOpen ? '▾' : '▸'}</td>
                        <td className="lbl">
                          {c.name}
                          <span className="muted"> [{c.id}]</span>
                        </td>
                        <td>{c.period}</td>
                        <td>
                          <CrashTags types={c.crash_types} />
                        </td>
                        <td className="txt">{c.what_broke}</td>
                        <DrawdownCell d={head} />
                        {worst && worst !== head ? <DrawdownCell d={worst} /> : <td className="num muted">—</td>}
                        <td className="num">{head && isNum(head.days_to_bottom) ? `${num(head.days_to_bottom, 0)} d` : '—'}</td>
                        <td>{recoverText(head, bundle.meta.as_of)}</td>
                        <td className="txt">{c.india || '—'}</td>
                      </tr>
                      {isOpen ? (
                        <tr className="detail">
                          <td colSpan={10}>
                            <CaseDetail c={c} bundle={bundle} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
