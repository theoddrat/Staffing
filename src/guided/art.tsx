// Inline SVG illustrations for the guided UI: one per scenario card, one per tour step, and the
// small "how a shock reaches India" strip on the home page. Pure shapes + the shared icon set;
// nothing here encodes data (no numbers), so the pictures can never contradict the model.
import type { ReactNode } from 'react';
import { Icon } from './icons';
import type { ScenarioCopy } from './lib/scenarios';

function At({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return <g transform={`translate(${x} ${y})`}>{children}</g>;
}

function Frame({ children, label, w = 160, h = 100 }: { children: ReactNode; label?: string; w?: number; h?: number }) {
  return (
    <svg className="g-art" viewBox={`0 0 ${w} ${h}`} role={label ? 'img' : 'presentation'} aria-label={label} aria-hidden={label ? undefined : true}>
      {children}
    </svg>
  );
}

function ArtFullpop() {
  return (
    <Frame>
      <circle cx="78" cy="46" r="30" className="a-bubble" />
      <path d="M62 34a17 17 0 0 1 12-9" className="a-shine" />
      <text x="78" y="53" textAnchor="middle" className="a-word">AI</text>
      <path d="M106 22l9-9M112 32l12-2M101 15l2-11" className="a-rays" />
      <path d="M57 84l4 7h-8zM96 86l6 5-7 2zM78 92l3 5h-6z" className="a-shard" />
      <At x={12} y={58}>
        <Icon name="trendDown" size={28} color="var(--g-down)" />
      </At>
    </Frame>
  );
}

function ArtCapex() {
  return (
    <Frame>
      <At x={10} y={18}>
        <Icon name="cloud" size={46} color="var(--ch-parent)" />
      </At>
      <At x={108} y={24}>
        <Icon name="server" size={42} color="var(--ch-capex)" />
      </At>
      <path d="M58 44C76 44 86 46 104 46" className="a-pipe" />
      <circle cx="74" cy="44" r="7.5" className="a-coin" />
      <text x="74" y="47.5" textAnchor="middle" className="a-coin-t">$</text>
      <circle cx="92" cy="45.5" r="5" className="a-coin is-small" />
      <At x={70} y={60}>
        <Icon name="trendDown" size={24} color="var(--g-down)" />
      </At>
    </Frame>
  );
}

function ArtGuidance() {
  return (
    <Frame>
      <At x={14} y={36}>
        <Icon name="chip" size={48} color="var(--g-accent)" />
      </At>
      <path d="M78 14h60a8 8 0 0 1 8 8v28a8 8 0 0 1-8 8H96l-12 11V58h-6a8 8 0 0 1-8-8V22a8 8 0 0 1 8-8z" className="a-speech" />
      <path d="M84 26l14 8 10-5 18 17" className="a-down" />
      <path d="M118 46h8v-8" className="a-down" />
      <At x={74} y={74}>
        <Icon name="chip" size={18} color="var(--g-faint)" />
      </At>
      <At x={100} y={78}>
        <Icon name="chip" size={14} color="var(--g-faint)" />
      </At>
    </Frame>
  );
}

function ArtRestatement() {
  return (
    <Frame>
      <rect x="34" y="12" width="58" height="76" rx="6" className="a-doc" />
      <path d="M44 28h38M44 38h38M44 48h26M44 58h32M44 68h20" className="a-lines" />
      <circle cx="102" cy="58" r="17" className="a-lens" />
      <path d="M114 70l15 15" className="a-handle" />
      <path d="M96 52l12 12M108 52l-12 12" className="a-x" />
    </Frame>
  );
}

function ArtMultiple() {
  return (
    <Frame>
      <At x={10} y={18}>
        <Icon name="tag" size={60} color="var(--g-faint)" />
      </At>
      <text x="38" y="94" textAnchor="middle" className="a-cap">P/E before</text>
      <path d="M78 48h20M92 42l6 6-6 6" className="a-arrow" />
      <At x={108} y={32}>
        <Icon name="tag" size={34} color="var(--ch-premium)" />
      </At>
      <text x="126" y="84" textAnchor="middle" className="a-cap">after</text>
    </Frame>
  );
}

function ArtCredit() {
  return (
    <Frame>
      <At x={10} y={26}>
        <Icon name="bank" size={48} color="var(--ch-credit)" />
      </At>
      <At x={62} y={12}>
        <Icon name="trendUp" size={28} color="var(--g-down)" />
      </At>
      <text x="76" y="62" textAnchor="middle" className="a-pct">%</text>
      <At x={106} y={34}>
        <Icon name="server" size={38} color="var(--g-muted)" />
      </At>
      <At x={113} y={74}>
        <Icon name="trendDown" size={20} color="var(--g-down)" />
      </At>
    </Frame>
  );
}

function ArtReplay() {
  return (
    <Frame>
      <At x={12} y={24}>
        <Icon name="clock" size={50} color="var(--g-accent)" />
      </At>
      <path d="M14 26A30 30 0 0 1 40 12" className="a-rewind" />
      <path d="M12 17v10h10" className="a-rewind" />
      <path d="M78 26l10 7 8-4 10 19 8-3 18 30" className="a-crash" />
      <path d="M76 86h70" className="a-axis" />
    </Frame>
  );
}

const SCENARIO_ART: Record<ScenarioCopy['art'], () => ReactNode> = {
  fullpop: ArtFullpop,
  capex: ArtCapex,
  guidance: ArtGuidance,
  restatement: ArtRestatement,
  multiple: ArtMultiple,
  credit: ArtCredit,
  replay: ArtReplay,
};

export function ScenarioArt({ art }: { art: ScenarioCopy['art'] }) {
  const A = SCENARIO_ART[art] ?? ArtFullpop;
  return <A />;
}

// ───────────────────────── tour ─────────────────────────

function TourWhatIf() {
  return (
    <Frame w={320} h={160} label="A shock that starts with US AI stocks travels to Indian listed companies">
      <rect x="10" y="34" width="104" height="92" rx="12" className="a-panel" />
      <text x="62" y="54" textAnchor="middle" className="a-cap">US AI stocks</text>
      <At x={26} y={66}>
        <Icon name="chip" size={30} color="var(--g-accent)" />
      </At>
      <At x={66} y={66}>
        <Icon name="cloud" size={30} color="var(--ch-parent)" />
      </At>
      <At x={50} y={98}>
        <Icon name="trendDown" size={22} color="var(--g-down)" />
      </At>
      <path d="M124 80h68" className="a-flowline" />
      <path d="M184 72l9 8-9 8" className="a-arrowhead" />
      <rect x="128" y="18" width="62" height="22" rx="11" className="a-tag" />
      <text x="159" y="33" textAnchor="middle" className="a-tag-t">WHAT IF?</text>
      <rect x="206" y="34" width="104" height="92" rx="12" className="a-panel" />
      <text x="258" y="54" textAnchor="middle" className="a-cap">Indian companies</text>
      <At x={222} y={66}>
        <Icon name="building" size={30} color="var(--tier-a)" />
      </At>
      <At x={262} y={66}>
        <Icon name="laptop" size={30} color="var(--tier-b)" />
      </At>
      <At x={242} y={98}>
        <Icon name="server" size={22} color="var(--tier-c)" />
      </At>
    </Frame>
  );
}

function TourPick() {
  const card = (x: number, icon: string, on: boolean) => (
    <g>
      <rect x={x} y="18" width="88" height="86" rx="10" className={on ? 'a-card is-on' : 'a-card'} />
      <At x={x + 30} y={34}>
        <Icon name={icon} size={28} color={on ? 'var(--g-accent)' : 'var(--g-muted)'} />
      </At>
      <rect x={x + 12} y="72" width="64" height="6" rx="3" className="a-stub" />
      <rect x={x + 12} y="84" width="44" height="6" rx="3" className="a-stub" />
    </g>
  );
  return (
    <Frame w={320} h={160} label="Scenario cards with Mild, Severe and Extreme choices">
      {card(12, 'server', false)}
      {card(116, 'pulse', true)}
      {card(220, 'tag', false)}
      {['Mild', 'Severe', 'Extreme'].map((t, i) => (
        <g key={t}>
          <rect x={86 + i * 52} y="118" width="48" height="24" rx="12" className={i === 1 ? 'a-pill is-on' : 'a-pill'} />
          <text x={110 + i * 52} y="134" textAnchor="middle" className={i === 1 ? 'a-pill-t is-on' : 'a-pill-t'}>
            {t}
          </text>
        </g>
      ))}
    </Frame>
  );
}

function TourWho() {
  const rows = [0.82, 0.6, 0.44, 0.3];
  return (
    <Frame w={320} h={160} label="Companies ranked by how far they could fall, each with a likely range">
      {rows.map((w, i) => {
        const y = 22 + i * 34;
        const x0 = 300;
        return (
          <g key={i}>
            <rect x="14" y={y + 2} width="70" height="8" rx="4" className="a-stub" />
            <rect x="14" y={y + 15} width="46" height="6" rx="3" className="a-stub is-dim" />
            <path d={`M${x0 - w * 220 - 24} ${y + 10}H${Math.min(x0 + 4, x0 - w * 220 + 70)}`} className="a-whisker" />
            <rect x={x0 - w * 200} y={y + 4} width={w * 200} height="12" rx="4" className="a-fall" />
            <path d={`M${x0} ${y}v20`} className="a-zero" />
          </g>
        );
      })}
    </Frame>
  );
}

function TourSpread() {
  const ribbons = [
    ['M40 30C120 30 120 40 160 40', 'var(--g-accent)', 14],
    ['M40 70C120 70 120 86 160 86', 'var(--ch-fpi)', 10],
    ['M40 112C120 112 120 124 160 124', 'var(--ch-parent)', 8],
    ['M172 40C240 40 240 30 288 30', 'var(--g-accent)', 9],
    ['M172 46C240 46 240 76 288 76', 'var(--g-accent)', 5],
    ['M172 86C240 86 240 82 288 82', 'var(--ch-fpi)', 10],
    ['M172 124C240 124 240 120 288 120', 'var(--ch-parent)', 8],
  ] as const;
  return (
    <Frame w={320} h={160} label="Ribbons show how the shock travels from US companies through channels to Indian companies">
      {ribbons.map(([d, c, w], i) => (
        <path key={i} d={d} stroke={c} strokeWidth={w} className="a-ribbon" />
      ))}
      {[22, 62, 104].map((y, i) => (
        <rect key={i} x="28" y={y} width="12" height={[18, 16, 16][i]} rx="2" className="a-node" />
      ))}
      {[32, 80, 118].map((y, i) => (
        <rect key={i} x="160" y={y} width="12" height={[20, 12, 12][i]} rx="2" className="a-node" />
      ))}
      {[24, 72, 114].map((y, i) => (
        <rect key={i} x="288" y={y} width="12" height={[14, 16, 12][i]} rx="2" className="a-node" />
      ))}
    </Frame>
  );
}

function TourSure() {
  return (
    <Frame w={320} h={160} label="Every estimate comes with a likely range, a confidence rating and source tags">
      <path d="M30 52H290" className="a-track" />
      <path d="M70 52H250" className="a-whisker is-strong" />
      <path d="M70 44v16M250 44v16" className="a-whisker is-strong" />
      <rect x="130" y="45" width="60" height="14" rx="4" className="a-fall" />
      <circle cx="130" cy="52" r="7" className="a-dot" />
      <text x="160" y="30" textAnchor="middle" className="a-cap">likely range (9 in 10 simulations)</text>
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={46 + i * 18} cy="104" r="6" className={i < 2 ? 'a-cdot is-on' : 'a-cdot'} />
      ))}
      <text x="104" y="108" className="a-cap">confidence</text>
      <rect x="190" y="92" width="64" height="22" rx="11" className="a-badge is-src" />
      <text x="222" y="107" textAnchor="middle" className="a-badge-t">Sourced</text>
      <rect x="190" y="122" width="88" height="22" rx="11" className="a-badge is-ass" />
      <text x="234" y="137" textAnchor="middle" className="a-badge-t">Assumption</text>
    </Frame>
  );
}

export const TOUR_ART = { TourWhatIf, TourPick, TourWho, TourSpread, TourSure };
