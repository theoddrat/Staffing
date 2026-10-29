"""Model zoo metadata (ModelSpec in src/types/data.ts): one plain-language sentence per model."""
from __future__ import annotations

SCEN = ["SOX", "NDX", "PARENT", "NIFTY (implied by the Nifty model)"]

MODEL_SPECS = [
    {"id": "zero", "label": "No change", "family": "baseline", "mode": "scenario", "scenario_usable": False, "features": [],
     "description": "Always predicts that the stock does not move. Every other model must beat this to be worth anything."},
    {"id": "ols", "label": "Original 3-year fit", "family": "linear", "mode": "scenario", "scenario_usable": True, "features": SCEN,
     "description": "How the stock moved the session after US chip stocks, US tech, its parent and the Nifty moved, fitted on the last 3 years (ordinary least squares)."},
    {"id": "ols_rf", "label": "Direct US link", "family": "linear", "mode": "scenario", "scenario_usable": True, "features": ["SOX", "NDX", "PARENT"],
     "description": "Links the stock straight to the US moves, without a separate Nifty step, so the market-wide Indian reaction is folded into its sensitivities."},
    {"id": "dimson", "label": "Delayed reaction", "family": "linear", "mode": "scenario", "scenario_usable": True,
     "features": ["SOX", "SOX (one session earlier)", "NDX", "NDX (one session earlier)", "PARENT", "NIFTY"],
     "description": "Allows Indian prices to take two sessions to absorb a US move; a scenario uses the reaction summed over both sessions."},
    {"id": "shrink", "label": "Shrunk toward peers", "family": "linear", "mode": "scenario", "scenario_usable": True, "features": SCEN,
     "description": "Pulls each stock's sensitivities part of the way toward the average of its tier, more when its own estimate is noisy (empirical Bayes)."},
    {"id": "ewma", "label": "Recent days count more", "family": "linear", "mode": "scenario", "scenario_usable": True, "features": SCEN,
     "description": "Same fit, but a day's weight halves every six months, so it adapts faster when a stock starts behaving differently."},
    {"id": "asym", "label": "Falls vs rises", "family": "linear", "mode": "scenario", "scenario_usable": True,
     "features": ["SOX on down days", "SOX on up days", "NDX", "PARENT", "NIFTY"],
     "description": "Lets the stock react differently when US chips fall than when they rise; crash scenarios use the down-day sensitivity."},
    {"id": "huber", "label": "Outlier-resistant", "family": "robust", "mode": "scenario", "scenario_usable": True, "features": SCEN,
     "description": "A robust fit (Huber) that limits the pull of extreme days such as results or scandals, so one outlier cannot dominate."},
    {"id": "gbm", "label": "Machine learning (trees)", "family": "nonlinear", "mode": "scenario", "scenario_usable": False,
     "features": ["SOX", "NDX", "PARENT", "tier", "trailing betas", "trailing volatility"],
     "description": "Gradient-boosted decision trees trained on all stocks together; it can find non-linear patterns but has no simple sensitivities, so it is only used to check accuracy."},
    {"id": "ensemble", "label": "Blend (used by the app)", "family": "stack", "mode": "scenario", "scenario_usable": True, "features": SCEN,
     "description": "A blend of the scenario models, each weighted by how well it predicted unseen days before; this is what the scenario engine uses."},
    {"id": "nowcast", "label": "Next-session nowcast", "family": "linear", "mode": "nowcast", "scenario_usable": False,
     "features": ["SOX", "NDX", "PARENT", "INDA", "EPI", "SMIN", "IGV", "TWII", "KS11", "TNX", "DXY", "USDINR", "ADR", "own previous return", "Nifty previous return"],
     "description": "Uses every clue known before the Indian close: US-listed India funds, the stock's US-listed shares, US software, Taiwan and Korea, US yields, the dollar and the rupee. A model check, not a scenario tool."},
    {"id": "nowcast_pre", "label": "Before-the-open nowcast", "family": "linear", "mode": "nowcast", "scenario_usable": False,
     "features": ["SOX", "NDX", "PARENT (if it closes after India)", "INDA", "EPI", "SMIN", "IGV", "TNX", "DXY", "USDINR", "ADR", "own previous return", "Nifty previous return"],
     "description": "The same clues minus markets that trade during Indian hours (Taiwan, Korea, Japan): only what is known before the NSE opens."},
    {"id": "gbm_now", "label": "Machine-learning nowcast", "family": "nonlinear", "mode": "nowcast", "scenario_usable": False,
     "features": ["all nowcast clues", "tier", "trailing betas", "trailing volatility"],
     "description": "Gradient-boosted trees on all the nowcast clues, trained on all stocks together; checks whether non-linear patterns add anything."},
]

SPEC_BY_ID = {s["id"]: s for s in MODEL_SPECS}
