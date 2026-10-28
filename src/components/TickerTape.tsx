// Scrolling ticker tape: last close + 1-day change for every name in bundle.tape. Pauses on hover.
import { memo, useMemo } from 'react';
import type { DataBundle } from '../types/data';
import { isNum, signClass, spct } from '../lib/format';

function fmtPrice(x: number | null, ccy: string): string {
  if (!isNum(x)) return '—';
  const digits = x >= 1000 ? 0 : x >= 10 ? 2 : 3;
  const sym = ccy === 'USD' ? '$' : ccy === 'INR' ? '₹' : ccy === 'EUR' ? '€' : ccy === 'JPY' ? '¥' : ccy === 'CHF' ? 'CHF ' : '';
  return `${sym}${x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function TickerTapeInner({ bundle, onPick }: { bundle: DataBundle; onPick: (ticker: string) => void }) {
  const items = useMemo(() => {
    const disp = new Map((bundle.india ?? []).map((t) => [t.ticker, t.display]));
    return (bundle.tape?.length ? bundle.tape : Object.keys(bundle.securities ?? {}))
      .map((t) => bundle.securities[t])
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => ({
        ticker: s.ticker,
        label: disp.get(s.ticker) ?? s.ticker,
        px: fmtPrice(s.last_close, s.currency),
        chg: s.chg_1d,
      }));
  }, [bundle]);
  if (!items.length) return <div className="tape tape-empty muted">TICKER TAPE: NO PRICES IN BUNDLE</div>;
  const dur = Math.max(40, items.length * 2.6);
  const row = items.map((it) => (
    <span key={it.ticker} className="tape-item" onClick={() => onPick(it.ticker)} title={`${it.ticker} — click for security page`}>
      <span className="tape-sym">{it.label}</span> <span className="white">{it.px}</span>{' '}
      <span className={signClass(it.chg)}>{spct(it.chg, 2)}</span>
    </span>
  ));
  return (
    <div className="tape" aria-label="ticker tape">
      <div className="tape-track" style={{ animationDuration: `${dur}s` }}>
        <div className="tape-seq">{row}</div>
        <div className="tape-seq" aria-hidden="true">
          {row}
        </div>
      </div>
    </div>
  );
}

export default memo(TickerTapeInner);
