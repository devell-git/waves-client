"use client";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { defineComponent } from "@openuidev/react-lang";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  Pie,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadialBar,
  AreaChart as RechartsAreaChart,
  BarChart as RechartsBarChart,
  LineChart as RechartsLineChart,
  PieChart as RechartsPieChart,
  RadarChart as RechartsRadarChart,
  RadialBarChart as RechartsRadialBarChart,
  ScatterChart as RechartsScatterChart,
  Scatter,
  XAxis,
  YAxis,
} from "recharts";
import { z } from "zod";

import { buildChartData, buildSliceData, hasAllProps } from "../helpers";

// Paleta expandida (12 cores) — definida em src/index.css.
// Rotação cíclica pra series além de 12.
const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
  "var(--chart-9)",
  "var(--chart-10)",
  "var(--chart-11)",
  "var(--chart-12)",
];

function buildConfig(keys: string[]): ChartConfig {
  const config: ChartConfig = {};
  keys.forEach((key, i) => {
    config[key] = { label: key, color: COLORS[i % COLORS.length] };
  });
  return config;
}

// Helper: id único por gradient — Recharts precisa de `<linearGradient id=...>`
// referenciado por url(#id). Como temos múltiplas instâncias do mesmo chart
// numa mesma página, geramos id estável por (chartType, seriesIndex).
function gradId(chartType: string, key: string, index: number): string {
  return `grad-${chartType}-${key}-${index}`.replace(/[^a-zA-Z0-9-]/g, "_");
}

// Estilo padronizado pros eixos — clean, light gray, fonte pequena
const AXIS_TICK_STYLE = {
  fontSize: 11,
  fill: "var(--muted-foreground)",
};

const ANIMATION_DURATION = 800;

function getSeriesKeys(data: Record<string, string | number>[]): string[] {
  if (!data.length) return [];
  return Object.keys(data[0]).filter((k) => k !== "category");
}

// ── Virtual sub-components ──

const SeriesSchema = z.object({
  category: z.string(),
  values: z.array(z.number()),
});

export const Series = defineComponent({
  name: "Series",
  props: SeriesSchema,
  description: "One named data series with values matching labels.",
  component: () => null,
});

const SliceSchema = z.object({
  category: z.string(),
  value: z.number(),
});

export const Slice = defineComponent({
  name: "Slice",
  props: SliceSchema,
  description: "A single slice in a PieChart or RadialChart.",
  component: () => null,
});

const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
  label: z.string().optional(),
});

export const Point = defineComponent({
  name: "Point",
  props: PointSchema,
  description: "A single data point in a ScatterChart series.",
  component: () => null,
});

const ScatterSeriesSchema = z.object({
  category: z.string(),
  points: z.array(Point.ref),
});

export const ScatterSeries = defineComponent({
  name: "ScatterSeries",
  props: ScatterSeriesSchema,
  description: "Named scatter series with Point references.",
  component: () => null,
});

// ── BarChart ──

export const BarChartCondensed = defineComponent({
  name: "BarChart",
  props: z.object({
    labels: z.array(z.string()),
    series: z.array(SeriesSchema),
    variant: z.enum(["grouped", "stacked"]).optional(),
    xLabel: z.string().optional(),
    yLabel: z.string().optional(),
  }),
  description:
    "Vertical bar chart with gradient fills and smooth animations. " +
    "Use for comparing values across categories. " +
    "Set variant='stacked' to stack series on same bar.",
  component: ({ props }) => {
    if (!hasAllProps(props as Record<string, unknown>, "labels", "series")) return null;
    const data = buildChartData(props.labels, props.series);
    if (!data.length) return null;
    const keys = getSeriesKeys(data);
    const config = buildConfig(keys);
    const stacked = props.variant === "stacked";
    const singleSeries = keys.length === 1;

    return (
      <ChartContainer config={config} className="min-h-[260px] w-full">
        <RechartsBarChart
          data={data}
          margin={{ top: 20, right: 16, bottom: props.xLabel ? 28 : 8, left: props.yLabel ? 12 : 0 }}
        >
          {/* Gradientes verticais — topo saturado, base 60% opacity */}
          <defs>
            {keys.map((key, i) => {
              const color = COLORS[i % COLORS.length];
              return (
                <linearGradient
                  key={key}
                  id={gradId("bar", key, i)}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={color} stopOpacity={1} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.55} />
                </linearGradient>
              );
            })}
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
          <XAxis
            dataKey="category"
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK_STYLE}
            label={
              props.xLabel
                ? { value: props.xLabel, position: "bottom", offset: 12, fontSize: 11, fill: "var(--muted-foreground)" }
                : undefined
            }
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK_STYLE}
            label={
              props.yLabel
                ? { value: props.yLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--muted-foreground)" }
                : undefined
            }
          />
          <ChartTooltip
            cursor={{ fill: "var(--accent)", opacity: 0.4 }}
            content={<ChartTooltipContent />}
          />
          {keys.length > 1 && (
            <Legend
              verticalAlign="top"
              height={36}
              iconType="circle"
              iconSize={10}
              wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
            />
          )}
          {keys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              fill={`url(#${gradId("bar", key, i)})`}
              radius={[6, 6, 0, 0]}
              stackId={stacked ? "stack" : undefined}
              isAnimationActive={true}
              animationDuration={ANIMATION_DURATION}
              animationEasing="ease-out"
            >
              {/* Data labels só em single-series + variant grouped (evita poluição) */}
              {singleSeries && !stacked && (
                <LabelList
                  dataKey={key}
                  position="top"
                  fontSize={11}
                  fill="var(--foreground)"
                  fontWeight={500}
                />
              )}
            </Bar>
          ))}
        </RechartsBarChart>
      </ChartContainer>
    );
  },
});

// ── LineChart ──

export const LineChartCondensed = defineComponent({
  name: "LineChart",
  props: z.object({
    labels: z.array(z.string()),
    series: z.array(SeriesSchema),
    xLabel: z.string().optional(),
    yLabel: z.string().optional(),
  }),
  description:
    "Line chart with smooth curves, animated dots and hover highlights. " +
    "Use for trends, time series, or any continuous data across categories.",
  component: ({ props }) => {
    if (!hasAllProps(props as Record<string, unknown>, "labels", "series")) return null;
    const data = buildChartData(props.labels, props.series);
    if (!data.length) return null;
    const keys = getSeriesKeys(data);
    const config = buildConfig(keys);

    return (
      <ChartContainer config={config} className="min-h-[260px] w-full">
        <RechartsLineChart
          data={data}
          margin={{ top: 16, right: 16, bottom: props.xLabel ? 28 : 8, left: props.yLabel ? 12 : 0 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
          <XAxis
            dataKey="category"
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK_STYLE}
            label={props.xLabel ? { value: props.xLabel, position: "bottom", offset: 12, fontSize: 11, fill: "var(--muted-foreground)" } : undefined}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK_STYLE}
            label={props.yLabel ? { value: props.yLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--muted-foreground)" } : undefined}
          />
          <ChartTooltip cursor={{ stroke: "var(--border)" }} content={<ChartTooltipContent />} />
          {keys.length > 1 && (
            <Legend
              verticalAlign="top"
              height={32}
              iconType="circle"
              iconSize={10}
              wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
            />
          )}
          {keys.map((key, i) => {
            const color = COLORS[i % COLORS.length];
            return (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={color}
                strokeWidth={2.5}
                // Dots brancos com borda colorida — visual mais polido
                dot={{ r: 3.5, fill: "var(--background)", stroke: color, strokeWidth: 2 }}
                activeDot={{
                  r: 5.5,
                  fill: color,
                  stroke: "var(--background)",
                  strokeWidth: 2,
                }}
                isAnimationActive={true}
                animationDuration={ANIMATION_DURATION}
                animationEasing="ease-out"
              />
            );
          })}
        </RechartsLineChart>
      </ChartContainer>
    );
  },
});

// ── AreaChart ──

export const AreaChartCondensed = defineComponent({
  name: "AreaChart",
  props: z.object({
    labels: z.array(z.string()),
    series: z.array(SeriesSchema),
    xLabel: z.string().optional(),
    yLabel: z.string().optional(),
  }),
  description:
    "Area chart with elegant gradient fills (top vibrant → bottom transparent) " +
    "and smooth animation. Use for volume, cumulative trends, or any continuous " +
    "data where you want to emphasize magnitude.",
  component: ({ props }) => {
    if (!hasAllProps(props as Record<string, unknown>, "labels", "series")) return null;
    const data = buildChartData(props.labels, props.series);
    if (!data.length) return null;
    const keys = getSeriesKeys(data);
    const config = buildConfig(keys);

    return (
      <ChartContainer config={config} className="min-h-[260px] w-full">
        <RechartsAreaChart
          data={data}
          margin={{ top: 16, right: 16, bottom: props.xLabel ? 28 : 8, left: props.yLabel ? 12 : 0 }}
        >
          {/* Gradiente vertical bonito: 60% → 5% de opacity */}
          <defs>
            {keys.map((key, i) => {
              const color = COLORS[i % COLORS.length];
              return (
                <linearGradient
                  key={key}
                  id={gradId("area", key, i)}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={color} stopOpacity={0.6} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.05} />
                </linearGradient>
              );
            })}
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
          <XAxis
            dataKey="category"
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK_STYLE}
            label={props.xLabel ? { value: props.xLabel, position: "bottom", offset: 12, fontSize: 11, fill: "var(--muted-foreground)" } : undefined}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK_STYLE}
            label={props.yLabel ? { value: props.yLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--muted-foreground)" } : undefined}
          />
          <ChartTooltip cursor={{ stroke: "var(--border)" }} content={<ChartTooltipContent />} />
          {keys.length > 1 && (
            <Legend
              verticalAlign="top"
              height={32}
              iconType="circle"
              iconSize={10}
              wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
            />
          )}
          {keys.map((key, i) => {
            const color = COLORS[i % COLORS.length];
            return (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradId("area", key, i)})`}
                isAnimationActive={true}
                animationDuration={ANIMATION_DURATION}
                animationEasing="ease-out"
              />
            );
          })}
        </RechartsAreaChart>
      </ChartContainer>
    );
  },
});

// ── PieChart ──

export const PieChartComponent = defineComponent({
  name: "PieChart",
  props: z.object({
    slices: z.array(SliceSchema),
    donut: z.boolean().optional(),
  }),
  description:
    "Pie or donut chart with white slice separators, animated entry and value labels. " +
    "Set donut=true for ring chart (recommended for >4 slices).",
  component: ({ props }) => {
    const data = buildSliceData(props.slices);
    if (!data.length) return null;
    const config = buildConfig(data.map((d) => d.category as string));
    const total = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    return (
      <ChartContainer
        config={config}
        className="min-h-[280px] w-full mx-auto aspect-square max-h-[320px]"
      >
        <RechartsPieChart>
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent nameKey="category" />}
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="category"
            innerRadius={props.donut ? "55%" : 0}
            outerRadius="85%"
            paddingAngle={2}
            // Sem stroke pra slices vibrantes; com stroke pro donut respirar
            stroke={props.donut ? "var(--background)" : "none"}
            strokeWidth={props.donut ? 3 : 0}
            isAnimationActive={true}
            animationDuration={ANIMATION_DURATION}
            animationEasing="ease-out"
            label={(entry: { value?: number; percent?: number }) => {
              const pct = entry.percent ?? 0;
              if (pct < 0.05) return ""; // omite labels muito pequenos (<5%)
              return `${Math.round(pct * 100)}%`;
            }}
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Legend
            verticalAlign="bottom"
            height={40}
            iconType="circle"
            iconSize={10}
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value: string, entry: { payload?: { value?: number } }) => {
              const v = entry.payload?.value ?? 0;
              const pct = total > 0 ? Math.round((v / total) * 100) : 0;
              return (
                <span style={{ color: "var(--foreground)" }}>
                  {value} <span style={{ color: "var(--muted-foreground)" }}>· {pct}%</span>
                </span>
              );
            }}
          />
        </RechartsPieChart>
      </ChartContainer>
    );
  },
});

// ── RadarChart ──

export const RadarChartComponent = defineComponent({
  name: "RadarChart",
  props: z.object({
    labels: z.array(z.string()),
    series: z.array(SeriesSchema),
  }),
  description: "Radar/spider chart for multi-dimensional comparison.",
  component: ({ props }) => {
    if (!hasAllProps(props as Record<string, unknown>, "labels", "series")) return null;
    const data = buildChartData(props.labels, props.series);
    if (!data.length) return null;
    const keys = getSeriesKeys(data);
    const config = buildConfig(keys);

    return (
      <ChartContainer
        config={config}
        className="min-h-[200px] w-full mx-auto aspect-square max-h-[250px]"
      >
        <RechartsRadarChart data={data}>
          <PolarGrid />
          <PolarAngleAxis dataKey="category" />
          <ChartTooltip content={<ChartTooltipContent />} />
          {keys.map((key, i) => (
            <Radar
              key={key}
              dataKey={key}
              fill={COLORS[i % COLORS.length]}
              fillOpacity={0.3}
              stroke={COLORS[i % COLORS.length]}
              isAnimationActive={false}
            />
          ))}
        </RechartsRadarChart>
      </ChartContainer>
    );
  },
});

// ── RadialChart ──

export const RadialChartComponent = defineComponent({
  name: "RadialChart",
  props: z.object({
    slices: z.array(SliceSchema),
  }),
  description: "Radial bar chart for displaying categorized values in rings.",
  component: ({ props }) => {
    const data = buildSliceData(props.slices);
    if (!data.length) return null;
    const colored = data.map((d, i) => ({ ...d, fill: COLORS[i % COLORS.length] }));
    const config = buildConfig(data.map((d) => d.category as string));

    return (
      <ChartContainer
        config={config}
        className="min-h-[200px] w-full mx-auto aspect-square max-h-[250px]"
      >
        <RechartsRadialBarChart data={colored} innerRadius={30} outerRadius={110}>
          <ChartTooltip content={<ChartTooltipContent nameKey="category" />} />
          <RadialBar dataKey="value" isAnimationActive={false} />
        </RechartsRadialBarChart>
      </ChartContainer>
    );
  },
});

// ── ScatterChart ──

export const ScatterChartComponent = defineComponent({
  name: "ScatterChart",
  props: z.object({
    series: z.array(ScatterSeriesSchema),
    xLabel: z.string().optional(),
    yLabel: z.string().optional(),
  }),
  description: "Scatter plot with named series of Point references.",
  component: ({ props }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seriesArr = ((props.series ?? []) as any[]).map((s) => ({
      category: String(s?.props?.category ?? ""),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      points: ((s?.props?.points ?? []) as any[]).map((p: any) => ({
        x: Number(p?.props?.x ?? 0),
        y: Number(p?.props?.y ?? 0),
      })),
    }));
    const config = buildConfig(seriesArr.map((s) => s.category));

    return (
      <ChartContainer config={config} className="min-h-[200px] w-full">
        <RechartsScatterChart>
          <CartesianGrid />
          <XAxis type="number" dataKey="x" name={props.xLabel ?? "x"} />
          <YAxis type="number" dataKey="y" name={props.yLabel ?? "y"} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {seriesArr.map((s, i) => (
            <Scatter
              key={s.category}
              name={s.category}
              data={s.points}
              fill={COLORS[i % COLORS.length]}
              isAnimationActive={false}
            />
          ))}
        </RechartsScatterChart>
      </ChartContainer>
    );
  },
});
