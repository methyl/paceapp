import { useMemo, useState } from "react";
import type { ParsedActivity, WorkoutType } from "../types";
import { WORKOUT_LABELS, WORKOUT_COLORS } from "../types";
import RunPathThumb from "./RunPathThumb";
import { parsePaceToSec } from "../lapUtils";

interface LibraryRailProps {
  activities: ParsedActivity[];
  selectedId: string | null;
  onSelect: (a: ParsedActivity) => void;
  onHover?: (a: ParsedActivity | null) => void;
  hoveredId?: string | null;
}

const TYPE_ORDER: WorkoutType[] = [
  "easy",
  "steady",
  "tempo",
  "intervals",
  "progressive",
  "race",
  "unknown",
];

function formatDay(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dayKey(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Score candidates against the selected run — lower is more similar.
// Weights mirror the design: type > distance > pace.
function scoreSimilarity(target: ParsedActivity, candidate: ParsedActivity): number {
  if (target.id === candidate.id) return Infinity;
  const typeMatch = target.workoutType === candidate.workoutType ? 0 : 1;
  const targetDist = target.summary.totalDistance;
  const candDist = candidate.summary.totalDistance;
  const distDiff = Math.abs(targetDist - candDist) / Math.max(targetDist, 1);
  const targetPace = parsePaceToSec(target.summary.avgPace) ?? 0;
  const candPace = parsePaceToSec(candidate.summary.avgPace) ?? 0;
  const paceDiff = targetPace > 0 ? Math.abs(targetPace - candPace) / targetPace : 0;
  return typeMatch * 0.6 + distDiff * 0.9 + paceDiff * 0.5;
}

function findSimilar(
  all: ParsedActivity[],
  target: ParsedActivity | null | undefined,
  max = 6
): ParsedActivity[] {
  if (!target) return [];
  return all
    .filter((a) => a.id !== target.id)
    .map((a) => ({ a, score: scoreSimilarity(target, a) }))
    .sort((x, y) => x.score - y.score)
    .slice(0, max)
    .map(({ a }) => a);
}

interface RunRowProps {
  activity: ParsedActivity;
  selected: boolean;
  compact?: boolean;
  onClick: () => void;
  onHover?: (a: ParsedActivity | null) => void;
}

function RunRow({ activity, selected, compact, onClick, onHover }: RunRowProps) {
  const color = WORKOUT_COLORS[activity.workoutType];
  return (
    <div
      className={`run-row ${selected ? "selected" : ""}`}
      onClick={onClick}
      onMouseEnter={() => onHover?.(activity)}
      onMouseLeave={() => onHover?.(null)}
      style={compact ? { padding: "6px 16px" } : undefined}
    >
      <div className="run-thumb">
        <RunPathThumb records={activity.records} color={color} />
      </div>
      <div className="run-main">
        <div className="run-title" title={activity.workoutLabel}>
          <span
            className="run-type-pill"
            style={{
              background: `color-mix(in oklch, ${color} 15%, transparent)`,
              color,
            }}
          >
            {WORKOUT_LABELS[activity.workoutType]}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {activity.workoutLabel || activity.fileName}
          </span>
        </div>
        {!compact && (
          <div className="run-meta">
            {formatDuration(activity.summary.totalElapsedTime)}
            {activity.summary.avgPace ? ` · ${activity.summary.avgPace}/km` : ""}
            {activity.summary.avgHeartRate != null
              ? ` · ${Math.round(activity.summary.avgHeartRate)} bpm`
              : ""}
          </div>
        )}
      </div>
      <div className="run-stats">
        <div className="run-dist">
          {(activity.summary.totalDistance / 1000).toFixed(1)}
          <span className="lap-u"> km</span>
        </div>
      </div>
    </div>
  );
}

export default function LibraryRail({
  activities,
  selectedId,
  onSelect,
  onHover,
  hoveredId,
}: LibraryRailProps) {
  const [filter, setFilter] = useState<WorkoutType | "all">("all");

  const typeCounts = useMemo(() => {
    const counts: Partial<Record<WorkoutType, number>> = {};
    for (const a of activities) counts[a.workoutType] = (counts[a.workoutType] ?? 0) + 1;
    return counts;
  }, [activities]);

  const sorted = useMemo(() => {
    const filtered =
      filter === "all" ? activities : activities.filter((a) => a.workoutType === filter);
    return [...filtered].sort((a, b) => {
      const da = a.summary.startTime ? new Date(a.summary.startTime).getTime() : 0;
      const db = b.summary.startTime ? new Date(b.summary.startTime).getTime() : 0;
      return db - da;
    });
  }, [activities, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: ParsedActivity[] }>();
    for (const a of sorted) {
      const key = dayKey(a.summary.startTime);
      const group = map.get(key);
      if (group) group.items.push(a);
      else map.set(key, { label: formatDay(a.summary.startTime), items: [a] });
    }
    return Array.from(map.values());
  }, [sorted]);

  const selected = useMemo(
    () => activities.find((a) => a.id === selectedId) ?? null,
    [activities, selectedId]
  );
  const similar = useMemo(
    () => findSimilar(activities, selected, 8),
    [activities, selected]
  );

  const visibleTypes = TYPE_ORDER.filter((t) => (typeCounts[t] ?? 0) > 0);

  return (
    <aside className="rail">
      <div className="rail-header">
        <div className="rail-title-row">
          <div className="rail-title">Library · {activities.length}</div>
        </div>
        <div className="rail-filters">
          <button
            type="button"
            className={`rail-chip ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All
            <span className="chip-count">{activities.length}</span>
          </button>
          {visibleTypes.map((t) => (
            <button
              key={t}
              type="button"
              className={`rail-chip ${filter === t ? "active" : ""}`}
              onClick={() => setFilter(filter === t ? "all" : t)}
            >
              <span className="chip-dot" style={{ background: WORKOUT_COLORS[t] }} />
              {WORKOUT_LABELS[t]}
              <span className="chip-count">{typeCounts[t]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rail-list">
        {groups.map((g, gi) => (
          <div key={gi}>
            <div className="rail-day">{g.label}</div>
            {g.items.map((a) => (
              <RunRow
                key={a.id}
                activity={a}
                selected={a.id === selectedId}
                onClick={() => onSelect(a)}
                onHover={onHover}
              />
            ))}
          </div>
        ))}
        {sorted.length === 0 && (
          <div style={{ padding: "24px 16px", color: "var(--ink-3)", fontSize: 12 }}>
            No runs match this filter.
          </div>
        )}
      </div>

      {similar.length > 0 && (
        <div
          style={{
            borderTop: "1px solid var(--hair)",
            background: "#fff",
            flexShrink: 0,
          }}
        >
          <div
            className="row between"
            style={{ padding: "12px 16px 6px", alignItems: "center" }}
          >
            <div className="rail-title" style={{ margin: 0 }}>
              Similar · {similar.length}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "var(--ink-3)",
                letterSpacing: "0.04em",
              }}
            >
              matched to current
            </div>
          </div>
          {/* ~2.5 compact rows visible, rest scrolls */}
          <div
            style={{
              maxHeight: 128,
              overflowY: "auto",
              paddingBottom: 8,
            }}
          >
            {similar.map((a) => (
              <RunRow
                key={a.id}
                activity={a}
                selected={a.id === hoveredId}
                compact
                onClick={() => onSelect(a)}
                onHover={onHover}
              />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
