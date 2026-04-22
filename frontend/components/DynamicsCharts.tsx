import { useMemo } from "react";
import type { LapSummary } from "../types";
import type { LapFilter, LapKind } from "../lapUtils";
import { classifyLaps } from "../lapUtils";

interface DynamicsChartsProps {
  laps: LapSummary[];
  /** Optional compare run laps (positional alignment by index) */
  compareLaps?: LapSummary[] | null;
  compareLabel?: string | null;
  /** Respect the lap filter from the run-detail view */
  filter?: LapFilter;
  /** Optional pre-classified kinds; we'll recompute if not provided */
  kinds?: LapKind[];
}

type MetricDef = {
  key: keyof LapSummary;
  title: string;
  unit: string;
  color: string;
  // Lower-is-better?
  invert: boolean;
  fmt: (v: number) => string;
  // Value transform (e.g. stride from mm to m)
  transform?: (v: number) => number;
};

const METRICS: MetricDef[] = [
  {
    key: "avgVerticalOscillation",
    title: "Vertical Oscillation",
    unit: "mm",
    color: "var(--viz-5)",
    invert: true,
    fmt: (v) => v.toFixed(1),
  },
  {
    key: "avgGroundContactTime",
    title: "Ground Contact Time",
    unit: "ms",
    color: "var(--viz-2)",
    invert: true,
    fmt: (v) => Math.round(v).toString(),
  },
  {
    key: "avgStrideLength",
    title: "Stride Length",
    unit: "m",
    color: "var(--viz-1)",
    invert: false,
    fmt: (v) => v.toFixed(2),
    transform: (v) => v / 1000,
  },
  {
    key: "avgVerticalRatio",
    title: "Vertical Ratio",
    unit: "%",
    color: "var(--viz-4)",
    invert: true,
    fmt: (v) => v.toFixed(1),
  },
  {
    key: "avgCadence",
    title: "Cadence",
    unit: "spm",
    color: "var(--viz-3)",
    invert: false,
    fmt: (v) => Math.round(v).toString(),
  },
  {
    key: "avgPower",
    title: "Power",
    unit: "W",
    color: "var(--viz-5)",
    invert: false,
    fmt: (v) => Math.round(v).toString(),
  },
];

function seriesOf(
  laps: LapSummary[],
  metric: MetricDef
): (number | null)[] {
  return laps.map((l) => {
    const raw = l[metric.key] as number | null | undefined;
    if (raw == null) return null;
    return metric.transform ? metric.transform(raw) : raw;
  });
}

function cleanNumbers(arr: (number | null)[]): number[] {
  return arr.filter((v): v is number => v != null);
}

function BarChart({
  data,
  labels,
  kinds,
  color,
  height = 140,
  formatValue,
}: {
  data: (number | null)[];
  labels: string[];
  kinds: LapKind[];
  color: string;
  height?: number;
  formatValue: (v: number) => string;
}) {
  const nums = cleanNumbers(data);
  if (nums.length === 0) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const pad = (max - min) * 0.15 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const W = 600;
  const H = 200;
  const bw = W / data.length;
  const sy = (v: number) => H - ((v - lo) / (hi - lo)) * (H - 20) - 10;

  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => lo + (hi - lo) * (i / ticks));

  return (
    <div style={{ position: "relative", height, paddingLeft: 38 }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 18,
          width: 36,
          display: "flex",
          flexDirection: "column-reverse",
          justifyContent: "space-between",
          fontSize: 10,
          color: "var(--ink-3)",
        }}
        className="num"
      >
        {tickVals.map((v, i) => (
          <span key={i} style={{ textAlign: "right" }}>
            {formatValue(v)}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H + 20}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        {tickVals.map((v, i) => (
          <line
            key={i}
            x1={0}
            x2={W}
            y1={sy(v)}
            y2={sy(v)}
            stroke="var(--hair)"
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {data.map((v, i) => {
          if (v == null) return null;
          const y = sy(v);
          const h = H - 10 - y;
          const isRest = kinds[i] === "rest";
          return (
            <rect
              key={i}
              x={i * bw + bw * 0.15}
              y={y}
              width={bw * 0.7}
              height={Math.max(2, h)}
              rx={2}
              fill={color}
              opacity={isRest ? 0.3 : 0.85}
            />
          );
        })}
      </svg>
      <div
        style={{
          display: "flex",
          marginLeft: 0,
          fontSize: 10,
          color: "var(--ink-3)",
          height: 14,
        }}
        className="num"
      >
        {labels.map((l, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              textAlign: "center",
              opacity: kinds[i] === "rest" ? 0.45 : 1,
            }}
          >
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

function DeltaBarChart({
  current,
  compare,
  labels,
  kinds,
  invert,
  formatValue,
  height = 140,
}: {
  current: (number | null)[];
  compare: (number | null)[];
  labels: string[];
  kinds: LapKind[];
  invert: boolean;
  formatValue: (v: number) => string;
  height?: number;
}) {
  const n = Math.min(current.length, compare.length);
  const pairs = Array.from({ length: n }, (_, i) => ({
    cur: current[i],
    cmp: compare[i],
    delta:
      current[i] != null && compare[i] != null
        ? (current[i] as number) - (compare[i] as number)
        : null,
  }));
  const validDeltas = pairs.map((p) => p.delta).filter((v): v is number => v != null);
  if (validDeltas.length === 0) return null;
  const maxAbs = Math.max(...validDeltas.map(Math.abs), 0.0001);
  const extent = maxAbs + maxAbs * 0.2;

  const W = 600;
  const H = 200;
  const bw = W / n;
  const zeroY = H / 2;
  const sy = (d: number) => zeroY - (d / extent) * (H / 2 - 12);

  return (
    <div style={{ position: "relative", height, paddingLeft: 8 }}>
      <svg
        viewBox={`0 0 ${W} ${H + 20}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        style={{ display: "block", overflow: "visible" }}
      >
        {[-extent * 0.5, extent * 0.5].map((v, i) => (
          <line
            key={i}
            x1={0}
            x2={W}
            y1={sy(v)}
            y2={sy(v)}
            stroke="var(--hair)"
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line
          x1={0}
          x2={W}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--ink-2)"
          strokeWidth={0.75}
          vectorEffect="non-scaling-stroke"
        />

        {pairs.map((p, i) => {
          if (p.delta == null || p.cur == null) return null;
          const y = sy(p.delta);
          const h = Math.abs(y - zeroY);
          const isWorse = invert ? p.delta > 0 : p.delta < 0;
          const color =
            p.delta === 0
              ? "var(--ink-3)"
              : isWorse
              ? "var(--viz-4)"
              : "var(--tag-easy)";
          const x = i * bw + bw * 0.2;
          const w = bw * 0.6;
          const top = p.delta >= 0 ? y : zeroY;
          const labelY = p.delta >= 0 ? y - 5 : y + 12;
          const isRest = kinds[i] === "rest";
          return (
            <g key={i} opacity={isRest ? 0.32 : 1}>
              <rect
                x={x}
                y={top}
                width={w}
                height={Math.max(1.5, h)}
                rx={2}
                fill={color}
                opacity={0.9}
              />
              <text
                x={x + w / 2}
                y={labelY}
                fontSize={10.5}
                textAnchor="middle"
                fill="var(--ink-2)"
                fontWeight={600}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatValue(p.cur)}
              </text>
            </g>
          );
        })}

        {labels.slice(0, n).map((l, i) => (
          <text
            key={i}
            x={i * bw + bw / 2}
            y={H + 14}
            fontSize={10}
            fill="var(--ink-3)"
            textAnchor="middle"
            style={{ fontVariantNumeric: "tabular-nums" }}
            opacity={kinds[i] === "rest" ? 0.45 : 1}
          >
            {l}
          </text>
        ))}
      </svg>
    </div>
  );
}

function avgOf(arr: (number | null)[]): number | null {
  const nums = cleanNumbers(arr);
  if (nums.length === 0) return null;
  return nums.reduce((a, v) => a + v, 0) / nums.length;
}

export default function DynamicsCharts({
  laps,
  compareLaps,
  compareLabel,
  filter = "all",
  kinds: kindsProp,
}: DynamicsChartsProps) {
  const kinds = useMemo(() => kindsProp ?? classifyLaps(laps), [laps, kindsProp]);

  const lapsForChart = useMemo(
    () => (filter === "working" ? laps.filter((_, i) => kinds[i] === "working") : laps),
    [laps, kinds, filter]
  );
  const kindsForChart = useMemo(
    () => (filter === "working" ? kinds.filter((k) => k === "working") : kinds),
    [kinds, filter]
  );

  const cmpKinds = useMemo(
    () => (compareLaps ? classifyLaps(compareLaps) : null),
    [compareLaps]
  );
  const cmpLapsForChart = useMemo(() => {
    if (!compareLaps || !cmpKinds) return null;
    return filter === "working"
      ? compareLaps.filter((_, i) => cmpKinds[i] === "working")
      : compareLaps;
  }, [compareLaps, cmpKinds, filter]);

  const labels = lapsForChart.map((l) => `L${l.lapIndex}`);

  const hasData = (metric: MetricDef) => laps.some((l) => l[metric.key] != null);
  const visibleMetrics = METRICS.filter(hasData);
  if (visibleMetrics.length === 0) return null;

  return (
    <section style={{ marginTop: 32 }}>
      <div
        className="row between"
        style={{ marginBottom: 12, alignItems: "baseline" }}
      >
        <h2
          style={{
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Running dynamics
        </h2>
        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {compareLaps ? (
            <>
              Δ vs{" "}
              <b style={{ color: "var(--ink)", fontWeight: 600 }}>
                {compareLabel ?? "compare"}
              </b>{" "}
              · per lap
            </>
          ) : (
            "Per-lap averages"
          )}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 14,
        }}
      >
        {visibleMetrics.map((m) => {
          const curData = seriesOf(lapsForChart, m);
          const curAvg = avgOf(curData);
          const cmpData = cmpLapsForChart ? seriesOf(cmpLapsForChart, m) : null;
          const cmpAvg = cmpData ? avgOf(cmpData) : null;
          const avgDelta =
            curAvg != null && cmpAvg != null ? curAvg - cmpAvg : null;
          const avgIsBetter =
            avgDelta != null && (m.invert ? avgDelta < 0 : avgDelta > 0);
          const avgColor =
            avgDelta != null
              ? avgIsBetter
                ? "var(--tag-easy)"
                : "var(--viz-4)"
              : m.color;
          const showDelta = !!cmpData;

          return (
            <div key={m.key} className="card card-pad">
              <div className="row between" style={{ marginBottom: 10 }}>
                <div>
                  <div className="card-title">{m.title}</div>
                  <div className="card-sub">
                    {showDelta ? `Δ ${m.unit}` : `Per lap · ${m.unit}`}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  {showDelta && avgDelta != null ? (
                    <>
                      <div
                        className="num"
                        style={{
                          fontSize: 18,
                          fontWeight: 600,
                          color: avgColor,
                          letterSpacing: "-0.02em",
                        }}
                      >
                        {avgDelta >= 0 ? "+" : ""}
                        {m.fmt(avgDelta)}
                      </div>
                      <div
                        className="num"
                        style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 1 }}
                      >
                        {curAvg != null ? m.fmt(curAvg) : "—"} vs{" "}
                        {cmpAvg != null ? m.fmt(cmpAvg) : "—"}
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        className="num"
                        style={{
                          fontSize: 18,
                          fontWeight: 600,
                          color: m.color,
                          letterSpacing: "-0.02em",
                        }}
                      >
                        {curAvg != null ? m.fmt(curAvg) : "—"}
                      </div>
                      <div
                        className="num"
                        style={{
                          fontSize: 10,
                          color: "var(--ink-3)",
                          marginTop: 1,
                          visibility: "hidden",
                        }}
                      >
                        placeholder
                      </div>
                    </>
                  )}
                </div>
              </div>
              {showDelta && cmpData ? (
                <DeltaBarChart
                  current={curData}
                  compare={cmpData}
                  labels={labels}
                  kinds={kindsForChart}
                  invert={m.invert}
                  formatValue={m.fmt}
                />
              ) : (
                <BarChart
                  data={curData}
                  labels={labels}
                  kinds={kindsForChart}
                  color={m.color}
                  formatValue={m.fmt}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
