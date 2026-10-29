// Registry of every Learn illustration, plus a guarded <Illustration> renderer.
import { Component, type ReactElement, type ReactNode } from 'react';
import { CarIll, ContagionIll, DrawdownIll, EventStudyIll } from './history';
import type { IllProps } from './kit';
import { BetaTotalIll, DownsideIll, ParentIll, RupeeIll } from './links';
import { BpsIll, CroreIll, IndexIll, McapIll } from './markets';
import {
  BubbleIll,
  CapexCutIll,
  CapexIll,
  CreditIll,
  FullPopIll,
  GuidanceIll,
  HorizonIll,
  HyperscalerIll,
  MultipleIll,
  ReplayIll,
  RestatementIll,
  ScenarioIll,
} from './scenario';
import { SourcesIll } from './sources';
import { BetaIll, ChannelsIll, FpiIll, FxIll, LagIll, OvernightIll, TiersIll } from './spread';
import { BacktestIll, CalibrationIll, ConfidenceIll, EnsembleIll, McFanIll, NowcastIll, OosIll, R2Ill, RangeIll } from './uncertainty';
import { EarIll, EpsIll, MarketFundIll, OpLevIll, PeIll, PremiumIll } from './value';

export const ILLUSTRATIONS = {
  // the scenario
  scenario: ScenarioIll,
  horizon: HorizonIll,
  bubble: BubbleIll,
  capex: CapexIll,
  capex_cut: CapexCutIll,
  hyperscaler: HyperscalerIll,
  guidance: GuidanceIll,
  restatement: RestatementIll,
  multiple: MultipleIll,
  credit: CreditIll,
  replay: ReplayIll,
  full_pop: FullPopIll,
  // markets & units
  index: IndexIll,
  overnight: OvernightIll,
  mcap: McapIll,
  crore: CroreIll,
  bps: BpsIll,
  // how it spreads
  channels: ChannelsIll,
  tiers: TiersIll,
  parent: ParentIll,
  beta: BetaIll,
  beta_total: BetaTotalIll,
  downside: DownsideIll,
  lag: LagIll,
  fpi: FpiIll,
  rupee: RupeeIll,
  fx: FxIll,
  // prices & earnings
  pe: PeIll,
  eps: EpsIll,
  premium: PremiumIll,
  op_lev: OpLevIll,
  ear: EarIll,
  market_fund: MarketFundIll,
  // uncertainty & accuracy
  mc_fan: McFanIll,
  range: RangeIll,
  confidence: ConfidenceIll,
  r2: R2Ill,
  oos: OosIll,
  backtest: BacktestIll,
  ensemble: EnsembleIll,
  calibration: CalibrationIll,
  nowcast: NowcastIll,
  // past crashes
  drawdown: DrawdownIll,
  car: CarIll,
  event_study: EventStudyIll,
  contagion: ContagionIll,
  // data & sources
  sources: SourcesIll,
} satisfies Record<string, (p: IllProps) => ReactElement>;

export type IllId = keyof typeof ILLUSTRATIONS;
export const ILL_IDS = Object.keys(ILLUSTRATIONS) as IllId[];

/** Never let one drawing take the page down: show a quiet placeholder instead. */
class IllBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <div className="lv-ill lv-ill-missing">{`Illustration unavailable (${this.props.label})`}</div>;
    return this.props.children;
  }
}

export function Illustration({ id, ...props }: { id: IllId } & IllProps) {
  const Draw = ILLUSTRATIONS[id];
  return (
    <IllBoundary label={id}>
      <Draw {...props} />
    </IllBoundary>
  );
}
