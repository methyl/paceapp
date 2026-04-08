import { useMemo } from "react";
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
import type { ParsedActivity, LapSummary } from "../types";
import { efficiencyFactor } from "../fitness";
import type { LoadCategory } from "../fitness";

interface SegmentHistoryProps {
  /** The activity being viewed */
  current: ParsedActivity;
  /** All activities for historical comparison */
  allActivities: ParsedActivity[];
}

interface HistoricalMatch {
  date: Date;
  dateStr: string;
  ef: number;
  hr: number;
  pace: number;
  paceStr: string;
  priorLoad: LoadCategory;
  isCurrent: boolean;
  activityId: string;
}

const LOAD_THRESHOLDS = { light: 1000, moderate: 5000, heavy: 15000 };

function priorLoadCategory(
  segs: LapSummary[],
  upToIndex: number
): LoadCategory {
  let work = 0;
  for (let i = 0; i < upToIndex; i++) {
    work += (segs[i].avgSpeed ?? 0) * segs[i].totalElapsedTime;
  }
  if (work < LOAD_THRESHOLDS.light) return "fresh";
  if (work < LOAD_THRESHOLDS.moderate) return "light";
  if (work < LOAD_THRESHOLDS.heavy) return "moderate";
  return "heavy";
}

function paceStr(speedMps: number): string {
  if (!speedMps || speedMps <= 0) return "-";
  const s = 1000 / speedMps;
  return `${Math.floor(s / 60)}:${Math.round(s % 60)
    .toString()
    .padStart(2, "0")}`;
}

const LOAD_LABELS: Record<LoadCategory, string> = {
  fresh: "Fresh",
  light: "Light",
  moderate: "Moderate",
  heavy: "Heavy",
};

/**
 * Find historical segments similar to the given segment:
 * - Similar pace (±15 sec/km)
 * - Similar prior load category (same or adjacent)
 */
function findSimilar(
  targetSpeed: number,
  targetLoad: LoadCategory,
  allActivities: ParsedActivity[],
  currentActivityId: string,
  currentSegIndex: number
): HistoricalMatch[] {
  const targetPace = 1000 / targetSpeed;
  const TOLERANCE = 15; // sec/km
  const adjacentLoads: Record<LoadCategory, LoadCategory[]> = {
    fresh: ["fresh", "light"],
    light: ["fresh", "light", "moderate"],
    moderate: ["light", "moderate", "heavy"],
    heavy: ["moderate", "heavy"],
  };
  const allowedLoads = adjacentLoads[targetLoad];

  const matches: HistoricalMatch[] = [];

  for (const a of allActivities) {
    const segs = a.segments;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (!seg.avgSpeed || seg.avgSpeed <= 0 || !seg.avgHeartRate) continue;
      if (seg.totalDistance < 200) continue;

      const segPace = 1000 / seg.avgSpeed;
      if (Math.abs(segPace - targetPace) > TOLERANCE) continue;

      const load = priorLoadCategory(segs, i);
      if (!allowedLoads.includes(load)) continue;

      const isCurrent = a.id === currentActivityId && i === currentSegIndex;

      matches.push({
        date: a.summary.startTime
          ? new Date(a.summary.startTime)
          : new Date(),
        dateStr: a.summary.startTime
          ? new Date(a.summary.startTime).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })
          : a.fileName,
        ef: efficiencyFactor(seg.avgSpeed, seg.avgHeartRate),
        hr: Math.round(seg.avgHeartRate),
        pace: Math.round(segPace),
        paceStr: paceStr(seg.avgSpeed),
        priorLoad: load,
        isCurrent,
        activityId: a.id,
      });
    }
  }

  return matches.sort((a, b) => a.date.getTime() - b.date.getTime());
}

function SegmentMiniChart({
  segment,
  segIndex,
  current,
  allActivities,
}: {
  segment: LapSummary;
  segIndex: number;
  current: ParsedActivity;
  allActivities: ParsedActivity[];
}) {
  const load = useMemo(
    () => priorLoadCategory(current.segments, segIndex),
    [current.segments, segIndex]
  );

  const matches = useMemo(
    () =>
      segment.avgSpeed && segment.avgSpeed > 0
        ? findSimilar(
            segment.avgSpeed,
            load,
            allActivities,
            current.id,
            segIndex
          )
        : [],
    [segment.avgSpeed, load, allActivities, current.id, segIndex]
  );

  if (matches.length < 2 || !segment.avgSpeed || !segment.avgHeartRate) {
    return null;
  }

  const currentEF = efficiencyFactor(segment.avgSpeed, segment.avgHeartRate);
  const currentPoint = matches.find((m) => m.isCurrent);

  const data = matches.map((m) => ({
    date: m.dateStr,
    ef: +m.ef.toFixed(2),
    isCurrent: m.isCurrent,
  }));

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-100 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-gray-700">
          Seg {segment.lapIndex}: {paceStr(segment.avgSpeed)}/km
          <span className="font-normal text-gray-500 ml-1">
            — {LOAD_LABELS[load]} load
          </span>
        </span>
        <span className="text-xs text-gray-500">
          {matches.length} similar segments
        </span>
      </div>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs">
          EF: <span className="font-bold">{currentEF.toFixed(2)}</span>
        </span>
        <span className="text-xs text-gray-500">
          HR: {Math.round(segment.avgHeartRate)} bpm
        </span>
        {matches.length >= 3 && (
          <span className="text-xs text-gray-500">
            Range: {Math.min(...matches.map((m) => m.ef)).toFixed(1)}–
            {Math.max(...matches.map((m) => m.ef)).toFixed(1)}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <ComposedChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
          <YAxis
            tick={{ fontSize: 9 }}
            domain={["auto", "auto"]}
            width={35}
          />
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null;
              const d = payload[0]?.payload as (typeof data)[0];
              return (
                <div className="bg-white border border-gray-200 rounded p-1.5 text-xs shadow">
                  <div className="font-semibold">
                    {d.date} {d.isCurrent ? "(this run)" : ""}
                  </div>
                  <div>EF: {d.ef}</div>
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="ef"
            stroke="#94a3b8"
            strokeWidth={1.5}
            dot={{ r: 2, fill: "#94a3b8" }}
          />
          {currentPoint && (
            <ReferenceDot
              x={currentPoint.dateStr}
              y={+currentPoint.ef.toFixed(2)}
              r={5}
              fill="#6366f1"
              stroke="#fff"
              strokeWidth={2}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function SegmentHistory({
  current,
  allActivities,
}: SegmentHistoryProps) {
  const validSegments = current.segments.filter(
    (s) => s.avgSpeed && s.avgSpeed > 0 && s.avgHeartRate
  );

  if (validSegments.length === 0 || allActivities.length < 2) return null;

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">
        Segment vs History
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        Each segment compared to historical segments at similar pace and prior
        load. Purple dot = this run.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {validSegments.map((seg) => {
          const segIndex = current.segments.indexOf(seg);
          return (
            <SegmentMiniChart
              key={seg.lapIndex}
              segment={seg}
              segIndex={segIndex}
              current={current}
              allActivities={allActivities}
            />
          );
        })}
      </div>
    </div>
  );
}
