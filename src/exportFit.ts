import { Encoder } from "@garmin/fitsdk";
import type { ParsedActivity, LapSummary, RecordPoint } from "./types";

/**
 * FIT message numbers from the FIT SDK profile.
 */
const MESG = {
  fileId: 0,
  fileCreator: 49,
  deviceInfo: 23,
  event: 21,
  sport: 12,
  record: 20,
  lap: 19,
  session: 18,
  activity: 34,
  timeInZone: 198,
} as const;

const SEMICIRCLE = 2 ** 31 / 180;

/**
 * Convert a RecordPoint to a FIT record message.
 * Matches the field names the Garmin SDK Encoder expects (camelCase).
 */
function recordToFitMesg(r: RecordPoint): Record<string, unknown> {
  const mesg: Record<string, unknown> = {
    timestamp: r.timestamp,
  };
  if (r.lat != null && r.lng != null) {
    // Convert degrees to FIT semicircles
    mesg.positionLat = Math.round(r.lat * SEMICIRCLE);
    mesg.positionLong = Math.round(r.lng * SEMICIRCLE);
  }
  if (r.altitude != null) {
    mesg.altitude = r.altitude;
    mesg.enhancedAltitude = r.altitude;
  }
  if (r.distance != null) mesg.distance = r.distance;
  if (r.speed != null) {
    mesg.speed = r.speed;
    mesg.enhancedSpeed = r.speed;
  }
  if (r.heartRate != null) mesg.heartRate = r.heartRate;
  if (r.cadence != null) {
    // FIT stores half-cadence for running
    mesg.cadence = Math.round(r.cadence / 2);
    mesg.fractionalCadence = (r.cadence / 2) % 1;
  }
  if (r.verticalOscillation != null) mesg.verticalOscillation = r.verticalOscillation;
  if (r.groundContactTime != null) mesg.stanceTime = r.groundContactTime;
  if (r.groundContactTimeBalance != null) mesg.stanceTimeBalance = r.groundContactTimeBalance;
  if (r.strideLength != null) mesg.stepLength = r.strideLength;
  if (r.verticalRatio != null) mesg.verticalRatio = r.verticalRatio;
  if (r.power != null) mesg.power = r.power;
  return mesg;
}

/**
 * Export a ParsedActivity as a valid FIT file.
 *
 * If rawFitMessages is available (from the original FIT file), re-encodes
 * those exact messages — preserving device info, events, sport, etc.
 * Records are replaced with the current activity records (including
 * any synthetic extension data).
 *
 * If rawFitMessages is not available, builds a minimal FIT file from
 * the activity data.
 */
export function exportActivityToFit(activity: ParsedActivity): Uint8Array {
  const encoder = new Encoder();
  const raw = activity.rawFitMessages;

  if (raw) {
    return exportWithRawMessages(encoder, activity, raw);
  }
  return exportMinimal(encoder, activity);
}

function exportWithRawMessages(
  encoder: Encoder,
  activity: ParsedActivity,
  raw: Record<string, unknown[]>
): Uint8Array {
  // Write non-record messages from the original file
  const writeMesgs = (key: string, mesgNum: number) => {
    for (const m of raw[key] ?? []) {
      encoder.writeMesg({ mesgNum, ...(m as Record<string, unknown>) });
    }
  };

  writeMesgs("fileIdMesgs", MESG.fileId);
  writeMesgs("fileCreatorMesgs", MESG.fileCreator);
  writeMesgs("deviceInfoMesgs", MESG.deviceInfo);
  writeMesgs("eventMesgs", MESG.event);
  writeMesgs("sportMesgs", MESG.sport);

  // Write ALL records (original + synthetic) from our RecordPoint array
  for (const r of activity.records) {
    encoder.writeMesg({ mesgNum: MESG.record, ...recordToFitMesg(r) });
  }

  let numLaps = activity.laps.length;

  // Write laps — use raw if not extended, otherwise rebuild
  if (activity.extended && raw.lapMesgs) {
    // Write original laps
    for (const m of raw.lapMesgs) {
      encoder.writeMesg({ mesgNum: MESG.lap, ...(m as Record<string, unknown>) });
    }
    // Add extension lap(s)
    const extRecords = activity.records.slice(activity.originalRecordCount ?? 0);
    if (extRecords.length > 0) {
      const sampleLap = raw.lapMesgs[raw.lapMesgs.length - 1] as Record<string, unknown> | undefined;
      const autoLapDist = detectAutoLapDistance(activity.laps);
      const chunks = autoLapDist
        ? splitRecordsByDistance(extRecords, autoLapDist)
        : [extRecords];

      let idx = activity.laps.length;
      for (const chunk of chunks) {
        if (chunk.length < 2) continue;
        encoder.writeMesg({
          mesgNum: MESG.lap,
          ...buildExtensionLapMesg(chunk, activity, idx, sampleLap, autoLapDist != null),
        });
        idx++;
      }
      numLaps = idx;
    }
  } else {
    writeMesgs("lapMesgs", MESG.lap);
  }

  // Update session with full activity stats
  if (raw.sessionMesgs?.length) {
    const session = { ...(raw.sessionMesgs[0] as Record<string, unknown>) };
    if (activity.extended) {
      updateSessionFromRecords(session, activity.records, numLaps);
    }
    encoder.writeMesg({ mesgNum: MESG.session, ...session });
  }

  // Update activity timestamp
  if (raw.activityMesgs?.length) {
    const act = { ...(raw.activityMesgs[0] as Record<string, unknown>) };
    const lastRec = activity.records[activity.records.length - 1];
    if (lastRec) {
      act.timestamp = lastRec.timestamp;
      act.totalTimerTime = lastRec.elapsed;
    }
    encoder.writeMesg({ mesgNum: MESG.activity, ...act });
  }

  return encoder.close();
}

function exportMinimal(encoder: Encoder, activity: ParsedActivity): Uint8Array {
  // Minimal FIT file when no raw messages available
  encoder.writeMesg({
    mesgNum: MESG.fileId,
    type: "activity",
    manufacturer: "development",
    timeCreated: activity.summary.startTime ?? new Date().toISOString(),
  });

  // Start event
  encoder.writeMesg({
    mesgNum: MESG.event,
    timestamp: activity.summary.startTime ?? new Date().toISOString(),
    event: "timer",
    eventType: "start",
  });

  // Records
  for (const r of activity.records) {
    encoder.writeMesg({ mesgNum: MESG.record, ...recordToFitMesg(r) });
  }

  // Stop event
  const lastRec = activity.records[activity.records.length - 1];
  if (lastRec) {
    encoder.writeMesg({
      mesgNum: MESG.event,
      timestamp: lastRec.timestamp,
      event: "timer",
      eventType: "stopAll",
    });
  }

  // Session
  const s = activity.summary;
  encoder.writeMesg({
    mesgNum: MESG.session,
    timestamp: lastRec?.timestamp ?? new Date().toISOString(),
    startTime: s.startTime ?? new Date().toISOString(),
    totalElapsedTime: s.totalElapsedTime,
    totalTimerTime: s.totalElapsedTime,
    totalDistance: s.totalDistance,
    sport: s.sport ?? "running",
    subSport: "generic",
    avgHeartRate: s.avgHeartRate ? Math.round(s.avgHeartRate) : undefined,
    avgSpeed: s.avgSpeed,
    avgCadence: s.avgCadence ? Math.round(s.avgCadence / 2) : undefined,
    avgPower: s.avgPower ? Math.round(s.avgPower) : undefined,
    firstLapIndex: 0,
    numLaps: 1,
    trigger: "activityEnd",
    eventType: "stop",
  });

  // Activity
  encoder.writeMesg({
    mesgNum: MESG.activity,
    timestamp: lastRec?.timestamp ?? new Date().toISOString(),
    numSessions: 1,
    type: "manual",
    event: "activity",
    eventType: "stop",
    totalTimerTime: s.totalElapsedTime,
  });

  return encoder.close();
}

/**
 * Detect whether the original activity used auto-lap at a uniform distance
 * (typical: 1000m or 1609.34m). Returns the lap distance if detected,
 * otherwise null — in which case we emit one lap for the whole extension.
 */
function detectAutoLapDistance(laps: LapSummary[]): number | null {
  if (laps.length < 2) return null;
  // Ignore the final lap — usually a partial trailing lap.
  const full = laps.slice(0, -1);
  if (full.length < 2) return null;
  const distances = full.map((l) => l.totalDistance).filter((d) => d > 0);
  if (distances.length < 2) return null;
  const mean = distances.reduce((s, d) => s + d, 0) / distances.length;
  if (mean < 400) return null;
  const maxDev = Math.max(...distances.map((d) => Math.abs(d - mean)));
  // Accept if every full lap is within ~3% of the mean — that's auto-lap.
  if (maxDev / mean < 0.03) return mean;
  return null;
}

/**
 * Split a run of records into chunks whose cumulative distance equals
 * `chunkDist`. The final chunk may be shorter (partial lap).
 */
function splitRecordsByDistance(
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

function buildExtensionLapMesg(
  extRecords: RecordPoint[],
  activity: ParsedActivity,
  lapIndex: number,
  sampleLap: Record<string, unknown> | undefined,
  isAutoLap: boolean,
): Record<string, unknown> {
  const first = extRecords[0];
  const last = extRecords[extRecords.length - 1];
  const dist = last.distance - first.distance;
  const time = last.elapsed - first.elapsed;

  const avg = (vals: (number | undefined)[]): number | undefined => {
    const v = vals.filter((x): x is number => x != null);
    return v.length > 0 ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
  };
  const max = (vals: (number | undefined)[]): number | undefined => {
    const v = vals.filter((x): x is number => x != null);
    return v.length > 0 ? Math.max(...v) : undefined;
  };

  // Elevation gain/loss from altitude deltas
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < extRecords.length; i++) {
    const prev = extRecords[i - 1].altitude;
    const cur = extRecords[i].altitude;
    if (prev != null && cur != null) {
      const d = cur - prev;
      if (d > 0) ascent += d;
      else descent -= d;
    }
  }

  const avgSpeed = time > 0 ? dist / time : 0;
  const avgCadenceHalf = avg(
    extRecords.map((r) => (r.cadence != null ? r.cadence / 2 : undefined)),
  );
  const maxCadenceHalf = max(
    extRecords.map((r) => (r.cadence != null ? r.cadence / 2 : undefined)),
  );

  const mesg: Record<string, unknown> = {
    // Preserve extra fields (e.g., left/right balance, intensity factor) from a
    // sibling lap so downstream tools don't see gaps the watch would fill in.
    ...(sampleLap ?? {}),
    timestamp: last.timestamp,
    startTime: first.timestamp,
    event: "lap",
    eventType: "stop",
    lapTrigger: isAutoLap ? "distance" : "manual",
    sport: activity.summary.sport ?? "running",
    subSport: (sampleLap?.subSport as string) ?? "generic",
    totalElapsedTime: time,
    totalTimerTime: time,
    totalDistance: dist,
    avgSpeed,
    enhancedAvgSpeed: avgSpeed,
    maxSpeed: max(extRecords.map((r) => r.speed)),
    enhancedMaxSpeed: max(extRecords.map((r) => r.speed)),
    avgHeartRate: round(avg(extRecords.map((r) => r.heartRate))),
    maxHeartRate: max(extRecords.map((r) => r.heartRate)),
    avgCadence: round(avgCadenceHalf),
    maxCadence: round(maxCadenceHalf),
    avgPower: round(avg(extRecords.map((r) => r.power))),
    maxPower: round(max(extRecords.map((r) => r.power))),
    avgVerticalOscillation: avg(extRecords.map((r) => r.verticalOscillation)),
    avgStanceTime: avg(extRecords.map((r) => r.groundContactTime)),
    avgStanceTimeBalance: avg(extRecords.map((r) => r.groundContactTimeBalance)),
    avgStepLength: avg(extRecords.map((r) => r.strideLength)),
    avgVerticalRatio: avg(extRecords.map((r) => r.verticalRatio)),
    totalAscent: Math.round(ascent),
    totalDescent: Math.round(descent),
    totalCalories: estimateCalories(time, avgSpeed),
    intensity: "active",
    messageIndex: lapIndex,
  };

  if (first.lat != null && first.lng != null) {
    mesg.startPositionLat = Math.round(first.lat * SEMICIRCLE);
    mesg.startPositionLong = Math.round(first.lng * SEMICIRCLE);
  }
  if (last.lat != null && last.lng != null) {
    mesg.endPositionLat = Math.round(last.lat * SEMICIRCLE);
    mesg.endPositionLong = Math.round(last.lng * SEMICIRCLE);
  }

  // Strip values that wouldn't apply to the synthetic extension
  delete mesg.totalTrainingEffect;
  delete mesg.totalAnaerobicTrainingEffect;
  delete mesg.trainingStressScore;

  return mesg;
}

function round(n: number | undefined): number | undefined {
  return n != null ? Math.round(n) : undefined;
}

/** Rough running calorie estimate: ~1 kcal per kg per km. Assumes 70kg — good
 * enough to avoid leaving the field blank in the extension lap. */
function estimateCalories(timeSeconds: number, speedMps: number): number {
  const km = (speedMps * timeSeconds) / 1000;
  return Math.round(km * 70);
}

function updateSessionFromRecords(
  session: Record<string, unknown>,
  records: RecordPoint[],
  numLaps: number,
) {
  if (records.length === 0) return;
  const last = records[records.length - 1];
  session.timestamp = last.timestamp;
  session.totalDistance = last.distance;
  session.totalElapsedTime = last.elapsed;
  session.totalTimerTime = last.elapsed;
  session.numLaps = numLaps;

  const avg = (vals: (number | undefined)[]): number | undefined => {
    const v = vals.filter((x): x is number => x != null);
    return v.length > 0 ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
  };
  const max = (vals: (number | undefined)[]): number | undefined => {
    const v = vals.filter((x): x is number => x != null);
    return v.length > 0 ? Math.max(...v) : undefined;
  };

  const avgHR = avg(records.map((r) => r.heartRate));
  if (avgHR) session.avgHeartRate = Math.round(avgHR);
  const maxHR = max(records.map((r) => r.heartRate));
  if (maxHR) session.maxHeartRate = Math.round(maxHR);

  const avgSpeed = avg(records.map((r) => r.speed));
  if (avgSpeed) {
    session.avgSpeed = avgSpeed;
    session.enhancedAvgSpeed = avgSpeed;
  }
  const maxSpeed = max(records.map((r) => r.speed));
  if (maxSpeed) {
    session.maxSpeed = maxSpeed;
    session.enhancedMaxSpeed = maxSpeed;
  }

  const avgCadenceHalf = avg(
    records.map((r) => (r.cadence != null ? r.cadence / 2 : undefined)),
  );
  if (avgCadenceHalf != null) session.avgCadence = Math.round(avgCadenceHalf);
  const maxCadenceHalf = max(
    records.map((r) => (r.cadence != null ? r.cadence / 2 : undefined)),
  );
  if (maxCadenceHalf != null) session.maxCadence = Math.round(maxCadenceHalf);

  const avgPower = avg(records.map((r) => r.power));
  if (avgPower != null) session.avgPower = Math.round(avgPower);
  const maxPower = max(records.map((r) => r.power));
  if (maxPower != null) session.maxPower = Math.round(maxPower);

  const avgVO = avg(records.map((r) => r.verticalOscillation));
  if (avgVO != null) session.avgVerticalOscillation = avgVO;
  const avgGCT = avg(records.map((r) => r.groundContactTime));
  if (avgGCT != null) session.avgStanceTime = avgGCT;
  const avgGCTB = avg(records.map((r) => r.groundContactTimeBalance));
  if (avgGCTB != null) session.avgStanceTimeBalance = avgGCTB;
  const avgStep = avg(records.map((r) => r.strideLength));
  if (avgStep != null) session.avgStepLength = avgStep;
  const avgVR = avg(records.map((r) => r.verticalRatio));
  if (avgVR != null) session.avgVerticalRatio = avgVR;

  // Re-aggregate elevation for the full activity
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1].altitude;
    const cur = records[i].altitude;
    if (prev != null && cur != null) {
      const d = cur - prev;
      if (d > 0) ascent += d;
      else descent -= d;
    }
  }
  session.totalAscent = Math.round(ascent);
  session.totalDescent = Math.round(descent);
}

/**
 * Trigger a file download in the browser.
 */
export function downloadFitFile(data: Uint8Array, fileName: string) {
  const blob = new Blob([new Uint8Array(data)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.replace(/\.fit$/i, "") + ".fit";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
