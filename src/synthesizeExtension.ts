import type { RecordPoint } from "./types";

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
}): RecordPoint[] {
  const { existingRecords, waypoints, totalFinishTimeSeconds } = params;

  if (existingRecords.length === 0 || waypoints.length < 2) return [];

  const last = existingRecords[existingRecords.length - 1];
  const trend = analyzeRecentTrend(existingRecords);

  const extensionDuration = totalFinishTimeSeconds - last.elapsed;
  if (extensionDuration <= 0) return [];

  // Compute extension distance from waypoints
  let totalWaypointDist = 0;
  for (let i = 1; i < waypoints.length; i++) {
    totalWaypointDist += haversineDistance(
      waypoints[i - 1][0], waypoints[i - 1][1],
      waypoints[i][0], waypoints[i][1]
    );
  }

  const targetSpeed = totalWaypointDist / extensionDuration;
  const spacing = targetSpeed * trend.recordInterval;
  const gpsPoints = interpolateAlongPolyline(waypoints, Math.max(spacing, 0.5));

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
