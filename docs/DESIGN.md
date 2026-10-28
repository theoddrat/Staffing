# AI CRASH MONITOR — shared design & math spec

This file is the contract between the three build streams (DATA / ENGINE / UI).
If code and this file disagree, fix the code or update this file deliberately.
Type definitions live in `src/types/data.ts` (data.json) and `src/types/engine.ts`
(engine API). Python must emit JSON that matches `src/types/data.ts` exactly
(snake_case keys, `null` for unknown — never NaN/Infinity in JSON).

## 0. Integrity rules (non-negotiable)

* Every scenario is HYPOTHETICAL. UI shows a persistent banner and the footer
  "Educational model. Not investment advice."
* Bloomberg *look* only (black, amber monospace, green/red, dense panels,
  F-keys, command bar). Never use the Bloomberg name, logo or wordmark.
* Every number that is not computed from downloaded market data carries a status:
  * `SOURCED`   — from a cited document (`src` → `sources[]` entry with URL + verbatim quote).
  * `UNVERIFIED` — single weak/secondary source, conflicting sources, or could not be confirmed.
  * `USER_ASSUMPTION` — no source; a declared model default the user can change (slider).
  * `COMPUTED` — computed by the pipeline from market data (Yahoo Finance via yfinance, Shiller data).
  * `DERIVED` — product of `parts`, each with its own status. Effective status = worst part
    (USER_ASSUMPTION > UNVERIFIED > SOURCED > COMPUTED).
* Never invent numbers. Unknown → `null` + label, or an explicit USER_ASSUMPTION in `universe.yaml`.
* `universe.yaml` drives everything (companies, tiers, parents, shock origins, exposures,
  presets, replay windows, history cases). Adding/removing a company must not need code edits.
* Research provenance: `docs/research_notes.md` (URLs + verbatim quotes gathered so far).

## 1. Repo layout & ownership

| Path | Owner |
|---|---|
| `universe.yaml`, `build_data.py`, `pipeline/{config,fetch_fund,align,stats,fundamentals,fx,calibration,export,…}.py` (everything in `pipeline/` except history files), `tests/test_align.py`, `tests/test_regress.py`, `tests/test_valuation.py`, `public/data.json` | DATA-CORE |
| `history.yaml` (included from universe.yaml), `pipeline/history.py`, `pipeline/shiller.py`, `pipeline/events.py`, `tests/test_history.py` | DATA-HISTORY |
| `research/addenda.yaml`, `docs/research_addenda.md` | RESEARCH |
| `src/engine/**` (incl. `__tests__`, `__fixtures__`), `scripts/report.ts` | ENGINE |
| `src/main.tsx`, `src/App.tsx`, `src/state/**`, `src/commands/**`, `src/components/*` (except the shared ones below), `src/panels/ShockPanel*`, `src/panels/ImpactPanel*`, `src/panels/TransmissionPanel*`, `src/panels/SecurityPanel*`, `src/styles/shell.css` | UI-A (shell + F1/F2/F3/SEC) |
| `src/panels/HistoryPanel*`, `src/panels/ModelPanel*`, `src/panels/SourcesPanel*`, `src/panels/b/**`, `src/styles/panels-b.css` | UI-B (F4/F5/F6) |
| `src/types/*.ts`, `src/panels/types.ts`, `src/lib/format.ts`, `src/components/{Chart,Formula,StatusBadge}.tsx`, `src/styles/theme.css`, `pipeline/prices.py`, `pipeline/context.py`, `docs/DESIGN.md`, `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `README.md`, `requirements.txt` | ORCHESTRATOR (ask before changing; additive optional fields are OK if you also note them in your final report) |

No agent runs `git commit/push`, `npm install`, or edits files owned by another stream.
Shared building blocks (already written): `pipeline/prices.py` (cached price download — always use
it), `pipeline/context.py` (DATA-CORE ↔ DATA-HISTORY interface), `src/panels/types.ts`
(`PanelProps` every panel receives), `src/components/Chart.tsx` (ECharts wrapper),
`Formula.tsx` (KaTeX), `StatusBadge.tsx` (`StatusBadge`, `SourceLinks`), `src/lib/format.ts`,
`src/styles/theme.css` (tokens + `.panel/.tbl/.btn/.badge-*` primitives).
Panels export a default React component `(props: PanelProps) => JSX.Element`; file names:
`src/panels/ShockPanel.tsx`, `ImpactPanel.tsx`, `TransmissionPanel.tsx`, `SecurityPanel.tsx`,
`HistoryPanel.tsx`, `ModelPanel.tsx`, `SourcesPanel.tsx`.
Research overlay: if `research/addenda.yaml` exists, the config loader applies it on top of
universe.yaml (quantity overrides by id + extra sources), and logs each applied override.

## 2. Conventions

* Returns: **log returns** for all regressions and factor algebra. Scenario moves shown to users are
  **simple returns** (`exp(x)-1`). Origin Layer-1 moves are simple; convert with `ln(1+R)` before
  aggregating into factors.
* Fractions everywhere (0.30 = 30%). Signed moves: negative = down. `mcap_change_*` is signed.
* Currency: `mcap_local` in the listing currency; `mcap_usd`, `mcap_inr` converted with latest FX
  (USDINR=X, JPY=X, EURUSD=X, CHF=X, … fetched by DATA). INR crore = 1e7 INR.
* Dates ISO `YYYY-MM-DD`. "as of" = last common trading date in the data.
* Horizons: `1D` = 1 trading day, `1M` = 21, `12M` = 252.

## 3. DATA pipeline (Python) — what must be computed

### 3.1 Universe & ticker verification
Every ticker in `universe.yaml` is checked in yfinance. Known fixes (log them in `meta.ticker_log`):
`LTIM.NS → LTM.NS` (NSE symbol change effective 27-Feb-2026), `GVT&D.NS` (works; `GVTD.NS` fails),
MosChip is listed on BSE since 2001 (`MOSCHIP.BO`) and NSE only since 5-Feb-2025 (`MOSCHIP.NS`) →
use `.BO` for regressions; `ENRIN.NS` only since 19-Jun-2025 (short history, flag).
Reused/dead tickers that must NOT be used as historical series: `LU` (now Lufax), `GBLX`, `SAY`,
`NT`, `WCOM`, `JNPR`, `JDSU`, DSQ, Pentamedia, Satyam → qualitative + sourced numbers only.

### 3.2 Calendar alignment (the "US t-1 lag")
Information-set rule. India trading day `t` = a date on which `^NSEI` has a close (NSE close 15:30 IST).
For any foreign series F, the return that enters India day `t` is the **sum of F's daily log returns
over all F-closes whose close timestamp lies in (NSE close of the previous India day, NSE close of t]**.
* US (16:00 ET) and Europe (17:30 CET) closes on calendar day d happen after the NSE close of d →
  they enter the next India trading day (this is the 1-day lag).
* Tokyo closes (15:30 JST = 12:00 IST) before NSE closes → a Tokyo close on day d enters India day d.
* Foreign holiday (no F close in the interval) → 0 (no new information), counted in diagnostics.
* India holiday while F trades → the F returns accumulate into the next India day.
Use exchange time zones with DST (zoneinfo). Unit-test all four cases.
Notation: `x_F,t` = aligned information-set return of F for India day t. The user's
`r_SOX,t-1` is `x_SOX,t`.

### 3.3 Layer-2 regressions (3-year window ending at the last India date)
Main model, per India target i (OLS, log returns, HAC/Newey-West t-stats with 5 lags; also store OLS se):

    r_i,t = a + b_SOX x_SOX,t + b_NDX x_NDX,t + b_P x_P,t + b_N r_NIFTY,t + e_i,t

`b_P` only for targets with a parent (Tier A). Parent alignment per §3.2 by parent exchange.
Nifty model (needed to propagate a US shock into r_NIFTY):

    r_NIFTY,t = c0 + c_SOX x_SOX,t + c_NDX x_NDX,t + e_N,t

Downside model: same spec, estimated only on days with `x_SOX,t <= quantile_0.05(x_SOX)` in the
window (null if n < 25).
Co-movement slopes (window, OLS): `m_NDX|SOX` (x_NDX on x_SOX), `m_P|SOX` (x_P on x_SOX) and the
downside analogues.
Total AI beta (response of ln P_i to a 1-unit log move in SOX along the typical joint path):

    beta_total = b_SOX + b_NDX*m_NDX|SOX + b_P*m_P|SOX + b_N*(c_SOX + c_NDX*m_NDX|SOX)

`beta_total_down` uses the downside coefficients and downside slopes.
Rolling: 252-day window, step 5 India days, from `settings.history_start`, same spec → series of
b_SOX, b_NDX, b_P, b_N, r2 (null when < 200 obs). Used to show whether AI linkage rose after 30-Nov-2022.
Residuals: store the main-model residuals and Nifty-model residuals aligned to one common date
vector `bundle.resid_dates` (India dates of the window; `null` where the stock has no data).
Heatmap: every India target × every shock origin: univariate OLS of r_i,t on x_origin,t over the
window → beta, HAC t, correlation.
Peer betas (same-day): origins on origins (US calendar), India targets on India targets (India calendar).
Factor maps (same-day, own calendar):
* `sox_on_chip_basket`: ln SOX return on ln of cap-weighted (latest mcap_usd) simple return of the
  chip origins. `ndx_on_ai_basket`: NDX on cap-weighted all-origin basket. Store beta, r2, n.
* Non-US parents (6501.T, ENR.DE, ABBN.SW, SU.PA, SIE.DE…): Dimson betas on SOX and NDX
  (own-date return on US same-date + previous-date returns; beta = sum) → `parent_maps`.
* INR: USDINR log change on NDX (Dimson 0+1) → `fx.beta_inr_on_ndx` (+ downside version).

### 3.4 Fundamentals (COMPUTED unless noted)
* P/E basis: TTM EPS = sum of the last 4 **reported** quarterly EPS from the Yahoo earnings calendar
  (`get_earnings_dates`), only quarters reported on/before the date (no look-ahead), split-adjusted
  `Close` (not dividend-adjusted) as price. `pe_ttm = price / TTM EPS` (null if EPS ≤ 0).
  Fallback current-only: yfinance `info.trailingPE` (mark `pe_basis`).
* Pre-ChatGPT median P/E: median of the daily P/E series over [2019-11-30, 2022-11-29]
  (`settings.pre_chatgpt_date` = 2022-11-30, source OpenAI). Needs ≥ 250 valid days else null.
* `ai_premium = pe_ttm / pe_pre_chatgpt_median - 1` (null if either missing).
* `ret_since_chatgpt` = price return from close on/just before 2022-11-30; `_vs_bench` subtracts
  the benchmark's (Nifty for India, NDX for US/global).
* Operating leverage (Layer 1/3): from annual income statements, last two fiscal years:
  `OL = clamp( (ΔEBIT/ΔRev) / (EBIT/Rev), 1, 4 )`; if |ΔRev/Rev| < 2% or EBIT ≤ 0 or nonsensical →
  fallback `clamp(gross_margin/op_margin, 1, 4)` (method noted); else USER_ASSUMPTION 1.5.
* EBIT margin TTM (sum of last 4 quarters OI / revenue; fallback latest annual).
* Hyperscaler capex: TTM sum of last 4 quarterly `Capital Expenditure` (abs) from cash-flow
  statements for MSFT, GOOGL, AMZN, META, ORCL (status COMPUTED; source "company filings via Yahoo").
* Credit: net debt = total debt − cash & ST investments (latest balance sheet); EBITDA TTM; nd/EBITDA.
* Market caps: yfinance `fast_info`/`info` (local) + USD/INR conversions.

### 3.5 FX calibration (Layer 4)
Episodes table (COMPUTED from USDINR=X, ^NDX, ^SOX, ^NSEI): e.g. GFC (2008-09-12→2008-11-20),
taper tantrum (2013-05-22→2013-08-28), COVID (2020-02-19→2020-03-23), 2022 (2022-01-03→2022-10-13),
yen-carry (2024-07-10→2024-08-05), DeepSeek (2025-01-24→2025-01-28), Mar-2026 (define from data/notes).
`fx.default_f` = median episode INR depreciation (COMPUTED). The engine's auto `f` is
`beta_inr_on_ndx * x_NDX` (positive = INR weaker), overridable.
IT margin sensitivity: 30 bps EBIT margin per 1% INR depreciation (SOURCED: Nomura via AIM/Business
Standard; range 20–40 bps) for Tier B; others per `universe.yaml` (USER_ASSUMPTION).

### 3.6 History (F4)
* Cases (`universe.yaml: history_cases`): Railway Mania, Dot-com 2000-02, Telecom/fiber 2001-02,
  Satyam Jan-2009, 2022 rate bear, Super Micro 2024, DeepSeek 27-Jan-2025, plus later AI drawdowns
  (2025-11-20 NVDA reversal, 2026-02-04 Anthropic/Indian IT, 2026-04-28 OpenAI WSJ, 2026-05-12
  OpenAI–Tomoro/Nifty IT, 2026-10-08 OpenAI revenue, 2026-10-14 CoreWeave bond scare,
  2026-10-22 Lam Research warning). Each: dates, what broke, crash type(s) from
  {earnings_collapse, multiple_compression, fraud_trust, credit_liquidity, capex_overbuild},
  peak-to-trough drawdown, time to bottom, time to recover, linked companies & India outcome.
  Drawdowns COMPUTED from series where Yahoo has data; otherwise SOURCED values.
* Event studies: CAR from −5 to +60 trading days (own market calendar), market model vs local index
  (α, β on [−250, −11]; fall back to market-adjusted if < 120 obs). Groups per event.
* Scatter A: US shock vs India response — for every day in the 3y window with x_SOX in its worst 5%
  plus the named AI events: (x_SOX,t, r_i,t) per India target, tier-coloured.
* Scatter B: pre-crash P/E vs peak-to-trough drawdown across bubbles: Shiller S&P episodes
  (1929, 1937, 1968, 1973, 1987, 2000, 2007, 2021-22; CAPE & trailing P/E COMPUTED from Shiller
  `ie_data.xls`), Nikkei 1989 (P/E ~60 SOURCED; drawdown COMPUTED from ^N225), Nasdaq-100 2000
  (P/E 104 at end-1999 SOURCED; drawdown COMPUTED from ^NDX), Nifty 2008 (P/E ~28 SOURCED;
  drawdown COMPUTED from ^NSEI). OLS fit drawdown ~ P/E → `pe_fit`, plus today's AI-basket P/E.
* Overlay: dot-com ^IXIC and ^NDX indexed to their Mar-2000 peaks vs today's ^SOX and ^NDX indexed
  to their latest all-time highs; x = trading days relative to peak.
* Worst windows: worst 1-, 21-, 252-day log moves of SOX and NDX since 1994 (calibration check).
* Replay windows (`universe.yaml: replay_windows`): COMPUTED cumulative log moves of SOX, NDX, SPX,
  plus actual Nifty/Sensex where data exists.
* Contagion calibration: US = SMCI 30-Oct-2024 (mean abnormal return of AI-hardware peers / SMCI
  abnormal return); India = Satyam 7-Jan-2009 (mean AR of INFY/TCS/WIPRO/HCLTECH/TECHM vs Nifty
  divided by the SOURCED −78% Satyam move).

## 4. ENGINE math (TypeScript, pure functions, live in the browser)

Notation per origin j: price P0, P/E0, EPS0 = P0/PE0, operating leverage OL_j, mcap M_j (USD).
Layer 1 origin move: `move_j = (1-e_j)(1-d_j) - 1`, waterfall P0 → P0(1-e) → P0(1-e)(1-d).
Combination across shock components: `(1-e) = Π(1-e_k)`, `(1-d) = Π(1-d_k)`.

### 4.1 Shock presets (parameter keys are fixed; defaults/ranges come from `bundle.presets`)
1. **capex** — `c` cut to combined hyperscaler AI capex. Supplier j (any origin with
   `hyperscaler_share` s_j > 0): `revenue_hit_j = c·ψ_supplier·s_j`, `e_j = min(revenue_hit_j·OL_j, 0.95)`,
   `d_j = κ·e_j` (κ = `kappa`, growth-reset de-rating, default 0). Hyperscalers themselves: e=d=0.
   Report `capex_cut_usd = c·Σ capex_ttm` and `capex_absorbed_share = Σ_j revenue_hit_j·revenue_ttm_j / capex_cut_usd`.
2. **guidance** — `target` chip j*, guided revenue cut `g`: `e = min(g·OL,0.95)`, `d = κ·e` (default κ 0.5).
   Sympathy for other origins k: `x_k = sympathy · β_peer(k on j*) · ln(1+move_j*)`.
3. **restatement** — `target` (any origin OR India target), profit cut `r`, credibility de-rating `d`:
   `move = (1-r)(1-d)-1`. Peers (same origin group, or same India tier):
   `move_k = contagion · move_target` with contagion defaulting to `calibration.contagion_us/india`.
4. **multiple** — earnings unchanged. AI-basket P/E (aggregate Σmcap/Σearnings over origins with
   positive EPS) reverts toward its pre-ChatGPT median by fraction λ (`mode='median'`), or to
   `target_pe` (`mode='multiple'`): `PE_target = PE_now + λ(PE_pre − PE_now)` or `target_pe`;
   `d_basket = 1 − PE_target/PE_now`; apply `d_j = d_basket` to all origins (`per_name=false`) or
   per name with own medians (fallback to basket). `floor_zero` (default true) clamps d at ≥ 0.
5. **credit** (LOW CONFIDENCE) — stressed origins (`credit.stressed=true`, e.g. CRWV, ORCL):
   `e_j = min(Δs·duration·max(net_debt,0)/mcap, 0.9)` (Δs = `ds_bps`/1e4), `d_j = d_credit`.
   Suppliers: `revenue_hit_j = k·ψ_supplier·neocloud_share_j`, `e_j = min(revenue_hit_j·OL_j,0.95)`.
6. **replay** — `window` id: SOX/NDX log moves from `history.replay_windows`; origins not modelled;
   India via today's betas; fundamental = not modelled (null gap).
7. **fullpop** — 1 + 4 + 5 combined with horizon-specific defaults (`1D`,`1M`,`12M`).

All presets also take `lambda_india` (India AI-premium unwind), `phi_it`, `psi_india_dc`, `f_override`.

### 4.2 From origins to factors (log space)
`x_chip = ln Σ_j∈chips w_j(1+move_j)`, `x_ai = ln Σ_j∈all w_j(1+move_j)` (latest-mcap weights).
`x_SOX = factor_map.sox_on_chip_basket.beta · x_chip`, `x_NDX = factor_map.ndx_on_ai_basket.beta · x_ai`.
Replay: x_SOX, x_NDX taken from the window directly.
Parent move: if parent is an origin → `ln(1+move_parent)`; else `β_P,SOX·x_SOX + β_P,NDX·x_NDX` (parent_maps).
Nifty: `x_N = c_SOX·x_SOX + c_NDX·x_NDX`. INR depreciation: `f = f_override ?? max(0, beta_inr_on_ndx·x_NDX)`
(sign: positive = INR weaker).

### 4.3 Layer 2 — market-implied India move
`ln(1+m_i) = b_SOX x_SOX + b_NDX x_NDX + b_P x_P + b_N x_N` (no alpha). Contributions:
parent = b_P x_P; sentiment = b_SOX x_SOX + b_NDX x_NDX; fx_fpi = b_N x_N. Restatement target: own move.

### 4.4 Layer 3 — fundamental damage
Per exposure k of stock i (`india[].exposures`): cut_k by channel:
* `revenue` (IT budgets of US tech clients): `cut = phi_it · R_tech`, R_tech = mcap-weighted mean of
  origin revenue hits (`factors.tech_revenue_shock`).
* `capex` (capex orders / data-centre demand): `cut = psi_india_dc · (c_effective)` where
  c_effective = c (+ k·share for credit shocks per §4.1; = g·s_target for a guidance cut).
* `credit`: `cut = k`.
`EaR_i = min(Σ_k share_k · cut_k · OL_i, 0.95)`.
`d_i = 1 − (1+prem_i)^(−λ_india)`; prem_i = ai_premium (if null → tier median, USER_ASSUMPTION);
floor at 0 unless the user turns the floor off.
`fundamental_gross = (1−EaR)(1−d) − 1`; FX EPS effect `fx_eps = (sens_bps/1e4 · f·100) / ebit_margin`
(sens in bps per 1% INR); `fundamental_net = (1−EaR)(1−d)(1+fx_eps) − 1`.
`gap = market_move − fundamental_net` (negative ⇒ market falls more than real damage = sentiment overreaction).

### 4.5 Monte Carlo (5,000 runs, seeded)
Shock sizes: each numeric param with `mc.dist` ∈ {triangular(low, mode=value, high), uniform} sampled
independently (not normal). Residuals: **joint bootstrap** of India-date indices (same index for all
stocks and the Nifty → keeps cross-correlation), h = horizon days, block length 5 when h ≥ 5.
Per run and stock: `ln(1+m_i) = deterministic(params) + Σ_h (e_i + b_N,i·e_N)`. Null residual cells →
redraw from the stock's own non-null residuals. Report p5/p50/p95 (market & fundamental), and a fan
chart (p5/p25/p50/p75/p95 of the cumulative path, deterministic part ramped linearly over h).

### 4.6 Outputs per India stock
tier, dominant channel (largest |INR crore| among parent / sentiment / fx_fpi / revenue / capex /
credit / fx), beta_total, beta_total_down, market-implied move, fundamental (gross & net), gap,
AI premium, low/base/high (MC p5/p50/p95), mcap change (INR crore), confidence:
`score = 100·(0.5·min(R²/0.4,1) + 0.5·(1−assumption_share))·min(1, sqrt(n/250))`,
grade HIGH ≥ 70, MED ≥ 40, else LOW; credit/fullpop scenarios carry a LOW-CONFIDENCE flag.
assumption_share = |fundamental contribution resting on USER_ASSUMPTION/UNVERIFIED parts| / total
(count-based share of exposure parts when the fundamental move is ~0).

### 4.7 Sankey
Nodes: origins (+ non-origin parents + "US risk-off") → channels {Parent link, Revenue (IT budgets),
Capex orders, Sentiment (US AI factor), FX / FPI} → India stocks. Link value = |INR crore| of the
channel contribution, attributed to origins in proportion to their weighted contribution
(sentiment: chips via x_SOX weights + all origins via x_NDX weights; revenue: revenue-hit weights;
capex: hyperscaler capex weights). Two modes: market (Layer 2) and fundamental (Layer 3, incl. FX offset).

## 5. UI spec (terminal look)
Black background, amber (#FFB000-ish) monospace (JetBrains Mono via @fontsource), green up / red down,
dense bordered panels, function-key nav F1–F6 (keyboard + clickable), command bar with `<GO>`,
scrolling ticker tape (last close + 1d change for every name), persistent HYPOTHETICAL banner,
footer "Educational model. Not investment advice.", status badges for SOURCED / UNVERIFIED /
USER ASSUMPTION / COMPUTED everywhere a number is shown with provenance.
Commands: `NVDA <GO>` (security page + waterfall), `CAPEX -30 <GO>`, `GUIDE AMD -20 <GO>`,
`RESTATE SMCI -30 25 <GO>`, `MULT 50 <GO>` / `MULT PE 25 <GO>`, `CREDIT 400 <GO>`,
`REPLAY DOTCOM <GO>`, `POP 12M <GO>`, `INDIA TIER C <GO>`, `HIST DEEPSEEK <GO>`, `F1`…`F6`, `HELP`.
Panels: F1 SHOCK (preset picker, sliders, horizon, origin waterfall table, factor moves, MC run),
F2 INDIA IMPACT (ranked table, treemap by |mcap change| coloured by move, fan chart + MC),
F3 TRANSMISSION MAP (ECharts Sankey, market/fundamental toggle), F4 HISTORY (cases, event-study
overlays, scatters, P/E-vs-drawdown fit, dot-com overlay, DeepSeek next-day table, 2025-26 events),
F5 MODEL (KaTeX formulas, regression tables w/ t-stats & R², downside, rolling betas, heatmap,
assumption register with editable USER_ASSUMPTION sliders, factor maps, FX calibration, OL table),
F6 SOURCES (sources table with quotes/links, ticker log, data provenance).

## 6. Tests & QA
pytest: alignment (US t-1 lag, holidays both sides, Tokyo same-day), regressions (recover known
betas on synthetic data; HAC t; downside subset; rolling), valuation math (P/E·EPS, move formula,
OL, AI premium, TTM EPS without look-ahead). vitest: Layer-1 math & waterfall, capex channel,
factor algebra, zero-shock ⇒ zero move, monotonicity in c, MC seeded determinism & percentile order,
command parser. QA: `python build_data.py && npm run dev`, Playwright screenshots of every panel,
no NaN/undefined rendered, audit that every displayed non-computed number has a status + source.
Final: `npm run report` prints the 10 most exposed Indian names under the Full bubble pop preset,
each one's dominant channel, and where market-implied most exceeds fundamental damage.

## 7. Quantity ids & the research overlay

Quantity ids (used by universe.yaml, data.json, engine `overrides`, and the UI assumption register):
* Origins: `<TICKER>.hyperscaler_share`, `<TICKER>.neocloud_share`, `<TICKER>.op_leverage`
* India targets: `<TICKER>.exposure.<channel>` (channel ∈ revenue|capex|credit), `<TICKER>.parent_stake`,
  `<TICKER>.fx_margin_sens_bps`, `<TICKER>.op_leverage`
* Global model assumptions: `assump.<key>` (e.g. `assump.psi_supplier`, `assump.phi_it`)
* Calibration: `calib.contagion_us`, `calib.contagion_india`, `fx.default_f`

`research/addenda.yaml` (optional overlay written by RESEARCH, applied by the config loader):
```yaml
sources:            # same fields as Source in src/types/data.ts
  - {id: asml_ar_2025, title: "...", publisher: "...", url: "...", date: "2026-02-11",
     quote: "verbatim text", verification: PRIMARY, accessed: "2026-10-28", note: null}
quantities:         # replace the universe.yaml definition of these ids wholesale
  ASML.hyperscaler_share:
    label: "Share of revenue tied to hyperscaler AI capex"
    parts:
      - {label: "...", value: 0.20, status: SOURCED, src: [asml_ar_2025], note: "..."}
    note: "..."
history_notes:      # optional: case_id -> list of extra sourced facts (free text + src ids)
  telecom: [{text: "...", src: [some_id]}]
```

## 8. Agent hand-off protocol
* Write a short `## Status` report in your final message: what is done, what is stubbed,
  every assumption you introduced (with its status), and any contract field you added.
* If you depend on another stream's output that is not there yet (e.g. `public/data.json`),
  code against the types and a fixture; never block.
* Keep functions small and tested; no network in unit tests.
