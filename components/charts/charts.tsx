"use client";

import * as React from "react";
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
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useFormat } from "@/components/providers/app-context";
import { useReducedMotion } from "framer-motion";

/**
 * Chart wrappers. Colours come from CSS tokens so light/dark both work; every
 * chart has an accessible summary (role="img" + aria-label) and the same data
 * is always available as text/table elsewhere on the page.
 */

export const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(var(--chart-6))"];
const GRID = "hsl(var(--chart-grid))";
const AXIS = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

function useAnimate() {
  const reduce = useReducedMotion();
  return !reduce;
}

function ChartFrame({ label, height, children }: { label: string; height: number; children: React.ReactElement }) {
  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function MoneyTooltip({ active, payload, label, money }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; money: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      {label && <p className="mb-1 font-medium">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 num">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} aria-hidden="true" />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-medium">{money(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

/** Grouped bars, e.g. income vs spending per month. */
export function GroupedBars({
  data,
  series,
  label,
  height = 240,
}: {
  data: Record<string, string | number>[];
  series: { key: string; name: string; color: string }[];
  label: string;
  height?: number;
}) {
  const f = useFormat();
  const animate = useAnimate();
  return (
    <ChartFrame label={label} height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={(v: number) => f.money(v, { compact: true })} />
        <Tooltip cursor={{ fill: "hsl(var(--muted))" }} content={<MoneyTooltip money={(n) => f.money(n)} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={animate} />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

/** Area/line over time with an optional zero line (net worth, balances, cash flow). */
export function TimeSeries({
  data,
  series,
  label,
  height = 240,
  zeroLine,
  xKey = "label",
  area = true,
}: {
  data: Record<string, string | number | null>[];
  series: { key: string; name: string; color: string; dashed?: boolean }[];
  label: string;
  height?: number;
  zeroLine?: boolean;
  xKey?: string;
  area?: boolean;
}) {
  const f = useFormat();
  const animate = useAnimate();
  const common = (
    <>
      <CartesianGrid vertical={false} stroke={GRID} />
      <XAxis dataKey={xKey} tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
      <YAxis tick={AXIS} axisLine={false} tickLine={false} width={60} tickFormatter={(v: number) => f.money(v, { compact: true })} />
      <Tooltip content={<MoneyTooltip money={(n) => f.money(n)} />} />
      {zeroLine && <ReferenceLine y={0} stroke="hsl(var(--outflow))" strokeDasharray="4 4" />}
    </>
  );
  if (!area) {
    return (
      <ChartFrame label={label} height={height}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {common}
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />}
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} strokeDasharray={s.dashed ? "5 4" : undefined} isAnimationActive={animate} />
          ))}
        </LineChart>
      </ChartFrame>
    );
  }
  return (
    <ChartFrame label={label} height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        {common}
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />}
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#fill-${s.key})`}
            strokeDasharray={s.dashed ? "5 4" : undefined}
            isAnimationActive={animate}
          />
        ))}
      </AreaChart>
    </ChartFrame>
  );
}

/** Share-of-total ring with the legend rendered as text beside it. */
export function Donut({ items, label, height = 200 }: { items: { name: string; value: number; color?: string | null }[]; label: string; height?: number }) {
  const f = useFormat();
  const animate = useAnimate();
  const data = items.filter((i) => i.value > 0);
  return (
    <ChartFrame label={label} height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={1.5} stroke="none" isAnimationActive={animate}>
          {data.map((d, i) => (
            <Cell key={d.name} fill={d.color ?? CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<MoneyTooltip money={(n) => f.money(n)} />} />
      </PieChart>
    </ChartFrame>
  );
}

/** Tiny inline trend (no axes); decorative — values are shown as text nearby. */
export function Sparkline({ values, color = CHART_COLORS[0], height = 32 }: { values: number[]; color?: string; height?: number }) {
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div style={{ height }} className="w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
