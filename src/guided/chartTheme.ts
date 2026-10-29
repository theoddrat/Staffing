// Hex mirrors of src/styles/guided-tokens.css for canvas charts (ECharts cannot read CSS variables).
export const GC = {
  bg: '#050608',
  card: '#0e1014',
  card2: '#151820',
  line: '#262a33',
  grid: '#1b1f27',
  text: '#ece9e2',
  muted: '#9aa1ab',
  faint: '#5f6671',
  accent: '#ffb000',
  up: '#34d17f',
  down: '#ff5c5c',
  neutral: '#2a2f38',
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  sans: "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
};

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const k = Math.min(1, Math.max(0, t));
  const c = (x: number, y: number) => Math.round(x + (y - x) * k).toString(16).padStart(2, '0');
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

/** Diverging fill for a price move: neutral grey at zero, red for falls, green for rises. */
export function moveColor(x: number, maxAbs: number): string {
  const t = maxAbs > 0 ? Math.sqrt(Math.min(1, Math.abs(x) / maxAbs)) : 0;
  return mix(GC.neutral, x < 0 ? GC.down : GC.up, t);
}

/** Near-black or near-white text, whichever reads on the fill. */
export function inkOn(hex: string): string {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.28 ? GC.bg : GC.text;
}
