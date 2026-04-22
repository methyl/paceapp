import { useMemo } from "react";
import type { RecordPoint } from "../types";

interface RunPathThumbProps {
  records: RecordPoint[];
  color?: string;
  width?: number;
  height?: number;
}

// Lightweight SVG polyline thumbnail for the library rail.
// Leaflet is too heavy for dozens of 28px thumbs — we plot lat/lng directly.
export default function RunPathThumb({
  records,
  color = "var(--ink-2)",
  width = 36,
  height = 28,
}: RunPathThumbProps) {
  const path = useMemo(() => {
    const pts = records
      .filter((r) => r.lat != null && r.lng != null)
      .map((r) => [r.lng!, r.lat!] as [number, number]);
    if (pts.length < 2) return null;
    // Subsample to ~60 points for cheap drawing
    const stride = Math.max(1, Math.floor(pts.length / 60));
    const sampled = pts.filter((_, i) => i % stride === 0 || i === pts.length - 1);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of sampled) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const spanX = Math.max(1e-6, maxX - minX);
    const spanY = Math.max(1e-6, maxY - minY);
    const pad = 2;
    const w = width - pad * 2;
    const h = height - pad * 2;
    // Preserve aspect ratio — fit longest side, center the other
    const scale = Math.min(w / spanX, h / spanY);
    const drawW = spanX * scale;
    const drawH = spanY * scale;
    const offX = pad + (w - drawW) / 2;
    const offY = pad + (h - drawH) / 2;
    return sampled
      .map(([x, y]) => {
        const px = offX + (x - minX) * scale;
        // flip Y so north is up
        const py = offY + (maxY - y) * scale;
        return `${px.toFixed(1)},${py.toFixed(1)}`;
      })
      .join(" ");
  }, [records, width, height]);

  if (!path) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center text-[8px] text-[color:var(--ink-4)]"
      >
        —
      </div>
    );
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none">
      <polyline
        points={path}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
    </svg>
  );
}
