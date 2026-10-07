# Bracelet Hunt: AI poker coach

Play WSOP-style no-limit hold'em tournaments against AI opponents modeled on famous pros (Phil Ivey, Daniel Negreanu, Phil Hellmuth, Doyle Brunson, Johnny Chan, Erik Seidel, Michael Mizrachi and more). A GTO-approximate coach grades every decision you make, and the app builds a profile of **your** style and leaks as you play.

```bash
cd poker-coach
npm start          # http://localhost:5173  (no dependencies to install)
npm test           # 28 tests: engine, side pots, equity, Nash push/fold, stats, importer, bots
```

Requires Node 18+. Everything runs in the browser; your data stays in local storage (export/import a backup from **Settings**).

## What it does

| Tab | What you get |
|---|---|
| **Play** | Single-table tournaments on a WSOP Main Event–style structure (60,000 chips, 100/200 with a 200 big-blind ante, rising every N hands), plus Turbo, Main Event Final Table (uneven stacks, ICM), Heads-Up, and a 100bb practice mode. The coach docks beside the table: live hints, or feedback after you act, or quiet mode. |
| **My Style** | Style classification (TAG, LAG, Nit, Calling Station, ...), which pro you play most like, a stat "fingerprint" vs a solid baseline, stat leaks, accuracy by decision spot, accuracy trend per tournament, VPIP/PFR by position, recent mistakes, and an optional Claude-written study plan. |
| **Opponents** | Profile cards for 15 pros and 6 field archetypes: verified WSOP facts, modeled tendencies, measured HUD stats, and what you've observed against them. Clone real opponents from imported hand histories, or play your **Mirror** (an AI built from your own stats). |
| **Hands** | Every hand you played with each decision graded, the coach's reasoning, the full hand history, and "Ask Claude about this hand". |
| **Train** | Drills (open or fold, big-blind defense, push or fold, pot odds and MDF) and range charts, including heads-up Nash push/fold solved live at any stack depth. |
| **Import** | Paste or upload PokerStars-format hand histories (GGPoker and most sites use the same format). Your hands feed My Style; every opponent gets a HUD profile you can study or clone. |

## How the "GTO" coach works

The coach approximates game-theory-optimal play from established theory; it is not a solver.

- **Preflop:** position-based opening ranges for BB-ante tournaments (UTG ~15% up to BTN ~54%), 3-bet/call ranges vs each opener group (polarized 3-bets with suited-ace bluffs, wide big-blind defense), 4-bet/5-bet ranges, and continue ranges vs 3-bets that scale with how wide you opened.
- **Short stacks:** a Nash push/fold solver (fictitious play over the 169 hand classes and a precomputed 169×169 all-in equity matrix) handles open-shoves, re-shoves and calling all-ins. In tournaments with payouts it uses **ICM** (Malmuth–Harville) for both your shove EV and opponents' calling thresholds. Heads-up it reproduces published Nash charts (10bb: jam ~58%, call ~37%).
- **Postflop:** every player's range is tracked through the hand and narrowed by each action. The coach then:
  - bets the top of your range for value, adding bluffs at the ratio the bet size supports (`s/(1+s)` bluffs per value combo on the river, more on earlier streets where bluffs have equity), and prefers draws as bluffs;
  - sizes bets from board texture and range or nut advantage (small and frequent on dry boards where you're ahead, larger and polarized on wet boards or with a nut advantage);
  - facing a bet, compares your equity with the pot odds (adjusted for position and implied odds) and blends that with **minimum defense frequency**;
  - raises the very top of your range plus strong draws as semi-bluffs.
- **Grading:** each decision is scored by how often the model's mixed strategy takes the action you chose (Best, Good, Inaccuracy, Mistake, Blunder). EV given up is estimated wherever the math is clean: calls and folds against a price, and push/fold spots.

Because it's an approximation, treat individual grades as strong guidance. Patterns over many hands, which the My Style report surfaces, are what matter.

## The AI opponents

Each bot starts from the coach's strategy and bends it with its profile: range widths, aggression, bluffing, calling-down tendency, c-betting, bet sizing habits (small-ball, overbets, varied), slow-playing, tilt after big losses, and **adaptation**. Adaptive bots read your HUD (fold to c-bet, fold to 3-bet, WTSD, aggression, fold to steal) and exploit it. When one does, the coach tells you, e.g. *"Ivey is 3-betting you lighter — you fold to 3-bets 72% of the time."*

The "measured HUD" on each card comes from simulation (`npm run simulate -- 6000 cash --calibrate`), not invented numbers.

**About the pro profiles.** WSOP facts (bracelets and notable results) are current through the 2026 WSOP: Hellmuth holds the record with 17 bracelets; Ivey won his 11th in the 2024 $10K 2-7 Triple Draw; Negreanu won his 8th in the 2026 $100K PLO High Roller; Mizrachi won the 2025 Main Event and his 9th bracelet in the 2026 $10K PLO Championship. Playing tendencies are **modeled from public reputation** (books, interviews, televised play), not from private hand data. They are practice caricatures. Not affiliated with the WSOP or any player.

## Optional: Claude as your coach

The study plan and hand reviews call Claude (`claude-opus-5-5`) through the official Anthropic SDK, loaded in the browser with your own API key (Settings → AI coach; the key is sent only to `api.anthropic.com` and is stored only if you tick "remember"). When the app runs as a published Claude artifact it uses the page's built-in Claude access instead, so no key is needed, and it syncs your data to your private per-user storage.

## Project layout

```
poker-coach/
  index.html, css/app.css, server.js     zero-dependency web app
  src/engine/    cards, 7-card evaluator, ranges & combos, equity (MC + exact),
                 NLHE hand state machine (side pots, min-raise rules), tournament, ICM
  src/gto/       charts, push/fold solver, preflop policy, postflop model,
                 range tracking (HandModel), advisor + decision grading
  src/ai/        pro/archetype profiles, profile-driven adaptive bot
  src/stats/     hand records, HUD stats, style/leaks/tendencies, hand-history importer
  src/app/       UI-agnostic game session (also used by the simulator)
  src/coach/     optional Claude coach
  src/ui/        views (play, report, opponents, hands, train, import), charts, storage
  scripts/       build-equity.js (169×169 matrix), simulate.js (calibration), build-artifact.js
  test/          node:test suites
```

Useful scripts:

```bash
npm run simulate -- 1500 cash          # bot-vs-bot run: per-profile HUD and win rates
npm run simulate -- 6000 cash --calibrate   # regenerate src/data/profileHud.js
npm run build:equity -- 12000          # regenerate the preflop equity matrix (~2 min)
node scripts/build-artifact.js dist    # single-page build for hosting
```

## Limitations

- The postflop model is theory-driven, not solved; its frequencies are approximations.
- Single-table tournaments only; multiway push/fold uses a single-caller approximation.
- Hand-history import supports PokerStars-style text for no-limit hold'em.
