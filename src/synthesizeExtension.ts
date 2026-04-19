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
 * Like splitRecordsByDistance, but the first chunk is `firstChunkDist` long
 * instead of `chunkDist`. Used to complete a partial trailing lap: the
 * first synth chunk fills the remaining distance to `chunkDist`, and every
 * subsequent chunk is a full `chunkDist`.
 */
export function splitRecordsWithFirstOffset(
  records: RecordPoint[],
  chunkDist: number,
  firstChunkDist: number,
): RecordPoint[][] {
  if (records.length === 0 || chunkDist <= 0 || firstChunkDist <= 0) return [records];
  const chunks: RecordPoint[][] = [];
  const startDist = records[0].distance;
  let chunkStart = 0;
  let nextBoundary = startDist + firstChunkDist;

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

function summarizeChunk(chunk: RecordPoint[], lapIndex: number): LapSummary | null {
  if (chunk.length < 2) return null;
  const first = chunk[0];
  const last = chunk[chunk.length - 1];
  const dist = last.distance - first.distance;
  const time = last.elapsed - first.elapsed;
  if (dist <= 0 || time <= 0) return null;

  const avg = (vals: (number | undefined)[]): number | undefined => {
    const v = vals.filter((x): x is number => x != null);
    return v.length > 0 ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
  };
  const max = (vals: (number | undefined)[]): number | undefined => {
    const v = vals.filter((x): x is number => x != null);
    return v.length > 0 ? Math.max(...v) : undefined;
  };

  const avgSpeed = dist / time;
  return {
    lapIndex,
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
  };
}

/**
 * Merge an existing partial lap summary with the synth records that
 * completed it. Metric averages are weighted by elapsed time.
 */
export function mergeWithPartialLap(
  partial: LapSummary,
  synthChunk: RecordPoint[],
): LapSummary {
  const synthSummary = summarizeChunk(synthChunk, partial.lapIndex);
  if (!synthSummary) return partial;

  const totalTime = partial.totalElapsedTime + synthSummary.totalElapsedTime;
  const totalDist = partial.totalDistance + synthSummary.totalDistance;
  const weighted = (a: number | undefined, b: number | undefined): number | undefined => {
    if (a == null && b == null) return undefined;
    if (a == null) return b;
    if (b == null) return a;
    return (a * partial.totalElapsedTime + b * synthSummary.totalElapsedTime) / totalTime;
  };
  const maxOf = (a: number | undefined, b: number | undefined): number | undefined => {
    if (a == null) return b;
    if (b == null) return a;
    return Math.max(a, b);
  };

  const avgSpeed = totalDist / totalTime;
  return {
    lapIndex: partial.lapIndex,
    startTime: partial.startTime,
    totalDistance: totalDist,
    totalElapsedTime: totalTime,
    avgHeartRate: weighted(partial.avgHeartRate, synthSummary.avgHeartRate),
    maxHeartRate: maxOf(partial.maxHeartRate, synthSummary.maxHeartRate),
    avgCadence: weighted(partial.avgCadence, synthSummary.avgCadence),
    avgSpeed,
    avgPace: speedToPace(avgSpeed),
    avgVerticalOscillation: weighted(
      partial.avgVerticalOscillation, synthSummary.avgVerticalOscillation,
    ),
    avgGroundContactTime: weighted(
      partial.avgGroundContactTime, synthSummary.avgGroundContactTime,
    ),
    avgGroundContactTimeBalance: weighted(
      partial.avgGroundContactTimeBalance, synthSummary.avgGroundContactTimeBalance,
    ),
    avgStrideLength: weighted(partial.avgStrideLength, synthSummary.avgStrideLength),
    avgVerticalRatio: weighted(partial.avgVerticalRatio, synthSummary.avgVerticalRatio),
    avgPower: weighted(partial.avgPower, synthSummary.avgPower),
  };
}

export interface ExtensionLapsResult {
  /**
   * Laps produced from the extension. If `replacesLastExistingLap` is true,
   * the first entry is a merged replacement for the last existing lap (a
   * partial auto-lap that got absorbed), and subsequent entries are new.
   */
  laps: LapSummary[];
  /**
   * Whether the last existing lap was absorbed into the first entry of
   * `laps`. Callers should drop the last existing lap before appending.
   */
  replacesLastExistingLap: boolean;
}

/**
 * Build LapSummary entries for synthetic extension records so the app's
 * lap table (and anything else that reads `activity.laps`) reflects the
 * extension. If the original activity used uniform auto-laps, the extension
 * is split into matching chunks; otherwise one summary lap is produced.
 *
 * When the original activity's last lap is partial (watch died mid-lap),
 * the first synth chunk completes that lap — returned as a merged summary
 * that replaces the partial. The caller is expected to splice accordingly.
 */
export function buildExtensionLaps(
  extRecords: RecordPoint[],
  existingLaps: LapSummary[],
): ExtensionLapsResult {
  if (extRecords.length < 2) return { laps: [], replacesLastExistingLap: false };
  const autoLapDist = detectAutoLapDistance(existingLaps);

  // Detect partial trailing lap worth absorbing: has to be clearly shorter
  // than the auto-lap distance (else it's just the natural run end) but not
  // a zero-length artifact.
  const lastExisting = existingLaps.length > 0
    ? existingLaps[existingLaps.length - 1]
    : null;
  const partial =
    autoLapDist &&
    lastExisting &&
    lastExisting.totalDistance > 0 &&
    lastExisting.totalDistance < autoLapDist * 0.9
      ? lastExisting
      : null;

  let chunks: RecordPoint[][];
  if (autoLapDist && partial) {
    const remainder = autoLapDist - partial.totalDistance;
    chunks = splitRecordsWithFirstOffset(extRecords, autoLapDist, remainder);
  } else if (autoLapDist) {
    chunks = splitRecordsByDistance(extRecords, autoLapDist);
  } else {
    chunks = [extRecords];
  }

  const result: LapSummary[] = [];
  let idx = partial ? partial.lapIndex + 1 : existingLaps.length + 1;

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    if (chunk.length < 2) continue;

    if (ci === 0 && partial) {
      const merged = mergeWithPartialLap(partial, chunk);
      result.push(merged);
      continue;
    }

    const lap = summarizeChunk(chunk, idx);
    if (!lap) continue;
    result.push(lap);
    idx++;
  }

  return { laps: result, replacesLastExistingLap: !!partial };
}

export interface MetricStats {
  mean: number;
  std: number;
  last: number;
  min: number;
  max: number;
  count: number;
}

export interface RecentTrend {
  // Per-metric distributional stats used to drive realistic variability
  speed: MetricStats;
  hr: MetricStats;
  cadence: MetricStats;
  vo: MetricStats;
  gct: MetricStats;
  gctBalance: MetricStats;
  stride: MetricStats;
  verticalRatio: MetricStats;
  power: MetricStats;
  altitude: MetricStats;
  hrSlope: number; // bpm per second
  recordInterval: number; // seconds between records
  // Legacy flat fields kept for backward compatibility with existing callers.
  avgSpeed: number;
  lastHR: number;
  maxHR: number;
  avgCadence: number;
  avgVO: number;
  avgGCT: number;
  avgStrideLength: number;
  avgVerticalRatio: number;
  avgPower: number;
  lastAltitude: number;
}

function computeStats(vals: (number | undefined)[]): MetricStats {
  const v = vals.filter((x): x is number => x != null);
  if (v.length === 0) {
    return { mean: 0, std: 0, last: 0, min: 0, max: 0, count: 0 };
  }
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const variance =
    v.length > 1
      ? v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1)
      : 0;
  return {
    mean,
    std: Math.sqrt(variance),
    last: v[v.length - 1],
    min: Math.min(...v),
    max: Math.max(...v),
    count: v.length,
  };
}

/**
 * Return only records plausibly recorded while actively running: cadence in
 * a believable range or moving above a slow-walk pace. This filters out stops,
 * pauses, and dropped samples — common contamination at the very end of a
 * recording when the watch is being checked or about to die.
 */
export function selectActiveRecords(records: RecordPoint[]): RecordPoint[] {
  return records.filter((r) => {
    const cadenceOk = r.cadence != null && r.cadence >= 120;
    const speedOk = r.speed != null && r.speed >= 1.5;
    return cadenceOk || speedOk;
  });
}

function buildStats(records: RecordPoint[]): {
  speed: MetricStats;
  hr: MetricStats;
  cadence: MetricStats;
  vo: MetricStats;
  gct: MetricStats;
  gctBalance: MetricStats;
  stride: MetricStats;
  verticalRatio: MetricStats;
  power: MetricStats;
  altitude: MetricStats;
} {
  return {
    speed: computeStats(records.map((r) => r.speed)),
    hr: computeStats(records.map((r) => r.heartRate)),
    cadence: computeStats(records.map((r) => r.cadence)),
    vo: computeStats(records.map((r) => r.verticalOscillation)),
    gct: computeStats(records.map((r) => r.groundContactTime)),
    gctBalance: computeStats(records.map((r) => r.groundContactTimeBalance)),
    stride: computeStats(records.map((r) => r.strideLength)),
    verticalRatio: computeStats(records.map((r) => r.verticalRatio)),
    power: computeStats(records.map((r) => r.power)),
    altitude: computeStats(records.map((r) => r.altitude)),
  };
}

/**
 * Analyze the recent portion of the run to extract per-metric stats used
 * to extrapolate trends and drive realistic variability in the extension.
 * Default window is ~5 minutes at 1Hz — long enough to capture natural
 * variability without overweighting early warmup minutes.
 */
export function analyzeRecentTrend(
  records: RecordPoint[],
  windowSize = 300,
): RecentTrend {
  const window = records.slice(-Math.min(windowSize, records.length));

  const stats = buildStats(window);

  // Linear regression: HR vs elapsed time
  const hrPairs = window
    .filter((r) => r.heartRate != null)
    .map((r) => ({ t: r.elapsed, hr: r.heartRate! }));
  let hrSlope = 0;
  if (hrPairs.length >= 5) {
    const n = hrPairs.length;
    const sumT = hrPairs.reduce((s, p) => s + p.t, 0);
    const sumHR = hrPairs.reduce((s, p) => s + p.hr, 0);
    const sumTT = hrPairs.reduce((s, p) => s + p.t * p.t, 0);
    const sumTHR = hrPairs.reduce((s, p) => s + p.t * p.hr, 0);
    const denom = n * sumTT - sumT * sumT;
    hrSlope = denom !== 0 ? (n * sumTHR - sumT * sumHR) / denom : 0;
  }

  // Median record interval
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
    ...stats,
    hrSlope,
    recordInterval,
    avgSpeed: stats.speed.mean,
    lastHR: stats.hr.last,
    maxHR: stats.hr.max,
    avgCadence: stats.cadence.mean,
    avgVO: stats.vo.mean,
    avgGCT: stats.gct.mean,
    avgStrideLength: stats.stride.mean,
    avgVerticalRatio: stats.verticalRatio.mean,
    avgPower: stats.power.mean,
    lastAltitude: stats.altitude.last,
  };
}

/**
 * Compute trend stats from records that were run at a similar pace to
 * `targetSpeed` (within ±tolerance), ignoring stops and non-running samples.
 * This captures the runner's dynamics at race pace, regardless of whether
 * the final minutes of the recording happen to reflect that — e.g. a
 * slowdown or pause right before the watch died skews a pure-recent window.
 *
 * HR drift slope and record interval are still taken from the recent window
 * since those are time-based. Each metric's `.last` is overridden with the
 * actually-last record's value so the AR(1) generators hand off smoothly
 * from the real data.
 *
 * Falls back to analyzeRecentTrend if too few records match the target pace.
 */
export function analyzePaceMatchedTrend(
  records: RecordPoint[],
  targetSpeed: number,
  options: { paceTolerance?: number; minSamples?: number } = {},
): RecentTrend {
  const recent = analyzeRecentTrend(records);
  if (records.length === 0 || targetSpeed <= 0) return recent;

  const tol = options.paceTolerance ?? 0.15;
  const minSamples = options.minSamples ?? 30;
  const minSpeed = targetSpeed * (1 - tol);
  const maxSpeed = targetSpeed * (1 + tol);

  const matched = selectActiveRecords(records).filter(
    (r) => r.speed != null && r.speed >= minSpeed && r.speed <= maxSpeed,
  );

  if (matched.length < minSamples) return recent;

  const stats = buildStats(matched);
  const lastReal = records[records.length - 1];

  // Cardiac drift at race pace, fit over the matched subset. Using the
  // recent-window slope instead would extrapolate any slowdown-induced HR
  // decline forever, pulling synth HR well below race-pace range.
  const hrPairs = matched
    .filter((r) => r.heartRate != null)
    .map((r) => ({ t: r.elapsed, hr: r.heartRate! }));
  let hrSlope = recent.hrSlope;
  if (hrPairs.length >= 5) {
    const n = hrPairs.length;
    const sumT = hrPairs.reduce((s, p) => s + p.t, 0);
    const sumHR = hrPairs.reduce((s, p) => s + p.hr, 0);
    const sumTT = hrPairs.reduce((s, p) => s + p.t * p.t, 0);
    const sumTHR = hrPairs.reduce((s, p) => s + p.t * p.hr, 0);
    const denom = n * sumTT - sumT * sumT;
    hrSlope = denom !== 0 ? (n * sumTHR - sumT * sumHR) / denom : 0;
  }

  // Preserve smooth handoff from the real recording: AR(1) generators are
  // seeded at `.last`, so use the actual last record's value there.
  const withLast = (s: MetricStats, last: number | undefined): MetricStats =>
    last != null ? { ...s, last } : s;

  const speed = withLast(stats.speed, lastReal.speed);
  const hr = withLast(stats.hr, lastReal.heartRate);
  const cadence = withLast(stats.cadence, lastReal.cadence);
  const vo = withLast(stats.vo, lastReal.verticalOscillation);
  const gct = withLast(stats.gct, lastReal.groundContactTime);
  const gctBalance = withLast(stats.gctBalance, lastReal.groundContactTimeBalance);
  const stride = withLast(stats.stride, lastReal.strideLength);
  const verticalRatio = withLast(stats.verticalRatio, lastReal.verticalRatio);
  const power = withLast(stats.power, lastReal.power);
  // Altitude should reflect where the runner actually is now, not average
  // altitude over the pace-matched subset which could be anywhere on the course.
  const altitude = recent.altitude;

  return {
    speed,
    hr,
    cadence,
    vo,
    gct,
    gctBalance,
    stride,
    verticalRatio,
    power,
    altitude,
    hrSlope,
    recordInterval: recent.recordInterval,
    avgSpeed: speed.mean,
    lastHR: hr.last,
    maxHR: hr.max,
    avgCadence: cadence.mean,
    avgVO: vo.mean,
    avgGCT: gct.mean,
    avgStrideLength: stride.mean,
    avgVerticalRatio: verticalRatio.mean,
    avgPower: power.mean,
    lastAltitude: altitude.last,
  };
}

function gauss(): number {
  // Box-Muller
  const u1 = Math.max(1e-12, Math.random());
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Autocorrelated (AR(1)) noise generator. Alpha closer to 1 => smoother
 * evolution. Preserves the mean and approximate stationary std `std`.
 */
function createAR1(mean: number, std: number, alpha: number, initial?: number) {
  let value = initial ?? mean;
  const innovationScale = std * Math.sqrt(Math.max(0, 1 - alpha * alpha));
  return () => {
    if (std <= 0) return mean;
    value = mean + alpha * (value - mean) + gauss() * innovationScale;
    return value;
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
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

  const extensionDuration = totalFinishTimeSeconds - last.elapsed;
  if (extensionDuration <= 0) return [];

  // Use the snapped road/trail path when available so synthetic GPS follows
  // actual routes rather than cutting across buildings.
  const routeLine = path && path.length >= 2 ? path : waypoints;

  // Cumulative distance along the route so we can place records by distance.
  const routeCum: number[] = [0];
  for (let i = 1; i < routeLine.length; i++) {
    routeCum.push(
      routeCum[i - 1] +
        haversineDistance(
          routeLine[i - 1][0], routeLine[i - 1][1],
          routeLine[i][0], routeLine[i][1],
        ),
    );
  }
  const totalRouteDist = routeCum[routeCum.length - 1];
  if (totalRouteDist <= 0) return [];

  // Match the trend to what the runner does at the extension pace, not
  // whatever happened in the last 5 min — which is often a slowdown right
  // before the watch died and skews dynamics low (cadence/power) and high
  // (VO) vs. typical race-pace laps.
  const targetSpeedForTrend = totalRouteDist / extensionDuration;
  const trend = analyzePaceMatchedTrend(existingRecords, targetSpeedForTrend);

  const positionAt = (d: number): [number, number] => {
    if (d <= 0) return routeLine[0];
    if (d >= totalRouteDist) return routeLine[routeLine.length - 1];
    let lo = 0;
    let hi = routeCum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (routeCum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const span = routeCum[hi] - routeCum[lo] || 1;
    const t = (d - routeCum[lo]) / span;
    return [
      routeLine[lo][0] + (routeLine[hi][0] - routeLine[lo][0]) * t,
      routeLine[lo][1] + (routeLine[hi][1] - routeLine[lo][1]) * t,
    ];
  };

  const dt = trend.recordInterval;
  const targetSpeed = targetSpeedForTrend;
  const numRecords = Math.max(1, Math.round(extensionDuration / dt));

  // Per-step pace deviation. If the recent window is unusually steady
  // (treadmill, pacing target) fall back to a modest 5% of target so the
  // extension still has believable micro-variation.
  const paceStd = trend.speed.std > 0 ? trend.speed.std : targetSpeed * 0.05;
  const paceDev = createAR1(0, paceStd, 0.95, 0);

  // Seed each AR(1) at the last observed value to blend smoothly from the
  // real data into the synthetic extension.
  //
  // HR uses a deviation-from-mean AR(1): seeded at (last - mean) so the
  // first synthetic HR matches the last real HR, then regresses toward the
  // pace-matched mean. Without this, a slowdown-before-watch-died would
  // leave HR anchored at a suppressed value and slope-extrapolated downward
  // for the whole extension.
  const hrMean = trend.hr.mean > 0 ? trend.hr.mean : trend.hr.last;
  const hrBaseline = trend.hr.last > 0 ? trend.hr.last : hrMean;
  const hrDevGen = createAR1(0, trend.hr.std, 0.95, hrBaseline - hrMean);
  const cadenceGen = createAR1(trend.cadence.mean, trend.cadence.std, 0.9, trend.cadence.last);
  const voGen = createAR1(trend.vo.mean, trend.vo.std, 0.85, trend.vo.last);
  const gctGen = createAR1(trend.gct.mean, trend.gct.std, 0.85, trend.gct.last);
  const gctBalanceGen = createAR1(
    trend.gctBalance.mean, trend.gctBalance.std, 0.9, trend.gctBalance.last,
  );
  const strideGen = createAR1(trend.stride.mean, trend.stride.std, 0.88, trend.stride.last);
  const vrGen = createAR1(
    trend.verticalRatio.mean, trend.verticalRatio.std, 0.85, trend.verticalRatio.last,
  );
  const powerGen = createAR1(trend.power.mean, trend.power.std, 0.88, trend.power.last);
  // Altitude: tiny drift around the last known value; real terrain is unknown.
  const altStd = trend.altitude.std > 0 ? Math.min(trend.altitude.std, 1) : 0.2;
  const altGen = createAR1(trend.altitude.last, altStd, 0.98, trend.altitude.last);

  // First pass: noisy step distances, then scale so the total matches the route.
  const stepDists: number[] = new Array(numRecords);
  let rawSum = 0;
  for (let i = 0; i < numRecords; i++) {
    const s = Math.max(0.5, targetSpeed + paceDev());
    stepDists[i] = s * dt;
    rawSum += stepDists[i];
  }
  const scale = rawSum > 0 ? totalRouteDist / rawSum : 1;
  for (let i = 0; i < numRecords; i++) stepDists[i] *= scale;

  // Clamps: allow synthetic values to roam slightly beyond the observed range
  // (real runs do too) but keep them in physiological bounds. The range must
  // also include each metric's `.last` (the AR(1) handoff seed) so the first
  // synth value doesn't get clamped away from a smooth transition.
  const pad = (stat: MetricStats, frac = 0.15): [number, number] => {
    if (stat.count === 0) return [-Infinity, Infinity];
    const lo = stat.last != null ? Math.min(stat.min, stat.last) : stat.min;
    const hi = stat.last != null ? Math.max(stat.max, stat.last) : stat.max;
    const range = Math.max(hi - lo, Math.abs(stat.mean) * frac, 1e-6);
    return [lo - range * frac, hi + range * frac];
  };
  const rangeWithLast = (stat: MetricStats, pad: number): [number, number] => {
    const lo = Math.min(stat.min, stat.last);
    const hi = Math.max(stat.max, stat.last);
    return [lo - pad, hi + pad];
  };
  const [hrMin, hrMax] = trend.hr.count > 0
    ? (() => {
        const [lo, hi] = rangeWithLast(trend.hr, 8);
        return [Math.max(60, lo), Math.min(205, hi)] as [number, number];
      })()
    : [60, 205];
  const [cadMin, cadMax] = trend.cadence.count > 0
    ? (() => {
        const [lo, hi] = rangeWithLast(trend.cadence, 6);
        return [Math.max(120, lo), Math.min(230, hi)] as [number, number];
      })()
    : [120, 230];
  const [voMin, voMax] = pad(trend.vo);
  const [gctMin, gctMax] = pad(trend.gct);
  const [gctBalMin, gctBalMax] = pad(trend.gctBalance, 0.05);
  const [strideMin, strideMax] = pad(trend.stride);
  const [vrMin, vrMax] = pad(trend.verticalRatio);
  const [powerMin, powerMax] = pad(trend.power);

  const lastTime = new Date(last.timestamp).getTime();
  const intervalMs = dt * 1000;

  const result: RecordPoint[] = [];
  let cumDistance = 0;
  for (let i = 0; i < numRecords; i++) {
    cumDistance += stepDists[i];
    const [lat, lng] = positionAt(cumDistance);

    const elapsed = last.elapsed + (i + 1) * dt;
    const timestamp = new Date(lastTime + (i + 1) * intervalMs).toISOString();

    let hr: number | undefined;
    if (trend.hr.count > 0) {
      const drift = trend.hrSlope * (i + 1) * dt;
      hr = Math.round(clamp(hrMean + drift + hrDevGen(), hrMin, hrMax));
    }

    const cadence = trend.cadence.count > 0
      ? Math.round(clamp(cadenceGen(), cadMin, cadMax))
      : undefined;
    const vo = trend.vo.count > 0
      ? +clamp(voGen(), voMin, voMax).toFixed(1)
      : undefined;
    const gctV = trend.gct.count > 0
      ? +clamp(gctGen(), gctMin, gctMax).toFixed(1)
      : undefined;
    const gctBal = trend.gctBalance.count > 0
      ? +clamp(gctBalanceGen(), gctBalMin, gctBalMax).toFixed(2)
      : undefined;
    const strideV = trend.stride.count > 0
      ? Math.round(clamp(strideGen(), strideMin, strideMax))
      : undefined;
    const vr = trend.verticalRatio.count > 0
      ? +clamp(vrGen(), vrMin, vrMax).toFixed(2)
      : undefined;
    const powerV = trend.power.count > 0
      ? Math.round(clamp(powerGen(), powerMin, powerMax))
      : undefined;

    result.push({
      timestamp,
      elapsed,
      distance: Math.round((last.distance + cumDistance) * 100) / 100,
      altitude: trend.altitude.count > 0 ? +altGen().toFixed(1) : undefined,
      lat,
      lng,
      heartRate: hr,
      cadence,
      speed: Math.round((stepDists[i] / dt) * 1000) / 1000,
      verticalOscillation: vo,
      groundContactTime: gctV,
      groundContactTimeBalance: gctBal,
      strideLength: strideV,
      verticalRatio: vr,
      power: powerV,
      lapIndex: last.lapIndex + 1,
    });
  }

  return result;
}
