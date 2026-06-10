"use client";

// Reusable Recharts wrappers for the admin dashboard.
//
// Every chart:
//  - is wrapped in a ResponsiveContainer (reflow on resize / mobile),
//  - respects `prefers-reduced-motion` (no entrance animation when set),
//  - formats numbers fr-FR,
//  - carries an aria-label / role="img" summary so screen readers get the gist
//    without depending on color, and pairs hue with explicit labels/legends,
//  - renders its own empty + skeleton state (never a bare axis frame).

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartColors, fmt, palette, PanelEmpty } from "./ui";

// --------------------------------------------------------------------------
// Reduced-motion hook. Defaults to "reduced" (safe) until the first effect run
// so SSR / first paint never animates unexpectedly.
// --------------------------------------------------------------------------
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);
  return reduced;
}

// Shared fr-FR axis/tooltip formatters.
const axisNumber = (v: number) => v.toLocaleString("fr-FR");
const shortDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
};

// --------------------------------------------------------------------------
// Tooltip — branded card, tabular fr-FR values.
// --------------------------------------------------------------------------
interface TooltipPayloadItem {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  labelFormatter?: (v: string | number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-[#E8DFD3] bg-white px-3 py-2 shadow-md text-xs">
      {label !== undefined ? (
        <div className="font-semibold text-[#1A0F0A] mb-1">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      ) : null}
      <ul className="space-y-0.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: p.color }}
              aria-hidden="true"
            />
            <span className="text-[#5A4634]">{p.name}</span>
            <span className="ml-auto font-semibold text-[#1A0F0A] tabular-nums">
              {typeof p.value === "number" ? fmt(p.value) : p.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --------------------------------------------------------------------------
// ChartLoading — shimmer placeholder shaped like a bar chart. Respects
// reduced-motion via the motion-safe: variant (static block otherwise).
// --------------------------------------------------------------------------
export function ChartLoading({ height = 240 }: { height?: number }) {
  return (
    <div style={{ height }} className="flex items-end gap-2 px-1 pb-1">
      {[40, 65, 50, 80, 60, 90, 70, 55, 45, 75].map((h, i) => (
        <div
          key={i}
          className="flex-1 bg-[#F1E9DD] rounded-md motion-safe:animate-pulse"
          style={{ height: `${h}%` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

// ==========================================================================
// Sparkline — tiny area, no axes, for KPI cards.
// ==========================================================================
export function Sparkline({
  data,
  dataKey,
  color = palette.primary,
}: {
  data: Array<Record<string, number | string>>;
  dataKey: string;
  color?: string;
}) {
  const reduced = useReducedMotion();
  if (!data || data.length === 0) return null;
  const gradId = `spark-${dataKey}-${color.replace("#", "")}`;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          isAnimationActive={!reduced}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ==========================================================================
// TrendChart — multi-series area/line over time (the hero chart).
// ==========================================================================
export interface TrendSeries {
  dataKey: string;
  name: string;
  color: string;
}

export function TrendChart({
  data,
  series,
  height = 300,
  ariaLabel,
}: {
  data: Array<Record<string, number | string>>;
  series: TrendSeries[];
  height?: number;
  ariaLabel: string;
}) {
  const reduced = useReducedMotion();
  if (!data || data.length === 0)
    return <PanelEmpty message="Aucune donnée sur la période" />;

  return (
    <div role="img" aria-label={ariaLabel} style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
        >
          <defs>
            {series.map((s) => (
              <linearGradient
                key={s.dataKey}
                id={`trend-${s.dataKey}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={palette.border}
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fill: palette.faint, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: palette.border }}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={axisNumber}
            tick={{ fill: palette.faint, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={44}
            allowDecimals={false}
          />
          <Tooltip
            content={<ChartTooltip labelFormatter={(v) => shortDate(String(v))} />}
          />
          <Legend
            iconType="circle"
            iconSize={9}
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          />
          {series.map((s) => (
            <Area
              key={s.dataKey}
              type="monotone"
              dataKey={s.dataKey}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#trend-${s.dataKey})`}
              isAnimationActive={!reduced}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ==========================================================================
// DonutChart — categorical distribution. Legend + center total. Labelled.
// ==========================================================================
export interface DonutDatum {
  name: string;
  value: number;
}

export function DonutChart({
  data,
  height = 220,
  ariaLabel,
  centerValue,
  centerCaption,
}: {
  data: DonutDatum[];
  height?: number;
  ariaLabel: string;
  centerValue?: number;
  centerCaption?: string;
}) {
  const reduced = useReducedMotion();
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!data.length || total === 0)
    return <PanelEmpty message="Aucune donnée" />;

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="relative"
      style={{ width: "100%", height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={2}
            stroke={palette.surface}
            strokeWidth={2}
            isAnimationActive={!reduced}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={chartColors[i % chartColors.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
          <Legend
            iconType="circle"
            iconSize={9}
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value, entry) => {
              const v =
                (entry?.payload as unknown as { value?: number })?.value ?? 0;
              const pct = total > 0 ? Math.round((v / total) * 100) : 0;
              return (
                <span className="text-[#5A4634]">
                  {value}{" "}
                  <span className="text-[#8A6B4D] tabular-nums">
                    · {fmt(v)} ({pct}%)
                  </span>
                </span>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* Centered total overlay. Positioned over the donut hole; the legend
          sits below so the vertical offset is biased upward. */}
      {centerValue !== undefined ? (
        <div
          className="absolute inset-x-0 top-[38%] -translate-y-1/2 text-center pointer-events-none"
          aria-hidden="true"
        >
          <div className="text-2xl font-bold text-[#1A0F0A] tabular-nums leading-none">
            {fmt(centerValue)}
          </div>
          {centerCaption ? (
            <div className="text-[11px] text-[#8A6B4D] mt-0.5">
              {centerCaption}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ==========================================================================
// BarList — horizontal bars (top N). Good for countries / reasons.
// ==========================================================================
export interface BarDatum {
  label: string;
  value: number;
}

export function BarList({
  data,
  height = 240,
  ariaLabel,
  color = palette.primary,
}: {
  data: BarDatum[];
  height?: number;
  ariaLabel: string;
  color?: string;
}) {
  const reduced = useReducedMotion();
  if (!data.length) return <PanelEmpty message="Aucune donnée" />;

  return (
    <div role="img" aria-label={ariaLabel} style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
          barCategoryGap={6}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={palette.border}
            horizontal={false}
          />
          <XAxis
            type="number"
            tickFormatter={axisNumber}
            tick={{ fill: palette.faint, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: palette.border }}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fill: palette.muted, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={96}
          />
          <Tooltip
            cursor={{ fill: "rgba(224,82,6,0.06)" }}
            content={<ChartTooltip />}
          />
          <Bar
            dataKey="value"
            name="Total"
            fill={color}
            radius={[0, 6, 6, 0]}
            isAnimationActive={!reduced}
            maxBarSize={26}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ==========================================================================
// VBarChart — vertical bars (reports by reason etc.).
// ==========================================================================
export function VBarChart({
  data,
  height = 240,
  ariaLabel,
  color = chartColors[1],
}: {
  data: BarDatum[];
  height?: number;
  ariaLabel: string;
  color?: string;
}) {
  const reduced = useReducedMotion();
  if (!data.length) return <PanelEmpty message="Aucune donnée" />;

  return (
    <div role="img" aria-label={ariaLabel} style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={palette.border}
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fill: palette.faint, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: palette.border }}
            interval={0}
            angle={data.length > 5 ? -20 : 0}
            textAnchor={data.length > 5 ? "end" : "middle"}
            height={data.length > 5 ? 48 : 24}
          />
          <YAxis
            tickFormatter={axisNumber}
            tick={{ fill: palette.faint, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={40}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(224,82,6,0.06)" }}
            content={<ChartTooltip />}
          />
          <Bar
            dataKey="value"
            name="Total"
            fill={color}
            radius={[6, 6, 0, 0]}
            isAnimationActive={!reduced}
            maxBarSize={48}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Re-export a LineChart-based variant if a consumer prefers lines.
export { LineChart, Line };
