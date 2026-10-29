// First-visit tour: five illustrated steps, skippable, re-openable from "How this works".
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DataBundle } from '../types/data';
import { Icon } from './icons';
import { TOUR_ART } from './art';

interface Step {
  title: string;
  text: ReactNode;
  art: ReactNode;
}

function steps(bundle: DataBundle): Step[] {
  const n = bundle.india.length;
  const us = bundle.origins.length;
  return [
    {
      title: 'A what-if simulator, not a forecast',
      text: (
        <>
          Imagine the AI boom deflates in the US. This tool estimates how that shock could reach <b>{n} Indian listed companies</b>
          — which ones get hit, through which links, and roughly how hard. Every scenario is <b>hypothetical</b>.
        </>
      ),
      art: <TOUR_ART.TourWhatIf />,
    },
    {
      title: '① Pick a scenario',
      text: (
        <>
          Choose what goes wrong — Big Tech cutting AI spending, an accounting scandal, a replay of a past crash… Then pick how
          strong (<b>Mild</b>, <b>Severe</b>, <b>Extreme</b>) and over how long (a day, a month or a year).
        </>
      ),
      art: <TOUR_ART.TourPick />,
    },
    {
      title: '② See who gets hit',
      text: (
        <>
          Each company gets a card: the likely fall, a thin line for the range of outcomes, the two biggest reasons and how much
          to trust the estimate. Tap a card for that company’s full story.
        </>
      ),
      art: <TOUR_ART.TourWho />,
    },
    {
      title: '③ Follow how it spreads',
      text: (
        <>
          A flow picture shows the path: from {us} US AI companies, through channels such as investor mood, parent companies,
          data-centre orders and the rupee, into Indian shares. Wider ribbons carry more rupees.
        </>
      ),
      art: <TOUR_ART.TourSpread />,
    },
    {
      title: '④ ⑤ Check history and accuracy',
      text: (
        <>
          Compare with real past crashes, and see how well the model did on days it had never seen. Every input is tagged{' '}
          <b>Sourced</b>, <b>Unverified</b> or <b>Assumption</b>, so you always know what is a fact and what is a guess.
        </>
      ),
      art: <TOUR_ART.TourSure />,
    },
  ];
}

export default function Tour({ bundle, onClose }: { bundle: DataBundle; onClose(): void }) {
  const list = steps(bundle);
  const [i, setI] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const last = i === list.length - 1;

  useEffect(() => {
    restore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.focus();
    return () => restore.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setI((x) => Math.min(list.length - 1, x + 1));
      else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      else if (e.key === 'Tab' && box.current) {
        // keep focus inside the dialog
        const f = box.current.querySelectorAll<HTMLElement>('button');
        if (!f.length) return;
        const first = f[0];
        const end = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          end.focus();
        } else if (!e.shiftKey && document.activeElement === end) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list.length, onClose]);

  const s = list[i];
  return (
    <div className="g-overlay" onClick={onClose}>
      <div
        className="g-tour"
        role="dialog"
        aria-modal="true"
        aria-labelledby="g-tour-title"
        aria-describedby="g-tour-text"
        tabIndex={-1}
        ref={box}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="g-tour-art">{s.art}</div>
        <div className="g-tour-body">
          <p className="g-tour-count">
            Step {i + 1} of {list.length}
          </p>
          <h2 id="g-tour-title" className="g-tour-title">
            {s.title}
          </h2>
          <p id="g-tour-text" className="g-tour-text">
            {s.text}
          </p>
          <div className="g-tour-dots" aria-hidden="true">
            {list.map((_, k) => (
              <span key={k} className={k === i ? 'is-on' : ''} />
            ))}
          </div>
          <div className="g-tour-actions">
            <button type="button" className="g-btn g-btn-ghost" onClick={onClose}>
              Skip tour
            </button>
            <span className="g-grow" />
            {i > 0 && (
              <button type="button" className="g-btn g-btn-ghost" onClick={() => setI(i - 1)}>
                Back
              </button>
            )}
            <button type="button" className="g-btn g-btn-primary" onClick={() => (last ? onClose() : setI(i + 1))}>
              {last ? 'Start exploring' : 'Next'}
              <Icon name="arrowRight" size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
