// Shared line-icon set for the guided UI (24×24, stroke = currentColor). Owned by the orchestrator;
// add icons here (not ad hoc inside views) so channels/tiers/concepts look the same everywhere.
import type { CSSProperties } from 'react';

const PATHS: Record<string, string[]> = {
  chip: ['M7 7h10v10H7z', 'M9 3v4M12 3v4M15 3v4M9 17v4M12 17v4M15 17v4M3 9h4M3 12h4M3 15h4M17 9h4M17 12h4M17 15h4'],
  cloud: ['M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.3 9.2 4.4 4.4 0 0 0 7 18z'],
  bolt: ['M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z'],
  code: ['M3 4h18v16H3z', 'M9.5 9.5 7 12l2.5 2.5M14.5 9.5 17 12l-2.5 2.5'],
  building: ['M4 21V6l8-3 8 3v15', 'M3 21h18', 'M9.5 21v-4h5v4', 'M8 9h1M11.5 9h1M15 9h1M8 13h1M11.5 13h1M15 13h1'],
  laptop: ['M4.5 5.5h15v10h-15z', 'M2 19h20'],
  server: ['M4 3.5h16v6H4zM4 12h16v6H4z', 'M7.5 6.5h.01M7.5 15h.01M11 6.5h5M11 15h5', 'M9 21h6M12 18v3'],
  rupee: ['M6.5 4h11M6.5 8.5h11', 'M6.5 4c4.6 0 7 1.5 7 4.5S11 13 6.5 13l8 7'],
  trendDown: ['M3 7l6 6 4-4 8 8', 'M15 17h6v-6'],
  trendUp: ['M3 17l6-6 4 4 8-8', 'M15 7h6v6'],
  pulse: ['M3 12h4l3-7 4 14 3-7h4'],
  bank: ['M3 10l9-6 9 6', 'M5 10v8M9.5 10v8M14.5 10v8M19 10v8', 'M3 21h18'],
  tag: ['M3 12.5V4h8.5L21 13.5 13.5 21 3 12.5z', 'M7.5 8.5h.01'],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.6 9.2a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .8-1 1.6v.3', 'M12 16.8h.01'],
  book: ['M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z', 'M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3.5 2'],
  target: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z', 'M12 12.8a.8.8 0 1 0 0-1.6.8.8 0 0 0 0 1.6z'],
  flow: ['M4 7h13M14 4l3 3-3 3', 'M20 17H7M10 14l-3 3 3 3'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z'],
  shield: ['M12 3l8 3v6c0 4.6-3.4 8.3-8 9-4.6-.7-8-4.4-8-9V6l8-3z', 'M8.8 12.2l2.2 2.2 4.3-4.4'],
  dice: ['M4 4h16v16H4z', 'M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01'],
  play: ['M7 4.5v15l12-7.5z'],
  arrowRight: ['M4 12h15', 'M13 6l6 6-6 6'],
  sliders: ['M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0', 'M16 4v4M10 10v4M18 16v4'],
  factory: ['M3 21V10l6 3.5V10l6 3.5V5h6v16z', 'M3 21h18', 'M7 17h2M12 17h2M17 17h2'],
  people: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M2.5 20a6.5 6.5 0 0 1 13 0', 'M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.5a6.5 6.5 0 0 1 3.5 5.5'],
  warning: ['M12 3.5 2.5 20h19L12 3.5z', 'M12 10v4.5M12 17.5h.01'],
  check: ['M4.5 12.5l4.5 4.5 10-10'],
  close: ['M6 6l12 12M18 6 6 18'],
  layers: ['M12 3 2.5 8 12 13l9.5-5L12 3z', 'M2.5 12.5 12 17.5l9.5-5', 'M2.5 16.5 12 21.5l9.5-5'],
  terminal: ['M3 4.5h18v15H3z', 'M7 9.5l3 2.5-3 2.5M12.5 15h4.5'],
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  color = 'currentColor',
  strokeWidth = 1.7,
  title,
  style,
  className,
}: {
  name: IconName | string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  title?: string;
  style?: CSSProperties;
  className?: string;
}) {
  const paths = PATHS[name] ?? PATHS.help;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      className={className}
      style={{ flex: '0 0 auto', ...style }}
    >
      {title ? <title>{title}</title> : null}
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS) as IconName[];
