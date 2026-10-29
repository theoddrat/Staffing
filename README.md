# AI CRASH MONITOR

A terminal-style market simulator that models a **hypothetical** AI-bubble deflation starting in
US/global AI stocks (chips, hyperscalers, AI infrastructure, AI software) and shows which Indian
listed companies get hit, through which channel, and by how much — with the math on screen and the
evidence (historical bubble crashes and accounting scandals) one key away.

> **Every scenario is HYPOTHETICAL.** This is an educational model, not a forecast.
> **Educational model. Not investment advice.**

The look borrows from professional market terminals (black, amber monospace, function keys,
command bar). It is not affiliated with, and does not use the name, logo or wordmark of, any
terminal vendor.

## Run it

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
npm install
```

```bash
python build_data.py && npm run dev
```

`build_data.py` downloads market data with yfinance (cached under `.cache/`), runs every
regression / valuation / history computation, validates the result against
`src/types/data.ts` and writes `public/data.json` (~2.4 MB). `npm run dev` serves the app at
http://127.0.0.1:5173. A snapshot `public/data.json` is committed, so `npm run dev` alone also works.

The first build fetches fundamentals for ~65 tickers (a few minutes; Yahoo rate-limits politely);
later builds reuse the cache and take ~10–15 s. Flags: `--refresh` (re-download prices),
`--offline` (cache only), `--skip-fund`, `--only-prices`.

Other entry points:

```bash
npm run report        # 10 most exposed Indian names under "Full bubble pop" (+ biggest market-vs-fundamental gaps)
```

```bash
python -m pytest -q   # 49 tests: alignment (US t-1 lag, holidays, Tokyo same-day), regressions, valuation math, history
```

```bash
npm test              # 98 tests: engine math, all presets, Monte Carlo, Sankey mass balance, command parser, panel helpers
```

`npm run report -- --horizon 1M` and `--set key=value` (e.g. `--set mode=median`) override preset parameters.

## Everything is driven by `universe.yaml`

Add or remove any company, tier, parent link or shock origin by editing `universe.yaml` — no code
changes. Each company entry carries its exposures as *quantities*, and every non-computed number
must declare where it came from:

| Status | Meaning |
|---|---|
| `SOURCED` | From a cited document (URL + verbatim quote in `sources:`) |
| `UNVERIFIED` | Weak/secondary or conflicting source — treat with care |
| `USER_ASSUMPTION` | No source; a declared model default you can change (slider in F5) |
| `COMPUTED` | Computed by the pipeline from downloaded market data |
| `DERIVED` | Product of parts, each with its own status (effective status = weakest part) |

`history.yaml` (included from `universe.yaml`) holds the historical cases and event studies.
`research/addenda.yaml` (optional) overlays newer research on top of `universe.yaml`.
Research provenance lives in `docs/research_notes.md` and `docs/research_addenda.md`.

## Screens

| Key | Panel | What it shows |
|---|---|---|
| F1 | SHOCK | 7 presets with sliders, live recalculation, origin valuation waterfall |
| F2 | INDIA IMPACT | Ranked table, treemap of market cap at risk, Monte Carlo fan charts |
| F3 | TRANSMISSION MAP | Sankey: origin → channel (parent, revenue, capex orders, sentiment, FX/FPI) → Indian stock |
| F4 | HISTORY | Bubble/scandal cases, event studies, scatters, P/E-vs-drawdown calibration, dot-com overlay |
| F5 | MODEL | Formulas, regression tables, downside & rolling betas, heatmap, assumption register |
| F6 | SOURCES | Every citation with verbatim quote, ticker verification log, data provenance |

Command bar examples: `NVDA <GO>`, `CAPEX -30 <GO>`, `REPLAY DOTCOM <GO>`, `INDIA TIER C <GO>`,
`GUIDE AMD -20 <GO>`, `RESTATE SMCI -30 25 <GO>`, `MULT 50 <GO>`, `CREDIT 400 <GO>`,
`POP 12M <GO>`, `HIST DEEPSEEK <GO>`, `HELP <GO>`.

## The model in one screen

Full specification: [`docs/DESIGN.md`](docs/DESIGN.md).

1. **Origin impact** — `Price = P/E × EPS`; `Move = (1−e)(1−d) − 1`. Capex channel:
   `revenue hit_j = c × hyperscaler share_j`, `EPS hit_j = revenue hit_j × operating leverage_j`
   (incremental ÷ current margin, from filings).
2. **Market transmission** — per Indian stock, 3-year daily regression
   `r_i,t = a + b_SOX r_SOX,t−1 + b_NDX r_NDX,t−1 + b_P r_parent,t−1 + b_N r_Nifty,t + e`
   with exchange-close-time calendar alignment (US closes after NSE; Tokyo closes before it),
   holiday handling, HAC t-stats, downside betas on the worst 5% of SOX days and rolling 1-year
   betas around the ChatGPT launch (30-Nov-2022).
3. **Fundamental damage** — `EaR_i = exposed revenue share × cut % × operating leverage`;
   `fundamental move_i = (1−EaR_i)(1−d_i) − 1`, where `d_i` unwinds the stock's own AI premium
   (current P/E ÷ median P/E in the 3 years before 30-Nov-2022, minus 1).
4. **FX offset** — risk-off → FPI outflow → INR depreciation `f` (calibrated from past episodes);
   IT exporters get a margin offset per 1% INR move. Gross vs net-of-FX shown separately.

Monte Carlo: 5,000 runs sampling shock sizes (triangular/uniform) and jointly bootstrapping
historical regression residuals (no normal distributions), giving 5th/50th/95th percentiles and fan charts.

## What the committed snapshot shows (data as of 28-Oct-2026 — hypothetical, re-run to refresh)

* **AI multiples are not the stretched part.** The AI basket trades at ~25.7x trailing earnings,
  *below* its pre-ChatGPT median (~32x): the rally has been earnings-led, so "revert to the
  pre-ChatGPT median" implies no de-rating. The shock-4 `calibrated` mode instead scales the
  peak-to-trough drawdown implied by the historical P/E-vs-drawdown fit (F4); Full bubble pop uses it.
* **Full bubble pop, 12M (defaults):** SOX −44%, Nasdaq-100 −28%, implied Nifty −4%; hyperscaler
  capex cut ≈ $203B. Most exposed on the market channel: SIFY, Netweb, Hitachi Energy India,
  GE Vernova T&D India, E2E, HFCL, Anant Raj, STL, CG Power, OFSS — Tier C capex-chain and Tier A
  parent-linked names, not the IT majors.
* **Indian IT is wired the other way.** Lagged SOX betas are negative for all 12 Tier B names
  (10 significant): over 2023–26 AI-chip rallies coincided with AI-disruption selling of IT
  services. Their total AI beta is close to zero (−0.01 to +0.12; positive Nasdaq-100 loadings
  offset the negative SOX ones), and where they do fall it is through Nasdaq-linked sentiment and
  FPI flows — the
  biggest "market move exceeds fundamental damage" gaps are Mphasis, LTM, Wipro, LTTS, Coforge.
* **Trust contagion is historically small:** Satyam (Jan-2009) moved Indian IT peers by ~0 on
  balance (Infosys/TCS/Wipro rose, HCL/TechM fell); Super Micro's auditor exit moved AI-hardware
  peers ~5% of its own move. These calibrate the restatement shock.

## Repository layout

```
universe.yaml, history.yaml     model universe, exposures, presets, cases (with sources)
build_data.py, pipeline/        Python data layer -> public/data.json
tests/                          pytest
src/types/                      data.json + engine contracts
src/engine/                     scenario engine, Monte Carlo (TypeScript, runs in the browser)
src/                            React UI (Vite, ECharts, KaTeX, JetBrains Mono)
scripts/report.ts               CLI summary of the Full bubble pop preset
docs/                           design spec and research notes
```

## Limitations

* Betas are estimated on daily data and applied to multi-day horizons as if horizon-invariant.
* Exposure shares are point-in-time disclosures; many links (e.g. hyperscaler share of a
  supplier's data-centre revenue) are not disclosed and are labelled USER ASSUMPTION.
* The AI-credit shock is deliberately marked low-confidence.
* Daily R² of Indian stocks on lagged US factors is low (≈0.04–0.24), so Monte Carlo bands —
  which bootstrap 252 days of residuals for the 12M horizon — are wide; the base case is the
  median, not a point forecast.
* Pre-ChatGPT P/E (and so the AI premium) is unavailable for names listed after 2022 or with
  negative/missing EPS history; those use a tier median, labelled USER ASSUMPTION.
* Some company sites and NSE archives block automated access; affected figures use secondary
  coverage and are labelled SECONDARY/UNVERIFIED (see `docs/research_addenda.md`).
* Market data comes from Yahoo Finance via yfinance and inherits its gaps and revisions.
