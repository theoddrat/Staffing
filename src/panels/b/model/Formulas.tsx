// F5 / FORMULAS — every layer of the model rendered with KaTeX (DESIGN.md §3.3 and §4).
import type { ReactNode } from 'react';
import type { DataBundle } from '../../../types/data';
import Formula from '../../../components/Formula';
import { SourceLinks } from '../../../components/StatusBadge';
import { isNum, num, pct } from '../../../lib/format';
import { Section } from '../common';

interface Block {
  title: string;
  tex: string[];
  notes?: ReactNode[];
}

function FormulaBlock({ b }: { b: Block }) {
  return (
    <div className="b-formula">
      <div className="b-formula-title">{b.title}</div>
      {b.tex.map((t, i) => (
        <Formula key={i} tex={t} />
      ))}
      {b.notes?.length ? (
        <ul className="b-list">
          {b.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const L1: Block[] = [
  {
    title: 'Layer 1 · valuation identity and origin move',
    tex: [
      String.raw`P = \text{P/E}\times\text{EPS}`,
      String.raw`\text{Move} = (1-e)(1-d) - 1`,
      String.raw`P_0 \;\longrightarrow\; P_0(1-e) \;\longrightarrow\; P_0(1-e)(1-d),\qquad \Delta M_{USD}=M_{0}\cdot\text{Move},\quad \Delta M_{INR}=\Delta M_{USD}\cdot S_{USD/INR}`,
    ],
    notes: [
      <>e = earnings (EPS) cut, d = multiple de-rating; the waterfall in F1 / the security page is price → EPS cut → de-rating → new price.</>,
      <>Several shock components combine multiplicatively: (1−e) = Π(1−e<sub>k</sub>), (1−d) = Π(1−d<sub>k</sub>).</>,
    ],
  },
  {
    title: 'Shock 1 · hyperscaler capex cut → chipmakers / AI infra',
    tex: [
      String.raw`\text{RevHit}_j = c\cdot\psi_{\text{sup}}\cdot s_j,\qquad e_j=\min\!\left(\text{RevHit}_j\cdot OL_j,\;0.95\right),\qquad d_j=\kappa\,e_j`,
      String.raw`OL_j=\operatorname{clamp}\!\left(\frac{\Delta\text{EBIT}_j/\Delta\text{Rev}_j}{\text{EBIT}_j/\text{Rev}_j},\,1,\,4\right)\quad(\text{incremental}\,/\,\text{current margin})`,
      String.raw`\text{CapexCut}_{USD}=c\sum_{h\in\{MSFT,GOOGL,AMZN,META,ORCL\}}K^{TTM}_h,\qquad \text{absorbed}=\frac{\sum_j\text{RevHit}_j\,\text{Rev}^{TTM}_j}{\text{CapexCut}_{USD}}`,
    ],
    notes: [
      <>s<sub>j</sub> = share of j's revenue tied to hyperscaler capex, from 10-K customer-concentration / segment disclosures (F6); where only a segment share is disclosed, the hyperscaler fraction is a labelled USER ASSUMPTION.</>,
      <>K<sup>TTM</sup> = trailing-four-quarter capital expenditure from company cash-flow statements (COMPUTED). Hyperscalers themselves get e = d = 0 in this shock.</>,
    ],
  },
  {
    title: 'Shock 2 · chipmaker guidance cut, Shock 3 · accounting restatement',
    tex: [
      String.raw`e_{j^*}=\min\!\left(g\cdot OL_{j^*},\,0.95\right),\quad d_{j^*}=\kappa\,e_{j^*},\qquad x_k=\text{symp}\cdot\beta_{k\mid j^*}\,\ln\!\left(1+\text{Move}_{j^*}\right)`,
      String.raw`\text{Move}_{target}=(1-r)(1-d)-1,\qquad \text{Move}_k=\gamma\cdot\text{Move}_{target}\quad(k\ \text{same group / tier})`,
    ],
    notes: [
      <>β<sub>k|j*</sub> = same-day peer beta (COMPUTED); γ = contagion ratio calibrated on Super Micro (30-Oct-2024) for US names and Satyam (7-Jan-2009) for Indian names (see FACTORS &amp; FX).</>,
    ],
  },
  {
    title: 'Shock 4 · pure multiple compression (earnings unchanged)',
    tex: [
      String.raw`\text{PE}^{*}=\text{PE}_{now}+\lambda\left(\text{PE}_{pre}-\text{PE}_{now}\right)\quad\text{or}\quad \text{PE}^{*}=M,\qquad d=\max\!\left(0,\;1-\frac{\text{PE}^{*}}{\text{PE}_{now}}\right)`,
      String.raw`\text{PE}^{basket}=\frac{\sum_j M_j}{\sum_j E_j}\quad(\text{origins with positive EPS})`,
    ],
    notes: [<>PE<sub>pre</sub> = median P/E in the 3 years before 30-Nov-2022 (ChatGPT launch). The P/E-vs-drawdown fit in F4 is the calibration reference.</>],
  },
  {
    title: 'Shock 5 · AI credit event (LOW CONFIDENCE) · Shock 6 replay · Shock 7 full pop',
    tex: [
      String.raw`e_j=\min\!\left(\frac{\Delta s\cdot D\cdot\max(ND_j,0)}{M_j},\;0.9\right),\quad d_j=d_{credit}\qquad(\text{stressed borrowers, e.g. CRWV, ORCL})`,
      String.raw`\text{RevHit}^{sup}_j=k\cdot\psi_{\text{sup}}\cdot s^{neo}_j`,
      String.raw`\text{Replay: } x_{SOX},x_{NDX}=\text{actual log moves of the window};\qquad \text{Full pop}=1+4+5\ \text{over }1\text{D}/1\text{M}/12\text{M}`,
    ],
    notes: [<>Δs = spread widening, D = duration, ND = net debt, M = market cap. The credit channel is a crude value-transfer approximation — treat it as low confidence.</>],
  },
];

const FACTORS: Block[] = [
  {
    title: 'From origins to factors (log space)',
    tex: [
      String.raw`x_{chip}=\ln\!\sum_{j\in\text{chips}}w_j\,(1+\text{Move}_j),\qquad x_{SOX}=\beta_{SOX\mid chip}\,x_{chip},\qquad x_{NDX}=\beta_{NDX\mid AI}\,x_{AI}`,
      String.raw`x_P=\begin{cases}\ln(1+\text{Move}_P) & P\ \text{is a shock origin}\\[2pt] \beta^{D}_{P,SOX}\,x_{SOX}+\beta^{D}_{P,NDX}\,x_{NDX} & \text{otherwise (Dimson lag 0+1)}\end{cases}`,
      String.raw`x_N=c_{SOX}\,x_{SOX}+c_{NDX}\,x_{NDX},\qquad f=\max\!\left(0,\;\beta_{INR\mid NDX}\,x_{NDX}\right)\ \ (\text{or user override})`,
    ],
    notes: [<>w = latest market-cap weights. Simple moves for display: m = e<sup>x</sup> − 1.</>],
  },
];

function layer2(bundle: DataBundle): Block[] {
  const w = bundle.meta?.regression_window;
  const al = bundle.meta?.alignment;
  const q = bundle.settings?.downside_quantile;
  const qTxt = isNum(q) ? pct(q, 0) : '5%';
  return [
    {
      title: 'Layer 2 · market transmission (what Indian prices will likely do)',
      tex: [
        String.raw`r_{i,t}=a+b_{SOX}\,x_{SOX,t}+b_{NDX}\,x_{NDX,t}+b_P\,x_{P,t}+b_N\,r_{N,t}+\varepsilon_{i,t}`,
        String.raw`r_{N,t}=c_0+c_{SOX}\,x_{SOX,t}+c_{NDX}\,x_{NDX,t}+\varepsilon_{N,t}`,
        String.raw`\ln(1+m_i)=b_{SOX}\,x_{SOX}+b_{NDX}\,x_{NDX}+b_P\,x_P+b_N\,x_N\qquad(\text{scenario, no alpha})`,
      ],
      notes: [
        <>
          OLS on daily log returns over the regression window
          {w ? (
            <>
              {' '}
              <b>
                {w.start} → {w.end}
              </b>{' '}
              ({num(w.years, 0)}y, {num(w.n_india_days, 0)} NSE sessions)
            </>
          ) : null}
          ; t-stats are HAC (Newey–West, 5 lags). b<sub>P</sub> only for Tier A (Indian arm of a global parent).
        </>,
        <>Rolling betas: 252-session window stepped every 5 sessions, to test whether the AI linkage rose after 30-Nov-2022.</>,
      ],
    },
    {
      title: 'Information-set alignment (the "US t−1 lag")',
      tex: [String.raw`x_{F,t}=\sum_{\tau:\;C^{F}_{\tau}\,\in\,\left(C^{NSE}_{t^{-}},\;C^{NSE}_{t}\right]} r_{F,\tau}`],
      notes: [
        <>C = exchange close timestamp; t<sup>−</sup> = the previous NSE session. A foreign return enters the first NSE session that closes after it.</>,
        <>US (16:00 ET) and European (17:30 CET) closes of day d come after the NSE 15:30 IST close of d → they enter India's next session: the 1-day lag.</>,
        <>Tokyo closes at 15:30 JST = 12:00 IST, before NSE → a Tokyo close on day d enters India day d (same-day).</>,
        <>
          Foreign holiday (no foreign close in the interval) → 0, i.e. no new information
          {al ? ` (${num(al.us_holiday_zero_days, 0)} US-holiday zero days in the data)` : ''}; Indian holiday while the foreign market trades → returns
          accumulate into the next NSE session{al ? ` (${num(al.india_holiday_accumulations, 0)} accumulations)` : ''}.
        </>,
      ],
    },
    {
      title: 'Downside beta and total AI beta',
      tex: [
        String.raw`\text{Downside: same OLS on } \left\{t:\; x_{SOX,t}\le Q_{${isNum(q) ? q : 0.05}}\!\left(x_{SOX}\right)\right\}`,
        String.raw`\beta^{tot}_i=b_{SOX}+b_{NDX}\,m_{NDX\mid SOX}+b_P\,m_{P\mid SOX}+b_N\left(c_{SOX}+c_{NDX}\,m_{NDX\mid SOX}\right)`,
      ],
      notes: [<>Downside model uses only sessions whose aligned SOX move is in its worst {qTxt} (null if fewer than 25). m = co-movement slopes over the window.</>],
    },
  ];
}

function layer34(bundle: DataBundle): Block[] {
  const pc = bundle.meta?.pre_chatgpt;
  return [
    {
      title: 'Layer 3 · fundamental damage (what earnings should do)',
      tex: [
        String.raw`\text{EaR}_i=\min\!\Big(\sum_k \text{share}_{ik}\cdot\text{cut}_k\cdot OL_i,\;0.95\Big),\qquad \text{cut}_{rev}=\varphi_{IT}\,R_{tech},\quad \text{cut}_{capex}=\psi_{IN}\,c_{eff},\quad \text{cut}_{credit}=k`,
        String.raw`\text{prem}_i=\frac{\text{PE}_{i,now}}{\operatorname{median}_{t\,\in\,\text{pre-ChatGPT}}\ \text{PE}_{i,t}}-1,\qquad d_i=1-(1+\text{prem}_i)^{-\lambda_{IN}}\ \ (\ge 0\ \text{by default})`,
        String.raw`\text{Fund}^{gross}_i=(1-\text{EaR}_i)(1-d_i)-1`,
      ],
      notes: [
        <>Exposed shares (hi-tech vertical mix, data-centre share of revenue / order book) come from disclosures; if not disclosed they are labelled USER ASSUMPTION sliders (ASSUMPTIONS tab).</>,
        <>
          Pre-ChatGPT window{pc ? ` ${pc.window_start} → ${pc.window_end} (launch ${pc.date})` : ''}
          {pc?.src?.length ? (
            <>
              {' '}
              <SourceLinks ids={pc.src} bundle={bundle} />
            </>
          ) : null}
          ; P/E = split-adjusted close ÷ sum of the last four reported quarterly EPS (no look-ahead). R<sub>tech</sub> = mcap-weighted revenue hit of US tech clients.
        </>,
      ],
    },
    {
      title: 'Layer 4 · FX offset and the gap',
      tex: [
        String.raw`\text{fx}^{EPS}_i=\frac{(\text{sens}_i/10^{4})\cdot 100\,f}{m^{EBIT}_i},\qquad \text{Fund}^{net}_i=(1-\text{EaR}_i)(1-d_i)\left(1+\text{fx}^{EPS}_i\right)-1`,
        String.raw`\text{Gap}_i=m_i-\text{Fund}^{net}_i\qquad(<0\;\Rightarrow\;\text{market falls more than real damage: sentiment overreaction})`,
      ],
      notes: [<>Risk-off → FPI outflow → INR depreciation f; sens = EBIT-margin bps per 1% INR depreciation (30 bps for large IT exporters, sourced range 20–40 bps).</>],
    },
    {
      title: 'Monte Carlo (5,000 runs) and confidence score',
      tex: [
        String.raw`\ln\!\left(1+m^{(s)}_i\right)=\text{det}_i\!\left(\theta^{(s)}\right)+\sum_{h=1}^{H}\left(\varepsilon_{i,\tau^{(s)}_h}+b_{N,i}\,\varepsilon_{N,\tau^{(s)}_h}\right),\qquad \theta^{(s)}\sim\text{Tri}(\text{low},\text{base},\text{high})`,
        String.raw`\text{score}_i=100\left[0.5\,\min\!\left(\frac{R^2_i}{0.4},1\right)+0.5\,(1-A_i)\right]\cdot\min\!\left(1,\sqrt{n_i/250}\right)`,
      ],
      notes: [
        <>Shock sizes are sampled from triangular/uniform ranges (not normal); residuals are a joint bootstrap of historical dates (same dates for every stock and the Nifty, block length 5 for H ≥ 5), preserving fat tails and cross-correlation. p5 / p50 / p95 are reported.</>,
        <>A<sub>i</sub> = share of the fundamental result resting on USER ASSUMPTION / UNVERIFIED inputs. Grades: HIGH ≥ 70, MED ≥ 40, else LOW; credit and full-pop scenarios carry a low-confidence flag.</>,
      ],
    },
  ];
}

export default function Formulas({ bundle }: { bundle: DataBundle }) {
  return (
    <div className="b-formula-grid">
      <Section title="Layer 1 — origin impact">
        {L1.map((b) => (
          <FormulaBlock key={b.title} b={b} />
        ))}
        {FACTORS.map((b) => (
          <FormulaBlock key={b.title} b={b} />
        ))}
      </Section>
      <Section title="Layers 2–4 — transmission, fundamentals, FX, uncertainty">
        {layer2(bundle).map((b) => (
          <FormulaBlock key={b.title} b={b} />
        ))}
        {layer34(bundle).map((b) => (
          <FormulaBlock key={b.title} b={b} />
        ))}
      </Section>
    </div>
  );
}
