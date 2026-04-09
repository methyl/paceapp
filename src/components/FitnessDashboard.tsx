import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import type { ParsedActivity } from "../types";
import {
  computeContextFitness,
  type FitnessContext,
  type ContextPoint,
} from "../fitness";

interface FitnessDashboardProps {
  activities: ParsedActivity[];
}

const TREND_STYLE: Record<string, { icon: string; color: string }> = {
  improving: { icon: "↑", color: "#22c55e" },
  stable: { icon: "→", color: "#f59e0b" },
  declining: { icon: "↓", color: "#ef4444" },
};

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const color =
    score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : score >= 25 ? "#f97316" : "#ef4444";
  return (
    <div className="text-center">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="relative inline-flex items-center justify-center w-20 h-20">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="34" fill="none" stroke="#e5e7eb" strokeWidth="6" />
          <circle
            cx="40" cy="40" r="34" fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={`${(score / 100) * 213.6} 213.6`} strokeLinecap="round"
          />
        </svg>
        <span className="absolute text-lg font-bold" style={{ color }}>{score}</span>
      </div>
    </div>
  );
}

type MetricKey = "ef" | "hr" | "verticalOscillation" | "groundContactTime" | "strideLength" | "cadence" | "power";

const METRICS: { key: MetricKey; label: string; unit: string; color: string }[] = [
  { key: "ef", label: "EF", unit: "", color: "#6366f1" },
  { key: "hr", label: "HR", unit: "bpm", color: "#ef4444" },
  { key: "verticalOscillation", label: "Vert Osc", unit: "mm", color: "#6366f1" },
  { key: "groundContactTime", label: "GCT", unit: "ms", color: "#f59e0b" },
  { key: "strideLength", label: "Stride", unit: "m", color: "#3b82f6" },
  { key: "cadence", label: "Cadence", unit: "spm", color: "#10b981" },
  { key: "power", label: "Power", unit: "W", color: "#8b5cf6" },
];

function ContextChart({
  context,
  isPrimary,
}: {
  context: FitnessContext;
  isPrimary: boolean;
}) {
  const [metric, setMetric] = useState<MetricKey>("ef");

  const availableMetrics = METRICS.filter((m) => {
    if (m.key === "ef" || m.key === "hr") return true;
    return context.points.some(
      (p) => p[m.key as keyof ContextPoint] != null
    );
  });

  const data = context.points.map((p) => ({
    dateStr: p.dateStr,
    value: metric === "ef" ? p.ef : (p[metric as keyof ContextPoint] as number | undefined) ?? null,
    count: p.count,
    ef: p.ef,
    hr: p.hr,
  }));

  const validData = data.filter((d) => d.value != null);
  if (validData.length < 2) return null;

  const currentMetric = METRICS.find((m) => m.key === metric)!;

  return (
    <div className={`bg-white rounded-lg border p-4 ${isPrimary ? "border-indigo-200 ring-1 ring-indigo-100" : "border-gray-200"}`}>
      <div className="flex items-center justify-between mb-1">
        <div>
          <span className={`text-sm font-semibold ${isPrimary ? "text-indigo-700" : "text-gray-700"}`}>
            {context.label}
          </span>
          {isPrimary && (
            <span className="ml-2 text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-medium">
              PRIMARY
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-500">{context.points.length} workouts</span>
      </div>

      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs">EF: <span className="font-bold">{context.currentEF.toFixed(2)}</span></span>
        <span className="text-xs text-gray-400">peak: {context.peakEF.toFixed(2)}</span>
      </div>

      {/* Metric selector */}
      <div className="flex flex-wrap gap-1 mb-2">
        {availableMetrics.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              metric === m.key
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={130}>
        <ComposedChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="dateStr" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9 }} domain={["auto", "auto"]} width={35} />
          {metric === "ef" && (
            <ReferenceLine y={context.peakEF} stroke="#22c55e" strokeDasharray="4 2" strokeWidth={1} />
          )}
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null;
              const d = payload[0]?.payload as (typeof data)[0];
              return (
                <div className="bg-white border border-gray-200 rounded p-1.5 text-[10px] shadow">
                  <div className="font-semibold">{d.dateStr}</div>
                  <div>{currentMetric.label}: {d.value != null ? (typeof d.value === "number" ? d.value.toFixed(1) : d.value) : "-"} {currentMetric.unit}</div>
                  <div>EF: {d.ef} | HR: {d.hr}</div>
                  <div>{d.count} seg{d.count > 1 ? "s" : ""} averaged</div>
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={currentMetric.color}
            strokeWidth={2}
            dot={{ r: 3, fill: currentMetric.color }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function FitnessDashboard({ activities }: FitnessDashboardProps) {
  const fitness = useMemo(
    () => computeContextFitness(activities),
    [activities]
  );

  const [showAll, setShowAll] = useState(false);

  if (fitness.contexts.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-500">
        Need more activities with HR data for fitness tracking.
      </div>
    );
  }

  const visibleContexts = showAll
    ? fitness.contexts
    : fitness.contexts.slice(0, 6);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Fitness</h2>
        <p className="text-sm text-gray-600">
          Efficiency Factor (speed ÷ HR) tracked per segment context.
          Each card compares like-for-like: same pace, same distance, same prior load.
        </p>
      </div>

      {/* Overall score from primary context */}
      {fitness.primaryContext && (
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex flex-wrap items-center justify-around gap-6">
            <ScoreGauge score={fitness.currentScore} label="Current Form" />
            <ScoreGauge score={fitness.peakScore} label="Peak Form" />
            <div className="text-center">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Trend</div>
              <div className="text-3xl font-bold" style={{ color: TREND_STYLE[fitness.trend].color }}>
                {TREND_STYLE[fitness.trend].icon}
              </div>
              <div className="text-xs font-medium capitalize" style={{ color: TREND_STYLE[fitness.trend].color }}>
                {fitness.trend}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Based on</div>
              <div className="text-sm font-semibold text-gray-700">{fitness.primaryContext.label}</div>
              <div className="text-xs text-gray-500">{fitness.primaryContext.points.length} workouts</div>
            </div>
          </div>
        </div>
      )}

      {/* Context charts */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          {fitness.contexts.length} comparable context{fitness.contexts.length !== 1 ? "s" : ""}
        </h3>
        {fitness.contexts.length > 6 && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            {showAll ? "Show less" : `Show all ${fitness.contexts.length}`}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visibleContexts.map((ctx) => (
          <ContextChart
            key={`${ctx.paceBand}-${ctx.loadCategory}-${ctx.distBucket}`}
            context={ctx}
            isPrimary={ctx === fitness.primaryContext}
          />
        ))}
      </div>
    </div>
  );
}
