import FitParser from "fit-file-parser";
import { detectWorkoutType } from "./detectWorkout";
import type { ParsedActivity, LapSummary, RecordPoint, ActivitySummary } from "./types";

function speedToPace(speedMps: number): string {
  if (!speedMps || speedMps <= 0) return "-";
  const secPerKm = 1000 / speedMps;
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function formatTime(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

let idCounter = 0;

export async function parseFitFile(
  buffer: ArrayBuffer,
  fileName: string
): Promise<ParsedActivity> {
  const parser = new FitParser({
    force: true,
    speedUnit: "m/s",
    lengthUnit: "m",
    elapsedRecordField: true,
    mode: "cascade",
  });

  const data = await parser.parseAsync(buffer);

  const laps: LapSummary[] = [];
  const records: RecordPoint[] = [];
  const startTime = data.activity?.sessions?.[0]?.start_time;

  const fitLaps = data.activity?.sessions?.[0]?.laps ?? data.laps ?? [];

  let lapIndex = 0;
  for (const lap of fitLaps) {
    const lapSummary: LapSummary = {
      lapIndex: lapIndex + 1,
      startTime: lap.start_time,
      totalDistance: lap.total_distance ?? 0,
      totalElapsedTime: lap.total_elapsed_time ?? 0,
      avgHeartRate: lap.avg_heart_rate,
      maxHeartRate: lap.max_heart_rate,
      avgCadence: lap.avg_cadence != null ? lap.avg_cadence * 2 : undefined,
      avgSpeed: lap.avg_speed ?? lap.enhanced_avg_speed,
      avgPace: speedToPace(lap.avg_speed ?? lap.enhanced_avg_speed ?? 0),
      avgVerticalOscillation: lap.avg_vertical_oscillation,
      avgGroundContactTime: lap.avg_stance_time,
      avgGroundContactTimeBalance: lap.avg_stance_time_balance,
      avgStrideLength: lap.avg_step_length,
      avgVerticalRatio: lap.avg_vertical_ratio,
      avgPower: lap.avg_power,
    };
    laps.push(lapSummary);

    const lapRecords = lap.records ?? [];
    for (const rec of lapRecords) {
      records.push({
        timestamp: rec.timestamp,
        elapsed: (rec as unknown as Record<string, number>).elapsed_time ?? 0,
        distance: rec.distance ?? 0,
        heartRate: rec.heart_rate,
        cadence: rec.cadence != null ? rec.cadence * 2 : undefined,
        speed: rec.speed ?? rec.enhanced_speed,
        verticalOscillation: rec.vertical_oscillation,
        groundContactTime: rec.stance_time,
        groundContactTimeBalance: rec.stance_time_balance,
        strideLength: rec.step_length,
        verticalRatio: rec.vertical_ratio,
        power: rec.power,
        lapIndex: lapIndex + 1,
      });
    }
    lapIndex++;
  }

  // If cascade mode didn't nest records in laps, use top-level records
  if (records.length === 0 && data.records) {
    let currentLap = 0;
    for (const rec of data.records) {
      while (
        currentLap < laps.length - 1 &&
        new Date(rec.timestamp) >= new Date(laps[currentLap + 1].startTime)
      ) {
        currentLap++;
      }
      records.push({
        timestamp: rec.timestamp,
        elapsed: (rec as unknown as Record<string, number>).elapsed_time ?? 0,
        distance: rec.distance ?? 0,
        heartRate: rec.heart_rate,
        cadence: rec.cadence != null ? rec.cadence * 2 : undefined,
        speed: rec.speed ?? rec.enhanced_speed,
        verticalOscillation: rec.vertical_oscillation,
        groundContactTime: rec.stance_time,
        groundContactTimeBalance: rec.stance_time_balance,
        strideLength: rec.step_length,
        verticalRatio: rec.vertical_ratio,
        power: rec.power,
        lapIndex: currentLap + 1,
      });
    }
  }

  const session = data.activity?.sessions?.[0];

  const avgSpeed = session?.avg_speed ?? session?.enhanced_avg_speed ?? 0;
  const summary: ActivitySummary = {
    sport: session?.sport,
    startTime: startTime,
    totalDistance: session?.total_distance ?? 0,
    totalElapsedTime: session?.total_elapsed_time ?? 0,
    avgHeartRate: session?.avg_heart_rate,
    avgCadence: session?.avg_cadence != null ? session.avg_cadence * 2 : undefined,
    avgSpeed,
    avgPace: speedToPace(avgSpeed),
    avgVerticalOscillation: session?.avg_vertical_oscillation,
    avgGroundContactTime: session?.avg_stance_time,
    avgStrideLength: session?.avg_step_length,
    avgVerticalRatio: session?.avg_vertical_ratio,
    avgPower: session?.avg_power,
  };

  const workoutType = detectWorkoutType(summary, laps);

  return {
    id: `${fileName}-${++idCounter}`,
    fileName,
    workoutType,
    summary,
    laps,
    records,
  };
}

export { speedToPace, formatTime };
