import type { ActivitySummary } from "../types";
import { formatTime, parsePaceToSec } from "../../shared/pace";

interface SummaryProps {
  summary: ActivitySummary;
  compare?: ActivitySummary | null;
  compareLabel?: string | null;
  comparePinned?: boolean;
  onUnpinCompare?: () => void;
}

type MastField = {
  label: string;
  value: string | number | null;
  unit?: string;
  // Lower-is-better metrics (pace, HR, GCT, vert osc, vert ratio) invert
  // the color semantics: negative diff = green, positive = red.
  invert?: boolean;
  // Raw numeric for diff computation — undefined means diff is not shown.
  rawCur?: number | null;
  rawCmp?: number | null;
  // If provided, use this as the display string for the compare value.
  cmpDisplay?: string | null;
};

function computeDiff(
  cur: number | null | undefined,
  cmp: number | null | undefined,
  invert: boolean | undefined
): { pct: number; isGood: boolean } | null {
  if (cur == null || cmp == null || cmp === 0) return null;
  const pct = ((cur - cmp) / cmp) * 100;
  const isGood = invert ? pct < 0 : pct > 0;
  return { pct, isGood };
}

function fmt(v: string | number | null): string {
  if (v == null || v === "") return "—";
  return String(v);
}

function MastCell({ field, hasCompare }: { field: MastField; hasCompare: boolean }) {
  const diff = computeDiff(field.rawCur, field.rawCmp, field.invert);
  const cmpText = field.cmpDisplay ?? (field.rawCmp != null ? String(field.rawCmp) : null);
  return (
    <div className="mast-cell">
      <div className="mast-label">{field.label}</div>
      <div className="mast-value num">
        {fmt(field.value)}
        {field.unit && field.value != null && (
          <span className="mast-unit">{field.unit}</span>
        )}
      </div>
      <div
        className="mast-compare"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 10,
          fontSize: 12,
          fontWeight: 500,
          color: "var(--ink-2)",
          minHeight: 18,
          visibility: hasCompare ? "visible" : "hidden",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 2,
            background: "var(--ink)",
            opacity: 0.35,
            flexShrink: 0,
          }}
        />
        <span className="num">
          {cmpText ?? "—"}
          {field.unit && cmpText && <span className="mast-unit">{field.unit}</span>}
        </span>
        {diff && (
          <span
            className="num"
            style={{
              marginLeft: "auto",
              fontSize: 11,
              fontWeight: 700,
              color: diff.isGood ? "var(--tag-easy)" : "var(--viz-4)",
            }}
          >
            {diff.pct > 0 ? "+" : ""}
            {diff.pct.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

function StripCell({ field, hasCompare }: { field: MastField; hasCompare: boolean }) {
  const diff = computeDiff(field.rawCur, field.rawCmp, field.invert);
  return (
    <div className="strip-cell">
      <div className="strip-label">{field.label}</div>
      <div className="strip-value num">
        {fmt(field.value)}
        {field.unit && field.value != null && (
          <span className="strip-unit">{field.unit}</span>
        )}
        <span
          className="num"
          style={{
            marginLeft: 6,
            fontSize: 10,
            fontWeight: 700,
            color: diff ? (diff.isGood ? "var(--tag-easy)" : "var(--viz-4)") : "transparent",
            visibility: hasCompare && diff ? "visible" : "hidden",
          }}
        >
          {diff ? `${diff.pct > 0 ? "+" : ""}${diff.pct.toFixed(1)}%` : "+0%"}
        </span>
      </div>
    </div>
  );
}

export default function Summary({
  summary,
  compare,
  compareLabel,
  comparePinned,
  onUnpinCompare,
}: SummaryProps) {
  const hasCompare = !!compare;

  const curDist = summary.totalDistance / 1000;
  const cmpDist = compare ? compare.totalDistance / 1000 : null;

  const curPaceSec = parsePaceToSec(summary.avgPace);
  const cmpPaceSec = compare ? parsePaceToSec(compare.avgPace) : null;

  const masthead: MastField[] = [
    {
      label: "Distance",
      value: curDist.toFixed(2),
      unit: "km",
      rawCur: curDist,
      rawCmp: cmpDist,
      cmpDisplay: cmpDist != null ? cmpDist.toFixed(2) : null,
    },
    {
      label: "Time",
      value: formatTime(summary.totalElapsedTime),
      rawCur: summary.totalElapsedTime,
      rawCmp: compare?.totalElapsedTime ?? null,
      cmpDisplay: compare ? formatTime(compare.totalElapsedTime) : null,
    },
    {
      label: "Pace",
      value: summary.avgPace,
      unit: "/km",
      invert: true,
      rawCur: curPaceSec,
      rawCmp: cmpPaceSec,
      cmpDisplay: compare?.avgPace ?? null,
    },
    {
      label: "Heart rate",
      value: summary.avgHeartRate != null ? Math.round(summary.avgHeartRate) : null,
      unit: "bpm",
      invert: true,
      rawCur: summary.avgHeartRate ?? null,
      rawCmp: compare?.avgHeartRate ?? null,
      cmpDisplay:
        compare?.avgHeartRate != null ? String(Math.round(compare.avgHeartRate)) : null,
    },
    {
      label: "Cadence",
      value: summary.avgCadence != null ? Math.round(summary.avgCadence) : null,
      unit: "spm",
      rawCur: summary.avgCadence ?? null,
      rawCmp: compare?.avgCadence ?? null,
      cmpDisplay:
        compare?.avgCadence != null ? String(Math.round(compare.avgCadence)) : null,
    },
  ];

  const strideCur = summary.avgStrideLength != null ? summary.avgStrideLength / 1000 : null;
  const strideCmp = compare?.avgStrideLength != null ? compare.avgStrideLength / 1000 : null;

  const strip: MastField[] = [
    {
      label: "Vert. Osc.",
      value: summary.avgVerticalOscillation != null ? summary.avgVerticalOscillation.toFixed(1) : null,
      unit: "mm",
      invert: true,
      rawCur: summary.avgVerticalOscillation ?? null,
      rawCmp: compare?.avgVerticalOscillation ?? null,
    },
    {
      label: "GCT",
      value: summary.avgGroundContactTime != null ? Math.round(summary.avgGroundContactTime) : null,
      unit: "ms",
      invert: true,
      rawCur: summary.avgGroundContactTime ?? null,
      rawCmp: compare?.avgGroundContactTime ?? null,
    },
    {
      label: "Stride",
      value: strideCur != null ? strideCur.toFixed(2) : null,
      unit: "m",
      rawCur: strideCur,
      rawCmp: strideCmp,
    },
    {
      label: "Vertical Ratio",
      value: summary.avgVerticalRatio != null ? summary.avgVerticalRatio.toFixed(1) : null,
      unit: "%",
      invert: true,
      rawCur: summary.avgVerticalRatio ?? null,
      rawCmp: compare?.avgVerticalRatio ?? null,
    },
    {
      label: "Power",
      value: summary.avgPower != null ? Math.round(summary.avgPower) : null,
      unit: "W",
      rawCur: summary.avgPower ?? null,
      rawCmp: compare?.avgPower ?? null,
    },
  ];

  return (
    <div>
      {/* Comparing-to pill — always rendered so layout doesn't jump on hover */}
      <div
        className="row"
        style={{
          justifyContent: "flex-end",
          marginBottom: 6,
          fontSize: 11.5,
          color: "var(--ink-2)",
          visibility: hasCompare && compareLabel ? "visible" : "hidden",
          minHeight: 22,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "3px 4px 3px 10px",
            borderRadius: 999,
            background: comparePinned ? "var(--accent-soft)" : "var(--bg-sunk)",
            border: comparePinned
              ? "1px solid var(--accent)"
              : "1px dashed var(--hair-strong)",
            color: comparePinned ? "var(--accent-ink)" : "var(--ink-2)",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: comparePinned ? "var(--accent)" : "var(--ink)",
              opacity: comparePinned ? 1 : 0.35,
            }}
          />
          {comparePinned ? "Pinned to" : "Comparing to"}{" "}
          <b style={{ color: "inherit", fontWeight: 600 }}>{compareLabel ?? "—"}</b>
          {comparePinned && onUnpinCompare && (
            <button
              type="button"
              onClick={onUnpinCompare}
              aria-label="Unpin compare"
              style={{
                width: 16,
                height: 16,
                marginLeft: 2,
                border: 0,
                borderRadius: 999,
                background: "transparent",
                color: "inherit",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                <path d="M6 6l12 12M6 18L18 6" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </span>
      </div>

      <div className="stats-mast">
        {masthead.map((f) => (
          <MastCell key={f.label} field={f} hasCompare={hasCompare} />
        ))}
      </div>

      <div className="stats-strip">
        {strip.map((f) => (
          <StripCell key={f.label} field={f} hasCompare={hasCompare} />
        ))}
      </div>
    </div>
  );
}
