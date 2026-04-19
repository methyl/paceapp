import { Encoder } from "@garmin/fitsdk";
import type { ParsedActivity, RecordPoint } from "./types";

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
    mesg.positionLat = Math.round(r.lat * (2 ** 31 / 180));
    mesg.positionLong = Math.round(r.lng * (2 ** 31 / 180));
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

  // Write laps — use raw if not extended, otherwise rebuild
  if (activity.extended && raw.lapMesgs) {
    // Write original laps
    for (const m of raw.lapMesgs) {
      encoder.writeMesg({ mesgNum: MESG.lap, ...(m as Record<string, unknown>) });
    }
    // Add extension lap
    const extRecords = activity.records.slice(activity.originalRecordCount ?? 0);
    if (extRecords.length > 0) {
      encoder.writeMesg({ mesgNum: MESG.lap, ...buildExtensionLapMesg(extRecords, activity) });
    }
  } else {
    writeMesgs("lapMesgs", MESG.lap);
  }

  // Update session with full activity stats
  if (raw.sessionMesgs?.length) {
    const session = { ...(raw.sessionMesgs[0] as Record<string, unknown>) };
    if (activity.extended) {
      updateSessionFromRecords(session, activity.records);
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

function buildExtensionLapMesg(
  extRecords: RecordPoint[],
  activity: ParsedActivity
): Record<string, unknown> {
  const first = extRecords[0];
  const last = extRecords[extRecords.length - 1];
  const dist = last.distance - first.distance;
  const time = last.elapsed - first.elapsed;

  const avg = (vals: (number | undefined)[]) => {
    const v = vals.filter((x): x is number => x != null);
    return v.length > 0 ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
  };

  return {
    timestamp: last.timestamp,
    startTime: first.timestamp,
    event: "lap",
    eventType: "stop",
    lapTrigger: "manual",
    sport: activity.summary.sport ?? "running",
    subSport: "generic",
    totalElapsedTime: time,
    totalTimerTime: time,
    totalDistance: dist,
    avgSpeed: time > 0 ? dist / time : 0,
    avgHeartRate: avg(extRecords.map((r) => r.heartRate)),
    maxHeartRate: Math.max(...extRecords.map((r) => r.heartRate ?? 0)),
    avgCadence: avg(extRecords.map((r) => r.cadence != null ? r.cadence / 2 : undefined)),
    avgPower: avg(extRecords.map((r) => r.power)),
    messageIndex: (activity.laps.length),
  };
}

function updateSessionFromRecords(
  session: Record<string, unknown>,
  records: RecordPoint[]
) {
  if (records.length === 0) return;
  const last = records[records.length - 1];
  session.timestamp = last.timestamp;
  session.totalDistance = last.distance;
  session.totalElapsedTime = last.elapsed;
  session.totalTimerTime = last.elapsed;

  const avg = (vals: (number | undefined)[]) => {
    const v = vals.filter((x): x is number => x != null);
    return v.length > 0 ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
  };

  const avgHR = avg(records.map((r) => r.heartRate));
  if (avgHR) session.avgHeartRate = Math.round(avgHR);

  const avgSpeed = avg(records.map((r) => r.speed));
  if (avgSpeed) {
    session.avgSpeed = avgSpeed;
    session.enhancedAvgSpeed = avgSpeed;
  }
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
