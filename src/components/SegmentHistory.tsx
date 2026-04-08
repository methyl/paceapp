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
  current: ParsedActivity;
  allActivities: ParsedActivity[];
}

const LOAD_THRESHOLDS = { light: 1000, moderate: 5000, heavy: 15000 };

function priorLoadCategory(segs: LapSummary[], upToIndex: number): LoadCategory {
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
  return `${Math.floor(s / 60)}:${Math.round(s % 60).toString().padStart(2, "0")}`;
}

const LOAD_LABELS: Record<LoadCategory, string> = {
  fresh: "Fresh",
  light: "Light",
  moderate: "Moderate",
  heavy: "Heavy",
};

const ADJACENT_LOADS: Record<LoadCategory, LoadCategory[]> = {
  fresh: ["fresh", "light"],
  light: ["fresh", "light", "moderate"],
  moderate: ["light", "moderate", "heavy"],
  heavy: ["moderate", "heavy"],
};

/** A group of similar segments from the current workout */
interface SegmentGroup {
  /** Representative pace for the group */
  avgSpeed: number;
  avgPace: string;
  /** Representative load */
  load: LoadCategory;
  /** Segments in this group from the current workout */
  segments: { seg: LapSummary; index: number }[];
  /** Averaged EF of this group */
  avgEF: number;
  avgHR: number;
}

/** One data point per workout in the history chart */
interface WorkoutPoint {
  date: Date;
  dateStr: string;
  avgEF: number;
  avgHR: number;
  avgPace: string;
  count: number;
  isCurrent: boolean;
}

/**
 * Group the current workout's segments by similar pace (±15s/km)
 * and same load category. Each group becomes one chart.
 */
function groupCurrentSegments(activity: ParsedActivity): SegmentGroup[] {
  const groups: SegmentGroup[] = [];

  for (let i = 0; i < activity.segments.length; i++) {
    const seg = activity.segments[i];
    if (!seg.avgSpeed || seg.avgSpeed <= 0 || !seg.avgHeartRate) continue;
    if (seg.totalDistance < 200) continue;

    const pace = 1000 / seg.avgSpeed;
    const load = priorLoadCategory(activity.segments, i);

    // Try to find an existing group with similar pace and same load
    const existing = groups.find((g) => {
      const gPace = 1000 / g.avgSpeed;
      return Math.abs(pace - gPace) <= 15 && g.load === load;
    });

    if (existing) {
      existing.segments.push({ seg, index: i });
      // Update group averages
      const n = existing.segments.length;
      const allSegs = existing.segments.map((s) => s.seg);
      existing.avgSpeed = allSegs.reduce((s, v) => s + (v.avgSpeed ?? 0), 0) / n;
      existing.avgPace = paceStr(existing.avgSpeed);
      existing.avgEF = allSegs.reduce(
        (s, v) => s + efficiencyFactor(v.avgSpeed!, v.avgHeartRate!), 0
      ) / n;
      existing.avgHR = allSegs.reduce((s, v) => s + (v.avgHeartRate ?? 0), 0) / n;
    } else {
      groups.push({
        avgSpeed: seg.avgSpeed,
        avgPace: paceStr(seg.avgSpeed),
        load,
        segments: [{ seg, index: i }],
        avgEF: efficiencyFactor(seg.avgSpeed, seg.avgHeartRate),
        avgHR: seg.avgHeartRate,
      });
    }
  }

  return groups;
}

/**
 * For a segment group, find matching segments from all workouts,
 * averaged per workout into one point each.
 */
function findHistoricalPoints(
  group: SegmentGroup,
  allActivities: ParsedActivity[],
  currentId: string
): WorkoutPoint[] {
  const targetPace = 1000 / group.avgSpeed;
  const TOLERANCE = 15;
  const allowedLoads = ADJACENT_LOADS[group.load];

  const workoutMap = new Map<string, { efs: number[]; hrs: number[]; date: Date; dateStr: string }>();

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

      if (!workoutMap.has(a.id)) {
        workoutMap.set(a.id, {
          efs: [],
          hrs: [],
          date: a.summary.startTime ? new Date(a.summary.startTime) : new Date(),
          dateStr: a.summary.startTime
            ? new Date(a.summary.startTime).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })
            : a.fileName,
        });
      }

      const entry = workoutMap.get(a.id)!;
      entry.efs.push(efficiencyFactor(seg.avgSpeed, seg.avgHeartRate));
      entry.hrs.push(seg.avgHeartRate);
    }
  }

  const points: WorkoutPoint[] = [];
  for (const [id, entry] of workoutMap) {
    if (entry.efs.length === 0) continue;
    const avgEF = entry.efs.reduce((s, v) => s + v, 0) / entry.efs.length;
    const avgHR = entry.hrs.reduce((s, v) => s + v, 0) / entry.hrs.length;
    points.push({
      date: entry.date,
      dateStr: entry.dateStr,
      avgEF: +avgEF.toFixed(2),
      avgHR: Math.round(avgHR),
      avgPace: paceStr(group.avgSpeed),
      count: entry.efs.length,
      isCurrent: id === currentId,
    });
  }

  return points.sort((a, b) => a.date.getTime() - b.date.getTime());
}

function GroupChart({
  group,
  points,
}: {
  group: SegmentGroup;
  points: WorkoutPoint[];
}) {
  if (points.length < 2) return null;

  const currentPoint = points.find((p) => p.isCurrent);

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-100 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-gray-700">
          {group.avgPace}/km
          <span className="font-normal text-gray-500 ml-1">
            — {LOAD_LABELS[group.load]} load
          </span>
          {group.segments.length > 1 && (
            <span className="font-normal text-gray-400 ml-1">
              ({group.segments.length} segs averaged)
            </span>
          )}
        </span>
        <span className="text-xs text-gray-500">
          {points.length} workouts
        </span>
      </div>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs">
          EF: <span className="font-bold">{group.avgEF.toFixed(2)}</span>
        </span>
        <span className="text-xs text-gray-500">
          HR: {Math.round(group.avgHR)} bpm
        </span>
        {points.length >= 3 && (
          <span className="text-xs text-gray-500">
            Range: {Math.min(...points.map((p) => p.avgEF)).toFixed(1)}–
            {Math.max(...points.map((p) => p.avgEF)).toFixed(1)}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <ComposedChart data={points} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="dateStr" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9 }} domain={["auto", "auto"]} width={35} />
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null;
              const d = payload[0]?.payload as WorkoutPoint;
              return (
                <div className="bg-white border border-gray-200 rounded p-1.5 text-xs shadow">
                  <div className="font-semibold">
                    {d.dateStr} {d.isCurrent ? "(this run)" : ""}
                  </div>
                  <div>Avg EF: {d.avgEF} ({d.count} seg{d.count > 1 ? "s" : ""})</div>
                  <div>Avg HR: {d.avgHR} bpm</div>
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="avgEF"
            stroke="#94a3b8"
            strokeWidth={1.5}
            dot={{ r: 2, fill: "#94a3b8" }}
          />
          {currentPoint && (
            <ReferenceDot
              x={currentPoint.dateStr}
              y={currentPoint.avgEF}
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
        Similar segments within this workout are averaged together, then
        compared to averaged similar segments from past workouts. Purple dot = this run.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {chartsToShow.map(({ group, points }, i) => (
          <GroupChart key={i} group={group} points={points} />
        ))}
      </div>
    </div>
  );
}
