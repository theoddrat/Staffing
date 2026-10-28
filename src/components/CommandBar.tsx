// Command bar: `> CAPEX -30 <GO>`; Enter runs, ↑/↓ history, Tab accepts first suggestion.
import { useEffect, useMemo, useRef, useState } from 'react';
import { suggest, type ParseContext } from '../commands/parse';

const HISTORY_KEY = 'acm.cmdHistory';

function loadHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(-50) : [];
  } catch {
    return [];
  }
}

function saveHistory(h: string[]) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-50)));
  } catch {
    /* storage unavailable: history stays in memory */
  }
}

export default function CommandBar({ ctx, onGo, focusKey }: { ctx: ParseContext; onGo: (cmd: string) => void; focusKey?: number }) {
  const [value, setValue] = useState('');
  const [hist, setHist] = useState<string[]>(() => loadHistory());
  const [cursor, setCursor] = useState<number | null>(null);
  const [showHints, setShowHints] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hints = useMemo(() => suggest(value, ctx, 8), [value, ctx]);

  useEffect(() => {
    if (focusKey != null) input.current?.focus();
  }, [focusKey]);

  const run = (cmd?: string) => {
    const c = (cmd ?? value).trim();
    if (!c) return;
    onGo(c);
    const next = [...hist.filter((x) => x !== c), c];
    setHist(next);
    saveHistory(next);
    setValue('');
    setCursor(null);
    setShowHints(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      run();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hist.length) return;
      const i = cursor == null ? hist.length - 1 : Math.max(0, cursor - 1);
      setCursor(i);
      setValue(hist[i]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (cursor == null) return;
      const i = cursor + 1;
      if (i >= hist.length) {
        setCursor(null);
        setValue('');
      } else {
        setCursor(i);
        setValue(hist[i]);
      }
    } else if (e.key === 'Tab') {
      if (hints.length) {
        e.preventDefault();
        setValue(hints[0] + ' ');
      }
    } else if (e.key === 'Escape') {
      setShowHints(false);
      input.current?.blur();
    }
  };

  return (
    <div className="cmd-bar">
      <span className="cmd-prompt">CMD&gt;</span>
      <div className="cmd-input-wrap">
        <input
          ref={input}
          className="cmd-input"
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder="NVDA · CAPEX -30 · REPLAY DOTCOM · INDIA TIER C · POP 12M · HELP"
          onChange={(e) => {
            setValue(e.target.value.toUpperCase());
            setShowHints(true);
            setCursor(null);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setShowHints(true)}
          onBlur={() => setTimeout(() => setShowHints(false), 150)}
          aria-label="command"
        />
        {!value && <span className="cmd-cursor">▌</span>}
        {showHints && hints.length > 0 && (
          <ul className="cmd-hints">
            {hints.map((h) => (
              <li key={h} onMouseDown={(e) => e.preventDefault()} onClick={() => setValue(h + ' ')}>
                {h}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button className="go-btn" onClick={() => run()} title="Run command (Enter)">
        &lt;GO&gt;
      </button>
    </div>
  );
}
