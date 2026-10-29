// Company search: names, display symbols or tickers → that company's story.
import { useId, useMemo, useRef, useState } from 'react';
import type { DataBundle } from '../types/data';
import type { ScenarioResult } from '../types/engine';
import { Icon } from './icons';
import { TIER_VIS } from './visual';
import { searchCompanies } from './lib/sort';
import { pct } from './lib/format';

export default function SearchBox({ bundle, result, onPick }: { bundle: DataBundle; result: ScenarioResult; onPick(ticker: string): void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const items = useMemo(() => searchCompanies(bundle.india, q, 8), [bundle, q]);
  const move = useMemo(() => new Map(result.india.map((r) => [r.ticker, r.market_move])), [result]);
  const show = open && q.trim().length > 0;

  const pick = (ticker: string) => {
    setQ('');
    setOpen(false);
    input.current?.blur();
    onPick(ticker);
  };

  return (
    <div className="g-search">
      <Icon name="search" size={16} className="g-search-icon" />
      <input
        ref={input}
        type="search"
        className="g-search-input"
        placeholder="Find a company (e.g. Infosys, NETWEB)"
        aria-label="Find a company"
        role="combobox"
        aria-expanded={show}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={show && items[hi] ? `${id}-${hi}` : undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setHi(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => Math.min(items.length - 1, h + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(0, h - 1));
          } else if (e.key === 'Enter' && items[hi]) {
            e.preventDefault();
            pick(items[hi].ticker);
          } else if (e.key === 'Escape') {
            setQ('');
            setOpen(false);
          }
        }}
      />
      {show && (
        <ul className="g-search-list" id={`${id}-list`} role="listbox" aria-label="Matching companies">
          {items.length === 0 && <li className="g-search-none">No company matches “{q.trim()}”. Try a name like Infosys or a symbol like TCS.</li>}
          {items.map((t, i) => {
            const m = move.get(t.ticker);
            const tv = TIER_VIS[t.tier];
            return (
              <li
                key={t.ticker}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === hi}
                className={i === hi ? 'is-hi' : ''}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(t.ticker);
                }}
              >
                <Icon name={tv.icon} size={16} color={tv.color} />
                <span className="g-search-name">{t.name}</span>
                <span className="g-search-sym">{t.display}</span>
                {typeof m === 'number' && <span className={`g-search-move ${m < 0 ? 'is-neg' : 'is-pos'}`}>{pct(m)}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
