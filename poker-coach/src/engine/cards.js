// Cards are integers 0..51: rank = card >> 2 (0 = deuce .. 12 = ace),
// suit = card & 3 (0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades).

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];
export const RANK_NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
export const RANK_PLURALS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

export const rankOf = (c) => c >> 2;
export const suitOf = (c) => c & 3;
export const makeCard = (rank, suit) => (rank << 2) | suit;

export function cardToString(c) {
  return RANKS[c >> 2] + SUITS[c & 3];
}

export function parseCard(str) {
  const r = RANKS.indexOf(str[0].toUpperCase());
  const s = SUITS.indexOf(str[1].toLowerCase());
  if (r < 0 || s < 0 || str.length !== 2) throw new Error(`Bad card: ${str}`);
  return makeCard(r, s);
}

/** Parse "AsKd" or "As Kd" or ["As","Kd"] into card ints. */
export function parseCards(input) {
  if (Array.isArray(input)) return input.map((c) => (typeof c === 'number' ? c : parseCard(c)));
  const s = input.replace(/[\s,]/g, '');
  const out = [];
  for (let i = 0; i < s.length; i += 2) out.push(parseCard(s.slice(i, i + 2)));
  return out;
}

export function cardsToString(cards) {
  return cards.map(cardToString).join(' ');
}

export function fullDeck() {
  const d = [];
  for (let c = 0; c < 52; c++) d.push(c);
  return d;
}

/** Fisher-Yates shuffle in place using the given rng. */
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

export class Deck {
  constructor(rng) {
    this.rng = rng;
    this.cards = shuffle(fullDeck(), rng);
    this.pos = 0;
  }
  deal(n = 1) {
    const out = this.cards.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  remaining() {
    return this.cards.slice(this.pos);
  }
}

/** Canonical 169-class label for two hole cards, e.g. "AKs", "T9o", "77". */
export function handClassLabel(c1, c2) {
  let r1 = c1 >> 2;
  let r2 = c2 >> 2;
  if (r1 < r2) [r1, r2] = [r2, r1];
  if (r1 === r2) return RANKS[r1] + RANKS[r2];
  return RANKS[r1] + RANKS[r2] + ((c1 & 3) === (c2 & 3) ? 's' : 'o');
}
