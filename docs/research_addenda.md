# Research addenda (RESEARCH stream, accessed 2026-10-28)

Companion to `research/addenda.yaml` (overlay applied on top of `universe.yaml`, DESIGN.md §7).
Each entry: what changed, the source, the verbatim quote, and how it was checked.
Status vocabulary as in DESIGN.md §0. "via search index" = the page blocked direct fetch, and the
quoted text came from the search engine's copy of it.

## 1. Quantities changed by the overlay

| Quantity id | universe.yaml before | overlay after | Why |
|---|---|---|---|
| `TCS.NS.exposure.revenue` | 0.086 UNVERIFIED | 0.086 **SOURCED** | Two independent secondary summaries agree |
| `INFY.NS.exposure.revenue` | 0.068 SOURCED (fact sheet via search index) | 0.0677 SOURCED (**PRIMARY**) | Ind AS segment table filed with the SEC |
| `HCLTECH.NS.exposure.revenue` | 0.143 UNVERIFIED | 0.143 × 0.921 = **0.1317** UNVERIFIED | Mix is on a Services basis; converted to total revenue |
| `TATAELXSI.NS.exposure.revenue` | 0.336 × 0.97 (UNVERIFIED) | 0.336 × 0.9736 = **0.3271** SOURCED | SDS share now from reported ₹ figures |
| `CYIENT.NS.exposure.revenue` | 0.0997 (semis / (DET+semis)) | **0.0825** SOURCED | Group-revenue denominator ($233.9M) |
| `SMCI.hyperscaler_share` | 0.5 USER_ASSUMPTION | 0.281 SOURCED × 1.78 USER_ASSUMPTION = 0.50 | Largest-customer share now PRIMARY (28.1%) |
| `ASML.hyperscaler_share` | 0.20 USER_ASSUMPTION | 0.7492 SOURCED × 0.27 USER_ASSUMPTION = 0.202 | System-sales share from the 20-F |
| `MU.hyperscaler_share` | 0.30026 SOURCED (one quarter) | **0.3235** SOURCED (PRIMARY, FY2026) | Full-year 10-K segment table |
| `MU.neocloud_share` | 0.33196 × 0.25 | 0.2822 × 0.25 = **0.0706** | Same, CDBU full year |
| `GEV.hyperscaler_share` | 0.15 USER_ASSUMPTION | 0.484 × 0.20 SOURCED × 1.5 USER_ASSUMPTION = 0.145 | Power share + data-centre share of gas GW |
| `ABB.NS.exposure.capex` | 0.08 USER_ASSUMPTION | **0.16** SOURCED | Data centres 15–17% of quarterly orders |
| `SCHNEIDER.NS.exposure.capex` | 0.10 USER_ASSUMPTION | **0.175** UNVERIFIED (proxy) | 15–20% of Schneider's India business |
| `GVT&D.NS.exposure.capex` | 0.10 USER_ASSUMPTION | 0.0622 SOURCED × 1.6 USER_ASSUMPTION = 0.0995 | Pending ₹1,300 cr US data-centre order |

## 2. Findings and quotes

### Indian IT verticals (quarter ended 30-Sep-2026)
* **Infosys** — SEC 6-K (23-Oct-2026) Ex 99.3, Ind AS segment table (₹ crore): Financial Services
  13,774; Retail 5,664; Communication 6,150; Energy, Utilities, Resources & Services 6,975;
  Manufacturing 7,913; **Hi-Tech 3,332**; Life Sciences 4,145; Others 1,291; **Total 49,244**
  (sum checked). Hi-Tech = 6.77%. Matches the fact-sheet 6.8% and Financial Services 28.0%.
  https://www.sec.gov/Archives/edgar/data/1067491/000106749126000042/exv99w03.htm
* **TCS** — Investing.com slide summary: "Technology & Services (8.6%)", "North America,
  representing 48.3% of total revenue". Multibagg segment table: "| Technology and Services | 8.6% |
  3.1% | 4.8% |". The fact-sheet columns (via search index) read 8.5% / 8.5% / 8.6%.
* **HCLTech** — Investing.com: "Financial Services led at 22.4% of services revenue", "HCLSoftware,
  accounting for 7.9% of revenue", "the United States ... 56.1% of services revenue". So the vertical
  mix is stated on a Services basis. The 14.3% Technology & Services figure has a single source
  (Finology, 403 to direct fetch), so it stays UNVERIFIED. The investor release on NSE returned 503.
* **Tata Elxsi** — company release: "Our Media & Communications vertical, which accounted for 33.6%
  of our SDS segment"; operating revenue ₹1,055.7 cr. Free Press Journal: "The software development
  and services segment recorded quarterly revenue of Rs 1,027.87 crore". SDS = 97.36% of revenue.
  Media & Comms is the closest technology vertical. Tata Elxsi has no semiconductor vertical.
* **Cyient** — Investing.com slides: "Group operating revenue of $233.9 million", "Semiconductor
  revenue of $19.3 million", "DET revenue came in at $174.2 million", "Networks & Infrastructure
  posted $52.8 million", "Americas at 53.9%". Semis = 8.25% of group revenue. Networks &
  Infrastructure (telecom/utility engineering) is not counted as AI exposure.
* **LTM / Coforge / Mphasis** — no better figure than universe.yaml, so no overlay entry.
  * LTM: Angel One: Technology & Services ₹2,236.1 cr; the four segments sum to ₹11,807.6 cr;
    "North America contributed 74.3%".
  * Coforge: Investing.com: "Healthcare & HiTech at 17.6%" (combined; HiTech is not split out);
    "Americas ... 63.1%". Revenue jumped with the Encora acquisition.
  * Mphasis: Q2 FY27 not yet reported. ICICI Securities Q1 FY27 note: "TMT (18% of mix)",
    "Americas (85% of mix)".
  * These North America shares are in `context.na_revenue_share`.

### Chips and infrastructure
* **SMCI** — 10-K FY2026 XBRL R53, "Segment Information - Narrative (Details)": Customer One
  **28.10%** of FY2026 net sales (FY2025: 20.9%, 11.5%, 11.3%, 11.1%); United States 70.90% of net
  sales; net sales $39,063,072K.
  https://www.sec.gov/Archives/edgar/data/1375365/000137536526000022/R53.htm.
  Accounts-receivable concentration (R52): 23.0% and 17.1%. The universe `concentration` text
  ("exact % not quoted") can now cite R53.
* **ASML** — 20-F FY2025 R67: Logic €16,054.1M, Memory €8,420.2M. R71: total net sales €32,667.3M
  and Taiwan €8,337.9M (25.5%). Motley Fool: "four customers accounted for about 61% of ASML's
  2025 net sales" (SECONDARY). Substack: largest customer 24% (UNVERIFIED). The share of system
  demand driven by AI is not disclosed and stays an assumption.
* **Micron** — 10-K FY2026 R82 ($M): CMBU 43,085; CDBU 37,592; MCBU 36,601; AEBU 15,886;
  total 133,188. Definitions: "CMBU is focused on memory solutions for large hyperscale cloud
  customers, and HBM for all data center customers"; "CDBU ... memory solutions for OEM data center,
  enterprise, and NeoCloud customers". "approximately one-half of our total revenue was from our top
  ten customers".
* **Arm** — 20-F FY2026 R58: largest customer 16% (Arm China); second 14%; third 12%; three largest
  42%. Revenue $4,920M; royalty $2,613M; related-party revenue $1,499M (R56). The data-centre royalty
  share is not disclosed; the Q1 FY27 commentary says data-centre royalties "more than doubled".
  The hyperscaler share stays USER_ASSUMPTION.
* **GE Vernova** — 3Q26 8-K: revenue $12.6B, of which Power $6.1B and Electrification $3.9B; gas
  backlog plus slot reservations 116→122 GW; FY26 guide $46.5–47.5B. CEO on the Q3 call: "Total
  segment data center orders are now more than $6 billion year to date, including roughly $1.4
  billion in Q3", and "approximately 80% are traditional customers and 20% are for data centers".
  The same 80/20 split was given on the Q1 and Q2 calls.
* **NVIDIA** — Q2 FY27 CFO commentary (PRIMARY, pdftotext):
  * Land, power and shell guarantees for AI-cloud partners: maximum $3.5B.
  * SB Energy / OpenAI PORTS-Pike guarantees capped at $105B, phased in from FY2029.
  * AI-cloud agreements: $36B of commitments.
  * Accounts receivable $63.1B (DSO 60 days, "extended payment terms ... with certain
    investment-grade customers").
  * These are credit-channel links, recorded in `context.credit_links`. The ACIE split
    (neocloud / sovereign / enterprise) is not disclosed.
* **Oracle** — Q1 FY27 slides (PRIMARY): operating cash flow $23B; capex $28B; free cash flow
  −$5B; $20B at-the-market equity issuance; RPO $664B; FY27 revenue guide $90B+. FY27 capex of
  $90–95B (net cash ≤ $70B) comes from call coverage (SECONDARY).
* **AMD / Intel / Marvell** — no hyperscaler split disclosed, so the assumptions are unchanged.
  * AMD 10-K FY2025 R55: no ≥10% customer in 2024–25 (2023 Customer A 18%); FY2025 Data Center
    $16,635M of $34,639M.
  * Marvell FY2026 10-K (via search): one distributor 37% of revenue; largest direct customer 14%.
  * Intel FY2025 10-K: DCAI growth "due to higher hyperscale customer-related demand"
    (qualitative only).
* **Vertiv / Eaton** — no primary data-centre share found. The Eaton IR PDFs returned 503 and
  Vertiv's Q3-2026 release has no end-market split. Both stay UNVERIFIED.
* **CEG / VST** — contracts are disclosed in MW, not as a share of revenue (in `context.power_contracts`):
  * Microsoft–Crane: about 835 MW, 20 years, online around 2028.
  * Meta–Clinton: about 1.1 GW. UNVERIFIED because the DCD page returned 403.
  * Vistra–AWS: 1.2 GW from Comanche Peak, 20 years, deliveries from 2027.
  * The assumptions are unchanged.

### India Tier A / C / D
* **ABB India** — ICICI Securities Q2 CY26 note: "Management highlighted data centres as one of the
  fastest-growing end markets, contributing 15–17% of quarterly order inflows".
* **Schneider Electric** — Reuters via Yahoo (25-May-2026): "Data centers currently account for 15%
  to 20% of Schneider Electric's India business". This covers the whole India business, not the
  listed SEIL entity, so it is UNVERIFIED as a proxy.
* **GE Vernova T&D India** — Q1 FY27 call (Cofacto): "Rs.1,300 Cr US data center RPT order has not
  been booked in Q1 ... expects booking in Q2 or Q3"; backlog ₹20,900 cr; exports 10–15% of backlog.
* **Hitachi Energy India** — Q1 FY27 release: "data centers contributed significantly, followed by
  industries and renewables"; exports 33.6% of orders excluding HVDC. No number, so the quantity is
  unchanged (noted in context).
* **Siemens Energy India, OFSS, TARIL, Polycab, KEI, E2E, Kaynes, Dixon, CG Power, MosChip** —
  no quantified AI or data-centre revenue link was found, so the universe assumptions stand.
  * Polycab: exports 3.3% of Q1 FY27 revenue.
  * KEI: exports about 9.7%.
  * Kaynes: OSAT revenue only starts in Q3 FY27.
  * E2E: Q1 FY27 revenue ₹156.8 cr; about 5,100 GPUs live; ₹1,000 cr sovereign Blackwell order
    through June 2029.
  * TARIL: order book ₹6,630 cr, driven by PGCIL; no data-centre orders found.

### Context only (no quantity changes)
Hyperscaler 2026 capex guidance, in `context.capex_guidance_2026`, all SECONDARY:

| Company | Guidance | Source date |
|---|---|---|
| META | $130–145B, including finance-lease principal | Q2 release, 29-Jul-2026 |
| GOOGL | $195–205B, raised from $180–190B | |
| AMZN | about $220B, raised from about $200B | |
| MSFT | higher capex in FY27; calendar 2026 about $175B after a lease-accounting change (about $190B before) | |
| ORCL | FY27 $90–95B | |

The MSFT, GOOGL and AMZN Q3 results (28–29 Oct 2026) were not yet available.

## 3. Blocked or unreadable sources (not bypassed)
* 403: infosys.com fact sheet, tcs.com (fact sheet and press release), ticker.finology.in,
  datacenterdynamics.com, spglobal.com, the jpx.co.jp trading-hours PDF (so `jpx_trading_hours`
  stays SECONDARY).
* 503: NSE archives (HCLTech investor release, Tata Elxsi presentation), hcltech.com,
  eaton.com IR PDFs.
* 404: Globe and Mail Eaton transcript; the guessed LTM fact-sheet and TSMC management-report URLs.
* PDFs that WebFetch saved but could not read were extracted with `pdftotext`, each in its own
  scratchpad folder: NVIDIA CFO commentary, TSMC press release, Tech Mahindra and Persistent decks,
  LTTS release, ICICI notes (Mphasis, ABB India), Oracle slides.
