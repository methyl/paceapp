import { useMemo, useRef, useState } from "react";
import type { RecordPoint } from "../types";
import { paceSecToStr } from "../lapUtils";

interface TimeSeriesChartProps {
  records: RecordPoint[];
  compareRecords?: RecordPoint[] | null;
  compareLabel?: string | null;
  restBands?: Array<[number, number]>;
  /** Height in pixels — scales to number of active channels */
  baseHeight?: number;
}

type ChannelKey = "pace" | "hr" | "power" | "elev";

type Channel = {
  key: ChannelKey;
  label: string;
  unit: string;
  color: string;
  formatValue: (v: number) => string;
  // Derive the series from a downsampled list of records
  derive: (r: RecordPoint) => number | null;
};

const CHANNELS: Channel[] = [
  {
    key: "pace",
    label: "Pace",
    unit: "/km",
    color: "var(--viz-1)",
    formatValue: (v) => paceSecToStr(v),
    derive: (r) => (r.speed != null && r.speed > 0 ? 1000 / r.speed : null),
  },
  {
    key: "hr",
    label: "Heart rate",
    unit: "bpm",
    color: "var(--viz-4)",
    formatValue: (v) => Math.round(v).toString(),
    derive: (r) => r.heartRate ?? null,
  },
  {
    key: "power",
    label: "Power",
    unit: "W",
    color: "var(--viz-5)",
    formatValue: (v) => Math.round(v).toString(),
    derive: (r) => r.power ?? null,
  },
  {
    key: "elev",
    label: "Elevation",
    unit: "m",
    color: "var(--ink-2)",
    formatValue: (v) => Math.round(v).toString(),
    derive: (r) => r.altitude ?? null,
  },
];

function downsample(records: RecordPoint[], target = 120): RecordPoint[] {
  if (records.length <= target) return records;
  const step = Math.floor(records.length / target);
  const out: RecordPoint[] = [];
  for (let i = 0; i < records.length; i += step) out.push(records[i]);
  if (out[out.length - 1] !== records[records.length - 1]) {
    out.push(records[records.length - 1]);
  }
  return out;
}

// Resample a records series onto a fixed number of evenly-spaced distance steps.
// Returns [0..n-1] indexed values — the x-axis is distance, so two runs can be
// compared over the same normalized distance fraction.
function resampleByDistance(
  records: RecordPoint[],
  channel: Channel,
  n: number
): (number | null)[] {
  if (records.length === 0) return [];
  const maxDist = records[records.length - 1].distance;
  if (maxDist <= 0) return [];
  const out: (number | null)[] = new Array(n);
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * maxDist;
    while (cursor < records.length - 1 && records[cursor + 1].distance < target) {
      cursor++;
    }
    out[i] = channel.derive(records[cursor]);
  }
  return out;
}

function stats(
  arr: (number | null)[]
): { avg: number | null; min: number | null; max: number | null } {
  const nums = arr.filter((v): v is number => v != null);
  if (nums.length === 0) return { avg: null, min: null, max: null };
  const sum = nums.reduce((a, v) => a + v, 0);
  return { avg: sum / nums.length, min: Math.min(...nums), max: Math.max(...nums) };
}

function elevationGainLoss(arr: (number | null)[]): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < arr.length; i++) {
    const a = arr[i - 1];
    const b = arr[i];
    if (a == null || b == null) continue;
    const d = b - a;
    if (d > 0) gain += d;
    else loss -= d;
  }
  return { gain, loss };
}

export default function TimeSeriesChart({
  records,
  compareRecords,
  compareLabel,
  restBands,
  baseHeight = 120,
}: TimeSeriesChartProps) {
  const [visible, setVisible] = useState<Record<ChannelKey, boolean>>({
    pace: true,
    hr: true,
    power: true,
    elev: true,
  });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const ds = useMemo(() => downsample(records, 160), [records]);
  const dsCmp = useMemo(
    () => (compareRecords ? downsample(compareRecords, 160) : null),
    [compareRecords]
  );

  const N = 100;

  // Per-channel resampled arrays (current + compare)
  const samples = useMemo(() => {
    const map: Record<ChannelKey, { data: (number | null)[]; compare: (number | null)[] | null }> = {
      pace: { data: [], compare: null },
      hr: { data: [], compare: null },
      power: { data: [], compare: null },
      elev: { data: [], compare: null },
    };
    for (const c of CHANNELS) {
      map[c.key].data = resampleByDistance(ds, c, N);
      map[c.key].compare = dsCmp ? resampleByDistance(dsCmp, c, N) : null;
    }
    return map;
  }, [ds, dsCmp]);

  const distanceKm = useMemo(() => {
    if (records.length === 0) return 0;
    return records[records.length - 1].distance / 1000;
  }, [records]);

  // Hide channels that have no data
  const availableChannels = useMemo(
    () => CHANNELS.filter((c) => samples[c.key].data.some((v) => v != null)),
    [samples]
  );
  const activeChannels = availableChannels.filter((c) => visible[c.key]);

  if (availableChannels.length === 0) return null;

  const panelCount = Math.max(1, activeChannels.length);
  const height = baseHeight + panelCount * 80;

  const W = 1000;
  const pl = 54;
  const pr = 14;
  const pt = 6;
  const pb = 22;
  const innerH = height - pt - pb;
  const panelH = innerH / panelCount;

  const sx = (i: number) => pl + (i / (N - 1)) * (W - pl - pr);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const xPct = (e.clientX - rect.left) / rect.width;
    const idx = Math.max(0, Math.min(N - 1, Math.round(xPct * (N - 1))));
    setHoverIdx(idx);
  };

  const xTickPositions = [0, 0.25, 0.5, 0.75, 1];
  const xTickLabel = (t: number) => {
    const km = t * distanceKm;
    if (km === 0) return "0 km";
    return `${km.toFixed(km >= 10 ? 0 : 1)} km`;
  };

  return (
    <div className="card card-pad" style={{ marginBottom: 24 }}>
      <div className="row between" style={{ marginBottom: 12, alignItems: "flex-end" }}>
        <div>
          <div className="card-title">Pace · HR · Power · Elevation</div>
          <div className="card-sub">
            {compareRecords ? (
              <>
                Solid = current · dashed ={" "}
                <b style={{ color: "var(--ink-2)", fontWeight: 600 }}>
                  {compareLabel ?? "compare"}
                </b>
                {" "}· x-axis = distance
              </>
            ) : (
              "Hover to inspect — x-axis = distance"
            )}
            {restBands && restBands.length > 0 && (
              <> · <span style={{ color: "var(--ink-3)" }}>shaded bands = rest zones</span></>
            )}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {availableChannels.map((c) => {
            const on = visible[c.key];
            return (
              <button
                key={c.key}
                onClick={() => setVisible((v) => ({ ...v, [c.key]: !v[c.key] }))}
                style={{
                  cursor: "pointer",
                  padding: "4px 10px",
                  fontSize: 11,
                  border: "0.5px solid var(--hair-strong)",
                  borderRadius: 999,
                  background: on ? "#fff" : "var(--bg-sunk)",
                  color: on ? "var(--ink)" : "var(--ink-3)",
                  opacity: on ? 1 : 0.7,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: on ? c.color : "transparent",
                    border: on ? "none" : "1px solid var(--hair-strong)",
                  }}
                />
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-channel summaries */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${activeChannels.length || 1}, 1fr)`,
          marginBottom: 14,
          borderTop: "0.5px solid var(--hair)",
          borderBottom: "0.5px solid var(--hair)",
        }}
      >
        {activeChannels.map((c, i) => {
          const data = samples[c.key].data;
          const leftBorder = i === 0 ? "none" : "0.5px solid var(--hair)";
          if (c.key === "elev") {
            const { gain, loss } = elevationGainLoss(data);
            const s = stats(data);
            return (
              <div
                key={c.key}
                style={{ padding: "10px 14px", borderLeft: leftBorder }}
              >
                <div
                  className="mast-label"
                  style={{ color: c.color, marginBottom: 4 }}
                >
                  {c.label}
                </div>
                <div
                  className="num"
                  style={{ fontWeight: 600, fontSize: 15, marginTop: 1 }}
                >
                  ↑{Math.round(gain)}
                  <span className="lap-u">m</span>
                  <span style={{ marginLeft: 8, color: "var(--ink-3)" }}>
                    ↓{Math.round(loss)}
                    <span className="lap-u">m</span>
                  </span>
                </div>
                <div
                  className="num"
                  style={{ fontSize: 10.5, color: "var(--ink-3)" }}
                >
                  {s.min != null && s.max != null
                    ? `${Math.round(s.min)}–${Math.round(s.max)}m`
                    : "—"}
                </div>
              </div>
            );
          }
          const s = stats(data);
          return (
            <div key={c.key} style={{ padding: "10px 14px", borderLeft: leftBorder }}>
              <div
                className="mast-label"
                style={{ color: c.color, marginBottom: 4 }}
              >
                {c.label} · avg
              </div>
              <div
                className="num"
                style={{ fontWeight: 600, fontSize: 15, marginTop: 1 }}
              >
                {s.avg != null ? c.formatValue(s.avg) : "—"}
                <span className="lap-u">{c.unit}</span>
              </div>
              <div
                className="num"
                style={{ fontSize: 10.5, color: "var(--ink-3)" }}
              >
                {s.min != null && s.max != null
                  ? `${c.formatValue(s.min)} – ${c.formatValue(s.max)}`
                  : "—"}
              </div>
            </div>
          );
        })}
      </div>

      {activeChannels.length === 0 ? (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: "var(--ink-3)",
            fontSize: 13,
          }}
        >
          Enable at least one channel above.
        </div>
      ) : (
        <div
          ref={containerRef}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIdx(null)}
          style={{ position: "relative", height, width: "100%" }}
        >
          <svg
            viewBox={`0 0 ${W} ${height}`}
            width="100%"
            height={height}
            preserveAspectRatio="none"
            style={{ display: "block", overflow: "visible" }}
          >
            {restBands &&
              restBands.map(([a, b], i) => {
                const x1 = pl + a * (W - pl - pr);
                const x2 = pl + b * (W - pl - pr);
                return (
                  <rect
                    key={i}
                    x={x1}
                    y={pt}
                    width={x2 - x1}
                    height={height - pt - pb + 2}
                    fill="var(--ink)"
                    opacity={0.04}
                  />
                );
              })}

            {activeChannels.map((c, si) => {
              const top = pt + si * panelH;
              const bot = top + panelH - 6;
              const cur = samples[c.key].data;
              const cmp = samples[c.key].compare;
              const all: number[] = [
                ...cur.filter((v): v is number => v != null),
                ...(cmp ?? []).filter((v): v is number => v != null),
              ];
              if (all.length === 0) return null;
              const dMin = Math.min(...all);
              const dMax = Math.max(...all);
              const dPad = (dMax - dMin) * 0.12 || 1;
              const lo = dMin - dPad;
              const hi = dMax + dPad;
              const sy = (v: number) =>
                bot - ((v - lo) / (hi - lo)) * (bot - top);

              const pathOf = (arr: (number | null)[]) => {
                const segs: string[] = [];
                let moveNext = true;
                for (let i = 0; i < arr.length; i++) {
                  const v = arr[i];
                  if (v == null) {
                    moveNext = true;
                    continue;
                  }
                  segs.push(`${moveNext ? "M" : "L"} ${sx(i).toFixed(2)} ${sy(v).toFixed(2)}`);
                  moveNext = false;
                }
                return segs.join(" ");
              };

              const yTop = hi - dPad * 0.5;
              const yBot = lo + dPad * 0.5;

              return (
                <g key={c.key}>
                  {si > 0 && (
                    <line
                      x1={pl}
                      x2={W - pr}
                      y1={top - 3}
                      y2={top - 3}
                      stroke="var(--hair)"
                      strokeWidth={0.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  <text
                    x={pl - 10}
                    y={top + 9}
                    fontSize={9}
                    fill="var(--ink-3)"
                    textAnchor="end"
                    style={{
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {c.label}
                  </text>
                  <text
                    x={pl - 10}
                    y={top + 20}
                    fontSize={9.5}
                    fill="var(--ink-2)"
                    textAnchor="end"
                    className="num"
                  >
                    {c.formatValue(yTop)}
                  </text>
                  <text
                    x={pl - 10}
                    y={bot - 3}
                    fontSize={9.5}
                    fill="var(--ink-2)"
                    textAnchor="end"
                    className="num"
                  >
                    {c.formatValue(yBot)}
                  </text>

                  {cmp && (
                    <path
                      d={pathOf(cmp)}
                      fill="none"
                      stroke="var(--ink-3)"
                      strokeWidth={1.2}
                      strokeDasharray="3 3"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      opacity={0.7}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  <path
                    d={pathOf(cur)}
                    fill="none"
                    stroke={c.color}
                    strokeWidth={1.75}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />

                  {hoverIdx != null && cur[hoverIdx] != null && (
                    <circle
                      cx={sx(hoverIdx)}
                      cy={sy(cur[hoverIdx] as number)}
                      r={3.2}
                      fill={c.color}
                      stroke="#fff"
                      strokeWidth={1.5}
                    />
                  )}

                  {hoverIdx != null && cur[hoverIdx] != null && (() => {
                    const cx = sx(hoverIdx);
                    const flipLeft = cx > W - 140;
                    const rx = flipLeft ? cx - 8 : cx + 8;
                    const anchor = flipLeft ? "end" : "start";
                    const v = cur[hoverIdx] as number;
                    const cv = cmp?.[hoverIdx];
                    return (
                      <g>
                        <text
                          x={rx}
                          y={sy(v) - 6}
                          fontSize={10.5}
                          fontWeight={600}
                          fill={c.color}
                          textAnchor={anchor}
                          className="num"
                        >
                          {c.formatValue(v)}
                          <tspan fill="var(--ink-3)" fontWeight={500}>
                            {" "}
                            {c.unit}
                          </tspan>
                        </text>
                        {cv != null && (
                          <text
                            x={rx}
                            y={sy(v) + 7}
                            fontSize={9.5}
                            fill="var(--ink-3)"
                            textAnchor={anchor}
                            className="num"
                          >
                            vs {c.formatValue(cv)} {c.unit}
                          </text>
                        )}
                      </g>
                    );
                  })()}
                </g>
              );
            })}

            <line
              x1={pl}
              x2={W - pr}
              y1={height - pb + 2}
              y2={height - pb + 2}
              stroke="var(--hair-strong)"
              strokeWidth={0.75}
              vectorEffect="non-scaling-stroke"
            />
            {xTickPositions.map((t, i) => {
              const x = pl + t * (W - pl - pr);
              return (
                <g key={i}>
                  <line
                    x1={x}
                    x2={x}
                    y1={pt}
                    y2={height - pb + 2}
                    stroke="var(--hair)"
                    strokeWidth={0.4}
                    strokeDasharray="2 3"
                    opacity={0.6}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={x}
                    y={height - pb + 14}
                    fontSize={10}
                    fill="var(--ink-3)"
                    textAnchor="middle"
                    className="num"
                  >
                    {xTickLabel(t)}
                  </text>
                </g>
              );
            })}

            {hoverIdx != null && (
              <line
                x1={sx(hoverIdx)}
                x2={sx(hoverIdx)}
                y1={pt}
                y2={height - pb + 2}
                stroke="var(--ink)"
                strokeWidth={0.8}
                strokeDasharray="3 3"
                opacity={0.35}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        </div>
      )}
    </div>
  );
}
