import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import type { LapSummary, RecordPoint } from "../types";

interface DynamicsChartsProps {
  laps: LapSummary[];
  records: RecordPoint[];
}

const COLORS = {
  vo: "#6366f1",
  gct: "#f59e0b",
  cadence: "#10b981",
  stride: "#3b82f6",
  vr: "#ef4444",
  power: "#8b5cf6",
  hr: "#ef4444",
  pace: "#0ea5e9",
};

function LapBarChart({
  laps,
  dataKey,
  label,
  unit,
  color,
  transform,
}: {
  laps: LapSummary[];
  dataKey: keyof LapSummary;
  label: string;
  unit: string;
  color: string;
  transform?: (v: number) => number;
}) {
  const data = laps
    .filter((l) => l[dataKey] != null)
    .map((l) => ({
      name: `Lap ${l.lapIndex}`,
      value: transform ? transform(l[dataKey] as number) : (l[dataKey] as number),
    }));

  if (data.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{label} per Lap</h3>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <Tooltip
            formatter={(value: number | string) => [`${Number(value).toFixed(1)} ${unit}`, label]}
            contentStyle={{ fontSize: 13 }}
          />
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} opacity={0.85} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function TimeSeriesChart({
  records,
  metrics,
}: {
  records: RecordPoint[];
  metrics: {
    key: keyof RecordPoint;
    label: string;
    color: string;
    yAxisId?: string;
    transform?: (v: number) => number;
  }[];
}) {
  // Downsample to max ~300 points for performance
  const step = Math.max(1, Math.floor(records.length / 300));
  const sampled = records.filter((_, i) => i % step === 0);

  const data = sampled.map((r) => {
    const point: Record<string, unknown> = {
      distance: +(r.distance / 1000).toFixed(2),
    };
    for (const m of metrics) {
      const raw = r[m.key] as number | undefined;
      point[m.key] = raw != null ? (m.transform ? m.transform(raw) : raw) : null;
    }
    return point;
  });

  const hasData = metrics.some((m) => data.some((d) => d[m.key] != null));
  if (!hasData) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">
        {metrics.map((m) => m.label).join(" & ")} over Distance
      </h3>
      <ResponsiveContainer width="100%" height={250}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="distance"
            tick={{ fontSize: 12 }}
            label={{ value: "km", position: "insideBottomRight", offset: -5, fontSize: 11 }}
          />
          <YAxis yAxisId="left" tick={{ fontSize: 12 }} domain={["auto", "auto"]} />
          {metrics.length > 1 && (
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} domain={["auto", "auto"]} />
          )}
          <Tooltip contentStyle={{ fontSize: 13 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {metrics.map((m, i) => (
            <Line
              key={m.key}
              yAxisId={i === 0 ? "left" : metrics.length > 1 ? "right" : "left"}
              type="monotone"
              dataKey={m.key}
              name={m.label}
              stroke={m.color}
              dot={false}
              strokeWidth={1.5}
              connectNulls
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function DynamicsCharts({ laps, records }: DynamicsChartsProps) {
  const hasVO = laps.some((l) => l.avgVerticalOscillation != null);
  const hasGCT = laps.some((l) => l.avgGroundContactTime != null);
  const hasSL = laps.some((l) => l.avgStrideLength != null);
  const hasVR = laps.some((l) => l.avgVerticalRatio != null);
  const hasPower = laps.some((l) => l.avgPower != null);

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4">Running Dynamics Charts</h2>

      {/* Per-lap bar charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {hasVO && (
          <LapBarChart
            laps={laps}
            dataKey="avgVerticalOscillation"
            label="Vertical Oscillation"
            unit="mm"
            color={COLORS.vo}
          />
        )}
        {hasGCT && (
          <LapBarChart
            laps={laps}
            dataKey="avgGroundContactTime"
            label="Ground Contact Time"
            unit="ms"
            color={COLORS.gct}
          />
        )}
        {hasSL && (
          <LapBarChart
            laps={laps}
            dataKey="avgStrideLength"
            label="Stride Length"
            unit="m"
            color={COLORS.stride}
            transform={(v) => v / 1000}
          />
        )}
        {hasVR && (
          <LapBarChart
            laps={laps}
            dataKey="avgVerticalRatio"
            label="Vertical Ratio"
            unit="%"
            color={COLORS.vr}
          />
        )}
        <LapBarChart
          laps={laps}
          dataKey="avgCadence"
          label="Cadence"
          unit="spm"
          color={COLORS.cadence}
        />
        {hasPower && (
          <LapBarChart
            laps={laps}
            dataKey="avgPower"
            label="Power"
            unit="W"
            color={COLORS.power}
          />
        )}
      </div>

      {/* Time series charts */}
      {records.length > 0 && (
        <>
          <h2 className="text-xl font-bold text-gray-900 mb-4">Continuous Data</h2>
          <div className="grid grid-cols-1 gap-4">
            <TimeSeriesChart
              records={records}
              metrics={[
                { key: "verticalOscillation", label: "Vert. Oscillation (mm)", color: COLORS.vo },
                { key: "groundContactTime", label: "GCT (ms)", color: COLORS.gct },
              ]}
            />
            <TimeSeriesChart
              records={records}
              metrics={[
                { key: "cadence", label: "Cadence (spm)", color: COLORS.cadence },
                { key: "heartRate", label: "Heart Rate (bpm)", color: COLORS.hr },
              ]}
            />
            {hasSL && (
              <TimeSeriesChart
                records={records}
                metrics={[
                  {
                    key: "strideLength",
                    label: "Stride Length (m)",
                    color: COLORS.stride,
                    transform: (v) => v / 1000,
                  },
                  { key: "verticalRatio", label: "Vert. Ratio (%)", color: COLORS.vr },
                ]}
              />
            )}
            {hasPower && (
              <TimeSeriesChart
                records={records}
                metrics={[{ key: "power", label: "Power (W)", color: COLORS.power }]}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
