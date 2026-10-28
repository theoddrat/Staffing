// Thin ECharts wrapper shared by all panels. Dark terminal palette; resizes with its container.
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export const CHART_COLORS = {
  amber: '#ffb000',
  amberDim: '#a87400',
  green: '#00d26a',
  red: '#ff3b3b',
  cyan: '#33c7ff',
  magenta: '#ff5fd2',
  white: '#e6e6e6',
  grey: '#7a7a7a',
  grid: '#262626',
  tiers: { A: '#33c7ff', B: '#ffb000', C: '#ff5fd2', D: '#00d26a' } as Record<string, string>,
};

export const baseOption = {
  backgroundColor: 'transparent',
  textStyle: { fontFamily: "'JetBrains Mono', monospace", color: CHART_COLORS.amber, fontSize: 11 },
  grid: { left: 56, right: 18, top: 28, bottom: 36, containLabel: false },
  tooltip: {
    backgroundColor: '#0d0d0d',
    borderColor: CHART_COLORS.amberDim,
    textStyle: { color: CHART_COLORS.white, fontFamily: "'JetBrains Mono', monospace", fontSize: 11 },
  },
  legend: { textStyle: { color: CHART_COLORS.amber, fontSize: 10 }, top: 0 },
};

export function axisStyle(extra: Record<string, unknown> = {}) {
  return {
    axisLine: { lineStyle: { color: CHART_COLORS.grey } },
    axisLabel: { color: CHART_COLORS.amber, fontSize: 10 },
    splitLine: { lineStyle: { color: CHART_COLORS.grid } },
    nameTextStyle: { color: CHART_COLORS.amberDim, fontSize: 10 },
    ...extra,
  };
}

interface ChartProps {
  option: echarts.EChartsCoreOption;
  height?: number | string;
  className?: string;
  onClick?: (params: any) => void;
  /** Merge with baseOption (default true). */
  themed?: boolean;
}

export default function Chart({ option, height = 280, className, onClick, themed = true }: ChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    inst.current = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    const ro = new ResizeObserver(() => {
      if (inst.current && !inst.current.isDisposed()) inst.current.resize();
    });
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      if (inst.current && !inst.current.isDisposed()) inst.current.dispose();
      inst.current = null;
    };
  }, []);

  useEffect(() => {
    if (!inst.current || inst.current.isDisposed()) return;
    const merged = themed ? { ...baseOption, ...option } : option;
    inst.current.setOption(merged as echarts.EChartsCoreOption, { notMerge: true, lazyUpdate: true });
  }, [option, themed]);

  useEffect(() => {
    const chart = inst.current;
    if (!chart || chart.isDisposed() || !onClick) return;
    chart.on('click', onClick);
    return () => {
      if (!chart.isDisposed()) chart.off('click', onClick);
    };
  }, [onClick]);

  return <div ref={ref} className={className} style={{ width: '100%', height }} />;
}
