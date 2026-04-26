import { useMemo } from "react";
import type { LapSummary, WorkoutType } from "../types";
import { formatTime, parsePaceToSec } from "../../shared/pace";
import {
  classifyLaps,
  type LapFilter,
  type LapKind,
} from "../lapUtils";

interface LapTableProps {
  laps: LapSummary[];
  title?: string;
  compareLaps?: LapSummary[] | null;
  compareWorkoutType?: WorkoutType;
  workoutType?: WorkoutType;
  filter?: LapFilter;
  onFilterChange?: (f: LapFilter) => void;
  /** Optional — if parent already classified, use that instead of re-classifying */
  kinds?: LapKind[];
}

type CmpValues = {
  pace: string | null;
  paceSec: number | null;
  time: number | null;
  hr: number | null;
  cadence: number | null;
  vertOsc: number | null;
  gct: number | null;
  stride: number | null; // in meters
  vertRatio: number | null;
  power: number | null;
};

function extractCmp(lap: LapSummary | null | undefined): CmpValues {
  if (!lap) {
    return {
      pace: null, paceSec: null, time: null, hr: null, cadence: null,
      vertOsc: null, gct: null, stride: null, vertRatio: null, power: null,
    };
  }
  return {
    pace: lap.avgPace,
    paceSec: parsePaceToSec(lap.avgPace),
    time: lap.totalElapsedTime,
    hr: lap.avgHeartRate ?? null,
    cadence: lap.avgCadence ?? null,
    vertOsc: lap.avgVerticalOscillation ?? null,
    gct: lap.avgGroundContactTime ?? null,
    stride: lap.avgStrideLength != null ? lap.avgStrideLength / 1000 : null,
    vertRatio: lap.avgVerticalRatio ?? null,
    power: lap.avgPower ?? null,
  };
}

function diffPct(
  cur: number | null | undefined,
  cmp: number | null | undefined,
  invert: boolean
): { pct: number; isGood: boolean } | null {
  if (cur == null || cmp == null || cmp === 0) return null;
  const pct = ((cur - cmp) / cmp) * 100;
  const isGood = invert ? pct < 0 : pct > 0;
  return { pct, isGood };
}

function CmpCell({
  cmpText,
  diff,
}: {
  cmpText: string | null;
  diff: { pct: number; isGood: boolean } | null;
}) {
  // Always render the slot so rows don't jump when compare appears/disappears.
  if (cmpText == null) {
    return (
      <div
        className="lap-cmp num"
        style={{ visibility: "hidden", fontSize: 10, marginTop: 1 }}
      >
        —
      </div>
    );
  }
  return (
    <div
      className="lap-cmp num"
      style={{
        fontSize: 10,
        marginTop: 1,
        color: "var(--ink-3)",
        display: "flex",
        justifyContent: "flex-end",
        gap: 4,
      }}
    >
      <span>{cmpText}</span>
      {diff && (
        <span
          style={{
            fontWeight: 700,
            color: diff.isGood ? "var(--tag-easy)" : "var(--viz-4)",
            fontSize: 9.5,
          }}
        >
          {diff.pct > 0 ? "+" : ""}
          {diff.pct.toFixed(0)}%
        </span>
      )}
    </div>
  );
}

export default function LapTable({
  laps,
  title,
  compareLaps,
  compareWorkoutType,
  workoutType,
  filter: filterProp,
  onFilterChange,
  kinds: kindsProp,
}: LapTableProps) {
  const kinds = useMemo(
    () => kindsProp ?? classifyLaps(laps, workoutType),
    [laps, workoutType, kindsProp]
  );
  const hasRest = kinds.some((k) => k === "rest");
  const filter: LapFilter = filterProp ?? "all";

  const cmpHasRest = useMemo(() => {
    if (!compareLaps) return false;
    const cmpKinds = classifyLaps(compareLaps, compareWorkoutType);
    return cmpKinds.some((k) => k === "rest");
  }, [compareLaps, compareWorkoutType]);

  const visibleLaps = useMemo(() => {
    if (filter === "working") return laps.filter((_, i) => kinds[i] !== "rest");
    return laps;
  }, [laps, kinds, filter]);

  const { minPace, maxPace } = useMemo(() => {
    const workingPaces = laps
      .map((l, i) => (kinds[i] === "working" ? parsePaceToSec(l.avgPace) : null))
      .filter((v): v is number => v != null);
    if (workingPaces.length === 0) return { minPace: 0, maxPace: 1 };
    return { minPace: Math.min(...workingPaces), maxPace: Math.max(...workingPaces) };
  }, [laps, kinds]);

  const fastestIdx = useMemo(() => {
    let best = -1;
    let bestPace = Infinity;
    laps.forEach((l, i) => {
      if (kinds[i] !== "working") return;
      const p = parsePaceToSec(l.avgPace);
      if (p != null && p < bestPace) {
        bestPace = p;
        best = l.lapIndex;
      }
    });
    return best;
  }, [laps, kinds]);

  const slowestIdx = useMemo(() => {
    let worst = -1;
    let worstPace = -Infinity;
    laps.forEach((l, i) => {
      if (kinds[i] !== "working") return;
      const p = parsePaceToSec(l.avgPace);
      if (p != null && p > worstPace) {
        worstPace = p;
        worst = l.lapIndex;
      }
    });
    return worst;
  }, [laps, kinds]);

  if (laps.length === 0) return null;

  const workingCount = kinds.filter((k) => k === "working").length;
  const restCount = kinds.filter((k) => k === "rest").length;

  // Show filter toggle when either current OR compare run has rest laps,
  // so the control stays present when hovering an intervals run from an easy run.
  const showFilterControl = (hasRest || cmpHasRest) && !!onFilterChange;

  return (
    <section>
      <div
        className="row between"
        style={{ padding: "10px 0", borderTop: "1px solid var(--ink)", marginTop: 20 }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            {title ?? "Laps"}
            <span
              className="num"
              style={{ marginLeft: 8, color: "var(--ink-3)", fontWeight: 500 }}
            >
              {laps.length}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>
            {workingCount} working
            {restCount > 0 ? ` · ${restCount} rest` : ""}
          </div>
        </div>
        {showFilterControl && (
          <div className="seg" style={{ fontSize: 12 }}>
            {(["all", "working"] as const).map((f) => (
              <button
                key={f}
                className={filter === f ? "active" : ""}
                onClick={() => onFilterChange?.(f)}
              >
                {f === "all" ? "All" : "Working only"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="lap-head">
        <div>#</div>
        <div>Dist</div>
        <div>Time</div>
        <div className="lap-pace-head">Pace</div>
        <div>HR</div>
        <div>Cad</div>
        <div>Osc</div>
        <div>GCT</div>
        <div>Str</div>
        <div>VR</div>
        <div>Pow</div>
      </div>

      {visibleLaps.map((lap) => {
        const origIdx = laps.indexOf(lap);
        const kind = kinds[origIdx];
        const paceSec = parsePaceToSec(lap.avgPace);
        // Working-only range; rest laps may fall outside — clamp for bar width.
        const clampedPace =
          paceSec != null
            ? Math.max(minPace, Math.min(maxPace, paceSec))
            : null;
        const fillWidth =
          clampedPace != null && maxPace > minPace
            ? 20 + ((clampedPace - minPace) / (maxPace - minPace)) * 80
            : 40;

        // Positionally match compare lap by zero-indexed lap number.
        const cmpLap = compareLaps?.[origIdx] ?? null;
        const cmp = extractCmp(cmpLap);

        const hrOver =
          lap.avgHeartRate != null && lap.maxHeartRate != null
            ? Math.round(lap.maxHeartRate - lap.avgHeartRate)
            : null;

        const curStride =
          lap.avgStrideLength != null ? lap.avgStrideLength / 1000 : null;

        const rowClasses = [
          "lap-row",
          kind === "rest" ? "lap-rest" : "",
          lap.lapIndex === fastestIdx ? "lap-fastest" : "",
          lap.lapIndex === slowestIdx ? "lap-slowest" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div key={lap.lapIndex} className={rowClasses}>
            <div>
              <span className="lap-idx">
                {String(lap.lapIndex).padStart(2, "0")}
                {hasRest && (
                  <span className="lap-kind-tag" data-kind={kind}>
                    {kind === "working" ? "work" : "rest"}
                  </span>
                )}
              </span>
            </div>
            <div>
              <div className="num">
                {(lap.totalDistance / 1000).toFixed(2)}
                <span className="lap-u">km</span>
              </div>
              <CmpCell
                cmpText={cmpLap ? `${(cmpLap.totalDistance / 1000).toFixed(2)} km` : null}
                diff={null}
              />
            </div>
            <div>
              <div className="num">{formatTime(lap.totalElapsedTime)}</div>
              <CmpCell
                cmpText={cmp.time != null ? formatTime(cmp.time) : null}
                diff={diffPct(lap.totalElapsedTime, cmp.time, true)}
              />
            </div>
            <div className="lap-pace">
              <div
                className="row"
                style={{ justifyContent: "space-between", alignItems: "baseline" }}
              >
                <div className="num lap-pace-val">{lap.avgPace}</div>
                <span
                  className="num"
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color:
                      cmp.paceSec != null && paceSec != null
                        ? diffPct(paceSec, cmp.paceSec, true)!.isGood
                          ? "var(--tag-easy)"
                          : "var(--viz-4)"
                        : "transparent",
                    visibility: cmp.pace ? "visible" : "hidden",
                  }}
                >
                  {cmp.pace != null && cmp.paceSec != null && paceSec != null
                    ? `${cmp.pace} ${
                        diffPct(paceSec, cmp.paceSec, true)!.pct > 0 ? "+" : ""
                      }${diffPct(paceSec, cmp.paceSec, true)!.pct.toFixed(0)}%`
                    : "0:00 +0%"}
                </span>
              </div>
              <div className="lap-pace-bar">
                <div
                  className="lap-pace-fill"
                  style={{
                    width: `${fillWidth}%`,
                    background: kind === "rest" ? "var(--hair-strong)" : undefined,
                  }}
                />
              </div>
            </div>
            <div className="lap-hr">
              <div>
                <span className="num" style={{ color: "var(--viz-4)", fontWeight: 600 }}>
                  {lap.avgHeartRate != null ? Math.round(lap.avgHeartRate) : "—"}
                </span>
                {hrOver != null && hrOver > 0 && (
                  <span
                    className={`lap-hr-delta ${hrOver > 8 ? "over" : "in"}`}
                    style={{ marginLeft: 5 }}
                  >
                    +{hrOver}
                  </span>
                )}
                <CmpCell
                  cmpText={cmp.hr != null ? String(Math.round(cmp.hr)) : null}
                  diff={diffPct(lap.avgHeartRate, cmp.hr, true)}
                />
              </div>
            </div>
            <div>
              <div className="num">
                {lap.avgCadence != null ? Math.round(lap.avgCadence) : "—"}
              </div>
              <CmpCell
                cmpText={cmp.cadence != null ? String(Math.round(cmp.cadence)) : null}
                diff={diffPct(lap.avgCadence, cmp.cadence, false)}
              />
            </div>
            <div>
              <div className="num">
                {lap.avgVerticalOscillation != null
                  ? lap.avgVerticalOscillation.toFixed(1)
                  : "—"}
                {lap.avgVerticalOscillation != null && (
                  <span className="lap-u">mm</span>
                )}
              </div>
              <CmpCell
                cmpText={cmp.vertOsc != null ? `${cmp.vertOsc.toFixed(1)} mm` : null}
                diff={diffPct(lap.avgVerticalOscillation, cmp.vertOsc, true)}
              />
            </div>
            <div>
              <div className="num">
                {lap.avgGroundContactTime != null
                  ? Math.round(lap.avgGroundContactTime)
                  : "—"}
                {lap.avgGroundContactTime != null && <span className="lap-u">ms</span>}
              </div>
              <CmpCell
                cmpText={cmp.gct != null ? `${Math.round(cmp.gct)} ms` : null}
                diff={diffPct(lap.avgGroundContactTime, cmp.gct, true)}
              />
            </div>
            <div>
              <div className="num">
                {curStride != null ? curStride.toFixed(2) : "—"}
                {curStride != null && <span className="lap-u">m</span>}
              </div>
              <CmpCell
                cmpText={cmp.stride != null ? `${cmp.stride.toFixed(2)} m` : null}
                diff={diffPct(curStride, cmp.stride, false)}
              />
            </div>
            <div>
              <div className="num">
                {lap.avgVerticalRatio != null ? lap.avgVerticalRatio.toFixed(1) : "—"}
                {lap.avgVerticalRatio != null && <span className="lap-u">%</span>}
              </div>
              <CmpCell
                cmpText={cmp.vertRatio != null ? `${cmp.vertRatio.toFixed(1)}%` : null}
                diff={diffPct(lap.avgVerticalRatio, cmp.vertRatio, true)}
              />
            </div>
            <div>
              <div className="num">
                {lap.avgPower != null ? Math.round(lap.avgPower) : "—"}
                {lap.avgPower != null && <span className="lap-u">W</span>}
              </div>
              <CmpCell
                cmpText={cmp.power != null ? `${Math.round(cmp.power)} W` : null}
                diff={diffPct(lap.avgPower, cmp.power, false)}
              />
            </div>
          </div>
        );
      })}
    </section>
  );
}
