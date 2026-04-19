import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceDot,
} from "recharts";
import type { ParsedActivity } from "../types";
import type { LoadCategory } from "../fitness";
import {
  groupCurrentSegments,
  findHistoricalPoints,
  type SegmentGroup,
  type WorkoutPoint,
} from "../segmentHistory";

interface SegmentHistoryProps {
  current: ParsedActivity;
  allActivities: ParsedActivity[];
}

const LOAD_LABELS: Record<LoadCategory, string> = {
  fresh: "Fresh",
  light: "Light",
  moderate: "Moderate",
  heavy: "Heavy",
};

type MetricKey = "avgEF" | "avgVerticalOscillation" | "avgGroundContactTime" | "avgStrideLength" | "avgVerticalRatio" | "avgCadence" | "avgPower";

const METRICS: { key: MetricKey; label: string; unit: string; color: string; format?: (v: number) => string }[] = [
  { key: "avgEF", label: "EF", unit: "", color: "#6366f1" },
  { key: "avgVerticalOscillation", label: "Vert. Osc.", unit: "mm", color: "#6366f1" },
  { key: "avgGroundContactTime", label: "GCT", unit: "ms", color: "#f59e0b" },
  { key: "avgStrideLength", label: "Stride", unit: "m", color: "#3b82f6", format: (v) => (v / 1000).toFixed(2) },
  { key: "avgVerticalRatio", label: "Vert. Ratio", unit: "%", color: "#ef4444" },
  { key: "avgCadence", label: "Cadence", unit: "spm", color: "#10b981" },
  { key: "avgPower", label: "Power", unit: "W", color: "#8b5cf6" },
];

function MiniChart({
  group,
  points,
  metricKey,
  metricLabel,
  metricUnit,
  metricColor,
  formatValue,
}: {
  group: SegmentGroup;
  points: WorkoutPoint[];
  metricKey: MetricKey;
  metricLabel: string;
  metricUnit: string;
  metricColor: string;
  formatValue?: (v: number) => string;
}) {
  const data = points
    .filter((p) => p[metricKey] != null)
    .map((p) => ({
      dateStr: p.dateStr,
      value: +(p[metricKey] as number).toFixed(2),
      isCurrent: p.isCurrent,
    }));

  if (data.length < 2) return null;

  const currentPoint = data.find((d) => d.isCurrent);
  const fmtVal = formatValue ?? ((v: number) => v.toFixed(1));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium text-gray-500">
          {metricLabel} {metricUnit && `(${metricUnit})`}
        </span>
        {group[metricKey] != null && (
          <span className="text-[10px] font-bold text-gray-700">
            {fmtVal(group[metricKey] as number)}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={70}>
        <ComposedChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="dateStr" tick={false} height={0} />
          <YAxis tick={{ fontSize: 8 }} domain={["auto", "auto"]} width={30} />
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null;
              const d = payload[0]?.payload as (typeof data)[0];
              return (
                <div className="bg-white border border-gray-200 rounded p-1 text-[10px] shadow">
                  <div className="font-semibold">{d.dateStr} {d.isCurrent ? "(now)" : ""}</div>
                  <div>{metricLabel}: {fmtVal(d.value)} {metricUnit}</div>
                </div>
              );
            }}
          />
          <Line type="monotone" dataKey="value" stroke={metricColor} strokeWidth={1.5} dot={{ r: 1.5 }} />
          {currentPoint && (
            <ReferenceDot x={currentPoint.dateStr} y={currentPoint.value} r={4} fill={metricColor} stroke="#fff" strokeWidth={1.5} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function GroupCard({
  group,
  points,
}: {
  group: SegmentGroup;
  points: WorkoutPoint[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (points.length < 2) return null;

  // Figure out which dynamics are available
  const availableMetrics = METRICS.filter((m) => {
    if (m.key === "avgEF") return true; // always show EF
    return points.some((p) => p[m.key] != null);
  });

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-100 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-gray-700">
          {group.distBucket ? `${group.distBucket} ` : ""}{group.avgPace}/km
          <span className="font-normal text-gray-500 ml-1">— {LOAD_LABELS[group.load]}</span>
          {group.segments.length > 1 && (
            <span className="font-normal text-gray-400 ml-1">({group.segments.length}× avg)</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500">{points.length} workouts</span>
          {availableMetrics.length > 1 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[10px] text-blue-600 hover:text-blue-800 font-medium"
            >
              {expanded ? "Less" : "Dynamics"}
            </button>
          )}
        </div>
      </div>

      {/* Current values summary */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-2">
        <span className="text-[10px]">EF: <span className="font-bold">{group.avgEF.toFixed(2)}</span></span>
        <span className="text-[10px] text-gray-500">HR: {Math.round(group.avgHR)}</span>
        {group.avgVerticalOscillation != null && (
          <span className="text-[10px] text-gray-500">VO: {group.avgVerticalOscillation.toFixed(1)}mm</span>
        )}
        {group.avgGroundContactTime != null && (
          <span className="text-[10px] text-gray-500">GCT: {Math.round(group.avgGroundContactTime)}ms</span>
        )}
        {group.avgCadence != null && (
          <span className="text-[10px] text-gray-500">Cad: {Math.round(group.avgCadence)}</span>
        )}
        {group.avgPower != null && (
          <span className="text-[10px] text-gray-500">Pow: {Math.round(group.avgPower)}W</span>
        )}
      </div>

      {/* EF chart always shown */}
      <MiniChart group={group} points={points} metricKey="avgEF" metricLabel="EF" metricUnit="" metricColor="#6366f1" formatValue={(v) => v.toFixed(2)} />

      {/* Expanded: dynamics charts */}
      {expanded && (
        <div className="mt-2 space-y-2">
          {availableMetrics
            .filter((m) => m.key !== "avgEF")
            .map((m) => (
              <MiniChart
                key={m.key}
                group={group}
                points={points}
                metricKey={m.key}
                metricLabel={m.label}
                metricUnit={m.unit}
                metricColor={m.color}
                formatValue={m.format}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export default function SegmentHistory({ current, allActivities }: SegmentHistoryProps) {
  const groups = useMemo(() => groupCurrentSegments(current), [current]);

  const groupsWithHistory = useMemo(
    () =>
      groups.map((g) => ({
        group: g,
        points: findHistoricalPoints(g, allActivities, current.id),
      })),
    [groups, allActivities, current.id]
  );

  const chartsToShow = groupsWithHistory.filter((g) => g.points.length >= 2);

  if (chartsToShow.length === 0 || allActivities.length < 2) return null;

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">
        Segment vs History
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        Similar segments averaged per workout. Purple dot = this run.
        Click "Dynamics" to compare running dynamics over time.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {chartsToShow.map(({ group, points }, i) => (
          <GroupCard key={i} group={group} points={points} />
        ))}
      </div>
    </div>
  );
}
