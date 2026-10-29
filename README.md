# AI CRASH MONITOR

A market simulator that models a **hypothetical** AI-bubble deflation starting in US/global AI
stocks (chips, hyperscalers, AI infrastructure, AI software) and shows which Indian listed
companies get hit, through which channel, and by how much — with the maths on screen, the evidence
(historical bubble crashes and accounting scandals) one click away, and an honest, out-of-sample
measure of how accurate the model has been.

> **Every scenario is HYPOTHETICAL.** This is an educational model, not a forecast.
> **Educational model. Not investment advice.**

Two ways to use it, same data and engine:

* **Guided mode** (default for first-time users): an illustrated 5-step tour, scenario cards with
  Mild / Severe / Extreme and 1 day / 1 month / 1 year, a visual card per company, a plain-language
  story page per company, an animated "how it spreads" diagram, a timeline of past crashes, a
  "How accurate is it?" page and an illustrated glossary — every term has a **?** explainer with a
  drawing and a live example from the data.
* **Terminal mode** (one click away): the dense black-and-amber F1–F6 screens with a command bar
  and ticker tape. It borrows the look of professional market terminals; it is not affiliated with,
  and does not use the name, logo or wordmark of, any terminal vendor.

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
regression / valuation / history computation and the walk-forward accuracy lab, validates the
result against `src/types/data.ts` and writes `public/data.json` (~3.4 MB). `npm run dev` serves
the app at http://127.0.0.1:5173. A snapshot `public/data.json` is committed, so `npm run dev`
alone also works.

The first build fetches fundamentals for ~65 tickers and runs the accuracy lab (a few minutes;
Yahoo rate-limits politely); later builds reuse the caches and take ~20 s. Flags: `--refresh`
(re-download prices), `--offline` (cache only), `--skip-fund`, `--only-prices`, `--skip-modellab`.

```bash
npm run report        # 10 most exposed Indian names under "Full bubble pop" + biggest market-vs-fundamental gaps + accuracy scoreboard
```

```bash
python -m pytest -q   # 64 tests: alignment (US t-1 lag, holidays, Tokyo same-day), regressions, valuation, history, accuracy lab (no look-ahead)
```

```bash
npm test              # 183 tests: engine maths, all presets, ensemble path, Monte Carlo, Sankey balance, explanations, glossary, guided views
```

`npm run report -- --horizon 1M` and `--set key=value` (e.g. `--set mode=median`) override preset
parameters. `npm run build:artifact` builds the hosted variant (fonts inlined, relative paths) into
`dist-artifact/`.

## Everything is driven by `universe.yaml`

Add or remove any company, tier, parent link, shock origin or accuracy-lab setting by editing
`universe.yaml` — no code changes. Every non-computed number declares where it came from:

| Status | Meaning |
|---|---|
| `SOURCED` | From a cited document (URL + verbatim quote in `sources:`) |
| `UNVERIFIED` | Weak/secondary or conflicting source — treat with care |
| `USER_ASSUMPTION` | No source; a declared model default you can change (slider / Assumptions tab) |
| `COMPUTED` | Computed by the pipeline from downloaded market data |
| `DERIVED` | Product of parts, each with its own status (effective status = weakest part) |

`history.yaml` (included from `universe.yaml`) holds the historical cases and event studies;
`research/addenda.yaml` overlays newer research. Provenance: `docs/research_notes.md`,
`docs/research_addenda.md`. Full specification: [`docs/DESIGN.md`](docs/DESIGN.md).

## The model in one screen

1. **Origin impact** — `Price = P/E × EPS`; `Move = (1−e)(1−d) − 1`. Capex channel:
   `revenue hit_j = c × hyperscaler share_j`, `EPS hit_j = revenue hit_j × operating leverage_j`.
   Shock 4's CALIBRATED mode scales the drawdown implied by the historical P/E-vs-drawdown fit
   (today's AI basket trades *below* its pre-ChatGPT median P/E, so "revert to median" implies no
   de-rating — the app says so).
2. **Market transmission** — per Indian stock,
   `r_i,t = a + b_SOX r_SOX,t−1 + b_NDX r_NDX,t−1 + b_P r_parent,t−1 + b_N r_Nifty,t + e`, with
   exchange-close-time calendar alignment (US closes after NSE; Tokyo/Taiwan/Korea before it).
   The coefficients the app uses come from a **walk-forward-validated blend** of several models
   (below), at a 1-session horizon for 1D and a 21-session horizon for 1M/12M.
3. **Fundamental damage** — `EaR_i = exposed revenue share × cut % × operating leverage`;
   `fundamental move_i = (1−EaR_i)(1−d_i) − 1`, where `d_i` unwinds the stock's own AI premium.
4. **FX offset** — risk-off → FPI outflow → INR depreciation; IT exporters gain margin per 1% INR
   move, electronics importers lose. Gross vs net-of-FX shown separately.

Monte Carlo: 5,000 runs sampling shock sizes (triangular/uniform) and jointly bootstrapping the
blend's **out-of-sample** errors (no normal distributions) → 5th/50th/95th percentiles and fan charts.

## How accurate is it? (walk-forward, out of sample, Jan-2019 → Oct-2026)

Every 21 NSE sessions each model is re-fitted on the previous 3 years only and then predicts the
next 21 sessions it has never seen. Scores are against the "no change" forecast.

| Model (scenario mode: only US chip/tech moves, the parent and the implied Nifty) | R², all days | R², US chip-shock days | Direction right on shock days |
|---|---|---|---|
| No change (baseline) | 0 | 0 | — |
| Original 3-year regression | 2.7% | 10.3% | 67% |
| Outlier-resistant (Huber) | 2.8% | 10.4% | 67% |
| Recent days weigh more (EWMA) | 2.7% | 10.7% | 68% |
| Shrunk toward peers | 2.6% | 9.9% | 67% |
| Delayed reaction / falls-vs-rises variants | 2.3% | ~10.2% | 66–67% |
| Gradient-boosted trees | −0.3% | 4.6% | 54% (all days) |
| **Validated blend (used by the app)** | **2.9%** | **11.1%** | **68%** |
| Nowcast (adds overnight India ETFs/ADRs, Taiwan, Korea, US software, rates, dollar) | 5.3% | 16.9% | — |

* The blend's 50/80/90% ranges contained 49% / 79% / 89% of actual outcomes (well calibrated).
* All 31 stocks with enough history beat "no change"; 23 of 31 beat the original regression.
* At the 1-month horizon the blend explains ~9% of moves (vs ~7% for the original 3-year fit).
* **Where it misses:** on DeepSeek day (Jan-2025) it got the direction right for most stocks but
  predicted only about a fifth of the fall for power, data-centre and electronics names; software-led
  shocks (e.g. Anthropic, Feb-2026) hit Indian IT through US software, a channel the scenario
  factors (chips + Nasdaq-100) cannot express yet.
* The nowcast's edge is real but mostly happens at the NSE open — not tradeable at the previous close.
* What did not help: tree models, delayed-reaction and asymmetric variants, letting the blend shrink
  toward "no change", fits on extreme days only.

## What the committed snapshot shows (data as of 28-Oct-2026 — hypothetical, re-run to refresh)

* **Full bubble pop, 12 months (defaults, validated blend):** US chips −43%, Nasdaq-100 −27%,
  implied Nifty −9%, and −₹4.2 lakh crore across the 32 Indian names. Most exposed: Sify, GE Vernova
  T&D India, Netweb, HFCL, STL, MosChip, E2E, Anant Raj, Hitachi Energy India, OFSS — capex-chain and
  parent-linked names. The 1-month model shows stronger transmission than daily betas implied:
  delayed reactions add up.
* **AI multiples are not the stretched part:** the AI basket's trailing P/E (~26x) is below its
  pre-ChatGPT median (~32x); the rally has been earnings-led.
* **Indian IT is wired the other way:** lagged US-chip betas are negative for all 12 IT-services
  names (10 significant) — 2023–26 AI-chip rallies coincided with AI-disruption selling of IT
  services — so IT falls in a pop mainly through Nasdaq-linked sentiment and foreign outflows; the
  largest "market falls more than the business damage" gaps are Coforge, LTM, LTTS, Wipro, Mphasis.
* **Trust contagion is historically small:** Satyam (2009) moved Indian IT peers ~0 on balance;
  Super Micro's auditor exit moved AI-hardware peers ~5% of its own move.

## Repository layout

```
universe.yaml, history.yaml     universe, exposures, presets, accuracy-lab settings, cases (with sources)
build_data.py, pipeline/        Python data layer -> public/data.json (pipeline/modellab: accuracy lab)
tests/                          pytest
src/types/                      data.json + engine contracts
src/engine/                     scenario engine, Monte Carlo, explanations (TypeScript, in the browser)
src/guided/, src/learn/         guided mode, illustrated glossary, history timeline, accuracy page
src/panels/, src/components/    terminal mode (F1–F6)
scripts/                        report CLI, hosted-artifact builder
docs/                           design spec and research notes
```

## Limitations

* Daily moves of Indian stocks are mostly noise: even on US-shock days the model explains ~11%
  of the size of moves. Treat outputs as direction and rough magnitude, not point forecasts.
* Betas estimated on 1- and 21-session data are applied to 12-month moves as horizon-invariant.
* Exposure shares are point-in-time disclosures; many links are not disclosed and are labelled
  USER ASSUMPTION. Some company sites block automated access; those figures use secondary coverage.
* Pre-ChatGPT P/E (and so the AI premium) is unavailable for names listed after 2022 or with
  negative/missing EPS history; those use a tier median, labelled USER ASSUMPTION.
* The AI-credit shock is deliberately marked low-confidence.
* Market data comes from Yahoo Finance via yfinance and inherits its gaps and revisions.
* Next step suggested by the accuracy lab: add US software (IGV) as a scenario factor for the
  AI-disruption channel into Indian IT.
