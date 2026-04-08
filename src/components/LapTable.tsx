import type { LapSummary } from "../types";
import { formatTime } from "../parseFit";

interface LapTableProps {
  laps: LapSummary[];
}

export default function LapTable({ laps }: LapTableProps) {
  if (laps.length === 0) return null;

  const hasVO = laps.some((l) => l.avgVerticalOscillation != null);
  const hasGCT = laps.some((l) => l.avgGroundContactTime != null);
  const hasGCTBal = laps.some((l) => l.avgGroundContactTimeBalance != null);
  const hasSL = laps.some((l) => l.avgStrideLength != null);
  const hasVR = laps.some((l) => l.avgVerticalRatio != null);
  const hasPower = laps.some((l) => l.avgPower != null);

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4">Segments / Laps</h2>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-600 text-left">
              <th className="px-3 py-2.5 font-semibold">Lap</th>
              <th className="px-3 py-2.5 font-semibold">Distance</th>
              <th className="px-3 py-2.5 font-semibold">Time</th>
              <th className="px-3 py-2.5 font-semibold">Pace</th>
              <th className="px-3 py-2.5 font-semibold">HR</th>
              <th className="px-3 py-2.5 font-semibold">Cadence</th>
              {hasVO && <th className="px-3 py-2.5 font-semibold">Vert. Osc.</th>}
              {hasGCT && <th className="px-3 py-2.5 font-semibold">GCT</th>}
              {hasGCTBal && <th className="px-3 py-2.5 font-semibold">GCT Bal.</th>}
              {hasSL && <th className="px-3 py-2.5 font-semibold">Stride</th>}
              {hasVR && <th className="px-3 py-2.5 font-semibold">Vert. Ratio</th>}
              {hasPower && <th className="px-3 py-2.5 font-semibold">Power</th>}
            </tr>
          </thead>
          <tbody>
            {laps.map((lap) => (
              <tr
                key={lap.lapIndex}
                className="border-t border-gray-100 hover:bg-blue-50/50 transition-colors"
              >
                <td className="px-3 py-2.5 font-medium text-gray-900">{lap.lapIndex}</td>
                <td className="px-3 py-2.5">{(lap.totalDistance / 1000).toFixed(2)} km</td>
                <td className="px-3 py-2.5">{formatTime(lap.totalElapsedTime)}</td>
                <td className="px-3 py-2.5 font-medium">{lap.avgPace}</td>
                <td className="px-3 py-2.5">
                  {lap.avgHeartRate != null ? `${Math.round(lap.avgHeartRate)}` : "-"}
                  {lap.maxHeartRate != null && (
                    <span className="text-gray-400 text-xs ml-1">/ {lap.maxHeartRate}</span>
                  )}
                </td>
                <td className="px-3 py-2.5">{lap.avgCadence != null ? Math.round(lap.avgCadence) : "-"}</td>
                {hasVO && (
                  <td className="px-3 py-2.5">
                    {lap.avgVerticalOscillation != null
                      ? `${lap.avgVerticalOscillation.toFixed(1)} mm`
                      : "-"}
                  </td>
                )}
                {hasGCT && (
                  <td className="px-3 py-2.5">
                    {lap.avgGroundContactTime != null
                      ? `${Math.round(lap.avgGroundContactTime)} ms`
                      : "-"}
                  </td>
                )}
                {hasGCTBal && (
                  <td className="px-3 py-2.5">
                    {lap.avgGroundContactTimeBalance != null
                      ? `${lap.avgGroundContactTimeBalance.toFixed(1)}%`
                      : "-"}
                  </td>
                )}
                {hasSL && (
                  <td className="px-3 py-2.5">
                    {lap.avgStrideLength != null
                      ? `${(lap.avgStrideLength / 1000).toFixed(2)} m`
                      : "-"}
                  </td>
                )}
                {hasVR && (
                  <td className="px-3 py-2.5">
                    {lap.avgVerticalRatio != null
                      ? `${lap.avgVerticalRatio.toFixed(1)}%`
                      : "-"}
                  </td>
                )}
                {hasPower && (
                  <td className="px-3 py-2.5">
                    {lap.avgPower != null ? `${Math.round(lap.avgPower)} W` : "-"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
