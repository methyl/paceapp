import type { RecordPoint, LapSummary } from "./types";

/**
 * Slice a record stream into uniform distance chunks (default 1km) and
 * return one LapSummary per chunk. The resulting splits are independent
 * of whatever lap structure the watch recorded — useful when manual
 * laps coexist with auto-laps and the raw `laps` array no longer
 * reflects every 1km mark.
 *
 * Records with gaps (paused GPS, dropped samples) produce a chunk that
 * may exceed `intervalMeters`; the trailing partial chunk is kept when
 * it covers at least 50m so a final cooldown isn't dropped.
 */
export function computeKmSplits(
  records: RecordPoint[],
  intervalMeters = 1000,
): LapSummary[] {
  if (!Array.isArray(records) || records.length < 3) return [];

  const startDist = records[0].distance ?? 0;
  let nextSplitDist = startDist + intervalMeters;
  let chunkStart = 0;

  const result: LapSummary[] = [];
  for (let i = 1; i < records.length; i++) {
    const dist = records[i].distance ?? 0;
    if (dist >= nextSplitDist && i - chunkStart >= 3) {
      const chunk = records.slice(chunkStart, i + 1);
      const split = summarizeChunk(chunk, result.length + 1);
      if (split) result.push(split);
      chunkStart = i;
      nextSplitDist = dist + intervalMeters;
    }
  }

  const tail = records.slice(chunkStart);
  if (tail.length >= 3) {
    const tailDist = (tail[tail.length - 1].distance ?? 0) - (tail[0].distance ?? 0);
    if (tailDist >= 50) {
      const split = summarizeChunk(tail, result.length + 1);
      if (split) result.push(split);
    }
  }

  return result;
}

function summarizeChunk(
  records: RecordPoint[],
  lapIndex: number,
): LapSummary | null {
  const first = records[0];
  const last = records[records.length - 1];
  const totalDistance = (last.distance ?? 0) - (first.distance ?? 0);
  const totalElapsedTime =
    (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / 1000;
  if (!(totalElapsedTime > 0)) return null;

  const avg = (vals: (number | undefined)[]): number | undefined => {
    let sum = 0;
    let count = 0;
    for (const v of vals) {
      if (v != null && Number.isFinite(v) && v > 0) {
        sum += v;
        count++;
      }
    }
    return count > 0 ? sum / count : undefined;
  };
  const max = (vals: (number | undefined)[]): number | undefined => {
    let m: number | undefined;
    for (const v of vals) {
      if (v != null && Number.isFinite(v) && (m == null || v > m)) m = v;
    }
    return m;
  };

  const avgSpeed = totalDistance / totalElapsedTime;

  return {
    lapIndex,
    startTime: first.timestamp,
    totalDistance,
    totalElapsedTime,
    avgHeartRate: avg(records.map((r) => r.heartRate)),
    maxHeartRate: max(records.map((r) => r.heartRate)),
    avgCadence: avg(records.map((r) => r.cadence)),
    avgSpeed,
    avgPace: speedToPace(avgSpeed),
    avgVerticalOscillation: avg(records.map((r) => r.verticalOscillation)),
    avgGroundContactTime: avg(records.map((r) => r.groundContactTime)),
    avgGroundContactTimeBalance: avg(records.map((r) => r.groundContactTimeBalance)),
    avgStrideLength: avg(records.map((r) => r.strideLength)),
    avgVerticalRatio: avg(records.map((r) => r.verticalRatio)),
    avgPower: avg(records.map((r) => r.power)),
  };
}

function speedToPace(speedMps: number): string {
  if (!speedMps || speedMps <= 0) return "-";
  const secPerKm = 1000 / speedMps;
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}
