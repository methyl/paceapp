import { useEffect, useMemo, useState } from "react";
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
  pinnedCompareId?: string | null;
  onTogglePinCompare?: (a: ParsedActivity) => void;
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
  max = 8
): ParsedActivity[] {
  if (!target) return [];
  return all
    .filter((a) => a.id !== target.id)
    .map((a) => ({ a, score: scoreSimilarity(target, a) }))
    .sort((x, y) => x.score - y.score)
    .slice(0, max)
    .map(({ a }) => a);
}

// Sub-filter buckets for intervals — matched against workoutLabel text.
// parseFit produces labels like "2km easy + 4×1km @3:50 + 2km easy", so
// we look for rep-distance tokens (400m, 800m, 1km, mile, 2km).
type SubFilterOption = {
  key: string;
  label: string;
  match: (a: ParsedActivity) => boolean;
};

const INTERVAL_REPS: SubFilterOption[] = [
  {
    key: "400",
    label: "400m",
    match: (a) => /\b400\s*m\b|×\s*400/i.test(a.workoutLabel),
  },
  {
    key: "800",
    label: "800m",
    match: (a) => /\b800\s*m\b|×\s*800/i.test(a.workoutLabel),
  },
  {
    key: "1000",
    label: "1 km",
    match: (a) =>
      /\b1\s*km\b|×\s*1\s*km|1000\s*m/i.test(a.workoutLabel),
  },
  {
    key: "mile",
    label: "Mile",
    match: (a) => /\bmile\b|\bmi\b/i.test(a.workoutLabel),
  },
  {
    key: "2000",
    label: "2 km",
    match: (a) =>
      /\b2\s*km\b|×\s*2\s*km|2000\s*m/i.test(a.workoutLabel),
  },
];

// Distance buckets — applied to total distance in km.
const DISTANCE_BUCKETS: Array<{
  key: string;
  label: string;
  test: (km: number) => boolean;
}> = [
  { key: "lt5", label: "< 5 km", test: (km) => km < 5 },
  { key: "5-10", label: "5–10 km", test: (km) => km >= 5 && km < 10 },
  { key: "10-15", label: "10–15 km", test: (km) => km >= 10 && km < 15 },
  { key: "15p", label: "15+ km", test: (km) => km >= 15 },
];

function getSubFilterOptions(
  type: WorkoutType | "all",
  pool: ParsedActivity[]
): SubFilterOption[] | null {
  if (type === "all") return null;
  if (type === "intervals") {
    // Only keep interval-length buckets that have at least one match
    return INTERVAL_REPS.filter((opt) => pool.some(opt.match));
  }
  // Distance buckets for all other types
  const opts: SubFilterOption[] = DISTANCE_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    match: (a) => b.test(a.summary.totalDistance / 1000),
  }));
  return opts.filter((opt) => pool.some(opt.match));
}

interface RunRowProps {
  activity: ParsedActivity;
  selected: boolean;
  isPinnedCompare?: boolean;
  compareDisabled?: boolean;
  compact?: boolean;
  onClick: () => void;
  onHover?: (a: ParsedActivity | null) => void;
  onTogglePinCompare?: (a: ParsedActivity) => void;
}

function PinIcon({ filled }: { filled?: boolean }) {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
      <path d="M12 2 8 6v6l-4 4h7v6l1 2 1-2v-6h7l-4-4V6l-4-4z" strokeLinejoin="round" />
    </svg>
  );
}

function RunRow({
  activity,
  selected,
  isPinnedCompare,
  compareDisabled,
  compact,
  onClick,
  onHover,
  onTogglePinCompare,
}: RunRowProps) {
  const color = WORKOUT_COLORS[activity.workoutType];
  return (
    <div
      className={`run-row ${selected ? "selected" : ""} ${isPinnedCompare ? "pinned-compare" : ""}`}
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
      {onTogglePinCompare && !compareDisabled && (
        <button
          type="button"
          className={`run-compare-btn ${isPinnedCompare ? "pinned" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePinCompare(activity);
          }}
          title={isPinnedCompare ? "Unpin compare" : "Pin as compare"}
        >
          <PinIcon filled={isPinnedCompare} />
          <span>{isPinnedCompare ? "Pinned" : "Compare"}</span>
        </button>
      )}
    </div>
  );
}

export default function LibraryRail({
  activities,
  selectedId,
  onSelect,
  onHover,
  hoveredId,
  pinnedCompareId,
  onTogglePinCompare,
}: LibraryRailProps) {
  const [filter, setFilter] = useState<WorkoutType | "all">("all");
  const [subFilter, setSubFilter] = useState<string | null>(null);

  // Reset sub-filter whenever the primary type changes — stale keys don't match new pool.
  useEffect(() => {
    setSubFilter(null);
  }, [filter]);

  const typeCounts = useMemo(() => {
    const counts: Partial<Record<WorkoutType, number>> = {};
    for (const a of activities) counts[a.workoutType] = (counts[a.workoutType] ?? 0) + 1;
    return counts;
  }, [activities]);

  // Pool filtered by primary type only — used to compute which sub-filter
  // buckets are non-empty.
  const typePool = useMemo(() => {
    if (filter === "all") return activities;
    return activities.filter((a) => a.workoutType === filter);
  }, [activities, filter]);

  const subOptions = useMemo(() => getSubFilterOptions(filter, typePool), [filter, typePool]);

  const filtered = useMemo(() => {
    if (!subFilter || !subOptions) return typePool;
    const opt = subOptions.find((o) => o.key === subFilter);
    if (!opt) return typePool;
    return typePool.filter(opt.match);
  }, [typePool, subFilter, subOptions]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const da = a.summary.startTime ? new Date(a.summary.startTime).getTime() : 0;
      const db = b.summary.startTime ? new Date(b.summary.startTime).getTime() : 0;
      return db - da;
    });
  }, [filtered]);

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
        {subOptions && subOptions.length > 0 && (
          <div className="rail-subfilters">
            {subOptions.map((opt) => {
              const count = typePool.filter(opt.match).length;
              const active = subFilter === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  className={`rail-subchip ${active ? "active" : ""}`}
                  onClick={() => setSubFilter(active ? null : opt.key)}
                >
                  {opt.label}
                  <span className="chip-count">{count}</span>
                </button>
              );
            })}
          </div>
        )}
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
                isPinnedCompare={a.id === pinnedCompareId}
                compareDisabled={a.id === selectedId}
                onClick={() => onSelect(a)}
                onHover={onHover}
                onTogglePinCompare={onTogglePinCompare}
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
          {/* ~2.5 compact rows visible, rest scrolls within the panel */}
          <div style={{ maxHeight: 128, overflowY: "auto", paddingBottom: 8 }}>
            {similar.map((a) => (
              <RunRow
                key={a.id}
                activity={a}
                selected={a.id === hoveredId}
                isPinnedCompare={a.id === pinnedCompareId}
                compareDisabled={a.id === selectedId}
                compact
                onClick={() => onSelect(a)}
                onHover={onHover}
                onTogglePinCompare={onTogglePinCompare}
              />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
