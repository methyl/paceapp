import { detectWorkoutType } from "./detectWorkout";
import { getEffortSegments } from "./segmenter";
import { generateWorkoutLabel } from "./labeller";
import { speedToPace, speedFromDistanceTime } from "../shared/pace";
import { normalizeSummaryPace } from "../shared/lapStats";
import { parseFitWasm, type WasmLap, type WasmRecord } from "../wasm-fit/loadWasm";
import type { ParsedActivity, LapSummary, RecordPoint, ActivitySummary } from "./types";

function avgOf(vals: (number | undefined)[]): number | undefined {
  const valid = vals.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return valid.length > 0 ? valid.reduce((s, v) => s + v, 0) / valid.length : undefined;
}

function maxOf(vals: (number | undefined)[]): number | undefined {
  const valid = vals.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return valid.length > 0 ? Math.max(...valid) : undefined;
}

/**
 * Fill in lap summaries that the FIT producer didn't populate (e.g. Apple
 * Watch on structured workouts omits HR/cadence on lap messages). Each
 * aggregate is computed from records whose lapIndex matches.
 */
function backfillLapAggregates(laps: LapSummary[], records: RecordPoint[]): void {
  if (laps.length === 0 || records.length === 0) return;
  const byLap = new Map<number, RecordPoint[]>();
  for (const r of records) {
    const arr = byLap.get(r.lapIndex);
    if (arr) arr.push(r);
    else byLap.set(r.lapIndex, [r]);
  }
  for (const lap of laps) {
    const rs = byLap.get(lap.lapIndex);
    if (!rs || rs.length === 0) continue;
    if (lap.avgHeartRate == null) lap.avgHeartRate = avgOf(rs.map((r) => r.heartRate));
    if (lap.maxHeartRate == null) lap.maxHeartRate = maxOf(rs.map((r) => r.heartRate));
    if (lap.avgCadence == null) lap.avgCadence = avgOf(rs.map((r) => r.cadence));
    if (lap.avgVerticalOscillation == null)
      lap.avgVerticalOscillation = avgOf(rs.map((r) => r.verticalOscillation));
    if (lap.avgGroundContactTime == null)
      lap.avgGroundContactTime = avgOf(rs.map((r) => r.groundContactTime));
    if (lap.avgStrideLength == null) lap.avgStrideLength = avgOf(rs.map((r) => r.strideLength));
    if (lap.avgVerticalRatio == null) lap.avgVerticalRatio = avgOf(rs.map((r) => r.verticalRatio));
    if (lap.avgPower == null) lap.avgPower = avgOf(rs.map((r) => r.power));
  }
}

let idCounter = 0;

function n(v: number | null | undefined): number | undefined {
  return v == null ? undefined : v;
}

function mapLap(l: WasmLap, lapIndex: number): LapSummary {
  // Prefer timer_time (moving time) over elapsed_time (includes pauses).
  const lapTime = l.total_timer_time ?? l.total_elapsed_time ?? 0;
  const lapDist = l.total_distance ?? 0;
  // Always compute speed from distance/time — matches what Garmin displays.
  // FIT avg_speed is often systematically faster than distance/time and
  // can be wildly wrong when pauses are involved.
  const computedSpeed = speedFromDistanceTime(lapDist, lapTime);
  const avgSpeed = computedSpeed || l.avg_speed || l.enhanced_avg_speed || 0;
  return {
    lapIndex: lapIndex + 1,
    startTime: l.start_time ?? "",
    totalDistance: lapDist,
    totalElapsedTime: lapTime,
    avgHeartRate: n(l.avg_heart_rate),
    maxHeartRate: n(l.max_heart_rate),
    avgCadence: l.avg_cadence != null ? l.avg_cadence * 2 : undefined,
    avgSpeed,
    avgPace: speedToPace(avgSpeed),
    avgVerticalOscillation: n(l.avg_vertical_oscillation),
    avgGroundContactTime: n(l.avg_stance_time),
    avgGroundContactTimeBalance: n(l.avg_stance_time_balance),
    avgStrideLength: n(l.avg_step_length),
    avgVerticalRatio: n(l.avg_vertical_ratio),
    avgPower: n(l.avg_power),
  };
}

function mapRecord(r: WasmRecord): RecordPoint {
  return {
    timestamp: r.timestamp ?? "",
    elapsed: r.elapsed_time,
    distance: r.distance,
    altitude: n(r.enhanced_altitude) ?? n(r.altitude),
    lat: n(r.position_lat),
    lng: n(r.position_long),
    heartRate: n(r.heart_rate),
    cadence: r.cadence != null ? r.cadence * 2 : undefined,
    speed: n(r.speed) ?? n(r.enhanced_speed),
    verticalOscillation: n(r.vertical_oscillation),
    groundContactTime: n(r.stance_time),
    groundContactTimeBalance: n(r.stance_time_balance),
    strideLength: n(r.step_length),
    verticalRatio: n(r.vertical_ratio),
    power: n(r.power),
    lapIndex: r.lap_index + 1,
  };
}

export async function parseFitFile(
  buffer: ArrayBuffer,
  fileName: string
): Promise<ParsedActivity> {
  const bytes = new Uint8Array(buffer);
  const data = await parseFitWasm(bytes);

  const laps: LapSummary[] = data.laps.map((l, i) => mapLap(l, i));
  const records: RecordPoint[] = data.records.map(mapRecord);

  // Apple Watch's FIT export for custom/structured workouts omits HR and
  // some other per-lap aggregates, even though records still carry the
  // raw samples. Backfill missing lap stats from the matching records.
  backfillLapAggregates(laps, records);

  const session = data.session;
  const totalDistance = session?.total_distance ?? 0;
  const totalElapsedTime = session?.total_timer_time ?? session?.total_elapsed_time ?? 0;
  // Always derive summary speed from distance/time — same canonical formula
  // as laps and segments — so MCP and UI never disagree on the headline pace.
  const summary: ActivitySummary = normalizeSummaryPace({
    sport: session?.sport,
    startTime: session?.start_time,
    totalDistance,
    totalElapsedTime,
    avgHeartRate: n(session?.avg_heart_rate),
    avgCadence: session?.avg_cadence != null ? session.avg_cadence * 2 : undefined,
    avgSpeed: 0,
    avgPace: "-",
    avgVerticalOscillation: n(session?.avg_vertical_oscillation),
    avgGroundContactTime: n(session?.avg_stance_time),
    avgStrideLength: n(session?.avg_step_length),
    avgVerticalRatio: n(session?.avg_vertical_ratio),
    avgPower: n(session?.avg_power),
  });

  const effortSegments = getEffortSegments(laps, records);
  const segmentsDetected = effortSegments.length > 0 && effortSegments[0].detected;

  // Use original laps for workout type detection — they reflect the runner's
  // intended structure. Chunked segments dilute CV (e.g., strides workout with
  // 3km warmup chunked into 3×1km makes the overall CV look low).
  // Use chunked segments for labelling since they provide better detail.
  const workoutType = detectWorkoutType(summary, laps);
  const workoutLabel = generateWorkoutLabel(effortSegments, summary.totalDistance, workoutType, records);

  // The WASM decoder mirrors every FIT message into rawFitMessages in the
  // exact @garmin/fitsdk camelCase shape (Date timestamps, camelCase fields
  // and enum values). The same structure is consumed by exportFit.ts when
  // the user re-exports the activity, so we pay the decode cost only once.
  const rawFitMessages = data.rawMessages;

  return {
    id: `${fileName}-${++idCounter}`,
    fileName,
    workoutType,
    workoutLabel,
    summary,
    laps,
    segments: effortSegments,
    segmentsDetected,
    records,
    rawFitMessages,
  };
}

/** Re-run segmentation and workout detection on a cached activity */
export function reprocessActivity(a: ParsedActivity): ParsedActivity {
  const effortSegments = getEffortSegments(a.laps, a.records);
  const segmentsDetected = effortSegments.length > 0 && effortSegments[0].detected;
  const workoutType = detectWorkoutType(a.summary, a.laps);
  const workoutLabel = generateWorkoutLabel(effortSegments, a.summary.totalDistance, workoutType, a.records);

  return {
    ...a,
    segments: effortSegments,
    segmentsDetected,
    workoutType,
    workoutLabel,
  };
}
