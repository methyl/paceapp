import type { RecordPoint } from "./types";
import { speedFromDistanceTime, speedToPace } from "./pace";

export interface HillSprint {
  startIndex: number;
  endIndex: number;
  startTime: string;
  endTime: string;
  distance: number; // meters
  duration: number; // seconds
  elevationGain: number; // meters
  grade: number; // percent
  avgSpeed: number; // m/s
  avgPace: string; // min:sec/km
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgCadence?: number;
  avgPower?: number;
}

/**
 * Detect uphill sprints from record-level altitude data.
 *
 * An uphill sprint is a sustained segment where:
 * - Grade > 2% (smoothed over ~10 records)
 * - Distance >= 20m
 * - Duration >= 10s
 *
 * Adjacent uphill records are grouped into sprints. Minor dips
 * (< 5 records flat/down) within an uphill segment are tolerated.
 */
export function detectHillSprints(records: RecordPoint[]): HillSprint[] {
  if (records.length < 20) return [];

  // Need altitude data
  const withAlt = records.filter((r) => r.altitude != null);
  if (withAlt.length < 20) return [];

  // Compute smoothed grade at each record (over ~10 record window)
  const grades = computeSmoothedGrade(records, 10);

  // Find uphill segments (grade > 2%)
  const MIN_GRADE = 3;
  const MIN_DISTANCE = 50;
  const MIN_DURATION = 15;
  const MAX_FLAT_GAP = 8; // tolerate this many non-uphill records

  const sprints: HillSprint[] = [];
  let sprintStart = -1;
  let flatCount = 0;

  for (let i = 0; i < records.length; i++) {
    const g = grades[i];

    if (g > MIN_GRADE) {
      if (sprintStart === -1) sprintStart = i;
      flatCount = 0;
    } else if (sprintStart !== -1) {
      flatCount++;
      if (flatCount > MAX_FLAT_GAP) {
        // End of uphill segment
        const endIdx = i - flatCount;
        const seg = buildSprint(records, sprintStart, endIdx, grades);
        if (seg && seg.distance >= MIN_DISTANCE && seg.duration >= MIN_DURATION && seg.grade >= MIN_GRADE) {
          sprints.push(seg);
        }
        sprintStart = -1;
        flatCount = 0;
      }
    }
  }

  // Handle sprint at end of records
  if (sprintStart !== -1) {
    const endIdx = records.length - 1 - flatCount;
    const seg = buildSprint(records, sprintStart, endIdx, grades);
    if (seg && seg.distance >= MIN_DISTANCE && seg.duration >= MIN_DURATION && seg.grade >= MIN_GRADE) {
      sprints.push(seg);
    }
  }

  return sprints;
}

function computeSmoothedGrade(records: RecordPoint[], windowSize: number): number[] {
  const grades: number[] = new Array(records.length).fill(0);
  const half = Math.floor(windowSize / 2);

  for (let i = half; i < records.length - half; i++) {
    const prev = records[i - half];
    const curr = records[i + half];

    const altPrev = prev.altitude;
    const altCurr = curr.altitude;
    if (altPrev == null || altCurr == null) continue;

    const distDiff = (curr.distance ?? 0) - (prev.distance ?? 0);
    if (distDiff < 1) continue;

    grades[i] = ((altCurr - altPrev) / distDiff) * 100;
  }

  return grades;
}

function buildSprint(
  records: RecordPoint[],
  startIdx: number,
  endIdx: number,
  grades: number[]
): HillSprint | null {
  if (endIdx <= startIdx) return null;

  const segRecords = records.slice(startIdx, endIdx + 1);
  if (segRecords.length < 3) return null;

  const first = segRecords[0];
  const last = segRecords[segRecords.length - 1];

  const distance = (last.distance ?? 0) - (first.distance ?? 0);
  if (distance <= 0) return null;

  const duration =
    (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / 1000;
  if (duration <= 0) return null;

  const startAlt = first.altitude ?? 0;
  const endAlt = last.altitude ?? 0;
  const elevationGain = Math.max(0, endAlt - startAlt);

  const avgGrade =
    grades.slice(startIdx, endIdx + 1).reduce((s, g) => s + g, 0) /
    (endIdx - startIdx + 1);

  const avgSpeed = speedFromDistanceTime(distance, duration);
  const avgPace = speedToPace(avgSpeed);

  const hrs = segRecords
    .map((r) => r.heartRate)
    .filter((h): h is number => h != null);
  const cads = segRecords
    .map((r) => r.cadence)
    .filter((c): c is number => c != null);
  const pows = segRecords
    .map((r) => r.power)
    .filter((p): p is number => p != null);

  return {
    startIndex: startIdx,
    endIndex: endIdx,
    startTime: first.timestamp,
    endTime: last.timestamp,
    distance: Math.round(distance),
    duration: Math.round(duration),
    elevationGain: +elevationGain.toFixed(1),
    grade: +avgGrade.toFixed(1),
    avgSpeed: +avgSpeed.toFixed(2),
    avgPace,
    avgHeartRate:
      hrs.length > 0 ? Math.round(hrs.reduce((s, h) => s + h, 0) / hrs.length) : undefined,
    maxHeartRate: hrs.length > 0 ? Math.max(...hrs) : undefined,
    avgCadence:
      cads.length > 0 ? Math.round(cads.reduce((s, c) => s + c, 0) / cads.length) : undefined,
    avgPower:
      pows.length > 0 ? Math.round(pows.reduce((s, p) => s + p, 0) / pows.length) : undefined,
  };
}
