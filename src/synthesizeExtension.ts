import type { LapSummary, RecordPoint } from "./types";
import { speedToPace } from "./parseFit";

const R = 6371000; // Earth radius in meters

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Interpolate evenly-spaced GPS points along a polyline of waypoints.
 */
export function interpolateAlongPolyline(
  waypoints: [number, number][],
  spacingMeters: number
): [number, number][] {
  if (waypoints.length < 2) return [...waypoints];

  const result: [number, number][] = [waypoints[0]];
  let accumulated = 0;

  for (let i = 1; i < waypoints.length; i++) {
    const [lat1, lng1] = waypoints[i - 1];
    const [lat2, lng2] = waypoints[i];
    const segDist = haversineDistance(lat1, lng1, lat2, lng2);
    let segOffset = 0;

    while (accumulated + (segDist - segOffset) >= spacingMeters) {
      const remaining = spacingMeters - accumulated;
      segOffset += remaining;
      const t = segOffset / segDist;
      result.push([
        lat1 + (lat2 - lat1) * t,
        lng1 + (lng2 - lng1) * t,
      ]);
      accumulated = 0;
    }
    accumulated += segDist - segOffset;
  }

  // Always include the last waypoint
  const last = waypoints[waypoints.length - 1];
  const prevLast = result[result.length - 1];
  if (haversineDistance(prevLast[0], prevLast[1], last[0], last[1]) > 1) {
    result.push(last);
  }

  return result;
}

/**
 * Return the auto-lap distance in meters if the original activity's laps
 * look like uniform auto-laps (every full lap within ~3% of the mean),
 * otherwise null.
 */
export function detectAutoLapDistance(laps: LapSummary[]): number | null {
  if (laps.length < 2) return null;
  // Ignore the final lap — typically a partial trailing lap.
  const full = laps.slice(0, -1);
  if (full.length < 2) return null;
  const distances = full.map((l) => l.totalDistance).filter((d) => d > 0);
  if (distances.length < 2) return null;
  const mean = distances.reduce((s, d) => s + d, 0) / distances.length;
  if (mean < 400) return null;
  const maxDev = Math.max(...distances.map((d) => Math.abs(d - mean)));
  if (maxDev / mean < 0.03) return mean;
  return null;
}

/**
 * Split a run of records into chunks whose cumulative distance equals
 * `chunkDist`. The final chunk may be shorter (partial lap).
 */
export function splitRecordsByDistance(
  records: RecordPoint[],
  chunkDist: number,
): RecordPoint[][] {
  if (records.length === 0 || chunkDist <= 0) return [records];
  const chunks: RecordPoint[][] = [];
  const startDist = records[0].distance;
  let chunkStart = 0;
  let nextBoundary = startDist + chunkDist;

  for (let i = 1; i < records.length; i++) {
    if (records[i].distance >= nextBoundary) {
      chunks.push(records.slice(chunkStart, i + 1));
      chunkStart = i;
      nextBoundary = records[i].distance + chunkDist;
    }
  }
  if (chunkStart < records.length - 1) {
    chunks.push(records.slice(chunkStart));
  }
  return chunks.length > 0 ? chunks : [records];
}

/**
 * Build LapSummary entries for synthetic extension records so the app's
 * lap table (and anything else that reads `activity.laps`) reflects the
 * extension. If the original activity used uniform auto-laps, the extension
 * is split into matching chunks; otherwise one summary lap is produced.
 */
export function buildExtensionLaps(
  extRecords: RecordPoint[],
  existingLaps: LapSummary[],
): LapSummary[] {
  if (extRecords.length < 2) return [];
  const autoLapDist = detectAutoLapDistance(existingLaps);
  const chunks = autoLapDist
    ? splitRecordsByDistance(extRecords, autoLapDist)
    : [extRecords];

  const result: LapSummary[] = [];
  let idx = existingLaps.length + 1;
  for (const chunk of chunks) {
    if (chunk.length < 2) continue;
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    const dist = last.distance - first.distance;
    const time = last.elapsed - first.elapsed;
    if (dist <= 0 || time <= 0) continue;

    const avg = (vals: (number | undefined)[]): number | undefined => {
      const v = vals.filter((x): x is number => x != null);
      return v.length > 0 ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
    };
    const max = (vals: (number | undefined)[]): number | undefined => {
      const v = vals.filter((x): x is number => x != null);
      return v.length > 0 ? Math.max(...v) : undefined;
    };

    const avgSpeed = dist / time;
    result.push({
      lapIndex: idx,
      startTime: first.timestamp,
      totalDistance: dist,
      totalElapsedTime: time,
      avgHeartRate: avg(chunk.map((r) => r.heartRate)),
      maxHeartRate: max(chunk.map((r) => r.heartRate)),
      avgCadence: avg(chunk.map((r) => r.cadence)),
      avgSpeed,
      avgPace: speedToPace(avgSpeed),
      avgVerticalOscillation: avg(chunk.map((r) => r.verticalOscillation)),
      avgGroundContactTime: avg(chunk.map((r) => r.groundContactTime)),
      avgGroundContactTimeBalance: avg(chunk.map((r) => r.groundContactTimeBalance)),
      avgStrideLength: avg(chunk.map((r) => r.strideLength)),
      avgVerticalRatio: avg(chunk.map((r) => r.verticalRatio)),
      avgPower: avg(chunk.map((r) => r.power)),
    });
    idx++;
  }
  return result;
}

export interface RecentTrend {
  avgSpeed: number;
  hrSlope: number; // bpm per second
  lastHR: number;
  maxHR: number;
  avgCadence: number;
  avgVO: number;
  avgGCT: number;
  avgStrideLength: number;
  avgVerticalRatio: number;
  avgPower: number;
  lastAltitude: number;
  recordInterval: number; // seconds between records
}

/**
 * Analyze the recent portion of the run to extrapolate trends.
 */
export function analyzeRecentTrend(
  records: RecordPoint[],
  windowSize = 60
): RecentTrend {
  const window = records.slice(-Math.min(windowSize, records.length));

  const avg = (vals: (number | undefined)[]) => {
    const v = vals.filter((x): x is number => x != null);
    return v.length > 0 ? v.reduce((s, x) => s + x, 0) / v.length : 0;
  };

  // Linear regression on HR vs elapsed time
  const hrPairs = window
    .filter((r) => r.heartRate != null)
    .map((r) => ({ t: r.elapsed, hr: r.heartRate! }));

  let hrSlope = 0;
  let lastHR = 0;
  let maxHR = 0;

  if (hrPairs.length >= 5) {
    const n = hrPairs.length;
    const sumT = hrPairs.reduce((s, p) => s + p.t, 0);
    const sumHR = hrPairs.reduce((s, p) => s + p.hr, 0);
    const sumTT = hrPairs.reduce((s, p) => s + p.t * p.t, 0);
    const sumTHR = hrPairs.reduce((s, p) => s + p.t * p.hr, 0);
    const denom = n * sumTT - sumT * sumT;
    hrSlope = denom !== 0 ? (n * sumTHR - sumT * sumHR) / denom : 0;
    lastHR = hrPairs[hrPairs.length - 1].hr;
    maxHR = Math.max(...hrPairs.map((p) => p.hr));
  }

  // Record interval (median gap)
  const gaps: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const dt =
      (new Date(window[i].timestamp).getTime() -
        new Date(window[i - 1].timestamp).getTime()) /
      1000;
    if (dt > 0 && dt < 10) gaps.push(dt);
  }
  gaps.sort((a, b) => a - b);
  const recordInterval = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 1;

  return {
    avgSpeed: avg(window.map((r) => r.speed)),
    hrSlope,
    lastHR,
    maxHR,
    avgCadence: avg(window.map((r) => r.cadence)),
    avgVO: avg(window.map((r) => r.verticalOscillation)),
    avgGCT: avg(window.map((r) => r.groundContactTime)),
    avgStrideLength: avg(window.map((r) => r.strideLength)),
    avgVerticalRatio: avg(window.map((r) => r.verticalRatio)),
    avgPower: avg(window.map((r) => r.power)),
    lastAltitude: window[window.length - 1]?.altitude ?? 0,
    recordInterval,
  };
}

function gaussianJitter(mean: number, pct = 0.02): number {
  // Box-Muller transform for gaussian noise
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + mean * pct * z;
}

export function synthesizeRecords(params: {
  existingRecords: RecordPoint[];
  waypoints: [number, number][];
  totalFinishTimeSeconds: number;
  /** Optional road/trail-snapped polyline — used instead of straight-line waypoints. */
  path?: [number, number][];
}): RecordPoint[] {
  const { existingRecords, waypoints, totalFinishTimeSeconds, path } = params;

  if (existingRecords.length === 0 || waypoints.length < 2) return [];

  const last = existingRecords[existingRecords.length - 1];
  const trend = analyzeRecentTrend(existingRecords);

  const extensionDuration = totalFinishTimeSeconds - last.elapsed;
  if (extensionDuration <= 0) return [];

  // Use the snapped road/trail path when available so synthetic GPS follows
  // actual routes rather than cutting across buildings.
  const routeLine = path && path.length >= 2 ? path : waypoints;

  let totalRouteDist = 0;
  for (let i = 1; i < routeLine.length; i++) {
    totalRouteDist += haversineDistance(
      routeLine[i - 1][0], routeLine[i - 1][1],
      routeLine[i][0], routeLine[i][1]
    );
  }

  const targetSpeed = totalRouteDist / extensionDuration;
  const spacing = targetSpeed * trend.recordInterval;
  const gpsPoints = interpolateAlongPolyline(routeLine, Math.max(spacing, 0.5));

  const numRecords = Math.min(
    gpsPoints.length,
    Math.ceil(extensionDuration / trend.recordInterval)
  );

  const lastTime = new Date(last.timestamp).getTime();
  const intervalMs = trend.recordInterval * 1000;
  const hrCeiling = Math.min(200, trend.maxHR + 10);

  const result: RecordPoint[] = [];
  let cumulativeDistance = last.distance;

  for (let i = 0; i < numRecords; i++) {
    const gpsIdx = Math.min(i, gpsPoints.length - 1);
    const [lat, lng] = gpsPoints[gpsIdx];

    // Distance from previous point
    const prevLat = i === 0 ? (last.lat ?? lat) : result[i - 1].lat!;
    const prevLng = i === 0 ? (last.lng ?? lng) : result[i - 1].lng!;
    const stepDist = haversineDistance(prevLat, prevLng, lat, lng);
    cumulativeDistance += stepDist;

    const elapsed = last.elapsed + (i + 1) * trend.recordInterval;
    const timestamp = new Date(lastTime + (i + 1) * intervalMs).toISOString();

    // HR: extrapolate from trend, clamp
    const dt = (i + 1) * trend.recordInterval;
    let hr = trend.lastHR > 0
      ? trend.lastHR + trend.hrSlope * dt
      : undefined;
    if (hr != null) {
      hr = Math.max(trend.lastHR - 10, Math.min(hrCeiling, hr));
      hr = Math.round(gaussianJitter(hr, 0.01));
    }

    const speed = stepDist / trend.recordInterval;

    result.push({
      timestamp,
      elapsed,
      distance: Math.round(cumulativeDistance * 100) / 100,
      altitude: trend.lastAltitude,
      lat,
      lng,
      heartRate: hr,
      cadence: trend.avgCadence > 0 ? Math.round(gaussianJitter(trend.avgCadence)) : undefined,
      speed: Math.round(speed * 1000) / 1000,
      verticalOscillation: trend.avgVO > 0 ? +gaussianJitter(trend.avgVO).toFixed(1) : undefined,
      groundContactTime: trend.avgGCT > 0 ? +gaussianJitter(trend.avgGCT).toFixed(1) : undefined,
      strideLength: trend.avgStrideLength > 0 ? +gaussianJitter(trend.avgStrideLength).toFixed(0) : undefined,
      verticalRatio: trend.avgVerticalRatio > 0 ? +gaussianJitter(trend.avgVerticalRatio).toFixed(2) : undefined,
      power: trend.avgPower > 0 ? Math.round(gaussianJitter(trend.avgPower)) : undefined,
      lapIndex: last.lapIndex + 1,
    });
  }

  return result;
}
