// Opponent profiles.
//
// Pro profiles pair verified WSOP facts (bracelet counts and results as of the
// 2026 WSOP) with *modeled* tendencies based on each player's public
// reputation: books, interviews and televised play. They are not built from
// private hand data. Treat them as practice caricatures, not scouting reports.
//
// Tendency knobs (1 = GTO baseline):
//   openMult / threeBetMult / callMult  preflop range widths
//   limpFreq          share of opens that limp instead
//   foldTo3BetMult    >1 folds more to 3-bets
//   shoveMult         looseness of all-in shoves and calls
//   aggression        bet/raise frequency multiplier postflop
//   bluff             bluff frequency multiplier
//   stickiness        >1 calls down more, <1 folds more
//   cbet              flop continuation-bet multiplier
//   sizing            'small' | 'standard' | 'big' | 'overbet' | 'varied'
//   openSizeBB        preflop open size
//   trap              slow-play propensity with monsters (0..1)
//   adapt             how hard they exploit your tendencies (0..1)
//   tilt              how much they spew after losing big pots (0..1)

export const BASELINE = {
  openMult: 1, threeBetMult: 1, callMult: 1, limpFreq: 0, foldTo3BetMult: 1, shoveMult: 1,
  aggression: 1, bluff: 1, stickiness: 1, cbet: 1, sizing: 'standard', openSizeBB: 2.2,
  trap: 0.1, adapt: 0.5, tilt: 0,
};

const pro = (p) => ({ kind: 'pro', ...p, tendencies: { ...BASELINE, ...p.tendencies } });
const arch = (p) => ({ kind: 'archetype', ...p, tendencies: { ...BASELINE, ...p.tendencies } });

export const PROFILES = [
  pro({
    id: 'ivey', name: 'Phil Ivey', short: 'Ivey', color: '#7c5cff',
    style: 'LAG', tagline: 'Fearless, balanced aggression with elite reads',
    wsop: { bracelets: 11, facts: [
      '11 WSOP bracelets — second only to Phil Hellmuth on the all-time list',
      '11th bracelet: 2024 $10,000 Deuce-to-Seven Triple Draw Championship, his first since 2014',
      'Poker Hall of Fame member',
    ] },
    bio: 'Widely regarded as the most complete player of his generation. Plays a wide range from late position, applies relentless pressure when checked to, and is famous for reading spots where opponents are weak. Adjusts quickly to how you play.',
    tendencies: { openMult: 1.3, threeBetMult: 1.5, callMult: 1.15, aggression: 1.3, bluff: 1.3, stickiness: 1.1, cbet: 1.05, sizing: 'varied', openSizeBB: 2.2, trap: 0.2, adapt: 0.95, shoveMult: 1.05 },
  }),
  pro({
    id: 'negreanu', name: 'Daniel Negreanu', short: 'Negreanu', color: '#ff7a59',
    style: 'Small-ball LAG', tagline: '"Small ball": lots of pots, small bets, big reads',
    wsop: { bracelets: 8, facts: [
      '8 WSOP bracelets',
      '8th bracelet: 2026 $100,000 High Roller Pot-Limit Omaha ($2,257,718)',
      '7th bracelet: 2024 $50,000 Poker Players Championship',
    ] },
    bio: 'Popularized the "small ball" approach in Power Hold\'em Strategy: open small, see many flops in position, keep pots manageable and outplay opponents with hand reading. Calls more than most pros and makes thin hero-calls.',
    tendencies: { openMult: 1.35, threeBetMult: 0.95, callMult: 1.7, aggression: 1.0, bluff: 1.0, stickiness: 1.25, cbet: 1.1, sizing: 'small', openSizeBB: 2.0, trap: 0.25, adapt: 0.85 },
  }),
  pro({
    id: 'hellmuth', name: 'Phil Hellmuth', short: 'Hellmuth', color: '#e2b93b',
    style: 'Tight / reads-first', tagline: '"White Magic": tight, patient, big laydowns',
    wsop: { bracelets: 17, facts: [
      '17 WSOP bracelets — the all-time record',
      '1989 Main Event champion',
      'Runner-up in Event #99 on the final day of the 2026 WSOP',
    ] },
    bio: 'Calls his read-based style "White Magic": avoids marginal big pots, limps or min-raises to see cheap flops, makes huge laydowns and lets aggressive players bluff off their stacks. Known as the "Poker Brat" — he can steam after a bad beat.',
    tendencies: { openMult: 0.8, threeBetMult: 0.7, callMult: 1.1, limpFreq: 0.12, foldTo3BetMult: 1.25, aggression: 0.85, bluff: 0.7, stickiness: 0.8, cbet: 0.9, sizing: 'small', openSizeBB: 2.0, trap: 0.4, adapt: 0.65, tilt: 0.6, shoveMult: 0.9 },
  }),
  pro({
    id: 'brunson', name: 'Doyle Brunson', short: 'Brunson', color: '#b0703c',
    style: 'Old-school LAG', tagline: 'Super/System aggression — "Texas Dolly" (1933–2023)',
    wsop: { bracelets: 10, facts: [
      '10 WSOP bracelets',
      'Back-to-back Main Event champion, 1976 and 1977 — winning both final hands holding 10-2',
      'Author of Super/System',
    ] },
    bio: 'The godfather of aggressive no-limit hold\'em. Super/System taught a generation to play suited connectors, attack weakness and keep betting when opponents show reluctance. A legend profile honoring his style.',
    tendencies: { openMult: 1.45, threeBetMult: 1.2, callMult: 1.4, aggression: 1.4, bluff: 1.3, stickiness: 1.0, cbet: 1.2, sizing: 'big', openSizeBB: 2.5, trap: 0.1, adapt: 0.7 },
  }),
  pro({
    id: 'chan', name: 'Johnny Chan', short: 'Chan', color: '#2fb8a3',
    style: 'Trapping TAG', tagline: '"The Orient Express" — patient, deadly trapper',
    wsop: { bracelets: 10, facts: [
      '10 WSOP bracelets',
      'Back-to-back Main Event champion, 1987 and 1988',
      'His 1988 final hand against Erik Seidel is replayed in the film Rounders',
    ] },
    bio: 'Famous for letting opponents hang themselves: in 1988 he checked a flopped straight and let Seidel move in. Plays solid ranges, slow-plays monsters more than most, and picks his spots.',
    tendencies: { openMult: 1.0, threeBetMult: 0.95, callMult: 1.1, aggression: 1.05, bluff: 0.9, stickiness: 1.05, cbet: 0.95, trap: 0.55, adapt: 0.7 },
  }),
  pro({
    id: 'seidel', name: 'Erik Seidel', short: 'Seidel', color: '#5b8def',
    style: 'TAG', tagline: 'Quiet, disciplined, decades of consistency',
    wsop: { bracelets: 10, facts: [
      '10 WSOP bracelets',
      'Runner-up to Johnny Chan in the 1988 Main Event',
      'Poker Hall of Fame member',
    ] },
    bio: 'One of the most respected tournament players ever — calm, low-variance, rarely makes a big mistake. Solid ranges, sensible sizing, few fancy plays.',
    tendencies: { openMult: 0.95, threeBetMult: 1.0, callMult: 0.95, aggression: 1.0, bluff: 0.85, stickiness: 0.92, cbet: 1.0, adapt: 0.7 },
  }),
  pro({
    id: 'mizrachi', name: 'Michael Mizrachi', short: 'Mizrachi', color: '#d6456b',
    style: 'Aggro grinder', tagline: '"The Grinder" — relentless pressure, never gives up',
    wsop: { bracelets: 9, facts: [
      '2025 Main Event champion ($10,000,000) — after surviving with about three big blinds on Day 8',
      'Four-time $50,000 Poker Players Championship winner',
      '9th bracelet: 2026 $10,000 Pot-Limit Omaha Championship',
    ] },
    bio: 'Plays a high-pressure, high-volume game: lots of raises, aggressive re-steals and fearless short-stack play. Inducted into the Poker Hall of Fame in 2025.',
    tendencies: { openMult: 1.3, threeBetMult: 1.4, callMult: 1.1, aggression: 1.3, bluff: 1.2, stickiness: 1.0, cbet: 1.1, shoveMult: 1.15, adapt: 0.8 },
  }),
  pro({
    id: 'deeb', name: 'Shaun Deeb', short: 'Deeb', color: '#8fbf3f',
    style: 'Volume LAG', tagline: 'High-volume, high-variance aggression',
    wsop: { bracelets: 9, facts: [
      '9 WSOP bracelets',
      '9th bracelet: 2026 $1,500 Eight-Game Mix',
    ] },
    bio: 'Plays a huge schedule and embraces variance: wide opens, frequent 3-bets, and he is happy to gamble in big pots.',
    tendencies: { openMult: 1.35, threeBetMult: 1.35, callMult: 1.25, aggression: 1.3, bluff: 1.15, stickiness: 1.15, cbet: 1.1, shoveMult: 1.15, adapt: 0.6 },
  }),
  pro({
    id: 'ungar', name: 'Stu Ungar', short: 'Ungar', color: '#c05cd6',
    style: 'Hyper-LAG', tagline: 'Three-time Main Event champion — fearless genius',
    wsop: { bracelets: 5, facts: [
      'Main Event champion in 1980, 1981 and 1997',
      '5 WSOP bracelets',
    ] },
    bio: 'Legendary for relentless aggression and uncanny reads, including famous hero calls. A legend profile: expect constant pressure and wide ranges.',
    tendencies: { openMult: 1.55, threeBetMult: 1.8, callMult: 1.2, aggression: 1.6, bluff: 1.5, stickiness: 1.15, cbet: 1.2, sizing: 'big', openSizeBB: 2.5, adapt: 0.9, shoveMult: 1.2 },
  }),
  pro({
    id: 'selbst', name: 'Vanessa Selbst', short: 'Selbst', color: '#ff5fa2',
    style: 'Hyper-aggressive', tagline: 'Light 3-bets, 4-bet bluffs and big overbets',
    wsop: { bracelets: 3, facts: ['3 WSOP bracelets'] },
    bio: 'Known for redefining aggression in tournaments: light 3-bets and 4-bets, polarized overbets, and constant pressure on the river.',
    tendencies: { openMult: 1.4, threeBetMult: 2.2, callMult: 0.9, aggression: 1.5, bluff: 1.45, stickiness: 0.95, cbet: 1.15, sizing: 'overbet', adapt: 0.8, shoveMult: 1.15 },
  }),
  pro({
    id: 'bonomo', name: 'Justin Bonomo', short: 'Bonomo', color: '#3fb0e0',
    style: 'Solver / GTO', tagline: 'Modern, theory-driven, hard to exploit',
    wsop: { bracelets: 3, facts: [
      '3 WSOP bracelets',
      'Won the 2018 $1,000,000 Big One for One Drop for $10,000,000',
    ] },
    bio: 'A modern high roller whose game is built on solver study: balanced ranges, mixed sizings and few exploitable leaks.',
    tendencies: { openMult: 1.02, threeBetMult: 1.05, callMult: 1.0, aggression: 1.05, bluff: 1.0, stickiness: 1.0, sizing: 'varied', adapt: 0.45 },
  }),
  pro({
    id: 'holz', name: 'Fedor Holz', short: 'Holz', color: '#6fcf97',
    style: 'Solver / GTO', tagline: 'High-roller precision',
    wsop: { bracelets: 2, facts: [
      '2016 $111,111 High Roller for One Drop champion',
      '2020 WSOP Online $25,000 Heads-Up champion',
      'Runner-up in the 2018 Big One for One Drop',
    ] },
    bio: 'One of the defining high-roller players of the late 2010s: theory-first, aggressive when ranges allow it, and disciplined in big spots.',
    tendencies: { openMult: 1.05, threeBetMult: 1.15, callMult: 0.95, aggression: 1.1, bluff: 1.05, stickiness: 0.98, sizing: 'varied', adapt: 0.55 },
  }),
  pro({
    id: 'dwan', name: 'Tom Dwan', short: 'Dwan', color: '#f2994a',
    style: 'Ultra-LAG', tagline: '"durrrr" — huge bluffs in huge pots',
    wsop: { bracelets: 0, facts: [
      'No WSOP bracelet — made his name in high-stakes televised cash games',
    ] },
    bio: 'Famous for fearless, creative aggression on TV cash games: wide ranges, big overbets and multi-street bluffs. Included because he is the classic "can you call him down?" test.',
    tendencies: { openMult: 1.75, threeBetMult: 2.0, callMult: 1.3, aggression: 1.7, bluff: 1.7, stickiness: 1.05, cbet: 1.2, sizing: 'overbet', openSizeBB: 2.5, adapt: 0.85, shoveMult: 1.2 },
  }),
  pro({
    id: 'harman', name: 'Jennifer Harman', short: 'Harman', color: '#9b8afb',
    style: 'TAG', tagline: 'Big-game veteran with a solid aggressive core',
    wsop: { bracelets: 2, facts: ['WSOP bracelets in 2000 and 2002'] },
    bio: 'A longtime fixture of the biggest cash games. Solid, well-timed aggression and a tough player to bluff.',
    tendencies: { openMult: 1.0, threeBetMult: 1.05, callMult: 1.0, aggression: 1.1, bluff: 0.95, stickiness: 1.05, adapt: 0.7 },
  }),
  pro({
    id: 'moneymaker', name: 'Chris Moneymaker', short: 'Moneymaker', color: '#27ae60',
    style: 'Fearless amateur', tagline: 'The 2003 champion who started the poker boom',
    wsop: { bracelets: 1, facts: [
      '2003 Main Event champion after qualifying through an online satellite',
      'His win sparked the "Moneymaker effect" poker boom',
    ] },
    bio: 'An accountant-turned-champion whose 2003 run — including a famous bluff against Sam Farha — showed amateurs they could win. Plays looser than the pros and isn\'t afraid to fire.',
    tendencies: { openMult: 1.25, threeBetMult: 0.9, callMult: 1.7, limpFreq: 0.1, aggression: 1.1, bluff: 1.2, stickiness: 1.3, cbet: 1.0, adapt: 0.3 },
  }),

  // ---- archetypes you meet in every WSOP field (not real people)
  arch({
    id: 'gto', name: 'GTO Bot', short: 'GTO', color: '#94a3b8', style: 'Baseline',
    tagline: 'Plays the advisor\'s strategy straight — your benchmark',
    bio: 'Uses the exact same model as the coach, with no adjustments. Great for checking whether your edge is real.',
    tendencies: { adapt: 0 },
  }),
  arch({
    id: 'rec', name: 'Main Event Amateur', short: 'Amateur', color: '#a3a3a3', style: 'Loose-passive',
    tagline: 'Plays too many hands, calls too much, rarely bluffs',
    bio: 'The classic dream-seat opponent: limps, calls with any pair or draw, and pays off big bets. Value bet relentlessly; don\'t bluff.',
    tendencies: { openMult: 1.2, threeBetMult: 0.5, callMult: 2.4, limpFreq: 0.6, foldTo3BetMult: 0.7, aggression: 0.6, bluff: 0.45, stickiness: 1.7, cbet: 0.7, sizing: 'small', adapt: 0, shoveMult: 1.2 },
  }),
  arch({
    id: 'grinder', name: 'Online Grinder', short: 'Grinder', color: '#64748b', style: 'TAG',
    tagline: 'Solid, chart-based, slightly too foldy vs aggression',
    bio: 'Knows the charts and c-bets a lot, but gives up too often when raised. Attack with check-raises and 3-bets.',
    tendencies: { openMult: 1.05, threeBetMult: 1.1, callMult: 0.9, foldTo3BetMult: 1.2, aggression: 1.1, bluff: 1.0, stickiness: 0.85, cbet: 1.25, adapt: 0.4 },
  }),
  arch({
    id: 'nit', name: 'The Nit', short: 'Nit', color: '#78716c', style: 'Nit',
    tagline: 'Only plays premiums — believe the bets',
    bio: 'Folds almost everything, and when they bet big they have it. Steal their blinds and fold to their aggression.',
    tendencies: { openMult: 0.55, threeBetMult: 0.5, callMult: 0.6, foldTo3BetMult: 1.4, aggression: 0.8, bluff: 0.3, stickiness: 0.75, cbet: 0.85, adapt: 0.1, shoveMult: 0.8 },
  }),
  arch({
    id: 'maniac', name: 'The Maniac', short: 'Maniac', color: '#ef4444', style: 'Maniac',
    tagline: 'Raises everything — trap and call down',
    bio: 'Plays most hands aggressively and bluffs constantly. Let them bet into you and call down lighter than normal.',
    tendencies: { openMult: 2.3, threeBetMult: 2.8, callMult: 1.4, aggression: 1.9, bluff: 2.0, stickiness: 1.2, cbet: 1.35, sizing: 'big', openSizeBB: 3, adapt: 0.1, tilt: 0.3, shoveMult: 1.4 },
  }),
  arch({
    id: 'station', name: 'Calling Station', short: 'Station', color: '#0ea5e9', style: 'Calling station',
    tagline: 'Never folds a pair — never bluff them',
    bio: 'Calls with anything that has a chance. Bet big with value hands, check back your bluffs.',
    tendencies: { openMult: 1.0, threeBetMult: 0.6, callMult: 2.8, limpFreq: 0.5, foldTo3BetMult: 0.6, aggression: 0.55, bluff: 0.4, stickiness: 2.2, cbet: 0.8, adapt: 0, shoveMult: 1.3 },
  }),
];

export const PROFILE_BY_ID = new Map(PROFILES.map((p) => [p.id, p]));

export function getProfile(id) {
  return PROFILE_BY_ID.get(id) || null;
}

export const DEFAULT_LINEUP = ['ivey', 'negreanu', 'hellmuth', 'mizrachi', 'seidel', 'dwan', 'chan', 'rec'];
